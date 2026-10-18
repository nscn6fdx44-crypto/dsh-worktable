/**
 * host 路由离线自测：桩掉 webServer / sessions / sessionQuery / req / res，直接调用 handler。
 * 覆盖：health（新旧前缀）、sessions 四态归类、tree（正常/非绝对/不存在）、file（文本/二进制/超大）。
 */
import { apply } from '../lib/index.js'

const routes = new Map()

/* ---------- 假会话：running / waiting / done / idle 各一条 ---------- */
function ev(type, extra) {
  return { type, time: Date.now(), ...(extra || {}) }
}
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
  ['s-done', {
    seq: 2,
    log: [ev('turn/start', {}), ev('turn/end', {})],
    header: { id: 's-done', cwd: 'C:\\Users\\demo\\proj-gamma', createdAt: 1 },
  }],
  ['s-idle', { seq: 0, log: [], header: { id: 's-idle', cwd: 'C:\\Users\\demo\\proj-delta', createdAt: 0 } }],
])

const fakeSessions = {
  list: () => [...liveSessions.values()],
  get: (id) => liveSessions.get(id),
}
const fakeSessionQuery = {
  listSessions: async () => [...liveSessions.values()].map((s) => ({
    header: s.header,
    live: true,
    persisted: true,
  })),
  /* 对话只读预览：只持久化、不在活的会话 s-persisted */
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

const ctx = {
  webServer: { register: (r) => routes.set(r.path, r.handler) },
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
apply(ctx)
console.log('routes:', [...routes.keys()].join(', '))

function call(path, bodyObj) {
  return new Promise((resolve) => {
    const handler = routes.get(path)
    if (!handler) return resolve({ status: 404, body: 'no route' })
    const payload = bodyObj === undefined ? '' : JSON.stringify(bodyObj)
    const req = {
      on(ev, fn) {
        if (ev === 'data' && payload) setTimeout(() => fn(payload), 0)
        if (ev === 'end') setTimeout(() => fn(), 1)
      },
    }
    let status = 0
    let out = ''
    const res = {
      writeHead(s) { status = s; return res },
      end(chunk) { out += chunk ?? ''; setTimeout(() => resolve({ status, body: out }), 0) },
    }
    handler(req, res)
  })
}

const results = []
function check(name, cond, extra) {
  results.push({ name, ok: !!cond, extra })
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '   ' + extra : ''))
}

/* ---------- MVP：health / sessions ---------- */
const health = await call('/api/trae-worktable/health')
const hj = JSON.parse(health.body)
check('worktable/health 200 + ok', health.status === 200 && hj.ok === true, health.body.slice(0, 100))
check('health 报告会话服务可用', hj.services && hj.services.sessions === true, JSON.stringify(hj.services))

const legacyHealth = await call('/api/trae-worktable/health')
const sess = await call('/api/trae-worktable/sessions')
const sj = JSON.parse(sess.body)
check('sessions 200 + ok', sess.status === 200 && sj.ok === true, 'source=' + sj.source)
check('sessions 计数：运行中 1', sj.counts.running === 1, JSON.stringify(sj.counts))
check('sessions 计数：待处理 1', sj.counts.waiting === 1, JSON.stringify(sj.counts))
check('sessions 计数：已完成 1', sj.counts.done === 1, JSON.stringify(sj.counts))
check('sessions 计数：待命 1', sj.counts.idle === 1, JSON.stringify(sj.counts))
check('sessions 计数：总数 4', sj.counts.total === 4, JSON.stringify(sj.counts))
check('sessions 标题优先取首条用户消息', sj.sessions.some((s) => s.title === '跑一下构建'), JSON.stringify(sj.sessions.map((s) => s.title)))
check('sessions 无消息时退回目录名', sj.sessions.some((s) => s.title === 'proj-gamma'), JSON.stringify(sj.sessions.map((s) => s.title)))
check('sessions 带 cwd', sj.sessions.every((s) => typeof s.cwd === 'string'), '')

/* ---------- 默认工作区 / 对话预览 ---------- */
const defaults = await call('/api/trae-worktable/defaults')
const dj = JSON.parse(defaults.body)
check('defaults 200 + 给出默认工作区', defaults.status === 200 && dj.ok === true && /proj-|demo|\\/.test(String(dj.workspace)), String(dj.workspace).slice(0, 60))

const tr = await call('/api/trae-worktable/transcript', { sessionId: 's-persisted', limit: 10 })
const trj = JSON.parse(tr.body)
check('transcript 200 + ok', tr.status === 200 && trj.ok === true, tr.body.slice(0, 90))
check('transcript 抽出两条气泡', Array.isArray(trj.messages) && trj.messages.length === 2, JSON.stringify(trj.messages?.map((m) => m.role)))
check('transcript 用户消息文本正确', trj.messages?.[0]?.role === 'user' && trj.messages?.[0]?.text.includes('构建脚本'), '')
check('transcript 助手消息文本正确', trj.messages?.[1]?.role === 'assistant' && trj.messages?.[1]?.text.includes('package.json'), '')
check('transcript 标题取日志里的 session/title', trj.title === '构建脚本整理', String(trj.title))
check('transcript 过滤 reasoning/tool-call 入参', !JSON.stringify(trj.messages).includes('"arguments"'), '')

const trBad = await call('/api/trae-worktable/transcript', {})
check('transcript 缺 sessionId → 400', trBad.status === 400, trBad.body.slice(0, 60))

const trMissing = await call('/api/trae-worktable/transcript', { sessionId: 'nope' })
check('transcript 未知会话降级 200', trMissing.status === 200 && JSON.parse(trMissing.body).ok === false, trMissing.body.slice(0, 80))

/* 没有 sessionQuery / sessions 时不崩，返回降级结构 */
const routesBare = new Map()
const bareCtx = {
  webServer: { register: (r) => routesBare.set(r.path, r.handler) },
  logger: { info() {}, warn() {} },
  effect() {},
  get() { return undefined },
}
apply(bareCtx)
const bareHandler = routesBare.get('/api/trae-worktable/sessions')
const bare = await new Promise((resolve) => {
  const res = { writeHead() { return res }, end(chunk) { resolve(JSON.parse(chunk)) } }
  bareHandler({ on() {} }, res)
})
check('无会话服务时降级不抛异常', bare.ok === true && bare.counts.total === 0, JSON.stringify(bare.counts))

/* ---------- P1 只读工作区 ---------- */
const tree = await call('/api/trae-worktable/tree', { path: process.cwd() })
const tj = JSON.parse(tree.body)
check('tree 200', tree.status === 200, 'entries=' + (tj.entries || []).length)
check('tree 排序目录在前', (tj.entries || []).length === 0 || tj.entries[0].dir === true)
check('tree 有 parent', typeof tj.parent === 'string' && tj.parent.length > 0, tj.parent)

const rel = await call('/api/trae-worktable/tree', { path: 'dsh' })
check('tree 拒绝相对路径', rel.status === 400, rel.body.slice(0, 80))

const missing = await call('/api/trae-worktable/tree', { path: 'C:\\__no_such_dir_wt__' })
check('tree 拒绝不存在目录', missing.status === 400, missing.body.slice(0, 80))

const file = await call('/api/trae-worktable/file', { path: process.cwd() + '\\package.json' })
const fj = JSON.parse(file.body)
check('file 200 + 有内容', file.status === 200 && fj.text.includes('trae-usage-worktable'), 'size=' + fj.size)
check('file 未截断', fj.truncated === false)

const bin = await call('/api/trae-worktable/file', { path: 'C:\\Windows\\System32\\notepad.exe' })
check('file 拒绝二进制/非白名单', bin.status === 415, bin.body.slice(0, 90))

const dirAsFile = await call('/api/trae-worktable/file', { path: process.cwd() })
check('file 拒绝目录', dirAsFile.status === 400, dirAsFile.body.slice(0, 80))

const noFile = await call('/api/trae-worktable/file', { path: process.cwd() + '\\nope.txt' })
check('file 拒绝不存在', noFile.status === 400, noFile.body.slice(0, 80))

const failed = results.filter((r) => !r.ok)
console.log('\n' + (failed.length ? 'FAILED ' + failed.length : 'ALL PASS') + ' / ' + results.length)
process.exit(failed.length ? 1 : 0)
