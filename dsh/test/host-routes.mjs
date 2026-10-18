/**
 * host 路由离线自测：桩掉 webServer / sessions / sessionQuery / req / res，直接调 handler。
 *
 * 覆盖：health、sessions 四态、defaults、transcript；
 *      fs/list、fs/read、fs/write、fs/mkdir、fs/rename（含原子写与越界拦截）；
 *      fs/delete / fs/deletable 的拒绝分支（盘符根、白名单根、白名单根的祖先）；
 *      fs/reveal（交给系统文件管理器，dry-run 不真弹窗）；
 *      git status/log；project/register + /site 静态托管；term/exec NDJSON 流。
 */
import { apply, sendJson } from '../lib/index.js'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { createServer } from 'node:http'
import { Writable } from 'node:stream'
import { join } from 'node:path'
import { homedir } from 'node:os'

const routes = new Map()
const BASE = '/api/trae-worktable'

/* ---------- 假会话：running / waiting / done / idle 各一条 ---------- */
const ev = (type, extra) => ({ type, time: Date.now(), ...(extra || {}) })
const liveSessions = new Map([
  ['s-running', {
    seq: 3,
    log: [ev('turn/start', { data: { turn: 1 } }), ev('user/message', { data: { content: [{ type: 'text', text: '跑一下构建' }] } }), ev('step/start', {})],
    header: { id: 's-running', cwd: 'C:\\Users\\demo\\proj-alpha', createdAt: 3 },
  }],
  ['s-waiting', {
    seq: 4,
    log: [
      ev('turn/start', {}),
      ev('user/message', { data: { content: [{ type: 'text', text: '删掉旧文件' }] } }),
      ev('approval/asked', { data: { id: 'a1', toolName: 'rm' } }),
      ev('tool/call', {}),
    ],
    header: { id: 's-waiting', cwd: 'C:\\Users\\demo\\proj-beta', createdAt: 2 },
  }],
  ['s-done', { seq: 2, log: [ev('turn/start', {}), ev('turn/end', {})], header: { id: 's-done', cwd: 'C:\\Users\\demo\\proj-gamma', createdAt: 1 } }],
  ['s-idle', { seq: 0, log: [], header: { id: 's-idle', cwd: 'C:\\Users\\demo\\proj-delta', createdAt: 0 } }],
])

const fakeSessions = { list: () => [...liveSessions.values()], get: (id) => liveSessions.get(id) }
const fakeSessionQuery = {
  /* 真实环境里持久化列表只给 header，没有 live 标记 —— 状态判定不能依赖它 */
  listSessions: async () => [...liveSessions.values()].map((s) => ({ header: s.header, persisted: true })),
  load: async (id) => {
    if (id !== 's-persisted') throw new Error('SESSION_QUERY_SESSION_NOT_FOUND')
    return {
      header: { id: 's-persisted', cwd: 'C:\\Users\\demo\\proj-log', createdAt: 9 },
      events: [
        { type: 'session/title', seq: 0, time: 1, data: { title: '构建脚本整理' } },
        { type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: '帮我整理一下构建脚本' }], source: { kind: 'user' } } },
        { type: 'assistant/message', seq: 2, time: 3, data: { message: { content: [{ type: 'text', text: '好的，先看 package.json。' }, { type: 'tool-call', id: 'c1', name: 'pwsh', arguments: '{}' }] } } },
      ],
    }
  },
}

/* 新建会话：宿主 GUI 走的也是 sessionController.create；这里只断言插件把 cwd 透传 */
const createdSessions = []
const fakeSessionController = {
  async create(request) {
    createdSessions.push(request || {})
    return { sessionId: 'session-new-1', agentPreset: 'standard' }
  },
}

function makeCtx() {
  return {
    webServer: {
      register: (r) => { routes.set((r.kind || 'exact') + ' ' + r.path, r.handler); return () => routes.delete(r.path) },
    },
    logger: { info() {}, warn() {} },
    effect() {},
    sessions: fakeSessions,
    sessionQuery: fakeSessionQuery,
    get(name) {
      if (name === 'sessions') return fakeSessions
      if (name === 'sessionQuery') return fakeSessionQuery
      if (name === 'sessionController') return fakeSessionController
      return undefined
    },
  }
}

apply(makeCtx())

function routeOf(path, kind = 'exact') {
  return routes.get(kind + ' ' + path)
}

/** 真 Writable 版 res：createReadStream().pipe(res) 需要真实的流语义 */
function makeRes(done) {
  const chunks = []
  const res = new Writable({
    write(chunk, _enc, cb) { chunks.push(Buffer.from(chunk)); cb() },
  })
  res.status = 0
  res.headers = {}
  res.writeHead = (s, h) => { res.status = s; Object.assign(res.headers, h || {}); return res }
  res.on('finish', () => done({
    status: res.status,
    headers: res.headers,
    body: Buffer.concat(chunks).toString('utf8'),
  }))
  return res
}

/** 流式 GET：/fs/raw 用 createReadStream().pipe(res)，res 必须是真 Writable */
function callRaw(path, query, headers) {
  return new Promise((resolve) => {
    const handler = routeOf(path) || routeOf(path, 'prefix')
    if (!handler) return resolve({ status: 404, body: 'no route', headers: {} })
    const qs = query ? '?' + new URLSearchParams(query).toString() : ''
    const res = makeRes((out) => resolve(out))
    handler({ method: 'GET', url: path + qs, headers: headers || {}, on() {} }, res)
  })
}

/** 一次性 JSON 调用（query 给 GET 用，例如 /fs/raw?path=…；reqHeaders 用于 CSRF 用例带 Origin） */
function call(path, bodyObj, method = 'POST', query, reqHeaders) {
  return new Promise((resolve) => {
    const handler = routeOf(path) || routeOf(path, 'prefix')
    if (!handler) return resolve({ status: 404, body: 'no route' })
    const payload = bodyObj === undefined ? '' : JSON.stringify(bodyObj)
    const qs = query ? '?' + new URLSearchParams(query).toString() : ''
    let delivered = false
    const req = {
      method,
      url: path + qs,
      headers: reqHeaders || {},
      on(e, fn) {
        if (e === 'data' && payload) setTimeout(() => { if (!delivered) fn(payload) }, 0)
        if (e === 'end') setTimeout(() => { delivered = true; fn() }, 1)
      },
    }
    let status = 0
    let headers = {}
    let out = ''
    const res = {
      writableEnded: false,
      writeHead(s, h) { status = s; if (h) headers = h; return res },
      write(chunk) { out += chunk; return true },
      end(chunk) { if (chunk) out += chunk; res.writableEnded = true; setTimeout(() => resolve({ status, headers, body: out }), 0) },
      destroy() { res.writableEnded = true; resolve({ status, headers, body: out }) },
    }
    handler(req, res)
  })
}

const results = []
function check(name, cond, extra) {
  results.push({ name, ok: !!cond })
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '   ' + String(extra).slice(0, 140) : ''))
}

/* ============================ 宿主状态 ============================ */

const health = await call(BASE + '/health', undefined, 'GET')
const hj = JSON.parse(health.body)
check('health 200 + ok', health.status === 200 && hj.ok === true, hj.version)
check('health 报告服务可用', hj.services.sessions === true && hj.services.sessionQuery === true, JSON.stringify(hj.services))
check('health 带上限常量', hj.limits && hj.limits.fileBytes > 0, JSON.stringify(hj.limits))

const sess = await call(BASE + '/sessions', undefined, 'GET')
const sj = JSON.parse(sess.body)
check('sessions 200', sess.status === 200 && sj.ok === true, 'source=' + sj.source)
check('sessions 四态各 1', sj.counts.running === 1 && sj.counts.waiting === 1 && sj.counts.done === 1 && sj.counts.idle === 1, JSON.stringify(sj.counts))
check('sessions 总数 4', sj.counts.total === 4)
check('标题取首条用户消息', sj.sessions.some((s) => s.title === '跑一下构建'))
check('无消息时退回目录名', sj.sessions.some((s) => s.title === 'proj-gamma'))
check('保留 host 原始态（running/waiting）', sj.sessions.some((s) => s.state === 'running') && sj.sessions.some((s) => s.state === 'waiting'))
check('列表行没 live 标记也能分辨活跃会话', sj.sessions.find((s) => s.id === 's-running').live === true && sj.sessions.find((s) => s.id === 's-idle').live === false, JSON.stringify(sj.sessions.map((s) => [s.id, s.live])))

const defaults = await call(BASE + '/defaults', undefined, 'GET')
const dj = JSON.parse(defaults.body)
check('defaults 给出工作区', defaults.status === 200 && dj.ok === true && String(dj.workspace).length > 0, dj.workspace)
check('defaults 带 shell 标签', typeof dj.shell === 'string' && dj.shell.length > 0, dj.shell)

const tr = await call(BASE + '/transcript', { sessionId: 's-persisted', limit: 10 })
const trj = JSON.parse(tr.body)
check('transcript 200 + 两条气泡', tr.status === 200 && trj.messages.length === 2, JSON.stringify(trj.messages.map((m) => m.role)))
check('transcript 标题取日志', trj.title === '构建脚本整理', trj.title)
check('transcript 不漏 tool-call 入参', !JSON.stringify(trj.messages).includes('"arguments"'))
check('transcript 缺 sessionId → 400', (await call(BASE + '/transcript', {})).status === 400)
check('transcript 未知会话降级', JSON.parse((await call(BASE + '/transcript', { sessionId: 'nope' })).body).ok === false)

/* ============================ 文件系统 ============================ */

const tmp = join(process.cwd(), '.tmp-wt-test')
rmSync(tmp, { recursive: true, force: true })
mkdirSync(tmp, { recursive: true })

const list = await call(BASE + '/fs/list', { path: process.cwd() })
const lj = JSON.parse(list.body)
check('fs/list 200', list.status === 200 && Array.isArray(lj.entries), 'entries=' + (lj.entries || []).length)
check('fs/list 目录在前', lj.entries.length === 0 || lj.entries[0].dir === true)
check('fs/list 带 parent', typeof lj.parent === 'string' && lj.parent.length > 0, lj.parent)
check('fs/list 条目带 size/mtime', lj.entries.every((e) => typeof e.size === 'number' && typeof e.mtime === 'number'))

const file = join(tmp, 'note.md')
writeFileSync(file, '# hello\n中文内容\n', 'utf8')
const read1 = await call(BASE + '/fs/read', { path: file })
const rj = JSON.parse(read1.body)
check('fs/read 200 + 文本', read1.status === 200 && rj.text.includes('中文内容'), 'size=' + rj.size)
check('fs/read 未截断', rj.truncated === false)
check('fs/read 识别换行', rj.eol === 'lf' || rj.eol === 'crlf', rj.eol)

/* /fs/raw：图片 / PDF / 音视频的内嵌预览通道（浏览器 <img>/<iframe> 只能 GET） */
const pngFile = join(tmp, 'shot.png')
writeFileSync(pngFile, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('WT-PNG-BODY')]))
const rawPng = await callRaw(BASE + '/fs/raw', { path: pngFile })
check('fs/raw 200 + image/png', rawPng.status === 200 && /^image\/png/.test(String(rawPng.headers['content-type'] || '')), JSON.stringify(rawPng.headers || {}).slice(0, 90))
check('fs/raw 回的是原始字节', rawPng.body.includes('WT-PNG-BODY'), JSON.stringify(rawPng.body.slice(0, 24)))
check('fs/raw 就地渲染（inline + nosniff）', /inline/.test(String(rawPng.headers['content-disposition'] || '')) && rawPng.headers['x-content-type-options'] === 'nosniff', rawPng.headers['content-disposition'])

const pdfFile = join(tmp, 'manual.pdf')
writeFileSync(pdfFile, '%PDF-1.4\n%%EOF\n')
const rawPdf = await callRaw(BASE + '/fs/raw', { path: pdfFile })
check('fs/raw pdf → application/pdf', rawPdf.status === 200 && /application\/pdf/.test(String(rawPdf.headers['content-type'] || '')), rawPdf.headers['content-type'])

const rawText = await call(BASE + '/fs/raw', undefined, 'GET', { path: file })
check('fs/raw 非媒体类型 → 415', rawText.status === 415 && JSON.parse(rawText.body).code === 'not-media', rawText.body.slice(0, 80))
const rawDir = await call(BASE + '/fs/raw', undefined, 'GET', { path: tmp })
check('fs/raw 目录 → 400', rawDir.status === 400, rawDir.body.slice(0, 60))
const rawMiss = await call(BASE + '/fs/raw', undefined, 'GET', { path: join(tmp, 'nope.png') })
check('fs/raw 不存在 → 404', rawMiss.status === 404, rawMiss.body.slice(0, 60))
const rawDenied = await call(BASE + '/fs/raw', undefined, 'GET', { path: join(homedir(), '.ssh', 'id_rsa') })
check('fs/raw 也挡凭证目录', rawDenied.status === 403, rawDenied.status + ' ' + rawDenied.body.slice(0, 60))

const hugePng = join(tmp, 'huge.png')
writeFileSync(hugePng, Buffer.alloc(49 * 1024 * 1024))
const rawBig = await call(BASE + '/fs/raw', undefined, 'GET', { path: hugePng })
check('fs/raw 超上限 → 413', rawBig.status === 413 && JSON.parse(rawBig.body).code === 'too-large', rawBig.body.slice(0, 90))
rmSync(hugePng, { force: true })

const wr = await call(BASE + '/fs/write', { path: file, text: '# 改过了\n' })
check('fs/write 200', wr.status === 200 && JSON.parse(wr.body).ok === true, wr.body.slice(0, 60))
check('fs/write 真的落盘', readFileSync(file, 'utf8') === '# 改过了\n')
check('fs/write 不留临时文件', !existsSync(file + '.wt-tmp-' + process.pid))

const wrBad = await call(BASE + '/fs/write', { path: file, text: 123 })
check('fs/write 非字符串文本 → 400', wrBad.status === 400, wrBad.body.slice(0, 60))

const mk = await call(BASE + '/fs/mkdir', { path: join(tmp, 'sub/deep') })
check('fs/mkdir 递归建目录', mk.status === 200 && existsSync(join(tmp, 'sub/deep')))

const rn = await call(BASE + '/fs/rename', { from: join(tmp, 'sub'), to: join(tmp, 'sub2') })
check('fs/rename 200', rn.status === 200 && existsSync(join(tmp, 'sub2')), rn.body.slice(0, 60))

/* 删除：只测「拒绝」分支 —— 真删会往系统回收站丢垃圾，不在自动测试里做 */
const delMissing = await call(BASE + '/fs/delete', { path: join(tmp, 'not-here') })
check('fs/delete 不存在 → 404', delMissing.status === 404, delMissing.body.slice(0, 60))
const delRoot = await call(BASE + '/fs/delete', { path: process.cwd() })
check('fs/delete 拒绝删除工作区根', delRoot.status === 403 && existsSync(process.cwd()), delRoot.status + ' ' + delRoot.body.slice(0, 70))
const delRel = await call(BASE + '/fs/delete', { path: 'some/rel' })
check('fs/delete 拒绝相对路径', delRel.status === 400, delRel.body.slice(0, 60))

/* 磁盘根：读得到（文件管理器要能一路往上翻），但绝不许删，且原因要说清楚 */
const driveRoot = (process.env.SystemDrive || 'C:') + '\\'
const rootList = await call(BASE + '/fs/list', { path: driveRoot })
check('fs/list 允许盘符根（读不设白名单）', rootList.status === 200, rootList.status + ' ' + rootList.body.slice(0, 60))
check('fs/list 报告白名单外不可写', JSON.parse(rootList.body).writable === false, rootList.body.slice(0, 40))
check('fs/list 报告白名单内可写', lj.writable === true, 'writable=' + lj.writable)
const delDrive = await call(BASE + '/fs/delete', { path: driveRoot })
check('fs/delete 拒绝盘符根并说明原因', delDrive.status === 400 && delDrive.body.includes('磁盘根目录'), delDrive.body.slice(0, 80))
const delUp = await call(BASE + '/fs/delete', { path: join(process.cwd(), '..') })
check('fs/delete 拒绝白名单根的祖先', delUp.status === 403 && delUp.body.includes('上级目录'), delUp.body.slice(0, 80))

/* 右键菜单先问「能不能删」，把禁止原因写在菜单里 */
const canFile = await call(BASE + '/fs/deletable', { path: join(tmp, 'note.md') })
check('fs/deletable 普通文件可删', JSON.parse(canFile.body).ok === true, canFile.body.slice(0, 60))
const canDrive = await call(BASE + '/fs/deletable', { path: driveRoot })
const canDriveJ = JSON.parse(canDrive.body)
check('fs/deletable 盘符根给出原因', canDriveJ.ok === false && String(canDriveJ.reason).includes('磁盘根'), canDrive.body.slice(0, 90))

const bin = await call(BASE + '/fs/read', { path: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe') })
check('fs/read 越界/二进制被拒', bin.status === 403 || bin.status === 415 || bin.status === 404, bin.status + ' ' + bin.body.slice(0, 70))

const relPath = await call(BASE + '/fs/list', { path: 'dsh' })
check('fs/list 拒绝相对路径', relPath.status === 400, relPath.body.slice(0, 60))

const outside = await call(BASE + '/fs/write', { path: (process.env.SystemRoot || 'C:\\Windows') + '\\wt-should-not-exist.txt', text: 'x' })
check('fs/write 拒绝白名单外路径', outside.status === 403, outside.body.slice(0, 80))

/* 交给系统文件管理器：只校验路径与返回结构，dry-run 下不真弹资源管理器 */
process.env.WORKTABLE_OPEN_DRYRUN = '1'
const rev = await call(BASE + '/fs/reveal', { path: tmp })
const rvj = JSON.parse(rev.body)
check('fs/reveal 200 + dryRun', rev.status === 200 && rvj.ok === true && rvj.dryRun === true, rev.body.slice(0, 90))
check('fs/reveal 回传真实路径', typeof rvj.path === 'string' && rvj.path.length > 0, rvj.path)
const revFile = await call(BASE + '/fs/reveal', { path: join(tmp, 'note.md'), select: true })
const rfj = JSON.parse(revFile.body)
check('fs/reveal 支持选中文件', revFile.status === 200 && rfj.select === true, revFile.body.slice(0, 80))

const revMissing = await call(BASE + '/fs/reveal', { path: join(tmp, 'nope-dir') })
check('fs/reveal 不存在 → 404', revMissing.status === 404, revMissing.body.slice(0, 60))

const revRel = await call(BASE + '/fs/reveal', { path: 'relative/dir' })
check('fs/reveal 拒绝相对路径', revRel.status === 400, revRel.body.slice(0, 60))

const revOut = await call(BASE + '/fs/reveal', { path: (process.env.SystemRoot || 'C:////Windows') + '\\System32' })
check('fs/reveal 白名单外也能打开（只读出口）', revOut.status === 200, revOut.status + ' ' + revOut.body.slice(0, 70))

/* 系统默认程序（大文件 / 二进制 / 日志的出路） */
const opn = await call(BASE + '/fs/open', { path: join(tmp, 'note.md') })
const opj = JSON.parse(opn.body)
check('fs/open 200 + dryRun', opn.status === 200 && opj.dryRun === true && opj.ok === true, opn.body.slice(0, 80))
const opnMissing = await call(BASE + '/fs/open', { path: join(tmp, 'nope.txt') })
check('fs/open 不存在 → 404', opnMissing.status === 404, opnMissing.body.slice(0, 60))
const opnRel = await call(BASE + '/fs/open', { path: 'rel/file.txt' })
check('fs/open 拒绝相对路径', opnRel.status === 400, opnRel.body.slice(0, 60))

const ssh = await call(BASE + '/fs/list', { path: join(homedir(), '.ssh') })
check('fs/list 拒绝凭证目录', ssh.status === 403, ssh.body.slice(0, 80))

const noFile = await call(BASE + '/fs/read', { path: join(tmp, 'nope.txt') })
check('fs/read 不存在 → 404', noFile.status === 404, noFile.body.slice(0, 60))

const dirAsFile = await call(BASE + '/fs/read', { path: tmp })
check('fs/read 目录 → 400', dirAsFile.status === 400, dirAsFile.body.slice(0, 60))

/* 大文件：auto 不再一上来就 413，而是降级成「只读预览」；full 才报 413；tail 给结尾 */
const big = join(tmp, 'big.log')
writeFileSync(big, 'HEAD-MARK\n' + 'y'.repeat(5 * 1024 * 1024) + '\nTAIL-MARK\n', 'utf8')
const bigAuto = await call(BASE + '/fs/read', { path: big })
const baj = JSON.parse(bigAuto.body)
check('大文件 auto 降级为只读预览（不再 413）', bigAuto.status === 200 && baj.partial === true, bigAuto.status + ' ' + bigAuto.body.slice(0, 60))
check('大文件 auto 只读开头 256 KB', baj.window.bytes === 256 * 1024 && baj.window.offset === 0 && baj.size > 4 * 1024 * 1024, JSON.stringify(baj.window))
check('大文件预览内容从文件开头开始', String(baj.text).startsWith('HEAD-MARK'), String(baj.text).slice(0, 20))
check('大文件预览带上限字段', baj.limit === 4 * 1024 * 1024 && baj.previewBytes === 256 * 1024, baj.limit + '/' + baj.previewBytes)

const bigFull = await call(BASE + '/fs/read', { path: big, mode: 'full' })
const bfj = JSON.parse(bigFull.body)
check('大文件 full → 413 + too-large', bigFull.status === 413 && bfj.code === 'too-large', bigFull.body.slice(0, 90))
check('413 里带 size / limit 供界面提示', bfj.size > 4 * 1024 * 1024 && bfj.limit === 4 * 1024 * 1024)

const bigTail = await call(BASE + '/fs/read', { path: big, mode: 'tail' })
const btj = JSON.parse(bigTail.body)
check('tail 读文件结尾', bigTail.status === 200 && btj.mode === 'tail' && String(btj.text).trimEnd().endsWith('TAIL-MARK'), String(btj.text).slice(-30))
check('tail 窗口偏移在文件末尾', btj.window.offset > 4 * 1024 * 1024 && btj.partial === true, JSON.stringify(btj.window))

const smallTail = await call(BASE + '/fs/read', { path: join(tmp, 'note.md'), mode: 'tail' })
check('小文件 tail 不标记 partial', smallTail.status === 200 && JSON.parse(smallTail.body).partial === false)

/* ============================ git ============================ */

const gitStatus = await call(BASE + '/git', { path: process.cwd(), op: 'status' })
const gj = JSON.parse(gitStatus.body)
check('git status 200', gitStatus.status === 200, gitStatus.body.slice(0, 80))
check('git 认出仓库', gj.repo === true, 'branch=' + gj.branch)
check('git 有 changes 数组', Array.isArray(gj.changes) && gj.counts && typeof gj.counts.total === 'number', JSON.stringify(gj.counts))

const gitLog = await call(BASE + '/git', { path: process.cwd(), op: 'log', limit: 3 })
const glj = JSON.parse(gitLog.body)
check('git log 200 + 提交', gitLog.status === 200 && glj.commits.length > 0, 'commits=' + (glj.commits || []).length)
check('git log 字段完整', !glj.commits.length || (glj.commits[0].hash && glj.commits[0].subject))

const gitBad = await call(BASE + '/git', { path: process.cwd(), op: 'push' })
check('git 拒绝写操作 op', gitBad.status === 400, gitBad.body.slice(0, 60))

/* ============================ 静态托管 ============================ */

writeFileSync(join(tmp, 'index.html'), '<h1>wt-site</h1>', 'utf8')
const reg = await call(BASE + '/project/register', { id: 'p-test', root: tmp })
check('project/register 200', reg.status === 200 && JSON.parse(reg.body).ok === true, reg.body.slice(0, 80))

async function getSite(url) {
  return new Promise((resolve) => {
    const handler = routeOf(BASE + '/site', 'prefix')
    handler({ method: 'GET', url }, makeRes(resolve))
  })
}

const siteRes = await getSite(BASE + '/site/p-test/')
check('/site 返回 index.html', siteRes.status === 200 && siteRes.body.includes('wt-site'), siteRes.status + ' ' + siteRes.body.slice(0, 40))
check('/site 带 html mime', String(siteRes.headers['content-type']).includes('text/html'))

const siteMiss = await getSite(BASE + '/site/p-unknown/')
check('/site 未注册项目 → 404（HTML 说明页，不是 JSON）',
  siteMiss.status === 404 && String(siteMiss.headers['content-type']).includes('text/html') && siteMiss.body.includes('静态托管还没就绪'),
  siteMiss.status + ' ' + siteMiss.body.slice(0, 50))

const siteTrav = await getSite(BASE + '/site/p-test/%2e%2e%2f%2e%2e%2fpackage.json')
check('/site 拦截编码路径穿越', siteTrav.status === 403, siteTrav.status + ' ' + siteTrav.body.slice(0, 60))

const siteDeep = await getSite(BASE + '/site/p-test/sub2/deep/')
check('/site 无 index 时回退目录页', siteDeep.status === 200 && siteDeep.body.includes('deep') && siteDeep.body.includes('目录列表'), siteDeep.status + ' ' + siteDeep.body.slice(0, 60))

writeFileSync(join(tmp, 'plain.txt'), 'plain', 'utf8')
const siteFile = await getSite(BASE + '/site/p-test/plain.txt')
check('/site 直出普通文件', siteFile.status === 200 && siteFile.body === 'plain', siteFile.status + ' ' + siteFile.body.slice(0, 20))
check('/site 普通文件 mime', String(siteFile.headers['content-type']).includes('text/plain'), siteFile.headers['content-type'])

/* ============================ 终端 ============================ */

const termOut = await new Promise((resolve) => {
  const handler = routeOf(BASE + '/term/exec')
  const payload = JSON.stringify({ id: 't1', cmd: process.platform === 'win32' ? 'echo wt-term-ok' : 'echo wt-term-ok', cwd: tmp })
  let delivered = false
  const req = {
    method: 'POST',
    on(e, fn) {
      if (e === 'data') setTimeout(() => { if (!delivered) fn(payload) }, 0)
      if (e === 'end') setTimeout(() => { delivered = true; fn() }, 1)
      if (e === 'aborted') {}
    },
  }
  let status = 0
  let out = ''
  const res = {
    writableEnded: false,
    writeHead(s) { status = s; return res },
    write(c) { out += c; return true },
    end(c) { if (c) out += c; res.writableEnded = true; resolve({ status, out }) },
    destroy() {},
  }
  handler(req, res)
})
const termEvents = termOut.out.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
check('term/exec 200 NDJSON', termOut.status === 200 && termEvents.length > 0, termEvents.length + ' events')
check('term 有输出回显', termEvents.some((e) => e && e.t === 'out' && String(e.d).includes('wt-term-ok')), termOut.out.slice(0, 120))
check('term 结束带 code', termEvents.some((e) => e && e.t === 'end' && e.code === 0))
check('term 回传 cwd', termEvents.some((e) => e && e.t === 'cwd'))

const cdOut = await new Promise((resolve) => {
  const handler = routeOf(BASE + '/term/exec')
  const payload = JSON.stringify({ id: 't2', cmd: 'cd ' + JSON.stringify(tmp), cwd: process.cwd() })
  let delivered = false
  const req = {
    method: 'POST',
    on(e, fn) {
      if (e === 'data') setTimeout(() => { if (!delivered) fn(payload) }, 0)
      if (e === 'end') setTimeout(() => { delivered = true; fn() }, 1)
    },
  }
  let out = ''
  const res = { writableEnded: false, writeHead() { return res }, write(c) { out += c; return true }, end(c) { if (c) out += c; resolve(out) }, destroy() {} }
  handler(req, res)
})
check('term cd 由 host 接管并生效', cdOut.includes('cwd') && cdOut.includes('tmp-wt-test'), cdOut.split('\n')[0].slice(0, 100))

/* ============================ 降级 ============================ */

const bareRoutes = new Map()
apply({
  webServer: { register: (r) => { bareRoutes.set(r.path, r.handler); return () => {} } },
  logger: { info() {}, warn() {} },
  effect() {},
  get() { return undefined },
})
const bare = await new Promise((resolve) => {
  const handler = bareRoutes.get(BASE + '/sessions')
  const res = { writableEnded: false, writeHead() { return res }, write() { return true }, end(c) { resolve(JSON.parse(c)) }, destroy() {} }
  handler({ method: 'GET' }, res)
})
check('无会话服务时降级不抛', bare.ok === true && bare.counts.total === 0 && bare.degraded === true, JSON.stringify(bare.counts))

/* ============================ 浏览器窗格：探测 / 外部打开 ============================ */

/* 起一个真服务：一条带 X-Frame-Options 的路由 + 一条正常路由 */
const probeSrv = createServer((req, res) => {
  if (req.url === '/blocked') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-frame-options': 'SAMEORIGIN' })
    res.end('<html><head><title>拒绝嵌入的服务</title></head><body>x</body></html>')
    return
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end('<html><head><title>本地开发服务</title></head><body>ok</body></html>')
})
await new Promise((r) => probeSrv.listen(0, '127.0.0.1', r))
const probePort = probeSrv.address().port

const probeOk = await call(BASE + '/web/probe', { url: 'http://127.0.0.1:' + probePort + '/' })
const probeOkJ = JSON.parse(probeOk.body).results[0]
check('web/probe 探到活服务 + 标题', probeOkJ.ok === true && probeOkJ.status === 200 && probeOkJ.title === '本地开发服务', JSON.stringify(probeOkJ))
check('web/probe 正常页判定可嵌入', probeOkJ.frameable === true && probeOkJ.frameReason === '', probeOkJ.frameReason)

const probeXfo = await call(BASE + '/web/probe', { urls: ['http://127.0.0.1:' + probePort + '/blocked'] })
const probeXfoJ = JSON.parse(probeXfo.body).results[0]
check('web/probe 认出 X-Frame-Options 不能嵌', probeXfoJ.frameable === false && /SAMEORIGIN/i.test(probeXfoJ.frameReason), probeXfoJ.frameReason)

const probeDead = await call(BASE + '/web/probe', { url: 'http://127.0.0.1:1/' })
const probeDeadJ = JSON.parse(probeDead.body).results[0]
check('web/probe 死端口 ok=false', probeDeadJ.ok === false && !!probeDeadJ.error, probeDeadJ.error)

const probeBadProto = await call(BASE + '/web/probe', { url: 'ftp://example.com/x' })
check('web/probe 挡掉非 http 协议', JSON.parse(probeBadProto.body).results[0].ok === false)
const probeNone = await call(BASE + '/web/probe', {})
check('web/probe 没地址 400', probeNone.status === 400)

probeSrv.close()

const openBad = await call(BASE + '/web/open', { url: 'file:///C:/Windows' })
check('web/open 挡掉 file: 协议', openBad.status === 400)
const openNoHost = await call(BASE + '/web/open', { url: 'http://' })
check('web/open 挡掉空主机', openNoHost.status === 400)
const openOk = await call(BASE + '/web/open', { url: 'localhost:5173' })
const openOkJ = JSON.parse(openOk.body)
check('web/open 归一地址（dry-run 不真弹浏览器）', openOk.status === 200 && openOkJ.url === 'http://localhost:5173/', openOkJ.url)

/* ============================ 自定义窗口库 ============================ */

/* 用临时 DSH_HOME，别把测试数据写进真实的 ~/.dsh */
process.env.DSH_HOME = join(tmp, 'dsh-home')

const cNew = await call(BASE + '/custom/save', { name: '构建看板', kind: 'html', body: '<h1>hi</h1>' })
const cNewJ = JSON.parse(cNew.body)
const cid = cNewJ.item?.id
check('custom/save 新建（宿主发号）', cNew.status === 200 && cNewJ.ok === true && /^c[a-z0-9]{4,}$/.test(String(cid)), cid)
check('custom/save 落盘到 DSH_HOME', existsSync(join(tmp, 'dsh-home', 'worktable-custom.json')))

const cList = await call(BASE + '/custom/list', {})
const cListJ = JSON.parse(cList.body)
check('custom/list 有条目且不带正文', cListJ.items.length === 1 && cListJ.items[0].name === '构建看板' && cListJ.items[0].body === undefined, JSON.stringify(cListJ.items[0]))

const cGet = await call(BASE + '/custom/get', { id: cid })
check('custom/get 回正文', JSON.parse(cGet.body).item.body === '<h1>hi</h1>')

const cUpd = await call(BASE + '/custom/save', { id: cid, body: '<h2>改过</h2>' })
const cUpdJ = JSON.parse(cUpd.body)
check('custom/save 按 id 覆盖，不新增', cUpdJ.item.id === cid && cUpdJ.item.body === '<h2>改过</h2>' && cUpdJ.item.name === '构建看板', JSON.stringify({ n: cUpdJ.item.name, b: cUpdJ.item.body }))
const cCount = JSON.parse((await call(BASE + '/custom/list', {})).body).items.length
check('custom/save 覆盖后条目数不变', cCount === 1, cCount)

const cUrl = await call(BASE + '/custom/save', { name: '监控页', kind: 'url', body: 'localhost:3000/dash' })
check('custom/save 网址型归一成 http', JSON.parse(cUrl.body).item.body === 'http://localhost:3000/dash')
const cBadUrl = await call(BASE + '/custom/save', { name: '坏', kind: 'url', body: 'javascript:alert(1)' })
check('custom/save 挡掉 javascript: 网址', cBadUrl.status === 400)

const cDel = await call(BASE + '/custom/delete', { id: cid })
const cGone = await call(BASE + '/custom/get', { id: cid })
check('custom/delete 后 get 404', cDel.status === 200 && cGone.status === 404)
check('custom/get 非法 id 安全返回 404', (await call(BASE + '/custom/get', { id: '../etc/passwd' })).status === 404)
check('custom/delete 不存在的 id 404', (await call(BASE + '/custom/delete', { id: 'nope' })).status === 404)

/* 无 webServer 时不抛 */
let boom = null
try {
  apply({ logger: { info() {}, warn() {} }, effect() {}, get() { return undefined } })
} catch (e) { boom = e }
check('无 webServer 时静默降级', !boom, boom && boom.message)

/* ============================ 安全加固回归 ============================ */

/* ① CSRF：跨域 Origin 必须被 403，本机 / 无 Origin 放行 */
const csrfCross = await call(BASE + '/fs/list', { path: process.cwd() }, 'POST', undefined, { origin: 'https://evil.example.com' })
check('① CSRF 跨域 Origin → 403', csrfCross.status === 403, csrfCross.status + ' ' + csrfCross.body.slice(0, 60))
const csrfTerm = await call(BASE + '/term/exec', { id: 'x', cmd: 'echo hi' }, 'POST', undefined, { origin: 'https://evil.example.com' })
check('① CSRF 跨域也能拦 /term/exec', csrfTerm.status === 403, csrfTerm.status + ' ' + csrfTerm.body.slice(0, 60))
const csrfLocal = await call(BASE + '/fs/list', { path: process.cwd() }, 'POST', undefined, { origin: 'http://localhost' })
check('① CSRF 本机 Origin 放行', csrfLocal.status === 200, csrfLocal.status + ' ' + csrfLocal.body.slice(0, 50))
const csrfNone = await call(BASE + '/fs/list', { path: process.cwd() })
check('① CSRF 无 Origin（内部/同源）放行', csrfNone.status === 200, csrfNone.status)

/* ⑤ 凭证段补全：.env / .env.local / .npmrc 一律拒绝 */
const denyEnv = await call(BASE + '/fs/list', { path: join(tmp, '.env', 'tokens') })
check('⑤ fs/list 拒绝 .env 凭证段', denyEnv.status === 403, denyEnv.body.slice(0, 80))
const denyEnvLocal = await call(BASE + '/fs/list', { path: join(tmp, '.env.local', 'x') })
check('⑤ fs/list 拒绝 .env.local 变体', denyEnvLocal.status === 403, denyEnvLocal.body.slice(0, 80))
const denyNpmrc = await call(BASE + '/fs/list', { path: join(tmp, '.npmrc') })
check('⑤ fs/list 拒绝 .npmrc', denyNpmrc.status === 403, denyNpmrc.body.slice(0, 80))

/* ⑥ /web/probe SSRF：云元数据 / 链路本地禁止代发请求（连都不连） */
const probeMeta = await call(BASE + '/web/probe', { url: 'http://169.254.169.254/latest/meta-data' })
const probeMetaJ = JSON.parse(probeMeta.body).results[0]
check('⑥ web/probe 拦云元数据端点', probeMetaJ.ok === false && /禁止|元数据|链路本地/.test(probeMetaJ.error || ''), probeMetaJ.error)
const probeLL = await call(BASE + '/web/probe', { url: 'http://169.254.1.1/' })
check('⑥ web/probe 拦链路本地地址', JSON.parse(probeLL.body).results[0].ok === false)
/* 回环（127.0.0.1）不拦：已有的 probeOk 用例（L463）已证明 127.0.0.1 正常 */

/* ④ /site 软链接逃逸：项目内一个指向项目外的链接，读不走外面 */
let linkOk = false
try {
  symlinkSync(process.cwd(), join(tmp, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
  linkOk = true
} catch { linkOk = false }
if (linkOk) {
  const siteEscapeFile = await getSite(BASE + '/site/p-test/escape/README.md')
  check('④ /site 挡软链接指向项目外的文件', siteEscapeFile.status === 403, siteEscapeFile.status + ' ' + siteEscapeFile.body.slice(0, 60))
  const siteEscapeDir = await getSite(BASE + '/site/p-test/escape/')
  check('④ /site 挡软链接指向项目外的目录', siteEscapeDir.status === 403, siteEscapeDir.status + ' ' + siteEscapeDir.body.slice(0, 60))
  /* 确认正常文件仍可读（没把合法请求误伤） */
  writeFileSync(join(tmp, 'ok.txt'), 'still-ok', 'utf8')
  const siteStillOk = await getSite(BASE + '/site/p-test/ok.txt')
  check('④ /site 合法文件仍 200', siteStillOk.status === 200 && siteStillOk.body === 'still-ok', siteStillOk.status + ' ' + siteStillOk.body.slice(0, 20))
} else {
  check('④ /site 软链接逃逸测试跳过（环境无法创建链接）', true, 'skip')
}

/* ② sendJson 对已 headersSent 的响应安全丢弃（不抛错） */
let guardThrew = false
try {
  const gres = { headersSent: true, writableEnded: false, writeHead() {}, end() {}, write() { return true } }
  sendJson(gres, 200, { ok: true })
} catch { guardThrew = true }
check('② sendJson 已发头时安全丢弃（不抛错）', guardThrew === false)

rmSync(tmp, { recursive: true, force: true })

/* ============================ 新建会话 ============================ */

const created = await call(BASE + '/session/create', { cwd: 'C:\\projects\\demo' })
const cj = JSON.parse(created.body)
check('session/create 返回宿主新建的 sessionId', created.status === 200 && cj.ok === true && cj.sessionId === 'session-new-1', created.body.slice(0, 110))
check('session/create 透传 cwd', (createdSessions[0] || {}).cwd === 'C:\\projects\\demo', JSON.stringify(createdSessions[0] || {}))

await call(BASE + '/session/create', {})
check('不传 cwd 时请求体为空（用宿主默认目录）', JSON.stringify(createdSessions[1] || {}) === '{}', JSON.stringify(createdSessions[1] || {}))

const bareCreateHandler = bareRoutes.get(BASE + '/session/create')
const bareCreate = await new Promise((resolve) => {
  const res = { writableEnded: false, writeHead() { return res }, write() { return true }, end(c) { resolve(JSON.parse(c)) }, destroy() {} }
  bareCreateHandler({
    method: 'POST',
    on(e, fn) {
      if (e === 'data') setTimeout(() => fn('{"cwd":"C:\\\\x"}'), 0)
      if (e === 'end') setTimeout(fn, 1)
    },
  }, res)
})
check('无 sessionController 时 ok:false + 原因', bareCreate.ok === false && /sessionController/.test(String(bareCreate.error)), JSON.stringify(bareCreate).slice(0, 120))

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? 'FAILED ' + failed.length : 'ALL PASS') + ' / ' + results.length)
process.exit(failed.length ? 1 : 0)
