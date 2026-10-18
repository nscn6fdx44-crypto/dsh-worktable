/**
 * host 路由离线自测：桩掉 webServer / sessions / sessionQuery / req / res，直接调 handler。
 *
 * 覆盖：health、sessions 四态、defaults、transcript；
 *      fs/list、fs/read、fs/write、fs/mkdir、fs/rename（含原子写与越界拦截）；
 *      git status/log；project/register + /site 静态托管；term/exec NDJSON 流。
 */
import { apply } from '../lib/index.js'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
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

/** 一次性 JSON 调用 */
function call(path, bodyObj, method = 'POST') {
  return new Promise((resolve) => {
    const handler = routeOf(path) || routeOf(path, 'prefix')
    if (!handler) return resolve({ status: 404, body: 'no route' })
    const payload = bodyObj === undefined ? '' : JSON.stringify(bodyObj)
    let delivered = false
    const req = {
      method,
      url: path,
      on(e, fn) {
        if (e === 'data' && payload) setTimeout(() => { if (!delivered) fn(payload) }, 0)
        if (e === 'end') setTimeout(() => { delivered = true; fn() }, 1)
      },
    }
    let status = 0
    let out = ''
    const res = {
      writableEnded: false,
      writeHead(s) { status = s; return res },
      write(chunk) { out += chunk; return true },
      end(chunk) { if (chunk) out += chunk; res.writableEnded = true; setTimeout(() => resolve({ status, body: out }), 0) },
      destroy() {},
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

const bin = await call(BASE + '/fs/read', { path: join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'notepad.exe') })
check('fs/read 越界/二进制被拒', bin.status === 403 || bin.status === 415 || bin.status === 404, bin.status + ' ' + bin.body.slice(0, 70))

const relPath = await call(BASE + '/fs/list', { path: 'dsh' })
check('fs/list 拒绝相对路径', relPath.status === 400, relPath.body.slice(0, 60))

const outside = await call(BASE + '/fs/write', { path: (process.env.SystemRoot || 'C:\\Windows') + '\\wt-should-not-exist.txt', text: 'x' })
check('fs/write 拒绝白名单外路径', outside.status === 403, outside.body.slice(0, 80))

const ssh = await call(BASE + '/fs/list', { path: join(homedir(), '.ssh') })
check('fs/list 拒绝凭证目录', ssh.status === 403, ssh.body.slice(0, 80))

const noFile = await call(BASE + '/fs/read', { path: join(tmp, 'nope.txt') })
check('fs/read 不存在 → 404', noFile.status === 404, noFile.body.slice(0, 60))

const dirAsFile = await call(BASE + '/fs/read', { path: tmp })
check('fs/read 目录 → 400', dirAsFile.status === 400, dirAsFile.body.slice(0, 60))

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
check('/site 未注册项目 → 404', siteMiss.body.includes('未注册'), siteMiss.body.slice(0, 60))

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

/* 无 webServer 时不抛 */
let boom = null
try {
  apply({ logger: { info() {}, warn() {} }, effect() {}, get() { return undefined } })
} catch (e) { boom = e }
check('无 webServer 时静默降级', !boom, boom && boom.message)

rmSync(tmp, { recursive: true, force: true })

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? 'FAILED ' + failed.length : 'ALL PASS') + ' / ' + results.length)
process.exit(failed.length ? 1 : 0)
