/**
 * trae-usage-worktable · host 侧 Cordis 插件
 *
 * 运行在 DSH 宿主进程内（Node 权限：fs / child_process）。
 *
 * 路由前缀统一 `/api/trae-worktable/*`：上游 dsh-worktable 占用 `/api/worktable/*`，
 * DSH 的 exact 路由是先注册者胜出，抢同名路径会让上游健康检查读到本插件响应。
 *
 * 契约分层
 *   只读宿主状态   GET  /health      GET /sessions      GET /defaults      POST /transcript
 *   文件系统       POST /fs/list     POST /fs/read      POST /fs/write
 *                  POST /fs/mkdir    POST /fs/rename    POST /fs/stat
 *   命令           POST /term/exec（NDJSON 流）          POST /term/kill
 *   版本控制       POST /git（只读：status / log / branches）
 *   项目静态托管   POST /project/register               GET  /site/<id>/<rel...>（prefix）
 *
 * 安全边界（与上游有意不同）
 *   1. 所有路径必须落在白名单根内：进程 cwd、用户 home、DSH_HOME、已注册项目根。
 *   2. 先 realpath 解析符号链接再判根，避免 ../ 与 symlink 逃逸。
 *   3. 凭证目录（.ssh / .aws / .gnupg / .kube）直接拒绝。
 *   4. 不把任意请求体写进包目录（上游 /ping 就这么干过）。
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'

export const name = 'trae-usage-worktable'
export const inject = ['webServer']

const VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__
const BASE = '/api/trae-worktable'

export const HEALTH_PATH = BASE + '/health'
export const SESSIONS_PATH = BASE + '/sessions'
export const DEFAULTS_PATH = BASE + '/defaults'
export const TRANSCRIPT_PATH = BASE + '/transcript'

/* ---------- 上限 ---------- */
const MAX_DIR_ENTRIES = 800
const MAX_FILE_BYTES = 4 * 1024 * 1024
const MAX_WRITE_BYTES = 4 * 1024 * 1024
const MAX_PREVIEW_CHARS = 400_000
const MAX_SESSIONS = 200
const MAX_EVENT_SCAN = 400
const MAX_BODY_JSON = 64 * 1024
const MAX_TERM_OUTPUT = 512 * 1024
const TERM_TIMEOUT_MS = 120_000
const GIT_TIMEOUT_MS = 10_000

/* 凭证目录：即便在 home 内也不允许读写 */
const DENY_SEGMENTS = new Set(['.ssh', '.aws', '.gnupg', '.kube', '.password-store', '.docker/config.json'])

/* 已注册的项目根：/site 托管与文件读写白名单都靠它 */
const PROJECT_ROOTS = new Map()

/* 终端会话：id → { cwd, child, startedAt, overflow } */
const TERM_SESSIONS = new Map()

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer) {
    ctx.logger?.warn?.('[worktable] ctx.webServer 不可用，跳过服务端路由注册')
    return
  }

  const disposers = []
  const register = (route) => {
    const dispose = webServer.register(route)
    if (typeof dispose === 'function') disposers.push(dispose)
  }

  /* ---------- 宿主状态（只读） ---------- */

  register({
    kind: 'exact',
    path: HEALTH_PATH,
    handler: (req, res) => {
      if (!allowMethod(req, res, 'GET')) return
      sendJson(res, 200, {
        plugin: 'trae-usage-worktable',
        version: VERSION,
        ok: true,
        node: process.version,
        platform: process.platform,
        pid: process.pid,
        services: {
          sessions: !!service(ctx, 'sessions'),
          sessionQuery: !!service(ctx, 'sessionQuery'),
        },
        limits: { fileBytes: MAX_FILE_BYTES, dirEntries: MAX_DIR_ENTRIES, termOutput: MAX_TERM_OUTPUT },
      })
    },
  })

  register({
    kind: 'exact',
    path: SESSIONS_PATH,
    handler: (req, res) => {
      if (!allowMethod(req, res, 'GET')) return
      collectSessions(ctx).then(
        (payload) => sendJson(res, 200, payload),
        (err) => sendJson(res, 200, degradedSessions(err)),
      )
    },
  })

  register({
    kind: 'exact',
    path: DEFAULTS_PATH,
    handler: (req, res) => {
      if (!allowMethod(req, res, 'GET')) return
      collectDefaults(ctx).then(
        (payload) => sendJson(res, 200, payload),
        (err) => sendJson(res, 200, { ok: false, error: msg(err), workspace: '', home: '' }),
      )
    },
  })

  register({
    kind: 'exact',
    path: TRANSCRIPT_PATH,
    handler: async (req, res) => {
      if (!allowMethod(req, res, 'POST')) return
      const payload = await readJson(req, res, MAX_BODY_JSON)
      if (payload === undefined) return
      const sessionId = String(payload?.sessionId || '')
      if (!sessionId) return sendJson(res, 400, { error: 'sessionId required' })
      const limit = clampInt(payload?.limit, 1, 120, 40)
      try {
        sendJson(res, 200, await readTranscript(ctx, sessionId, limit))
      } catch (err) {
        sendJson(res, 200, { ok: false, sessionId, messages: [], error: msg(err) })
      }
    },
  })

  /* ---------- 文件系统 ---------- */

  register({ kind: 'exact', path: BASE + '/fs/list', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertExisting(body?.path, 'dir')
    const dirents = readdirSync(target, { withFileTypes: true })
    const rows = []
    for (const ent of dirents) {
      let size = 0
      let mtime = 0
      try {
        const st = statSync(join(target, ent.name))
        size = st.size
        mtime = st.mtimeMs
      } catch { /* 权限不足/损坏链接：保留条目但无 stat */ }
      const dir = ent.isDirectory() || (ent.isSymbolicLink() && isDirQuiet(join(target, ent.name)))
      rows.push({ name: ent.name, dir, link: ent.isSymbolicLink(), size, mtime })
    }
    rows.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
    const parent = dirname(target)
    sendJson(res, 200, {
      path: target,
      name: basename(target),
      parent: parent === target ? '' : parent,
      entries: rows.slice(0, MAX_DIR_ENTRIES),
      total: rows.length,
      truncated: rows.length > MAX_DIR_ENTRIES,
    })
  })})

  register({ kind: 'exact', path: BASE + '/fs/read', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertExisting(body?.path, 'file')
    const st = statSync(target)
    if (st.size > MAX_FILE_BYTES) {
      return sendJson(res, 413, { error: '文件过大（' + fmtBytes(st.size) + '），上限 ' + fmtBytes(MAX_FILE_BYTES) })
    }
    const raw = readFileSync(target)
    if (raw.subarray(0, 8192).includes(0)) {
      return sendJson(res, 415, { error: '二进制文件，无法以文本打开', binary: true, size: st.size })
    }
    let text = raw.toString('utf8')
    const truncated = text.length > MAX_PREVIEW_CHARS
    if (truncated) text = text.slice(0, MAX_PREVIEW_CHARS)
    sendJson(res, 200, {
      path: target,
      name: basename(target),
      size: st.size,
      mtime: st.mtimeMs,
      text,
      truncated,
      eol: text.includes('\r\n') ? 'crlf' : 'lf',
    })
  })})

  register({ kind: 'exact', path: BASE + '/fs/write', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_WRITE_BYTES + MAX_BODY_JSON)
    if (body === undefined) return
    if (typeof body?.text !== 'string') return sendJson(res, 400, { error: 'text 必须是字符串' })
    if (Buffer.byteLength(body.text, 'utf8') > MAX_WRITE_BYTES) return sendJson(res, 413, { error: '内容过大' })
    const target = await assertWritable(body?.path)
    mkdirSync(dirname(target), { recursive: true })
    const tmp = target + '.wt-tmp-' + process.pid
    writeFileSync(tmp, body.text, 'utf8')
    renameSync(tmp, target)
    sendJson(res, 200, { ok: true, path: target, size: Buffer.byteLength(body.text, 'utf8'), at: Date.now() })
  })})

  register({ kind: 'exact', path: BASE + '/fs/mkdir', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertWritable(body?.path)
    mkdirSync(target, { recursive: true })
    sendJson(res, 200, { ok: true, path: target })
  })})

  register({ kind: 'exact', path: BASE + '/fs/rename', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const from = await assertExisting(body?.from, 'any')
    const to = await assertWritable(body?.to)
    if (existsSync(to)) return sendJson(res, 409, { error: '目标已存在' })
    mkdirSync(dirname(to), { recursive: true })
    renameSync(from, to)
    sendJson(res, 200, { ok: true, from, to })
  })})

  /* 删除：一律走系统回收站 / 废纸篓，不做硬删。
     路径先过白名单，再拒绝「白名单根本身」和盘符根，免得一条请求把工作区端掉。 */
  register({ kind: 'exact', path: BASE + '/fs/delete', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertExisting(body?.path, 'any')
    if (dirname(target) === target) return sendJson(res, 400, { error: '不能删除磁盘根目录' })
    if (isProtectedRoot(target)) return sendJson(res, 403, { error: '不能删除工作区根目录：' + target })
    const r = await moveToTrash(target)
    if (!r.ok) return sendJson(res, 500, { error: '删除失败：' + msg(r.error) })
    sendJson(res, 200, { ok: true, path: target, trash: r.trash })
  })})

  register({ kind: 'exact', path: BASE + '/fs/stat', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertExisting(body?.path, 'any')
    const st = statSync(target)
    sendJson(res, 200, { path: target, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs })
  })})

  /* 用系统文件管理器打开（Windows 资源管理器 / macOS Finder / Linux 默认）。
     本插件不再自绘文件列表 —— 文件浏览整个交给系统窗口。
     离线测试用 WORKTABLE_OPEN_DRYRUN=1：照常校验路径，但不真的弹窗口。 */
  register({ kind: 'exact', path: BASE + '/fs/reveal', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertExisting(body?.path, 'any')
    const select = body?.select === true
    const dryRun = process.env.WORKTABLE_OPEN_DRYRUN === '1'
    if (dryRun) return sendJson(res, 200, { ok: true, path: target, select, dryRun: true, cmd: '' })
    const r = await openInSystem(target, select)
    logReveal(target, select, r)
    if (!r.ok) {
      console.warn('[worktable] 打开系统文件管理器失败', r.cmd, msg(r.error))
      return sendJson(res, 500, { error: '系统文件管理器启动失败：' + msg(r.error), path: target, cmd: r.cmd })
    }
    sendJson(res, 200, { ok: true, path: target, select, dryRun: false, cmd: r.cmd })
  })})

  /* ---------- 终端（NDJSON 流） ---------- */

  register({ kind: 'exact', path: BASE + '/term/exec', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const id = String(body?.id || '').slice(0, 64) || 'default'
    const cmd = String(body?.cmd ?? '')
    if (!cmd.trim()) return sendJson(res, 400, { error: 'cmd required' })
    if (cmd.length > 16_000) return sendJson(res, 400, { error: 'cmd 过长' })

    const term = ensureTerm(id, body?.cwd)
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    })
    const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n') } catch { /* 客户端已断开 */ } }
    const finish = () => { try { res.end() } catch { /* 已结束 */ } }

    const builtin = handleBuiltin(term, cmd)
    if (builtin) {
      if (builtin.clear) send({ t: 'clear' })
      if (builtin.note) send({ t: 'sys', d: builtin.note })
      send({ t: 'cwd', d: term.cwd })
      send({ t: 'end', code: builtin.code ?? 0 })
      return finish()
    }

    const { file, args } = shellCommand(cmd)
    let sent = 0
    let killed = false
    let child
    try {
      child = spawn(file, args, { cwd: term.cwd, windowsHide: true, env: shellEnv() })
    } catch (err) {
      send({ t: 'err', d: '无法启动 shell：' + msg(err) })
      send({ t: 'end', code: -1 })
      return finish()
    }
    term.child = child

    const push = (stream, chunk) => {
      if (killed) return
      const text = sanitize(chunk.toString('utf8'))
      if (!text) return
      sent += text.length
      if (sent > MAX_TERM_OUTPUT) {
        killed = true
        send({ t: 'err', d: '\n[worktable] 输出超过 ' + fmtBytes(MAX_TERM_OUTPUT) + '，已终止' })
        killTree(child)
        return
      }
      send({ t: stream, d: text })
    }

    child.stdout?.on('data', (c) => push('out', c))
    child.stderr?.on('data', (c) => push('err', c))

    const timer = setTimeout(() => {
      if (killed) return
      killed = true
      send({ t: 'err', d: '\n[worktable] 超过 ' + Math.round(TERM_TIMEOUT_MS / 1000) + 's 未结束，已终止' })
      killTree(child)
    }, TERM_TIMEOUT_MS)

    const done = (code, signal) => {
      clearTimeout(timer)
      if (term.child === child) term.child = null
      if (!killed) {
        send({ t: 'cwd', d: term.cwd })
        send({ t: 'end', code: code ?? (signal ? -1 : 0), signal: signal || undefined })
      } else {
        send({ t: 'end', code: -1, aborted: true })
      }
      finish()
    }
    child.on('error', (err) => { send({ t: 'err', d: msg(err) }); done(-1, null) })
    child.on('close', (code, signal) => done(code, signal))
    req.on('aborted', () => { killTree(child) })
  })})

  register({ kind: 'exact', path: BASE + '/term/kill', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const term = TERM_SESSIONS.get(String(body?.id || 'default'))
    if (term?.child) killTree(term.child)
    sendJson(res, 200, { ok: true })
  })})

  /* ---------- git（只读） ---------- */

  register({ kind: 'exact', path: BASE + '/git', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const cwd = await assertExisting(body?.path, 'dir')
    const op = String(body?.op || 'status')
    if (op === 'status') return sendJson(res, 200, await gitStatus(cwd))
    if (op === 'log') return sendJson(res, 200, await gitLog(cwd, clampInt(body?.limit, 1, 50, 15)))
    if (op === 'branches') return sendJson(res, 200, await gitBranches(cwd))
    return sendJson(res, 400, { error: '未知 op：' + op })
  })})

  /* ---------- 项目静态托管 ---------- */

  register({ kind: 'exact', path: BASE + '/project/register', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const id = String(body?.id || '')
    if (!id) return sendJson(res, 400, { error: 'id required' })
    let root = ''
    try { root = realpathSync(resolve(String(body?.root || ''))) } catch { /* 目录不存在：保持空，前端会提示 */ }
    if (root && !isDirQuiet(root)) root = ''
    if (root) PROJECT_ROOTS.set(id, root)
    else PROJECT_ROOTS.delete(id)
    sendJson(res, 200, { ok: !!root, id, root })
  })})

  register({ kind: 'prefix', path: BASE + '/site', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'GET')) return
    const url = new URL(req.url ?? '/', 'http://x')
    const rest = url.pathname.slice((BASE + '/site').length).replace(/^\/+/, '')
    const slash = rest.indexOf('/')
    const id = decodeURIComponent(slash === -1 ? rest : rest.slice(0, slash))
    const rel = slash === -1 ? '' : decodeURIComponent(rest.slice(slash + 1))
    const root = PROJECT_ROOTS.get(id)
    if (!root) return sendJson(res, 404, { error: '项目未注册静态托管：' + id })

    const target = safeJoin(root, rel || 'index.html')
    if (!target) return sendJson(res, 403, { error: '路径越界' })
    let file = target
    if (!rel || isDirQuiet(file)) {
      const index = join(isDirQuiet(file) ? file : root, 'index.html')
      if (existsSync(index)) file = index
      else if (!rel || isDirQuiet(target)) return sendListing(res, isDirQuiet(target) ? target : root)
    }
    let st
    try { st = statSync(file) } catch {
      return sendJson(res, 404, { error: '文件不存在：' + (rel || 'index.html') })
    }
    if (!st.isFile()) return sendJson(res, 404, { error: '不是文件' })
    res.writeHead(200, {
      'content-type': mimeOf(file),
      'content-length': st.size,
      'cache-control': 'no-store',
    })
    createReadStream(file).on('error', () => { try { res.destroy() } catch { /* 已关闭 */ } }).pipe(res)
  })})

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => () => {
      for (const dispose of disposers) { try { dispose() } catch { /* 已移除 */ } }
      for (const term of TERM_SESSIONS.values()) if (term.child) killTree(term.child)
      TERM_SESSIONS.clear()
      PROJECT_ROOTS.clear()
    }, 'trae-usage-worktable: routes')
  }

  ctx.logger?.info?.('[worktable] host 已加载 ' + VERSION + ' · ' + BASE)
}

/* ============================ 会话快照 ============================ */

async function collectSessions(ctx) {
  const at = Date.now()
  const sessionsSvc = service(ctx, 'sessions')
  const querySvc = service(ctx, 'sessionQuery')
  /* agents 注册表：agent.status 是 DSH 自己维护的 'running' / 'idle'，
     比我们从事件日志推断「这一轮开没开」可靠得多 —— 状态灯对不上的根因就在这。 */
  const agentsSvc = service(ctx, 'agents')

  let rows = []
  let source = 'live'
  let note = ''

  if (querySvc && typeof querySvc.listSessions === 'function') {
    try {
      const list = await querySvc.listSessions()
      if (Array.isArray(list) && list.length) { rows = list; source = 'sessionQuery' }
    } catch (err) {
      note = 'sessionQuery.listSessions 失败：' + msg(err)
    }
  }
  if (!rows.length && sessionsSvc && typeof sessionsSvc.list === 'function') {
    try {
      const list = sessionsSvc.list()
      if (Array.isArray(list)) {
        rows = list.map((s) => ({ header: s?.header ?? { id: String(s?.id ?? '') }, live: true, persisted: false }))
        source = 'live'
      }
    } catch (err) {
      note = note ? note + ' / ' + msg(err) : 'sessions.list 失败：' + msg(err)
    }
  }

  const counts = { running: 0, waiting: 0, done: 0, idle: 0, total: 0 }
  const out = []

  for (const row of rows.slice(0, MAX_SESSIONS)) {
    const header = row?.header ?? {}
    const id = String(header.id ?? '')
    if (!id) continue
    /* 行来自 sessionQuery 时 live 标记常常缺失（持久化列表只给 header），
       不能拿它判活会话 —— 只要会话服务里还拿得到这个 id，就去读事件日志，
       否则「进行中 / 待处理」永远算不出来（侧边栏状态一直不动就是这么来的）。 */
    const session = sessionsSvc && typeof sessionsSvc.get === 'function'
      ? safe(() => sessionsSvc.get(id))
      : null
    const agent = agentsSvc && typeof agentsSvc.get === 'function' ? safe(() => agentsSvc.get(id)) : null
    const agentStatus = agent ? String(safe(() => agent.status) || '') : ''
    const observed = readSessionState(session)
    const live = row?.live === true || isLiveSession(session) || !!agent
    const state = pickState(live, observed, agentStatus)
    counts[state] = (counts[state] ?? 0) + 1
    counts.total += 1
    out.push({
      id,
      title: safeTitle(header, observed),
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      state,
      live,
      agent: agentStatus || undefined,
      persisted: row?.persisted === true,
      createdAt: Number(header.createdAt) || 0,
      updatedAt: observed.updatedAt || Number(header.createdAt) || 0,
      turns: observed.turns,
    })
  }

  out.sort((a, b) => (b.updatedAt - a.updatedAt) || a.id.localeCompare(b.id))
  return {
    ok: true,
    at,
    version: VERSION,
    source,
    degraded: !sessionsSvc && !querySvc,
    note: note || undefined,
    counts,
    sessions: out,
  }
}

function degradedSessions(err) {
  return {
    ok: false,
    at: Date.now(),
    degraded: true,
    error: msg(err),
    counts: { running: 0, waiting: 0, done: 0, idle: 0, total: 0 },
    sessions: [],
  }
}

async function collectDefaults(ctx) {
  let workspace = ''
  const querySvc = service(ctx, 'sessionQuery')
  if (querySvc && typeof querySvc.listSessions === 'function') {
    try {
      const rows = await querySvc.listSessions()
      const cwd = Array.isArray(rows) ? rows[0]?.header?.cwd : ''
      if (typeof cwd === 'string' && cwd) workspace = cwd
    } catch { /* 落到下面的兜底 */ }
  }
  if (!workspace) {
    const sessionsSvc = service(ctx, 'sessions')
    const list = safe(() => sessionsSvc?.list?.()) || []
    for (const s of list) {
      if (typeof s?.header?.cwd === 'string' && s.header.cwd) { workspace = s.header.cwd; break }
    }
  }
  if (!workspace) workspace = process.cwd()
  return {
    ok: true,
    at: Date.now(),
    workspace,
    home: String(safe(() => process.env.DSH_HOME) || ''),
    platform: process.platform,
    shell: shellLabel(),
  }
}

async function readTranscript(ctx, sessionId, limit) {
  const querySvc = service(ctx, 'sessionQuery')
  const sessionsSvc = service(ctx, 'sessions')
  let header = null
  let events = null
  let live = false

  const liveSession = safe(() => sessionsSvc?.get?.(sessionId))
  if (liveSession) {
    live = true
    header = liveSession.header || null
    events = Array.isArray(liveSession.log) ? liveSession.log : null
  }
  if (!events && querySvc && typeof querySvc.load === 'function') {
    const loaded = await querySvc.load(sessionId).catch(() => null)
    if (loaded) {
      header = loaded.header || null
      events = Array.isArray(loaded.events) ? loaded.events : null
    }
  }
  if (!events) return { ok: false, sessionId, live, messages: [], total: 0, truncated: false, error: 'session not found' }

  const { messages, total } = messagesOf(events, limit)
  return {
    ok: true,
    sessionId,
    live,
    title: transcriptTitle(header, events),
    cwd: typeof header?.cwd === 'string' ? header.cwd : '',
    messages,
    total,
    truncated: total > messages.length,
  }
}

function messagesOf(events, limit) {
  const tail = events.slice(Math.max(0, events.length - 800))
  const out = []
  for (const ev of tail) {
    if (!ev || typeof ev !== 'object') continue
    const time = Number(ev.time) || 0
    const id = String(ev.seq ?? out.length)
    if (ev.type === 'user/message') {
      const kind = ev?.data?.source?.kind
      if (kind && kind !== 'user') continue
      const text = textOfContent(ev?.data?.content)
      if (text) out.push({ id, role: 'user', text: clip(text), time })
    } else if (ev.type === 'assistant/message') {
      const parts = ev?.data?.message?.content
      const text = textOfContent(parts)
      const tools = Array.isArray(parts) ? parts.filter((p) => p && p.type === 'tool-call').length : 0
      if (text || tools) {
        out.push({ id, role: 'assistant', text: text ? clip(text) : '（调用工具 ' + tools + ' 次）', time })
      }
    }
  }
  return { messages: out.slice(-limit), total: out.length }
}

function textOfContent(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  const chunks = []
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) chunks.push(part.text.trim())
  }
  return chunks.join('\n\n')
}

function clip(text, max = 4000) {
  const s = String(text)
  return s.length > max ? s.slice(0, max) + '\n…（已截断）' : s
}

function transcriptTitle(header, events) {
  let title = ''
  for (let i = events.length - 1; i >= 0 && i >= events.length - 400; i -= 1) {
    const ev = events[i]
    if (ev && ev.type === 'session/title') {
      const t = ev?.data?.title
      if (typeof t === 'string' && t.trim()) { title = t.trim(); break }
    }
  }
  if (title) return title
  return safeTitle(header || {}, { title: '' })
}

/** 会话服务里的对象是不是「还活着」：拿得到事件日志或 seq 就算（与 row.live 无关） */
function isLiveSession(session) {
  if (!session) return false
  if (Array.isArray(session.log)) return session.log.length > 0
  return Number(safe(() => session.seq)) > 0
}

/**
 * 四态判定，优先级：
 *   1. agent.status（DSH 权威状态）—— running 时再用事件里的审批记录区分「进行中 / 待处理」；
 *   2. 退回到事件日志推断（agent 已卸载的历史会话、或者宿主没挂 agents 服务时）；
 *   3. 都没有就按「有没有跑过一轮」分 done / idle。
 */
function pickState(live, observed, agentStatus) {
  if (agentStatus === 'running') return observed.pendingApproval ? 'waiting' : 'running'
  if (agentStatus === 'idle') return observed.turns > 0 ? 'done' : 'idle'
  if (live && observed.openTurn) return observed.pendingApproval ? 'waiting' : 'running'
  if (observed.turns > 0) return 'done'
  return 'idle'
}

function readSessionState(session) {
  const result = { openTurn: false, pendingApproval: false, turns: 0, updatedAt: 0, title: '' }
  if (!session) return result
  const log = Array.isArray(session.log) ? session.log : null
  const seq = log ? log.length : Number(safe(() => session.seq)) || 0
  if (!seq) return result

  const start = Math.max(0, seq - MAX_EVENT_SCAN)
  let lastTurnStart = -1
  let lastTurnEnd = -1
  let askedAfter = -1
  let decidedAfter = -1
  let lastTime = 0
  let title = ''

  for (let i = start; i < seq; i += 1) {
    const ev = log ? log[i] : safe(() => session.eventAt(i))
    if (!ev || typeof ev !== 'object') continue
    const type = String(ev.type ?? '')
    const time = Number(ev.time) || 0
    if (time > lastTime) lastTime = time
    if (type === 'turn/start') {
      lastTurnStart = i
      result.turns += 1
      askedAfter = -1
      decidedAfter = -1
    } else if (type === 'turn/end') {
      lastTurnEnd = i
    } else if (type === 'approval/asked') {
      askedAfter = i
    } else if (type === 'approval/decided') {
      decidedAfter = i
    } else if (type === 'session/title') {
      const t = ev?.data?.title
      if (typeof t === 'string' && t.trim()) title = t.trim()
    } else if (!title && type === 'user/message') {
      const text = textOfContent(ev?.data?.content)
      if (text) title = text.slice(0, 60)
    }
  }

  result.openTurn = lastTurnStart > lastTurnEnd
  result.pendingApproval = result.openTurn && askedAfter > decidedAfter
  result.updatedAt = lastTime
  result.title = title
  return result
}

function safeTitle(header, observed) {
  if (observed?.title) return observed.title
  const cwd = typeof header?.cwd === 'string' ? header.cwd : ''
  if (cwd) {
    const parts = cwd.split(/[\\/]+/).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  const id = String(header?.id ?? '')
  return id ? id.slice(0, 18) : '未命名会话'
}

/* ============================ 系统文件管理器 ============================ */

const psQuote = (p) => "'" + String(p).replace(/'/g, "''") + "'"

/** 白名单根本身不许删（工作目录 / home / DSH_HOME / 已注册项目根） */
function isProtectedRoot(target) {
  const norm = process.platform === 'win32' ? target.toLowerCase() : target
  for (const root of canonicalRoots()) {
    const r = process.platform === 'win32' ? root.toLowerCase() : root
    if (norm === r) return true
  }
  return false
}

/**
 * 丢进系统回收站（Windows 回收站 / macOS 废纸篓 / Linux gio trash）。
 * 不用 rm / fs.rm —— 文件管理器里的删除必须是能后悔的。
 */
function moveToTrash(target) {
  return new Promise((resolveP) => {
    const done = (ok, extra) => resolveP({ ok, ...(extra || {}) })
    let cmd
    let args
    if (process.platform === 'win32') {
      const isDir = isDirQuiet(target)
      const script = [
        '$ErrorActionPreference = "Stop"',
        'Add-Type -AssemblyName Microsoft.VisualBasic',
        '[Microsoft.VisualBasic.FileIO.FileSystem]::' + (isDir ? 'DeleteDirectory' : 'DeleteFile')
          + '(' + psQuote(target) + ", 'OnlyErrorDialogs', 'SendToRecycleBin')",
      ].join('; ')
      const ps = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      cmd = existsSync(ps) ? ps : 'powershell.exe'
      args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
    } else if (process.platform === 'darwin') {
      cmd = 'osascript'
      args = ['-e', 'tell application "Finder" to delete POSIX file "' + String(target).replace(/"/g, '\\"') + '"']
    } else {
      cmd = 'gio'
      args = ['trash', target]
    }

    let child
    try {
      child = spawn(cmd, args, { windowsHide: true })
    } catch (err) {
      done(false, { error: msg(err) })
      return
    }
    let errText = ''
    try { child.stderr?.on('data', (d) => { errText += String(d) }) } catch { /* 无 stderr */ }
    child.on('error', (err) => done(false, { error: msg(err) }))
    child.on('exit', (code) => {
      if (code === 0) done(true, { trash: true })
      else done(false, { error: errText.trim() || ('退出码 ' + code) })
    })
  })
}

/**
 * 每次「打开系统文件管理器」记一行到 ~/.dsh/worktable-reveal.log。
 * 用户说「打不开」时，这是唯一能区分「根本没调用 / 调用了但失败 / 调用成功但窗口没到前台」的证据。
 */
const REVEAL_LOG_MAX = 128 * 1024

function logReveal(target, select, r) {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const file = join(home, 'worktable-reveal.log')
    try { if (statSync(file).size > REVEAL_LOG_MAX) writeFileSync(file, '') } catch { /* 首次写入 */ }
    const parts = [
      new Date().toISOString(),
      r.ok ? 'ok' : 'fail',
      'select=' + (select ? 1 : 0),
      r.cmd || '-',
      target,
      r.ok ? '' : msg(r.error),
    ]
    appendFileSync(file, parts.join(' | ') + '\n', 'utf8')
  } catch { /* 日志写不了不影响主流程 */ }
}

/** Windows 上 explorer.exe 的绝对路径（PATH 在打包后的 Electron 里不一定完整） */function explorerExe() {
  const root = process.env.SystemRoot || process.env.windir || 'C:\\Windows'
  const exe = join(root, 'explorer.exe')
  return existsSync(exe) ? exe : 'explorer.exe'
}

/**
 * 把路径交给操作系统的文件管理器。目录 → 打开该目录；文件 + select → 在资源管理器里选中它。
 *
 * 两个坑：
 *  1. explorer.exe 的退出码不可信 —— 正常打开也常返回 1，所以「exit」一律算成功，
 *     只有 spawn 本身失败（ENOENT/EACCES）才算失败；
 *  2. 必须 detached + unref，否则会被宿主的子进程管理连带回收，窗口一闪就没。
 */
function openInSystem(target, select) {
  return new Promise((resolveP) => {
    let cmd
    let args
    if (process.platform === 'win32') {
      cmd = explorerExe()
      /* /select, 与路径必须是一个参数，Node 会在含空格时整串加引号，explorer 认 */
      args = [select ? '/select,' + target : target]
    } else if (process.platform === 'darwin') {
      cmd = 'open'
      args = select ? ['-R', target] : [target]
    } else {
      cmd = 'xdg-open'
      args = [select ? dirname(target) : target]
    }

    let child
    try {
      child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false })
    } catch (err) {
      resolveP({ ok: false, error: msg(err), cmd })
      return
    }

    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolveP(r) } }
    child.on('error', (err) => done({ ok: false, error: msg(err), cmd }))
    child.on('exit', (code) => done({ ok: true, code, cmd }))
    /* explorer 可能把请求转交给已在运行的实例后立刻退出，1.5s 兜底 */
    setTimeout(() => done({ ok: true, code: null, cmd }), 1500)
    try { child.unref() } catch { /* 已经退出 */ }
  })
}

/* ============================ git ============================ */

function runGit(cwd, args) {
  return new Promise((resolveP) => {
    execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout, stderr) => resolveP({
        ok: !err,
        code: typeof err?.code === 'number' ? err.code : (err ? -1 : 0),
        out: String(stdout || ''),
        err: String(stderr || (err && !stdout ? msg(err) : '')),
      }))
  })
}

async function gitStatus(cwd) {
  const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok || !inside.out.includes('true')) {
    return { ok: false, repo: false, error: inside.err || '不是 git 仓库' }
  }
  const [branch, porcelain] = await Promise.all([
    runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']),
    runGit(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all']),
  ])
  const changes = []
  const parts = porcelain.out.split('\0')
  for (let i = 0; i < parts.length; i += 1) {
    const row = parts[i]
    if (!row || row.length < 3) continue
    const code = row.slice(0, 2)
    const file = row.slice(3)
    if (code[0] === 'R' || code[0] === 'C') {
      // -z 模式下重命名是「新路径\0旧路径」，旧路径在下一段
      const from = parts[i + 1] || ''
      i += 1
      changes.push({ code, file, from })
    } else {
      changes.push({ code, file })
    }
  }
  const staged = changes.filter((c) => c.code[0] !== ' ' && c.code[0] !== '?').length
  const unstaged = changes.filter((c) => c.code[1] !== ' ' && c.code[0] !== '?').length
  const untracked = changes.filter((c) => c.code === '??').length
  return {
    ok: true,
    repo: true,
    branch: branch.out.trim() || '(detached)',
    ahead: 0,
    changes,
    counts: { staged, unstaged, untracked, total: changes.length },
    at: Date.now(),
  }
}

async function gitLog(cwd, limit) {
  const res = await runGit(cwd, ['log', '-n', String(limit), '--date=short', '--pretty=format:%h%x1f%ad%x1f%s%x1f%an'])
  if (!res.ok) return { ok: false, commits: [], error: res.err }
  const commits = res.out.split('\n').filter(Boolean).map((line) => {
    const [hash, date, subject, author] = line.split('\x1f')
    return { hash, date, subject, author }
  })
  return { ok: true, commits }
}

async function gitBranches(cwd) {
  const res = await runGit(cwd, ['branch', '--format=%(refname:short)'])
  if (!res.ok) return { ok: false, branches: [], error: res.err }
  return { ok: true, branches: res.out.split('\n').filter(Boolean) }
}

/* ============================ 终端 ============================ */

function ensureTerm(id, cwd) {
  let term = TERM_SESSIONS.get(id)
  if (!term) {
    let dir = process.cwd()
    if (typeof cwd === 'string' && cwd) {
      try {
        const real = realpathSync(resolve(cwd))
        if (isDirQuiet(real)) dir = real
      } catch { /* 用默认目录 */ }
    }
    term = { id, cwd: dir, child: null, startedAt: Date.now() }
    TERM_SESSIONS.set(id, term)
    if (TERM_SESSIONS.size > 12) {
      const oldest = [...TERM_SESSIONS.values()].sort((a, b) => a.startedAt - b.startedAt)[0]
      if (oldest && oldest.id !== id) {
        if (oldest.child) killTree(oldest.child)
        TERM_SESSIONS.delete(oldest.id)
      }
    }
  } else if (typeof cwd === 'string' && cwd) {
    try {
      const real = realpathSync(resolve(cwd))
      if (isDirQuiet(real) && real !== term.cwd) term.cwd = real
    } catch { /* 保持原 cwd */ }
  }
  return term
}

/** cd / clear / pwd / exit 这类改自身状态的命令在 host 侧处理，不启进程 */
function handleBuiltin(term, raw) {
  const cmd = raw.trim()
  if (/^(clear|cls)$/i.test(cmd)) return { clear: true, code: 0 }
  if (/^pwd$/i.test(cmd) || /^cd$/i.test(cmd) && process.platform !== 'win32') {
    return { note: term.cwd, code: 0 }
  }
  const m = /^cd\s+(.+)$/i.exec(cmd)
  if (!m) return null
  let target = m[1].trim().replace(/^["']|["']$/g, '')
  if (!target || target === '~') target = homedir()
  else if (target === '-') return { note: '（不支持返回上一个目录）', code: 0 }
  const abs = isAbsolute(target) ? target : resolve(term.cwd, target)
  try {
    const real = realpathSync(abs)
    if (!isDirQuiet(real)) return { note: '不是目录：' + abs, code: 1 }
    term.cwd = real
    return { note: real, code: 0 }
  } catch {
    return { note: '目录不存在：' + abs, code: 1 }
  }
}

function shellLabel() {
  if (process.platform !== 'win32') return process.env.SHELL || '/bin/sh'
  return powershellPath() ? 'powershell' : (process.env.COMSPEC || 'cmd.exe')
}

let _psPath
function powershellPath() {
  if (_psPath !== undefined) return _psPath
  const root = process.env.SystemRoot || 'C:\\Windows'
  const p = join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  _psPath = existsSync(p) ? p : ''
  return _psPath
}

function shellCommand(cmd) {
  if (process.platform !== 'win32') {
    return { file: process.env.SHELL || '/bin/sh', args: ['-c', cmd] }
  }
  const ps = powershellPath()
  if (ps) {
    const prelude = '[Console]::OutputEncoding=[Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";'
    return { file: ps, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', prelude + cmd] }
  }
  return { file: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', cmd] }
}

function shellEnv() {
  return { ...process.env, PYTHONIOENCODING: 'utf-8', NO_COLOR: '1', TERM: 'dumb', FORCE_COLOR: '0' }
}

function killTree(child) {
  if (!child || child.killed) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
      return
    }
    child.kill('SIGTERM')
    setTimeout(() => { try { child.kill('SIGKILL') } catch { /* 已退出 */ } }, 1200)
  } catch { /* 进程已消失 */ }
}

/** 去掉 ANSI 转义与 \r，前端只按纯文本渲染 */
function sanitize(text) {
  return String(text)
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*\u0007/g, '')
    .replace(/\u001b[@-Z\\-_]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

/* ============================ 路径沙箱 ============================ */

function canonicalRoots() {
  const list = [process.cwd(), homedir(), process.env.DSH_HOME, ...PROJECT_ROOTS.values()]
  const out = []
  for (const item of list) {
    if (typeof item !== 'string' || !item) continue
    try { out.push(realpathSync(item)) } catch { /* 不存在就跳过 */ }
  }
  return out
}

/** 逐级向上找第一个存在的祖先，realpath 后拼回剩余部分 */
function canonicalize(target) {
  const abs = resolve(target)
  let probe = abs
  const rest = []
  for (let depth = 0; depth < 64; depth += 1) {
    try {
      return join(realpathSync(probe), ...rest.reverse())
    } catch {
      const parent = dirname(probe)
      if (parent === probe) return abs
      rest.push(basename(probe))
      probe = parent
    }
  }
  return abs
}

function insideRoot(target, roots) {
  const norm = process.platform === 'win32' ? target.toLowerCase() : target
  for (const root of roots) {
    const r = process.platform === 'win32' ? root.toLowerCase() : root
    if (norm === r) return true
    if (norm.startsWith(r.endsWith(sep) ? r : r + sep)) return true
  }
  return false
}

function hasDeniedSegment(target) {
  const parts = target.split(/[\\/]+/).map((p) => p.toLowerCase())
  for (const bad of DENY_SEGMENTS) if (parts.includes(bad.toLowerCase())) return true
  return false
}

function assertSandbox(target) {
  if (typeof target !== 'string' || !target.trim()) throw httpError(400, 'path required')
  if (target.includes('\0')) throw httpError(400, 'invalid path')
  if (!isAbsolute(target)) throw httpError(400, 'path must be absolute')
  const canonical = canonicalize(target)
  if (hasDeniedSegment(canonical)) throw httpError(403, '该目录受保护：' + canonical)
  if (!insideRoot(canonical, canonicalRoots())) {
    throw httpError(403, '路径不在允许范围（工作目录 / 用户目录 / 已注册项目）内：' + canonical)
  }
  return canonical
}

async function assertExisting(target, kind) {
  const real = assertSandbox(target)
  let st
  try {
    st = statSync(real)
  } catch {
    throw httpError(404, '路径不存在：' + real)
  }
  if (kind === 'dir' && !st.isDirectory()) throw httpError(400, '不是目录：' + real)
  if (kind === 'file' && !st.isFile()) throw httpError(400, '不是文件：' + real)
  return real
}

async function assertWritable(target) {
  return assertSandbox(target)
}

function safeJoin(root, rel) {
  const clean = String(rel || '').replace(/\\/g, '/')
  if (clean.split('/').some((p) => p === '..')) return ''
  const target = resolve(root, clean)
  const norm = process.platform === 'win32' ? target.toLowerCase() : target
  const r = process.platform === 'win32' ? root.toLowerCase() : root
  if (norm !== r && !norm.startsWith(r.endsWith(sep) ? r : r + sep)) return ''
  return target
}

function isDirQuiet(p) {
  try { return statSync(p).isDirectory() } catch { return false }
}

/* ============================ 工具 ============================ */

function service(ctx, name_) {
  const direct = safe(() => ctx?.[name_])
  if (direct) return direct
  return safe(() => (typeof ctx?.get === 'function' ? ctx.get(name_) : null)) || null
}

function safe(fn) { try { return fn() } catch { return undefined } }
function msg(e) { return String(e?.message ?? e) }
function clampInt(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}
function fmtBytes(n) {
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
  return n + ' B'
}
function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function allowMethod(req, res, method) {
  const actual = String(req?.method || 'GET').toUpperCase()
  if (actual === method || (method === 'GET' && actual === 'HEAD')) return true
  sendJson(res, 405, { error: '仅支持 ' + method })
  return false
}

function sendJson(res, status, body) {
  if (res.writableEnded) return
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function readJson(req, res, limit) {
  return new Promise((resolveP) => {
    let body = ''
    let settled = false
    const fail = (status, message) => {
      if (settled) return
      settled = true
      sendJson(res, status, { error: message })
      resolveP(undefined)
    }
    req.on('data', (chunk) => {
      if (settled) return
      body += chunk
      if (body.length > limit) fail(413, '请求体过大')
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      if (!body.trim()) return resolveP({})
      try {
        resolveP(JSON.parse(body))
      } catch {
        sendJson(res, 400, { error: 'invalid json' })
        resolveP(undefined)
      }
    })
    req.on('error', (err) => fail(400, msg(err)))
  })
}

function guard(handler) {
  return async (req, res) => {
    try {
      await handler(req, res)
    } catch (err) {
      const status = Number(err?.status) || 500
      if (status >= 500) console.warn('[worktable]', msg(err))
      if (!res.writableEnded) sendJson(res, status, { error: msg(err) })
    }
  }
}

/** 没有 index.html 时给一个纯静态目录页，浏览器窗格不至于只看到 404 JSON */
function sendListing(res, dir) {
  let rows = []
  try {
    rows = readdirSync(dir, { withFileTypes: true })
      .map((d) => ({ name: d.name, dir: d.isDirectory() }))
      .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1))
  } catch (err) {
    return sendJson(res, 403, { error: '目录不可读：' + msg(err) })
  }
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const items = rows.map((r) => '<li><a href="' + encodeURIComponent(r.name) + (r.dir ? '/' : '') + '">'
    + (r.dir ? '📁 ' : '📄 ') + esc(r.name) + (r.dir ? '/' : '') + '</a></li>').join('')
  const html = '<!doctype html><meta charset="utf-8"><title>' + esc(basename(dir)) + '</title>'
    + '<style>body{font:14px/1.6 system-ui,"Segoe UI",sans-serif;background:#0f1218;color:#dfe4ea;padding:28px}'
    + 'h1{font-size:16px;color:#f0b429;margin:0 0 4px}p{color:#6e7683;font-size:12px;margin:0 0 16px}'
    + 'ul{list-style:none;padding:0;margin:0}li{border-bottom:1px solid #1c2129}'
    + 'a{display:block;padding:7px 4px;color:#cfd6df;text-decoration:none}a:hover{color:#f0b429}</style>'
    + '<h1>' + esc(basename(dir)) + '</h1><p>没有 index.html，这是托管目录列表</p><ul>' + items + '</ul>'
  const body = Buffer.from(html, 'utf8')
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' })
  res.end(body)
}

function mimeOf(file) {
  const ext = extname(file).toLowerCase()
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  }
  return map[ext] || 'application/octet-stream'
}
