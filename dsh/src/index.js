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
 *                  GET  /fs/raw（图片 / PDF / 音视频原始字节，内嵌预览用）
 *                  GET  /asset/<令牌>/<rel...>（prefix：托管本地网页，令牌是所在目录的 base64url）
 *                  POST /fs/reveal（系统文件管理器）      POST /fs/open（系统默认程序）
 *   命令           POST /term/exec（NDJSON 流）          POST /term/kill
 *   版本控制       POST /git（op = status/log/branches/tags/diff/stage/unstage/discard/
 *                          commit/fetch/pull/push/checkout/branch/tag/reset/init/remote）
 *                  POST /git/clone（NDJSON 进度流）
 *   GitHub 账号    GET  /gh/status      POST /gh/login  /gh/logout /gh/repos /gh/create /gh/upload
 *   项目静态托管   POST /project/register               GET  /site/<id>/<rel...>（prefix）
 *   浏览器窗格     POST /web/probe（活没活 / 能不能 iframe 嵌）  POST /web/open（系统浏览器）
 *   自定义窗口库   POST /custom/list  /custom/get  /custom/save  /custom/delete
 *                  （存 ~/.dsh/worktable-custom.json，不写用户项目目录）
 *
 * 安全边界（与上游有意不同）
 *   1. 读（list / read / stat / reveal）：不设白名单，文件管理器要能一路翻到盘符根；
 *      只挡凭证目录（.ssh / .aws / .gnupg / .kube / .dsh）。
 *   2. 写（write / mkdir / rename）：必须落在白名单根内 —— 进程 cwd、用户 home、
 *      DSH_HOME、已注册项目根。
 *   3. 删（delete）：一律进系统回收站（可撤销），不要求白名单，但拒绝磁盘根、
 *      系统目录、白名单根本身、白名单根的祖先。
 *   4. 先 realpath 解析符号链接再判根，避免 ../ 与 symlink 逃逸。
 *   5. 不把任意请求体写进包目录（上游 /ping 就这么干过）。
 *   6. 所有路由默认只接受本机 DSH 自己的请求（Origin 为 localhost / 127.0.0.1 / 缺省），
 *      拒绝任何跨域 Origin —— 防 CSRF，尤其挡住恶意网页 drive-by 调 /term/exec。
 */
import { closeSync, createReadStream, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, statSync, writeFileSync, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { basename, dirname, extname, isAbsolute, join, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { loadPty, shellSpec, openSession, getSession, peekSession, closeSession, listSessions } from './pty.js'
import {
  gitDispatch, normalizeCloneUrl, cloneRepo, resolveToken,
  ghStatus, ghLogin, ghRepos, ghCreateRepo, ghUpload, clearStore,
} from './git.js'

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
/* 编辑器「整份打开」的上限：再大就不是 textarea 能承受的了（也不是它该干的事） */
const MAX_FILE_BYTES = 4 * 1024 * 1024
/* 超过上限时只读预览的窗口大小（前 N 字节 / 后 N 字节） */
const MAX_PREVIEW_BYTES = 256 * 1024
const MAX_WRITE_BYTES = 4 * 1024 * 1024
/* 内嵌预览（图片 / PDF / 音视频）走原始字节，比文本宽松：只要浏览器吞得下就让它看 */
const MAX_RAW_BYTES = 48 * 1024 * 1024
const MAX_PREVIEW_CHARS = 400_000
const MAX_SESSIONS = 200
const MAX_EVENT_SCAN = 400
const MAX_BODY_JSON = 64 * 1024
const MAX_TERM_OUTPUT = 512 * 1024
const TERM_TIMEOUT_MS = 120_000
const GIT_TIMEOUT_MS = 10_000
/* 会改动仓库 / 工作区的 git 操作：要求目录落在可写白名单内 */const GIT_WRITE_OPS = new Set([
  'stage', 'unstage', 'discard', 'commit', 'fetch', 'pull', 'push',
  'checkout', 'branch', 'tag', 'reset', 'init', 'uninit', 'remote',
])
/* 探测本地开发服务器：超时要短（3.5s 已经比「人觉得卡了」长） */
const PROBE_TIMEOUT_MS = 3_500
/* 探测时最多读多少响应体（只为了抠 <title>，不是下载页面） */
const PROBE_BODY_BYTES = 16 * 1024
/* 自定义窗口：条目数 / 单份内容上限 */
const MAX_CUSTOM_ITEMS = 200
const MAX_CUSTOM_BODY = 512 * 1024

/* 凭证目录：即便在 home 内也不允许读写。
   .npmrc / .gitconfig 里常写 token；.env* 是运行时密钥；.pki / .azure 是证书与云凭据。 */
const DENY_SEGMENTS = new Set([
  '.ssh', '.aws', '.gnupg', '.kube', '.dsh', '.netrc', '.git-credentials', '.password-store',
  '.npmrc', '.gitconfig', '.env', '.pki', '.azure',
])

/* /fs/raw 放行的媒体类型：这些东西在编辑器里永远是「二进制」，只能让浏览器自己渲染 */
const MEDIA_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif', '.svg',
  '.pdf',
  '.mp4', '.webm', '.ogv', '.mov',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac',
])

/* /asset 托管本地网页时放行的资源：只给「网页跑起来真正需要的东西」，
   同目录下的 .txt / .md / .db 之类不会被这个路由顺带读走 */
const ASSET_EXTS = new Set([
  '.html', '.htm', '.xhtml',
  '.css', '.js', '.mjs', '.json', '.map',
  '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.avif',
  '.woff', '.woff2', '.ttf', '.otf',
  '.mp4', '.webm', '.ogv', '.mp3', '.wav', '.ogg', '.m4a',
])


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
    /* 防 CSRF：所有路由默认只接受「本机 DSH 自己」发起的请求（见 originAllowed）。
       恶意站点（Origin: https://evil.com）的跨域 POST 会被 403 挡下，
       避免它借 drive-by 调用 /term/exec 在宿主机器上执行命令。 */
    const original = route.handler
    route.handler = (req, res) => {
      if (!originAllowed(req)) {
        sendJson(res, 403, { error: '跨域请求被拒绝（仅允许本机 DSH 调用）' })
        return
      }
      return original(req, res)
    }
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
        limits: { fileBytes: MAX_FILE_BYTES, dirEntries: MAX_DIR_ENTRIES, termOutput: MAX_TERM_OUTPUT, rawBytes: MAX_RAW_BYTES },
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

  /* 新建一个空会话（新建项目「＋ 新建对话」用）：走宿主 GUI 同一条 sessionController.create */
  register({
    kind: 'exact',
    path: BASE + '/session/create',
    handler: async (req, res) => {
      if (!allowMethod(req, res, 'POST')) return
      const body = await readJson(req, res, MAX_BODY_JSON)
      if (body === undefined) return
      sendJson(res, 200, await createSession(ctx, String(body?.cwd || '').trim() || undefined))
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
      /* 写操作只允许在白名单内，前端据此把「新建」置灰，而不是点了才报错 */
      writable: insideRoot(target, canonicalRoots()),
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
    const mode = ['auto', 'head', 'tail', 'full'].includes(body?.mode) ? body.mode : 'auto'
    const wantBytes = body?.bytes ? Math.max(1024, Math.min(MAX_PREVIEW_BYTES, Number(body.bytes) || 0)) : MAX_PREVIEW_BYTES

    /* full = 「我就要整份」，超过上限直接说清楚为什么不行（附 code，前端好给替代入口） */
    if (mode === 'full' && st.size > MAX_FILE_BYTES) {
      return sendJson(res, 413, {
        error: '文件过大（' + fmtBytes(st.size) + '），编辑器上限 ' + fmtBytes(MAX_FILE_BYTES),
        code: 'too-large', size: st.size, limit: MAX_FILE_BYTES, previewBytes: MAX_PREVIEW_BYTES,
      })
    }

    /* auto：小的整份读；大的自动降级成「只读预览开头」，不再一上来就 413 */
    const whole = mode === 'auto' && st.size <= MAX_FILE_BYTES
    const win = whole
      ? { raw: readFileSync(target), offset: 0, partial: false }
      : readWindow(target, st.size, mode === 'auto' ? 'head' : mode, mode === 'auto' ? MAX_PREVIEW_BYTES : wantBytes)

    if (win.raw.subarray(0, 8192).includes(0)) {
      return sendJson(res, 415, {
        error: '二进制文件，编辑器打不开', code: 'binary', binary: true, size: st.size,
        previewBytes: MAX_PREVIEW_BYTES,
      })
    }

    let text = win.raw.toString('utf8')
    /* 从中间切进去的第一个字符可能只剩半个字节序列，丢掉这个残字 */
    if (win.offset > 0) text = text.replace(/^\uFFFD+/, '')
    const charCut = text.length > MAX_PREVIEW_CHARS
    if (charCut) text = text.slice(0, MAX_PREVIEW_CHARS)

    sendJson(res, 200, {
      path: target,
      name: basename(target),
      size: st.size,
      mtime: st.mtimeMs,
      text,
      mode: whole ? 'full' : (mode === 'auto' ? 'head' : mode),
      /* partial = 只读了文件的一段（大文件预览）；truncated = 字符数被截了 */
      partial: win.partial || charCut,
      window: { offset: win.offset, bytes: win.raw.length },
      truncated: charCut,
      limit: MAX_FILE_BYTES,
      previewBytes: MAX_PREVIEW_BYTES,
      eol: text.includes('\r\n') ? 'crlf' : 'lf',
    })
  })})

  /* 用操作系统的默认程序打开（大文件 / 二进制 / 日志的正当出路） */
  register({ kind: 'exact', path: BASE + '/fs/open', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertExisting(body?.path, 'any')
    const dryRun = process.env.WORKTABLE_OPEN_DRYRUN === '1'
    if (dryRun) return sendJson(res, 200, { ok: true, path: target, dryRun: true, cmd: '' })
    /* 系统默认程序：和「在资源管理器里双击」完全同一条链路（explorer / open / xdg-open） */
    const r = await openInSystem(target, false)
    logReveal(target, false, { ...r, marker: 'open' })
    if (!r.ok) {
      console.warn('[worktable] 用系统程序打开失败', r.cmd, msg(r.error))
      return sendJson(res, 500, { error: '没能用系统程序打开：' + msg(r.error), path: target, cmd: r.cmd })
    }
    sendJson(res, 200, { ok: true, path: target, dryRun: false, cmd: r.cmd })
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
     回收站本身就是「可以后悔」，所以不限制在白名单内（否则从盘符根翻过去就删不了），
     只拦真正会伤人的目标：磁盘根、系统目录、白名单根本身、白名单根的祖先。 */
  register({ kind: 'exact', path: BASE + '/fs/delete', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = deleteTarget(body?.path)
    const t0 = Date.now()
    const r = await moveToTrash(target)
    logTrash(target, r, Date.now() - t0)
    if (!r.ok) return sendJson(res, 500, { error: '删除失败：' + msg(r.error) })
    sendJson(res, 200, { ok: true, path: target, trash: r.trash, ms: Date.now() - t0 })
  })})

  /* 这个路径能不能删（右键菜单先问一下，把禁止的原因写在菜单里，而不是点了才报错） */
  register({ kind: 'exact', path: BASE + '/fs/deletable', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    try {
      deleteTarget(body?.path)
      sendJson(res, 200, { ok: true, reason: '' })
    } catch (err) {
      sendJson(res, 200, { ok: false, reason: msg(err?.message ?? err) })
    }
  })})

  register({ kind: 'exact', path: BASE + '/fs/stat', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const target = await assertExisting(body?.path, 'any')
    const st = statSync(target)
    sendJson(res, 200, { path: target, dir: st.isDirectory(), size: st.size, mtime: st.mtimeMs })
  })})

  /* 原始字节：图片 / PDF / 音视频的内嵌预览（<img src> 与 <iframe src> 只能 GET）。
     只放行 MEDIA_EXTS，不给它当「通用下载通道」；读权限与 /fs/list 同档（不设白名单、挡凭证目录）。 */
  register({ kind: 'exact', path: BASE + '/fs/raw', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'GET')) return
    const url = new URL(req.url || '/', 'http://dsh.internal')
    const target = await assertExisting(url.searchParams.get('path'), 'file')
    const ext = extname(target).toLowerCase()
    if (!MEDIA_EXTS.has(ext)) {
      return sendJson(res, 415, {
        error: '这个类型不走内嵌预览（' + ext + '）', code: 'not-media', ext,
        media: [...MEDIA_EXTS],
      })
    }
    const st = statSync(target)
    if (st.size > MAX_RAW_BYTES) {
      return sendJson(res, 413, {
        error: '文件过大（' + fmtBytes(st.size) + '），内嵌预览上限 ' + fmtBytes(MAX_RAW_BYTES),
        code: 'too-large', size: st.size, limit: MAX_RAW_BYTES,
      })
    }
    res.writeHead(200, {
      'content-type': mimeOf(target),
      'content-length': st.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      /* inline：浏览器就地渲染，不要弹下载 */
      'content-disposition': 'inline; filename*=UTF-8\'\'' + encodeURIComponent(basename(target)),
    })
    const stream = createReadStream(target)
    stream.on('error', () => { try { res.destroy() } catch { /* 已断开 */ } })
    stream.pipe(res)
  })})

  /* 本地网页托管（0.10.6）：自定义窗口的 iframe 从这里加载磁盘上的 .html。
     为什么不用 ?path= 的查询串：那样 <link href="style.css"> 会被解析到
     /api/trae-worktable/style.css，全 404。这里把「文件所在目录」编成路径第一段
     （base64url），后面的相对资源自然落在同一目录，用户文件一个字都不用改。 */
  register({ kind: 'prefix', path: BASE + '/asset', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'GET')) return
    const url = new URL(req.url ?? '/', 'http://dsh.internal')
    const rest = url.pathname.slice((BASE + '/asset').length).replace(/^\/+/, '')
    if (!rest) return sendJson(res, 400, { error: '缺少目录令牌', code: 'no-token' })
    const slash = rest.indexOf('/')
    const token = slash === -1 ? rest : rest.slice(0, slash)
    const dir = Buffer.from(String(token).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    if (!dir || !isAbsolute(dir)) return sendJson(res, 400, { error: '目录令牌无效', code: 'bad-token' })
    let rel = ''
    try {
      rel = slash === -1 ? '' : decodeURIComponent(rest.slice(slash + 1))
    } catch {
      return sendJson(res, 400, { error: '资源名编码不对', code: 'bad-uri' })
    }
    const base = resolve(dir)
    const joined = resolve(base, rel || 'index.html')
    if (!insideRoot(joined, [base])) {
      return sendJson(res, 403, { error: '路径越界：只能读这个网页所在目录里的资源', code: 'outside' })
    }
    const ext = extname(joined).toLowerCase()
    if (!ASSET_EXTS.has(ext)) {
      return sendJson(res, 415, {
        error: '这个类型不给网页加载（' + ext + '）', code: 'not-asset', ext, allow: [...ASSET_EXTS],
      })
    }
    const target = await assertExisting(joined, 'file')
    const st = statSync(target)
    if (st.size > MAX_RAW_BYTES) {
      return sendJson(res, 413, {
        error: '文件过大（' + fmtBytes(st.size) + '），上限 ' + fmtBytes(MAX_RAW_BYTES),
        code: 'too-large', size: st.size, limit: MAX_RAW_BYTES,
      })
    }
    res.writeHead(200, {
      'content-type': mimeOf(target),
      'content-length': st.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      /* 页面本身按「沙箱」下发：脚本照跑，但拿不到同源身份 ——
         它没法 fetch 插件的 /api，也就没法反过来改你的文件。 */
      /* 不给 allow-modals：页面里的 alert / confirm 会变成 Electron 的窗口模态框，
         在 iframe 场景下经常「框在那儿点不动」，把整个界面卡住（0.10.7 用户报的弹窗）。 */
      'content-security-policy': 'sandbox allow-scripts allow-forms allow-popups allow-downloads',
    })
    createReadStream(target).on('error', () => { try { res.destroy() } catch { /* 已断开 */ } }).pipe(res)
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

  /* ---------- 浏览器窗格 ---------- */

  register({ kind: 'exact', path: BASE + '/web/probe', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const list = Array.isArray(body?.urls) ? body.urls : [body?.url]
    const targets = list.filter((u) => typeof u === 'string' && u.trim()).slice(0, 8)
    if (!targets.length) return sendJson(res, 400, { error: 'url required' })
    const dryRun = process.env.WORKTABLE_PROBE_DRYRUN === '1'
    if (dryRun) {
      return sendJson(res, 200, {
        results: targets.map((u) => ({ ok: true, url: u, status: 200, ms: 1, title: '', frameable: true, frameReason: '', dryRun: true })),
      })
    }
    const results = await Promise.all(targets.map((u) => probeUrl(u)))
    sendJson(res, 200, { results })
  })})

  register({ kind: 'exact', path: BASE + '/web/open', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const u = normUrl(body?.url)
    if (!u) return sendJson(res, 400, { error: '只支持 http / https 地址' })
    /* 空 host（例如 http://）会让 explorer 去开「我的电脑」，直接挡掉 */
    if (!u.hostname) return sendJson(res, 400, { error: '地址缺少主机名' })
    if (process.env.WORKTABLE_OPEN_DRYRUN === '1') return sendJson(res, 200, { ok: true, url: u.href, dryRun: true, cmd: '' })
    const r = await openInSystem(u.href, false)
    if (!r.ok) return sendJson(res, 500, { error: '浏览器启动失败：' + msg(r.error), cmd: r.cmd })
    sendJson(res, 200, { ok: true, url: u.href, cmd: r.cmd })
  })})

  /* ---------- 自定义窗口库 ---------- */

  register({ kind: 'exact', path: BASE + '/custom/list', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const data = readCustomStore()
    sendJson(res, 200, { file: customStoreFile(), items: data.items.map(customMeta) })
  })})

  register({ kind: 'exact', path: BASE + '/custom/get', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const id = String(body?.id || '')
    const item = readCustomStore().items.find((it) => it.id === id)
    if (!item) return sendJson(res, 404, { error: '没有这个自定义窗口：' + id })
    sendJson(res, 200, { item })
  })})

  register({ kind: 'exact', path: BASE + '/custom/save', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    /* 内容上限 512KB，JSON 转义会膨胀，读的时候按 2 倍 + 余量放 */
    const body = await readJson(req, res, MAX_CUSTOM_BODY * 2 + MAX_BODY_JSON)
    if (body === undefined) return
    const store = readCustomStore()
    const now = new Date().toISOString()
    const wanted = String(body?.id || '').trim()
    const existing = wanted ? store.items.find((it) => it.id === wanted) : null
    /* 新建时宿主发号：前端不用自己编 id（编了也不会撞） */
    const id = existing ? existing.id : (wanted && CUSTOM_ID_RE.test(wanted) ? wanted : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6))
    const merged = normalizeCustomItem({
      id,
      name: body?.name ?? existing?.name,
      kind: body?.kind ?? existing?.kind,
      body: body?.body ?? existing?.body,
      pid: body?.pid ?? existing?.pid,
      created: existing?.created || now,
      updated: now,
    })
    if (!merged) return sendJson(res, 400, { error: '自定义窗口定义不合法（需要 id / name / 内容）' })
    if (!existing && store.items.length >= MAX_CUSTOM_ITEMS) {
      return sendJson(res, 409, { error: '自定义窗口最多 ' + MAX_CUSTOM_ITEMS + ' 个，先删掉一些' })
    }
    const items = existing
      ? store.items.map((it) => (it.id === id ? merged : it))
      : store.items.concat([merged])
    try {
      writeCustomStore({ version: 1, items })
    } catch (err) {
      return sendJson(res, 500, { error: '保存失败：' + msg(err) })
    }
    sendJson(res, 200, { ok: true, item: merged, meta: customMeta(merged) })
  })})

  register({ kind: 'exact', path: BASE + '/custom/delete', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const id = String(body?.id || '')
    const store = readCustomStore()
    const items = store.items.filter((it) => it.id !== id)
    if (items.length === store.items.length) return sendJson(res, 404, { error: '没有这个自定义窗口：' + id })
    try {
      writeCustomStore({ version: 1, items })
    } catch (err) {
      return sendJson(res, 500, { error: '删除失败：' + msg(err) })
    }
    sendJson(res, 200, { ok: true, id })
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
    const id = String(body?.id || 'default')
    const term = TERM_SESSIONS.get(id)
    if (term?.child) killTree(term.child)
    closeSession(id)
    sendJson(res, 200, { ok: true })
  })})

  /* ---------- 终端：真 PTY（借用宿主自带的 node-pty） ---------- */

  register({ kind: 'exact', path: BASE + '/term/mode', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'GET')) return
    const p = loadPty()
    sendJson(res, 200, {
      ok: p.ok, from: p.from, error: p.error, shell: shellSpec().file, sessions: listSessions(),
    })
  })})

  /**
   * 开一个交互式终端。
   * 拿不到 node-pty 时**不报错**，返回 { ok:false, mode:'exec' }：客户端据此退回
   * 「一条命令一个进程」的老模式，用户不至于开不出终端。
   */
  register({ kind: 'exact', path: BASE + '/term/open', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const id = String(body?.id || 'default').slice(0, 64) || 'default'
    const r = openSession(id, { cwd: body?.cwd, cols: body?.cols, rows: body?.rows })
    if (!r.ok) return sendJson(res, 200, { ok: false, mode: 'exec', error: r.error })
    sendJson(res, 200, {
      ok: true, mode: 'pty', id, shell: r.shell, cwd: r.cwd,
      cols: r.session.cols, rows: r.session.rows,
    })
  })})

  /** 把 PTY 输出以 NDJSON 长连接推给客户端（先回放 backlog，再接实时流） */
  register({ kind: 'exact', path: BASE + '/term/stream', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const id = String(body?.id || 'default')
    const s = peekSession(id)
    if (!s) return sendJson(res, 404, { error: '没有这个终端会话（先 /term/open）' })

    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    })
    const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n') } catch { /* 客户端已断开 */ } }
    if (s.backlog) send({ t: 'out', d: s.backlog })
    send({ t: 'ready', d: id })
    if (s.exited) {
      send({ t: 'exit', code: s.code ?? 0 })
      return res.end()
    }
    const onData = (d) => {
      if (d === null) { send({ t: 'exit', code: s.code ?? 0 }); cleanup(); return }
      send({ t: 'out', d })
    }
    const cleanup = () => {
      s.listeners.delete(onData)
      try { res.end() } catch { /* 已结束 */ }
    }
    s.listeners.add(onData)
    req.on('close', () => { s.listeners.delete(onData) })
  })})

  register({ kind: 'exact', path: BASE + '/term/input', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const s = getSession(body?.id)
    if (!s) return sendJson(res, 409, { error: '终端已关闭' })
    const data = String(body?.data ?? '')
    if (data.length > 64_000) return sendJson(res, 400, { error: '一次输入过长' })
    try {
      s.pty.write(data)
    } catch (err) {
      return sendJson(res, 500, { error: '写入终端失败：' + msg(err) })
    }
    sendJson(res, 200, { ok: true })
  })})

  register({ kind: 'exact', path: BASE + '/term/resize', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const s = getSession(body?.id)
    if (!s) return sendJson(res, 409, { error: '终端已关闭' })
    const cols = clampInt(body?.cols, 20, 400, s.cols)
    const rows = clampInt(body?.rows, 6, 200, s.rows)
    try {
      s.pty.resize(cols, rows)
      s.cols = cols
      s.rows = rows
    } catch (err) {
      return sendJson(res, 500, { error: '调整终端尺寸失败：' + msg(err) })
    }
    sendJson(res, 200, { ok: true, cols, rows })
  })})

  /* ---------- git（读写） ---------- */

  register({ kind: 'exact', path: BASE + '/git', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const op = String(body?.op || 'status')
    /* 读操作只要不是凭证目录；改仓库的操作（暂存/提交/推送/切换…）一律要求在白名单根内 */
    const cwd = await assertExisting(body?.path, 'dir', GIT_WRITE_OPS.has(op) ? 'write' : 'read')
    const out = await gitDispatch(cwd, body)
    /* 「不是 git 仓库」是正常状态（200 + repo:false），不当作错误 */
    sendJson(res, out.ok === false ? 400 : 200, out)
  })})

  /* 克隆：流式返回进度，超时按 10 分钟算（大仓库） */
  register({ kind: 'exact', path: BASE + '/git/clone', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const url = normalizeCloneUrl(body?.url)
    if (!url.ok) return sendJson(res, 400, { error: url.error })
    const dest = String(body?.dest || '').trim()
    if (!dest) return sendJson(res, 400, { error: '请选择克隆到哪个目录' })
    /* 目标目录可以还不存在，但它的父目录必须存在且在可写白名单内 */
    let target
    try {
      target = await assertWritable(dest)
    } catch (err) {
      return sendJson(res, err.status || 400, { error: msg(err) })
    }
    if (existsSync(target)) {
      const entries = safe(() => readdirSync(target)) || []
      if (entries.length) return sendJson(res, 400, { error: '目标目录已存在且不是空的：' + target })
    } else {
      try {
        mkdirSync(dirname(target), { recursive: true })
      } catch (err) {
        return sendJson(res, 400, { error: '建不了上级目录：' + msg(err) })
      }
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    })
    const timer = setTimeout(() => { try { res.end() } catch { /* 已结束 */ } }, 11 * 60_000)
    const send = (obj) => { try { res.write(JSON.stringify(obj) + '\n') } catch { /* 客户端断了 */ } }
    resolveToken().then(({ token }) => {
      cloneRepo({
        url: url.url,
        dest: target,
        token,
        depth: clampInt(body?.depth, 0, 50, 0),
        branch: String(body?.branch || ''),
        insecure: !!body?.insecure,
      }, (ev) => {
        send(ev)
        if (ev.t === 'end') {
          clearTimeout(timer)
          try { res.end() } catch { /* 已结束 */ }
        }
      })
    })
    req.on('close', () => clearTimeout(timer))
  })})

  /* ---------- GitHub 账号 ---------- */

  register({ kind: 'exact', path: BASE + '/gh/status', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'GET', 'POST')) return
    sendJson(res, 200, await ghStatus({ fresh: true }))
  })})

  register({ kind: 'exact', path: BASE + '/gh/login', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const out = await ghLogin(body?.token, {
      remember: body?.remember !== false,
      writeCredential: !!body?.writeCredential,
    })
    sendJson(res, out.ok ? 200 : 400, out)
  })})

  register({ kind: 'exact', path: BASE + '/gh/logout', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    clearStore()
    sendJson(res, 200, { ok: true })
  })})

  register({ kind: 'exact', path: BASE + '/gh/repos', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'GET', 'POST')) return
    const body = req.method === 'POST' ? (await readJson(req, res, MAX_BODY_JSON)) : {}
    if (body === undefined) return
    const out = await ghRepos({ q: String(body?.q || ''), page: clampInt(body?.page, 1, 50, 1) })
    sendJson(res, out.ok ? 200 : 400, out)
  })})

  register({ kind: 'exact', path: BASE + '/gh/create', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const out = await ghCreateRepo({
      name: String(body?.name || ''),
      private: body?.private !== false,
      description: String(body?.description || ''),
      org: String(body?.org || ''),
    })
    sendJson(res, out.ok ? 200 : 400, out)
  })})

  /* 上传本地仓库：init → 首次提交 → 建远程 → push -u */
  register({ kind: 'exact', path: BASE + '/gh/upload', handler: guard(async (req, res) => {
    if (!allowMethod(req, res, 'POST')) return
    const body = await readJson(req, res, MAX_BODY_JSON)
    if (body === undefined) return
    const cwd = await assertExisting(body?.path, 'dir', 'write')
    const out = await ghUpload({ ...body, path: cwd })
    sendJson(res, out.ok ? 200 : 400, out)
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
    if (!root) return sendSiteError(res, 404, '这个项目的静态托管还没就绪', '项目「' + id + '」没有登记可用的目录。回到工作台重新进一次项目即可重新登记；没设目录的项目本来就没有站点。')

    /* safeSiteTarget 会先挡 ../，再 realpath 跟随软链接，最后再验一次 containment，
       项目内一个指向外部 / 系统目录的软链接会被拦成 403，读不走项目外的文件。 */
    const target = safeSiteTarget(root, rel || 'index.html')
    if (!target) return sendSiteError(res, 403, '路径越界', '请求的路径跑出了项目目录，或软链接指向了项目之外，已拦下。')
    let file = target
    const targetIsDir = isDirQuiet(file)
    if (!rel || targetIsDir) {
      const indexRel = rel ? rel.replace(/\/+$/, '') + '/index.html' : 'index.html'
      const indexFile = safeSiteTarget(root, indexRel)
      if (indexFile && existsSync(indexFile) && !isDirQuiet(indexFile)) {
        file = indexFile
      } else if (!rel || targetIsDir) {
        return sendListing(res, targetIsDir ? target : root)
      }
    }
    let st
    try { st = statSync(file) } catch {
      return sendSiteError(res, 404, '文件不存在', '这个路径下没有 ' + (rel || 'index.html') + '。项目目录可能还没登记，或者文件被挪走了。')
    }
    if (!st.isFile()) return sendSiteError(res, 404, '不是文件', rel + ' 是个目录，而这里需要一个能打开的文件。')
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
      /* 这个 title 是不是「会话自己的名字」。false = 只是拿工作目录名兜底，
         界面该当它没有名字（项目别叫成 default-workspace）。
         decorateTitles 拿到真标题后会翻成 true。 */
      titled: !!observed.title,
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

  /* 用宿主自己的标题折叠覆盖：侧边栏的会话名就是它算出来的，工作台要跟它一致 */
  await decorateTitles(ctx, out)

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

/* ---------------------------- 会话标题 ---------------------------- */

const TITLE_TTL_MS = 60_000
const TITLE_CACHE_MAX = 400
/** id → { stamp, at, title }：readTitleSnapshots 要读整条日志，不能每 4s 重来一遍 */
const TITLE_CACHE = new Map()

/**
 * 把 host 认的会话标题刷到行上。
 *
 * 侧边栏里的会话名（「安装 dsh-worktable 插件」这种）来自
 * `sessionQuery.readTitleSnapshots()` —— 它会折叠**整条日志**，取最后一个
 * `session/title` 事件。我们以前只在事件尾部 400 条里找，长会话的标题事件
 * 早就甩出窗口了；冷会话（重启后不在内存里）更是连日志都拿不到，于是标题
 * 退化成工作目录名 —— 默认工作区恰好叫 `default-workspace`，项目就跟着叫了
 * 这个名字。这里直接问 host 要权威标题。
 *
 * 成本：冷会话要读盘重放日志，所以按 (id, updatedAt) 做 60s 缓存，
 * 失败/无标题也缓存成空串，否则每轮轮询都会重读。
 */
async function decorateTitles(ctx, rows) {
  if (!Array.isArray(rows) || !rows.length) return
  const querySvc = service(ctx, 'sessionQuery')
  const fold = querySvc && typeof querySvc.readTitleSnapshots === 'function' ? querySvc.readTitleSnapshots : null

  const now = Date.now()
  const pending = []
  for (const row of rows) {
    const stamp = String(row.updatedAt) + '|' + String(row.createdAt)
    const hit = TITLE_CACHE.get(row.id)
    if (hit && hit.stamp === stamp && now - hit.at < TITLE_TTL_MS) {
      if (hit.title) { row.title = hit.title; row.titled = true }
      continue
    }
    pending.push({ row, stamp })
  }
  if (!fold || !pending.length) return

  let settled = null
  try {
    settled = await Promise.resolve(fold.call(querySvc, pending.map((x) => x.row.id)))
  } catch { return }
  if (!Array.isArray(settled)) return

  pending.forEach((item, i) => {
    const res = settled[i]
    const snap = res && res.status === 'fulfilled' ? res.value : null
    const title = titleTextOf(snap)
    TITLE_CACHE.set(item.row.id, { stamp: item.stamp, at: now, title })
    if (title) { item.row.title = title; item.row.titled = true }
  })

  if (TITLE_CACHE.size > TITLE_CACHE_MAX) {
    let drop = TITLE_CACHE.size - TITLE_CACHE_MAX
    for (const key of TITLE_CACHE.keys()) {
      TITLE_CACHE.delete(key)
      drop -= 1
      if (drop <= 0) break
    }
  }
}

/** 标题快照是 `{ title, messageSeqs, source, eventSeq, updatedAt }`；老宿主给纯字符串 */
function titleTextOf(snap) {
  const raw = snap && typeof snap === 'object' ? snap.title : ''
  const text = typeof raw === 'string' ? raw : (raw && typeof raw.title === 'string' ? raw.title : '')
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 100)
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

/**
 * 新建一个宿主会话（只创建，不发送任何消息）。
 * 走 sessionController.create —— 与 GUI 里「新会话」按钮同一条链路，
 * 因此新建出来的会话在宿主侧边栏里也立刻可见、可继续对话。
 * @param ctx - 插件上下文。
 * @param cwd - 可选的工作目录；缺省时宿主用它自己的默认目录。
 */
async function createSession(ctx, cwd) {
  const controller = service(ctx, 'sessionController')
  if (!controller || typeof controller.create !== 'function') {
    return { ok: false, error: '宿主未提供 sessionController（无法新建会话）' }
  }
  try {
    const created = await controller.create(cwd ? { cwd } : {})
    const sessionId = String(created?.sessionId || '')
    if (!sessionId) return { ok: false, error: 'sessionController.create 没有返回 sessionId' }
    return { ok: true, sessionId, agentPreset: created?.agentPreset }
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) }
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
  /* events 是完整日志（已经在内存里），从尾往前找最后一个 session/title 即可 ——
     限成尾部 400 条会让长会话的标题永远取不到。 */
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (!ev || ev.type !== 'session/title') continue
    const title = titleTextOf({ title: ev?.data?.title })
    if (title) return title
  }
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
 * 把 PowerShell 的 stderr 洗成人话。
 *
 * Windows PowerShell 会把「Preparing modules for first use.」这类进度记录按 CLIXML
 * 序列化进 stderr，退出码也常常不为 0。原来直接把它当错误抛给用户，
 * 界面就显示成「删除失败：#< CLIXML <Objs Version=…」，而文件其实已经进回收站了。
 */
function cleanPsError(text) {
  const raw = String(text || '')
  if (!raw.trim()) return ''
  const errs = [...raw.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1])
  let out = errs.length ? errs.join(' ') : raw
  if (!errs.length && raw.trimStart().startsWith('#< CLIXML')) out = ''
  return out
    .replace(/_x000D__x000A_/g, ' ')
    .replace(/#< CLIXML[\s\S]*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300)
}

const TRASH_TIMEOUT_MS = 12_000

/**
 * 丢进系统回收站（Windows 回收站 / macOS 废纸篓 / Linux gio trash）。
 * 不用 rm / fs.rm —— 文件管理器里的删除必须是能后悔的。
 *
 * 成败**以磁盘为准**：回收站这条链路上退出码全不可信（成功也可能非 0，
 * 失败也可能 0），所以先等子进程结束，再看目标还在不在。
 */
function moveToTrash(target) {
  return new Promise((resolveP) => {
    let settled = false
    let timer = 0
    const done = (ok, extra) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolveP({ ok, ...(extra || {}) })
    }

    let cmd
    let args
    if (process.platform === 'win32') {
      const isDir = isDirQuiet(target)
      const script = [
        '$ProgressPreference = "SilentlyContinue"',
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
      done(false, { error: msg(err), cmd })
      return
    }

    let errText = ''
    /* stdout 也要抽干：spawn 默认 pipe，写满 64KB 会把子进程卡住，这个 Promise 就永远不 resolve */
    try { child.stdout?.resume() } catch { /* 无 stdout */ }
    try { child.stderr?.on('data', (d) => { errText += String(d) }) } catch { /* 无 stderr */ }

    timer = setTimeout(() => {
      try { child.kill() } catch { /* 已经退出 */ }
      done(false, { error: '回收站调用超时（' + Math.round(TRASH_TIMEOUT_MS / 1000) + 's）', cmd })
    }, TRASH_TIMEOUT_MS)

    child.on('error', (err) => done(false, { error: msg(err), cmd }))
    child.on('exit', (code) => {
      if (!existsSync(target)) return done(true, { trash: true, code, cmd })
      done(false, {
        error: cleanPsError(errText) || ('没有删掉（退出码 ' + code + '；可能被占用，或这个磁盘没有回收站）'),
        code,
        cmd,
      })
    })
  })
}

/**
 * 每次「打开系统文件管理器」记一行到 ~/.dsh/worktable-reveal.log。
 * 用户说「打不开」时，这是唯一能区分「根本没调用 / 调用了但失败 / 调用成功但窗口没到前台」的证据。
 */
const REVEAL_LOG_MAX = 128 * 1024

/**
 * 每次「打开」记一行到 ~/.dsh/worktable-reveal.log。
 * marker：'open' = 用系统默认程序打开；不带 = 打开系统文件管理器（/ 在其中选中）。
 */
function logReveal(target, select, r) {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const file = join(home, 'worktable-reveal.log')
    try { if (statSync(file).size > REVEAL_LOG_MAX) writeFileSync(file, '') } catch { /* 首次写入 */ }
    const parts = [
      new Date().toISOString(),
      r.ok ? 'ok' : 'fail',
      r.marker || 'reveal',
      'select=' + (select ? 1 : 0),
      r.cmd || '-',
      target,
      r.ok ? '' : msg(r.error),
    ]
    appendFileSync(file, parts.join(' | ') + '\n', 'utf8')
  } catch { /* 日志写不了不影响主流程 */ }
}

/**
 * 每次「移到回收站」记一行到 ~/.dsh/worktable-delete.log。
 * 和 reveal 那份一样，用户说「删除用不了」时能一眼看出是没调用、调用失败还是成功。
 */
function logTrash(target, r, ms) {
  try {
    const home = process.env.DSH_HOME || join(homedir(), '.dsh')
    const file = join(home, 'worktable-delete.log')
    try { if (statSync(file).size > REVEAL_LOG_MAX) writeFileSync(file, '') } catch { /* 首次写入 */ }
    const parts = [
      new Date().toISOString(),
      r.ok ? 'ok' : 'fail',
      ms + 'ms',
      r.code === undefined || r.code === null ? '-' : 'exit=' + r.code,
      target,
      r.ok ? '' : msg(r.error),
    ]
    appendFileSync(file, parts.join(' | ') + '\n', 'utf8')
  } catch { /* 日志写不了不影响主流程 */ }
}

/** Windows 上 explorer.exe 的绝对路径（PATH 在打包后的 Electron 里不一定完整） */
function explorerExe() {
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

/* ============================ 浏览器窗格：地址归一 / 探测 / 外部打开 ============================ */

/** 补协议、挡掉非 http(s)。「localhost:5173」这种半截地址也认。 */
function normUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return null
  const withProto = /^https?:\/\//i.test(s)
    ? s
    : (/^[a-z0-9.-]+(:\d+)?([/?#]|$)/i.test(s) ? 'http://' + s : '')
  if (!withProto) return null
  let u
  try { u = new URL(withProto) } catch { return null }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  return u
}

function decodeEntities(s) {
  return String(s || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

/**
 * 这个响应头组合允不允许被 iframe 嵌？
 *
 * 这是浏览器窗格最需要的一条信息：本地 dev server 常带
 * `X-Frame-Options: SAMEORIGIN`，用户只会看到一个白框，然后以为工作台坏了。
 */
function frameVerdict(xfo, csp) {
  const x = String(xfo || '').toLowerCase()
  if (x.includes('deny')) return { ok: false, reason: 'X-Frame-Options: DENY' }
  if (x.includes('sameorigin')) return { ok: false, reason: 'X-Frame-Options: SAMEORIGIN' }
  const m = /frame-ancestors([^;]*)/i.exec(String(csp || ''))
  if (m) {
    const val = m[1].trim()
    if (/^'none'$/i.test(val)) return { ok: false, reason: "CSP frame-ancestors 'none'" }
    if (val && !val.includes('*')) return { ok: false, reason: 'CSP frame-ancestors ' + val }
  }
  return { ok: true, reason: '' }
}

/**
 * 探测一个地址：活没活、多快、页面标题、能不能嵌。
 *
 * 走原生 http/https 而不是 fetch：
 *  1. 宿主的 Node 里 fetch 到 localhost 会被代理/证书折腾；
 *  2. 我们要读原始响应头（X-Frame-Options / CSP），fetch 拿到的是加工过的。
 */
/**
 * 这个 host 地址能不能被「代发请求」去碰？
 *
 * 云元数据端点（169.254.169.254）与链路本地（169.254.* / fe80::）是经典 SSRF 猎物：
 * 恶意自定义窗口/用户误填一个内网地址，宿主就会替他发出请求。
 * 回环（127.* / ::1）放行 —— 本地 dev server 是正当用途。
 */
function isBlockedProbeHost(hostname) {
  const h = String(hostname || '').toLowerCase()
  if (h === '169.254.169.254' || h === '::ffff:169.254.169.254') return true
  if (/^169\.254\./.test(h)) return true
  if (h === 'fe80::' || h.startsWith('fe80:') || h === '[fe80::]') return true
  return false
}

function probeUrl(raw) {
  const u = normUrl(raw)
  if (!u) {
    return Promise.resolve({ ok: false, url: String(raw || ''), error: '地址不合法（只支持 http / https）', frameable: false })
  }
  if (isBlockedProbeHost(u.hostname)) {
    return Promise.resolve({ ok: false, url: u.href, error: '该地址被禁止探测（链路本地 / 云元数据端点）', frameable: false })
  }
  const started = Date.now()
  return new Promise((resolveP) => {
    let done = false
    const finish = (r) => { if (done) return; done = true; resolveP(r) }
    const lib = u.protocol === 'https:' ? httpsRequest : httpRequest
    let req
    try {
      req = lib({
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: (u.pathname || '/') + (u.search || ''),
        method: 'GET',
        timeout: PROBE_TIMEOUT_MS,
        /* 本地 dev server 常挂自签证书；探测只问「能不能连上」，不做信任判断 */
        rejectUnauthorized: false,
        headers: {
          'user-agent': 'trae-worktable-probe',
          accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
          'accept-encoding': 'identity',
        },
      }, (res) => {
        const headers = res.headers || {}
        const verdict = frameVerdict(headers['x-frame-options'], headers['content-security-policy'])
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => { if (body.length < PROBE_BODY_BYTES) body += chunk })
        res.on('end', () => {
          const raw2 = (/<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(body) || [])[1] || ''
          finish({
            ok: true,
            url: u.href,
            status: res.statusCode || 0,
            ms: Date.now() - started,
            title: decodeEntities(String(raw2).replace(/\s+/g, ' ').trim()),
            contentType: String(headers['content-type'] || ''),
            frameable: verdict.ok,
            frameReason: verdict.reason,
          })
        })
        res.on('error', (err) => finish({ ok: false, url: u.href, error: msg(err), ms: Date.now() - started, frameable: true }))
      })
    } catch (err) {
      finish({ ok: false, url: u.href, error: msg(err), ms: Date.now() - started, frameable: true })
      return
    }
    req.on('timeout', () => req.destroy(new Error('超时 ' + Math.round(PROBE_TIMEOUT_MS / 1000) + 's 没有响应')))
    req.on('error', (err) => finish({ ok: false, url: u.href, error: msg(err), ms: Date.now() - started, frameable: true }))
    req.end()
  })
}

/* ============================ 自定义窗口库 ============================ */

/** 自定义窗口存这儿：不碰用户项目目录，随 DSH 一起走 */
function customStoreFile() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'worktable-custom.json')
}

const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9_-]{0,47}$/i

function normalizeCustomItem(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const id = String(src.id || '').trim()
  if (!CUSTOM_ID_RE.test(id)) return null
  /* html＝手写 / 贴进来的 HTML；url＝嵌一个网址；file＝指向磁盘上一个 .html 文件 */
  const kind = src.kind === 'url' ? 'url' : (src.kind === 'file' ? 'file' : 'html')
  let body = String(src.body ?? '')
  if (kind === 'url') {
    const u = normUrl(body)
    if (!u) return null
    body = u.href
  }
  if (kind === 'file') {
    /* 只存绝对路径：相对路径在这里没法解析，文件也可能还没生成（存的时候不 stat） */
    body = body.trim()
    if (!isAbsolute(body) || !/\.(html?|xhtml)$/i.test(body)) return null
  }
  if (body.length > MAX_CUSTOM_BODY) body = body.slice(0, MAX_CUSTOM_BODY)
  const name = String(src.name || '').trim().slice(0, 60) || '未命名窗口'
  return {
    id,
    name,
    kind,
    body,
    pid: String(src.pid || '').slice(0, 64),
    created: String(src.created || new Date().toISOString()),
    updated: String(src.updated || new Date().toISOString()),
  }
}

function readCustomStore() {
  let data
  try {
    data = JSON.parse(readFileSync(customStoreFile(), 'utf8'))
  } catch {
    return { version: 1, items: [] }
  }
  const items = (Array.isArray(data?.items) ? data.items : [])
    .map(normalizeCustomItem)
    .filter(Boolean)
    .slice(0, MAX_CUSTOM_ITEMS)
  return { version: 1, items }
}

function writeCustomStore(data) {
  const file = customStoreFile()
  mkdirSync(dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.tmp'
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

function customMeta(item) {
  return {
    id: item.id,
    name: item.name,
    kind: item.kind,
    pid: item.pid,
    created: item.created,
    updated: item.updated,
    size: item.body.length,
  }
}

/**
 * 只读预览：从文件里切一段（'head' 从头，'tail' 从尾）。
 * 大文件不该整份读进内存 —— 编辑器要的只是「能看见的那一屏」。
 */function readWindow(target, size, mode, bytes) {
  const len = Math.max(0, Math.min(bytes, size))
  const offset = mode === 'tail' ? Math.max(0, size - len) : 0
  const fd = openSync(target, 'r')
  try {
    const buf = Buffer.alloc(len)
    let got = 0
    while (got < len) {
      const n = readSync(fd, buf, got, len - got, offset + got)
      if (n <= 0) break
      got += n
    }
    return { raw: buf.subarray(0, got), offset, partial: size > got }
  } finally {
    closeSync(fd)
  }
}

/* ============================ git ============================ */
/* 实现在 src/git.js（含 GitHub 账号 / 克隆 / 上传），这里只保留分发与路径校验。 */

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

/**
 * realpath 的 Windows 友好版：优先用 native 实现。
 * JS 那份只做字符串层面的 .. / 符号链接展开，**不会把 8.3 短名（JINSHU~1）还原成长名**，
 * 于是「白名单里是 C:\Users\jinshuaiyu，请求走的是 C:\Users\JINSHU~1」就会被误判成越界。
 */
function realPath(p) {
  try {
    if (typeof realpathSync.native === 'function') return realpathSync.native(p)
  } catch { /* 落到 JS 实现再试一次 */ }
  return realpathSync(p)
}

function canonicalRoots() {
  const list = [process.cwd(), homedir(), process.env.DSH_HOME, ...PROJECT_ROOTS.values()]
  const out = []
  for (const item of list) {
    if (typeof item !== 'string' || !item) continue
    try { out.push(realPath(item)) } catch { /* 不存在就跳过 */ }
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
      return join(realPath(probe), ...rest.reverse())
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
  /* .env 前缀：覆盖 .env.local / .env.production 等运行时密钥文件 */
  if (parts.some((p) => p.startsWith('.env'))) return true
  return false
}

/**
 * 路径准入。
 *
 * - `read`  ：只挡凭证目录。文件管理器要能像资源管理器那样一路往上翻到盘符根，
 *             读遍全盘不设白名单（DSH 里的 agent 本来就有同样的读权限）。
 * - `write` ：额外要求落在白名单根内（cwd / home / DSH_HOME / 已注册项目）。
 * - `trash` ：不要求白名单（回收站本身就是可撤销的），具体的「不能删什么」
 *             交给 /fs/delete 里的 trashGuard 判断。
 */
function assertSandbox(target, mode = 'read') {
  if (typeof target !== 'string' || !target.trim()) throw httpError(400, 'path required')
  if (target.includes('\0')) throw httpError(400, 'invalid path')
  if (!isAbsolute(target)) throw httpError(400, 'path must be absolute')
  const canonical = canonicalize(target)
  if (hasDeniedSegment(canonical)) throw httpError(403, '该目录受保护：' + canonical)
  if (mode === 'write' && !insideRoot(canonical, canonicalRoots())) {
    throw httpError(403, '写操作只允许在工作目录 / 用户目录 / 已注册项目内：' + canonical)
  }
  return canonical
}

async function assertExisting(target, kind, mode = 'read') {
  const real = assertSandbox(target, mode)
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
  return assertSandbox(target, 'write')
}

/** 大小写不敏感的平台统一小写，用于路径比较 */
function normPath(p) {
  const s = String(p || '')
  return process.platform === 'win32' ? s.toLowerCase() : s
}

/** target 是不是某个白名单根的祖先（删了它等于连工作区一起端掉） */
function isAncestorOfRoot(target) {
  const t = normPath(target)
  const withSep = t.endsWith(sep) ? t : t + sep
  for (const root of canonicalRoots()) {
    const r = normPath(root)
    if (r !== t && r.startsWith(withSep)) return true
  }
  return false
}

/** Windows 系统关键目录，永远不删 */
function isSystemCritical(target) {
  if (process.platform !== 'win32') return false
  const t = normPath(target)
  const list = [
    process.env.SystemRoot,
    process.env.windir,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
  ]
  for (const p of list) {
    if (typeof p === 'string' && p && normPath(p) === t) return true
  }
  return false
}

/** 删除前的闸门：只拦真正会伤到人的目标，其余一律放行到回收站 */
function trashGuard(target) {
  if (dirname(target) === target) return { status: 400, error: '不能删除磁盘根目录：' + target }
  if (isSystemCritical(target)) return { status: 403, error: '不能删除系统目录：' + target }
  if (isProtectedRoot(target)) return { status: 403, error: '不能删除工作区根目录：' + target }
  if (isAncestorOfRoot(target)) return { status: 403, error: '不能删除包含工作目录的上级目录：' + target }
  return null
}

/**
 * 真正要删的那一项。
 *
 * 关键：**不跟随最后一段软链接**。原来走 assertExisting → canonicalize → realpathSync，
 * 右击一个指向别处的链接会把「链接指向的目标」删掉，链接本身反而留下。
 * 这里只解析父目录，末段保留原样，并用 lstat 判断存在（断链也能删）。
 */
function deleteTarget(rawPath) {
  assertSandbox(rawPath, 'trash') /* 先跟随链接查一遍凭证目录，防止借链接摸进 .ssh */
  const abs = resolve(rawPath)
  const target = join(canonicalize(dirname(abs)), basename(abs))
  try {
    lstatSync(target)
  } catch {
    throw httpError(404, '路径不存在：' + target)
  }
  const blocked = trashGuard(target)
  if (blocked) throw httpError(blocked.status, blocked.error)
  return target
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

/**
 * /site 的最终路径校验（防软链接逃逸）。
 *
 * 先 safeJoin 挡 ../，再 realpath 跟随软链接到真实路径，最后再验一次 containment。
 * 返回真实绝对路径；若路径存在但软链接指向项目之外 → 返回 ''（调用方转 403）；
 * 若不存在 → 退回 safeJoin 的字符串结果（container 已保证在根内），让后续 stat 报 404。
 */
function safeSiteTarget(root, rel) {
  const t = safeJoin(root, rel || 'index.html')
  if (!t) return ''
  let real
  try { real = realpathSync(t) } catch { return t }
  const norm = process.platform === 'win32' ? real.toLowerCase() : real
  const r = process.platform === 'win32' ? root.toLowerCase() : root
  if (norm === r || norm.startsWith(r.endsWith(sep) ? r : r + sep)) return real
  return ''
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

function allowMethod(req, res, ...methods) {
  const list = methods.length ? methods : ['GET']
  const actual = String(req?.method || 'GET').toUpperCase()
  if (list.includes(actual) || (list.includes('GET') && actual === 'HEAD')) return true
  sendJson(res, 405, { error: '仅支持 ' + list.join(' / ') })
  return false
}

/**
 * 防 CSRF 的 Origin 判定。
 *
 * DSH 把客户端与 API 都挂在同一个 localhost（Cordis webServer 同源），
 * 所以合法请求的 Origin 是 localhost / 127.0.0.1（或浏览器不带的简单请求 / curl / 内部健康检查）。
 * 任何带「远程站点 Origin」的请求（如恶意网页 drive-by POST）一律拒绝 ——
 * 这样即使浏览器因无 CORS 头读不到响应，命令也不会被执行。
 */
function originAllowed(req) {
  const origin = req.headers && (req.headers.origin || req.headers.Origin)
  if (!origin) return true
  let host
  try {
    host = new URL(String(origin)).hostname.toLowerCase()
  } catch {
    return false
  }
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '::ffff:127.0.0.1'
}

export function sendJson(res, status, body) {
  /* 流式响应（/term/exec 的 NDJSON）先 writeHead 再 end；若中途异常、guard 再调本函数，
     对已 headersSent 的响应二次 writeHead 会抛错。这里安全降级为丢弃并告警。 */
  if (res.headersSent || res.writableEnded) {
    console.warn('[worktable] 响应已发送，丢弃重复写入', status)
    return
  }
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

/** /site 的错误页：iframe 里直接看到中文说明，而不是一坨 JSON */
function sendSiteError(res, status, title, detail) {
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const html = '<!doctype html><meta charset="utf-8"><title>' + esc(title) + '</title>'
    + '<style>body{font:13px/1.7 system-ui,"Segoe UI",sans-serif;background:#0f1218;color:#dfe4ea;padding:32px;max-width:640px}'
    + 'h1{font-size:15px;color:#f0b429;margin:0 0 8px}p{color:#8b95a3;margin:0 0 7px;font-size:12px}'
    + 'code{color:#cfd6df}</style>'
    + '<h1>⚠ ' + esc(title) + '</h1><p>' + esc(detail) + '</p>'
    + '<p>这是工作台的项目静态托管（<code>' + esc(BASE) + '/site/…</code>），不是你的开发服务器；'
    + '要连 dev server 请在浏览器窗格地址栏直接填 <code>http://localhost:端口</code>。</p>'
  const body = Buffer.from(html, 'utf8')
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' })
  res.end(body)
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
    '.bmp': 'image/bmp',
    '.avif': 'image/avif',
    '.pdf': 'application/pdf',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ogv': 'video/ogg',
    '.mov': 'video/quicktime',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.txt': 'text/plain; charset=utf-8',
    '.md': 'text/markdown; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
  }
  return map[ext] || 'application/octet-stream'
}
