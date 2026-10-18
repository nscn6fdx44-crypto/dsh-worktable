/**
 * trae-usage-worktable · host 侧 Cordis 插件（MVP）
 *
 * 运行在 DSH 宿主进程内，有完整 Node 权限（fs / child_process / 进程环境）。
 *
 * 路由：
 *   MVP（本期主链路）
 *     GET  /api/trae-worktable/health   插件版本 + 会话服务可用性探针
 *     GET  /api/trae-worktable/sessions 宿主机会话快照（运行中 / 待处理 / 已完成）—— 不调模型
 *   P1 只读工作区（保留，P2 分栏/终端直接复用）
 *     POST /api/trae-worktable/tree
 *     POST /api/trae-worktable/file
 *   排障探针（P2 稳定后移除）
 *     /api/trae-worktable/{health,ping,pings}
 *
 * 路由前缀的由来（真机踩过两次）：
 *   上游 dsh-worktable@0.4.0 占用 /api/worktable/*。DSH 的 exact 路由是「先注册者胜出」，
 *   本插件若注册同名路径，上游的健康检查就会读到本插件的响应（实测复现过）。
 *   因此本插件所有路由统一 /api/trae-worktable/*，永不碰上游前缀。
 *
 * 会话状态的读取边界（重要）：
 *   只用 Cordis 的 sessions / sessionQuery 服务读宿主已有快照与事件日志，
 *   不发任何模型请求，也不写宿主数据。取不到服务时降级为 200 + degraded 标记，
 *   绝不因为统计失败把宿主页面拖挂。
 */
import { appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'

export const name = 'trae-usage-worktable'
export const inject = ['webServer']

/** 构建期由 esbuild define 注入；未构建时兜底 dev */
const PLUGIN_VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__

/**
 * 路由前缀：全部走 `/api/trae-worktable/*`，与上游 dsh-worktable 的
 * `/api/worktable/*` 彻底隔离。
 *
 * 曾短暂「接管」过上游前缀（上游缺席时），现上游已装回并启用 ——
 * DSH 的 exact 路由是「先注册者胜出」，同名路径会让上游的健康检查读到本插件的响应。
 * 因此本插件永久让出 `/api/worktable/*`，client 的 API 常量同步指向本前缀。
 */
export const HEALTH_PATH = '/api/trae-worktable/health'
export const SESSIONS_PATH = '/api/trae-worktable/sessions'
export const DEFAULTS_PATH = '/api/trae-worktable/defaults'
export const TRANSCRIPT_PATH = '/api/trae-worktable/transcript'

const PING_PATH = '/api/trae-worktable/ping'
const PINGS_PATH = '/api/trae-worktable/pings'
const TREE_PATH = '/api/trae-worktable/tree'
const FILE_PATH = '/api/trae-worktable/file'

/** 探针日志落在插件包根目录（与 lib/ 同级），便于安装后定位 */
const PING_LOG = fileURLToPath(new URL('../.tmp-pings.jsonl', import.meta.url))

/* 上限：目录条目数 / 文件字节 / 预览字符数 / 会话条数 / 会话事件扫描深度 */
const MAX_DIR_ENTRIES = 500
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_PREVIEW_CHARS = 200_000
const MAX_SESSIONS = 200
const MAX_EVENT_SCAN = 400

/* 文本白名单（无扩展名的常见文本文件单独列出） */
const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.jsonc', '.json5', '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts', '.css', '.scss', '.less', '.html', '.htm',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cc', '.cpp', '.hpp', '.cs', '.php', '.lua',
  '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd', '.sql', '.graphql', '.vue', '.svelte', '.astro',
  '.xml', '.csv', '.tsv', '.log', '.env', '.gitignore', '.gitattributes', '.editorconfig', '.npmrc',
])
const TEXT_NAME = new Set(['LICENSE', 'NOTICE', 'README', 'Makefile', 'Dockerfile', 'Procfile', '.gitignore'])

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer) {
    // headless profile（无 web 服务）时静默降级，不影响宿主其他插件
    ctx.logger?.warn?.('[worktable] ctx.webServer 不可用，跳过服务端路由注册')
    return
  }

  const route = (path, handler) => webServer.register({ kind: 'exact', path, handler })

  /* ---------- MVP ---------- */

  route(HEALTH_PATH, (_req, res) => {
    const services = {
      sessions: hasService(ctx, 'sessions'),
      sessionQuery: hasService(ctx, 'sessionQuery'),
    }
    json(res, 200, {
      plugin: 'trae-usage-worktable',
      version: PLUGIN_VERSION,
      ok: true,
      node: process.version,
      platform: process.platform,
      services,
    })
  })

  route(SESSIONS_PATH, (req, res) => {
    collectSessions(ctx)
      .then((payload) => json(res, 200, payload))
      .catch((err) => json(res, 200, {
        ok: false,
        at: Date.now(),
        degraded: true,
        error: String(err?.message ?? err),
        counts: { running: 0, waiting: 0, done: 0, idle: 0, total: 0 },
        sessions: [],
      }))
  })

  /* ---------- 默认路径 / 绑定对话只读预览 ---------- */

  route(DEFAULTS_PATH, (_req, res) => {
    collectDefaults(ctx)
      .then((payload) => json(res, 200, payload))
      .catch((err) => json(res, 200, { ok: false, error: msg(err), workspace: '', home: '' }))
  })

  route(TRANSCRIPT_PATH, (req, res) => {
    readBody(req, 16 * 1024, (err, body) => {
      if (err) return json(res, 400, { error: err })
      let payload
      try { payload = JSON.parse(body || '{}') } catch { return json(res, 400, { error: 'invalid json' }) }
      const sessionId = String(payload?.sessionId || '')
      if (!sessionId) return json(res, 400, { error: 'sessionId required' })
      const limit = Math.min(100, Math.max(1, Number(payload?.limit) || 40))
      readTranscript(ctx, sessionId, limit)
        .then((data) => json(res, 200, data))
        .catch((e) => json(res, 200, { ok: false, sessionId, messages: [], error: msg(e) }))
    })
  })

  /* ---------- P1 只读工作区 ---------- */

  route(PING_PATH, (req, res) => {
    readBody(req, 16 * 1024, (err, body) => {
      if (!err && body && PING_LOG) {
        try { appendFileSync(PING_LOG, body.trim() + '\n') } catch { /* 磁盘不可写时静默 */ }
      }
      json(res, 200, { ok: true })
    })
  })

  route(PINGS_PATH, (_req, res) => {
    let text = ''
    try { text = readFileSync(PING_LOG, 'utf8') } catch { /* 无记录时返回空 */ }
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(text)
  })

  route(TREE_PATH, (req, res) => {
    readBody(req, 8 * 1024, (err, body) => {
      if (err) return json(res, 400, { error: err })
      let payload
      try { payload = JSON.parse(body || '{}') } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const target = requireAbsoluteDir(payload?.path)
        const dirs = []
        const files = []
        const dirents = readdirSync(target, { withFileTypes: true })
        for (const d of dirents) {
          if (d.isSymbolicLink()) continue
          const row = { name: d.name, dir: d.isDirectory() }
          if (row.dir) dirs.push(row)
          else if (d.isFile()) files.push(row)
        }
        const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
        dirs.sort(byName)
        files.sort(byName)
        const all = dirs.concat(files)
        const parent = dirname(target)
        json(res, 200, {
          path: target,
          name: basename(target),
          parent: parent === target ? '' : parent,
          entries: all.slice(0, MAX_DIR_ENTRIES),
          truncated: all.length > MAX_DIR_ENTRIES,
          total: all.length,
        })
      } catch (e) {
        json(res, 400, { error: String(e?.message ?? e) })
      }
    })
  })

  route(FILE_PATH, (req, res) => {
    readBody(req, 8 * 1024, (err, body) => {
      if (err) return json(res, 400, { error: err })
      let payload
      try { payload = JSON.parse(body || '{}') } catch { return json(res, 400, { error: 'invalid json' }) }
      try {
        const target = requireAbsoluteFile(payload?.path)
        const st = statSync(target)
        if (st.size > MAX_FILE_BYTES) return json(res, 413, { error: 'file too large (' + st.size + ' bytes)' })
        const ext = extname(target).toLowerCase()
        if (!TEXT_EXT.has(ext) && !TEXT_NAME.has(basename(target))) {
          return json(res, 415, { error: 'not a text file type (' + (ext || 'no ext') + ')' })
        }
        const raw = readFileSync(target)
        // 二进制探测：前 8KB 出现 NUL 即拒绝
        const probe = raw.subarray(0, 8192)
        if (probe.includes(0)) return json(res, 415, { error: 'binary file' })
        let text = raw.toString('utf8')
        const truncated = text.length > MAX_PREVIEW_CHARS
        if (truncated) text = text.slice(0, MAX_PREVIEW_CHARS)
        json(res, 200, {
          path: target,
          name: basename(target),
          size: st.size,
          text,
          truncated,
        })
      } catch (e) {
        json(res, 400, { error: String(e?.message ?? e) })
      }
    })
  })

  ctx.logger?.info?.('[worktable] host 插件已加载，health: ' + HEALTH_PATH + ' sessions: ' + SESSIONS_PATH)
}

/* ---------- 会话快照（MVP 核心） ---------- */

/**
 * 读取宿主会话快照并归类成控制室要的四态。
 *
 * 数据来源优先级：
 *   1. sessionQuery.listSessions() —— 持久化 + 在活的完整语料（GUI 侧边栏同源）；
 *   2. 退化为 sessions.list() —— 只含本进程在活的会话。
 *
 * 状态判定（只读事件日志，不碰模型）：
 *   running  在活会话，且日志里有未闭合的 turn（turn/start 之后没有 turn/end）
 *   waiting  在活会话，turn 未闭合，且最后一条 approval/asked 没有对应的 approval/decided
 *   done     日志里出现过 turn/end，当前没有未闭合 turn
 *   idle     还没有跑过任何 turn 的会话
 */
async function collectSessions(ctx) {
  const at = Date.now()
  const sessionsSvc = getService(ctx, 'sessions')
  const querySvc = getService(ctx, 'sessionQuery')

  /** @type {Array<{ header: any, live: boolean, persisted: boolean }>} */
  let rows = []
  let source = 'live'
  let note = ''

  if (querySvc && typeof querySvc.listSessions === 'function') {
    try {
      const list = await querySvc.listSessions()
      if (Array.isArray(list)) {
        rows = list
        source = 'sessionQuery'
      }
    } catch (e) {
      note = 'sessionQuery.listSessions 失败：' + msg(e)
    }
  }

  if (!rows.length && sessionsSvc && typeof sessionsSvc.list === 'function') {
    try {
      const list = sessionsSvc.list()
      if (Array.isArray(list)) {
        rows = list.map((session) => ({ header: session?.header ?? { id: String(session?.id ?? '') }, live: true, persisted: false }))
        source = 'live'
      }
    } catch (e) {
      note = note ? note + ' / ' + msg(e) : 'sessions.list 失败：' + msg(e)
    }
  }

  const counts = { running: 0, waiting: 0, done: 0, idle: 0, total: 0 }
  const out = []

  for (const row of rows.slice(0, MAX_SESSIONS)) {
    const header = row?.header ?? {}
    const id = String(header.id ?? '')
    if (!id) continue
    const live = row?.live === true
    const session = live && sessionsSvc && typeof sessionsSvc.get === 'function'
      ? safe(() => sessionsSvc.get(id))
      : null

    const observed = readSessionState(session)
    const state = pickState(live, observed)

    counts[state] = (counts[state] ?? 0) + 1
    counts.total += 1

    out.push({
      id,
      title: safeTitle(header, observed),
      cwd: typeof header.cwd === 'string' ? header.cwd : '',
      state,
      live,
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
    version: PLUGIN_VERSION,
    source,
    degraded: !sessionsSvc && !querySvc,
    note: note || undefined,
    counts,
    sessions: out,
  }
}

/* ---------- 默认工作区 / 对话只读预览 ---------- */

/**
 * 取 DSH 默认工作区：最近活跃会话的 cwd（宿主里最贴近“当前工作区”的事实），
 * 取不到时退回宿主进程 cwd；同时带上 DSH_HOME 供 client 展示。
 */
async function collectDefaults(ctx) {
  const at = Date.now()
  let workspace = ''
  const querySvc = getService(ctx, 'sessionQuery')

  if (querySvc && typeof querySvc.listSessions === 'function') {
    try {
      const rows = await querySvc.listSessions()
      const cwd = Array.isArray(rows) ? rows[0]?.header?.cwd : ''
      if (typeof cwd === 'string' && cwd) workspace = cwd
    } catch { /* 继续用下面的兜底 */ }
  }

  if (!workspace) {
    const sessionsSvc = getService(ctx, 'sessions')
    const list = safe(() => sessionsSvc?.list?.()) || []
    for (const session of list) {
      const cwd = session?.header?.cwd
      if (typeof cwd === 'string' && cwd) { workspace = cwd; break }
    }
  }

  if (!workspace) workspace = process.cwd()

  return {
    ok: true,
    at,
    workspace,
    home: String(safe(() => process.env.DSH_HOME) || ''),
    platform: process.platform,
  }
}

/**
 * 读一个会话的最近消息（只读：扫事件日志，不调模型、不写会话）。
 * user/message → 用户气泡；assistant/message → 助手气泡（无文本时标注工具调用次数）。
 * 不含 reasoning / 工具入参，避免把大块内部状态塞进前端。
 */
async function readTranscript(ctx, sessionId, limit) {
  const querySvc = getService(ctx, 'sessionQuery')
  const sessionsSvc = getService(ctx, 'sessions')

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

  if (!events) {
    return { ok: false, sessionId, live, messages: [], total: 0, truncated: false, error: 'session not found' }
  }

  const { messages, total } = messagesOf(events, limit)
  return {
    ok: true,
    sessionId,
    live,
    title: transcriptTitle(header, events),
    messages,
    total,
    truncated: total > messages.length,
  }
}

/** 从事件日志里抽 user / assistant 气泡（只扫尾部，避免长会话全量遍历） */
function messagesOf(events, limit) {
  const tail = events.slice(Math.max(0, events.length - 800))
  const out = []

  for (const ev of tail) {
    if (!ev || typeof ev !== 'object') continue
    const time = Number(ev.time) || 0
    const id = String(ev.seq ?? out.length)

    if (ev.type === 'user/message') {
      const kind = ev?.data?.source?.kind
      if (kind && kind !== 'user') continue // 审批/系统注入的消息不当成用户发言
      const text = textOfContent(ev?.data?.content)
      if (text) out.push({ id, role: 'user', text: clip(text), time })
    } else if (ev.type === 'assistant/message') {
      const parts = ev?.data?.message?.content
      const text = textOfContent(parts)
      const tools = Array.isArray(parts) ? parts.filter((p) => p && p.type === 'tool-call').length : 0
      if (text || tools) {
        out.push({
          id,
          role: 'assistant',
          text: text ? clip(text) : '（调用工具 ' + tools + ' 次）',
          time,
        })
      }
    }
  }

  return { messages: out.slice(-limit), total: out.length }
}

/** 消息内容里的文本片段（忽略 reasoning / tool-call / 图片等） */
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

/** 标题：日志里最新的 session/title → 目录名 → 短 id */
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
  const cwd = header && typeof header.cwd === 'string' ? header.cwd : ''
  if (cwd) {
    const parts = cwd.split(/[\\/]+/).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  const id = header && header.id ? String(header.id) : ''
  return id ? id.slice(0, 18) : '未命名会话'
}

/** 四态判定：只有在活会话才可能是 running / waiting */
function pickState(live, observed) {
  if (live && observed.openTurn) return observed.pendingApproval ? 'waiting' : 'running'
  if (observed.turns > 0) return 'done'
  return 'idle'
}

/**
 * 扫描一个在活会话的事件日志尾部。
 * @returns {{ openTurn: boolean, pendingApproval: boolean, turns: number, updatedAt: number, title: string }}
 */
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
      // 新的 turn 开始时旧的审批状态作废
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
      const text = firstText(ev?.data?.content)
      if (text) title = text.slice(0, 60)
    }
  }

  result.openTurn = lastTurnStart > lastTurnEnd
  result.pendingApproval = result.openTurn && askedAfter > decidedAfter
  result.updatedAt = lastTime
  result.title = title
  return result
}

/** 会话标题：日志里最新的标题 / 首条用户消息 / 目录名 / 短 id */
function safeTitle(header, observed) {
  if (observed.title) return observed.title
  const cwd = typeof header.cwd === 'string' ? header.cwd : ''
  if (cwd) {
    const parts = cwd.split(/[\\/]+/).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  const id = String(header.id ?? '')
  return id ? id.slice(0, 18) : '未命名会话'
}

function firstText(content) {
  if (typeof content === 'string') return content.trim()
  if (!Array.isArray(content)) return ''
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string' && part.text.trim()) return part.text.trim()
  }
  return ''
}

function getService(ctx, serviceName) {
  const direct = safe(() => ctx?.[serviceName])
  if (direct) return direct
  return safe(() => (typeof ctx?.get === 'function' ? ctx.get(serviceName) : null)) || null
}

function hasService(ctx, serviceName) {
  return !!getService(ctx, serviceName)
}

function safe(fn) {
  try { return fn() } catch { return undefined }
}

function msg(e) {
  return String(e?.message ?? e)
}

/* ---------- 工具 ---------- */

function readBody(req, limit, done) {
  let body = ''
  let settled = false
  req.on('data', (chunk) => {
    if (settled) return
    body += chunk
    if (body.length > limit) {
      settled = true
      done('payload too large')
    }
  })
  req.on('end', () => { if (!settled) { settled = true; done(null, body) } })
  req.on('error', (e) => { if (!settled) { settled = true; done(String(e?.message ?? e)) } })
}

function requireAbsoluteDir(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path required')
  if (!isAbsolute(p)) throw new Error('path must be absolute')
  if (p.includes('\0')) throw new Error('invalid path')
  const st = statSync(p)
  if (!st.isDirectory()) throw new Error('not a directory')
  return p
}

function requireAbsoluteFile(p) {
  if (typeof p !== 'string' || !p.trim()) throw new Error('path required')
  if (!isAbsolute(p)) throw new Error('path must be absolute')
  if (p.includes('\0')) throw new Error('invalid path')
  const st = statSync(p)
  if (!st.isFile()) throw new Error('not a file')
  return p
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}
