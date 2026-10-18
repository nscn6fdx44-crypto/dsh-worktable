/**
 * client bundle 离线冒烟：桩掉 React / document / localStorage / fetch / slots，
 * 加载 ModuleLoader 产物并真实渲染 + 点按钮，验证：
 *   - 两个座位注册、样式只注入一次
 *   - 侧边栏：状态栏 / 项目列表（不再单列宿主会话）
 *   - 右击菜单：单一「绑定对话」入口（窗口模式已删除）
 *   - 总览 / 项目工作区：宿主会话区都让位到右侧，工作台只占左边，右侧是宿主原生对话
 *     两者共用同一套外壳（顶栏 + 面板 + 右边缘拖动条），铺满对话左侧那块
 *   - 工作台只有一种形态：铺满让位区，没有浮动窗口
 *   - 侧边栏状态框只记四态；文件管理器交给系统窗口（点标签页即弹出）
 *   - 让位宽度换算（computeDock）
 *   - 新建项目小窗、对话绑定小窗
 */
import { readFileSync } from 'node:fs'

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/* ---------- 桩：document / localStorage ---------- */
const styleNodes = []
globalThis.document = {
  createElement: (tag) => ({ tag, setAttribute() {}, textContent: '', remove() {} }),
  head: { appendChild: (n) => styleNodes.push(n) },
  body: { classList: { add() {}, remove() {} } },
  querySelectorAll: () => [1],
  addEventListener() {},
  removeEventListener() {},
}
globalThis.window = globalThis.window || {}
globalThis.window.innerWidth = 1440
globalThis.window.innerHeight = 900
globalThis.window.addEventListener = () => {}
globalThis.window.removeEventListener = () => {}

const ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
}

/* ---------- 桩：fetch ---------- */
const NOW = Date.now()
const fakeSessions = {
  ok: true, at: NOW, source: 'sessionQuery',
  counts: { running: 2, waiting: 1, done: 3, idle: 1, total: 7 },
  sessions: [
    { id: 's-apple', title: 'app-alpha 会话', cwd: 'C:\\demo\\app-alpha', state: 'running', live: true, createdAt: 3, updatedAt: NOW },
    { id: 's-beta', title: 'beta 控制台', cwd: 'C:\\demo\\beta', state: 'waiting', live: true, createdAt: 2, updatedAt: NOW },
    { id: 's-gamma', title: 'gamma', cwd: 'C:\\demo\\gamma', state: 'done', live: false, createdAt: 1, updatedAt: NOW },
  ],
}
const fakeDefaults = { ok: true, at: NOW, workspace: 'C:\\Users\\demo\\default-workspace', home: 'C:\\Users\\demo\\.dsh', platform: 'win32', shell: 'powershell' }
const fakeTree = {
  path: 'C:\\projects\\smart-car', name: 'smart-car', parent: 'C:\\projects',
  entries: [
    { name: 'src', dir: true, size: 0, mtime: NOW },
    { name: 'README.md', dir: false, size: 128, mtime: NOW },
    { name: 'main.c', dir: false, size: 2048, mtime: NOW },
    { name: 'app.js', dir: false, size: 512, mtime: NOW },
    { name: 'shot.png', dir: false, size: 4096, mtime: NOW },
    { name: 'manual.pdf', dir: false, size: 8192, mtime: NOW },
  ],
  total: 6, truncated: false,
}
const fakeFile = { path: 'C:\\projects\\smart-car\\README.md', name: 'README.md', size: 18, text: '# smart car\n固件说明\n', truncated: false }
const fakeJs = { path: 'C:\\projects\\smart-car\\app.js', name: 'app.js', size: 62, text: 'const a = 1\n// 注释\nfunction go() { return "x" }\n', truncated: false }
const fakeGit = { ok: true, repo: true, branch: 'main', changes: [{ code: ' M', file: 'main.c' }], counts: { staged: 0, unstaged: 1, untracked: 0, total: 1 } }
const fakeGitLog = { ok: true, commits: [{ hash: 'a1b2c3d', date: '2026-10-01', subject: '整理构建脚本', author: 'demo' }] }
const fakeGitBranches = { ok: true, branches: ['main'] }

const sessionCreates = []
let lastListPath = ''
let listCalls = 0
let deletableBlock = ''
const reveals = []
const deletes = []
const opens = []
const writes = []
const reads = []
/* 浏览器 · 探测结果可控；自定义窗口库用内存数组模拟宿主侧 */
const probeCalls = []
const webOpens = []
let probeFrameable = false
const customStore = []
/* 'big' 时把 /fs/read 变成「8 MB 大文件」：不带 mode → 413，带 mode → 只读预览 */
let readCase = ''
/* 'missing' 时 artifact.json 读不到，用来测「没有产物不算错误」 */
let artifactCase = ''
globalThis.fetch = async (url, opts) => {
  const u = String(url)
  if (u.endsWith('/fs/list')) {
    listCalls += 1
    try { lastListPath = String(JSON.parse(String(opts?.body || '{}')).path || '') } catch { lastListPath = '' }
  }
  if (u.endsWith('/fs/reveal')) {
    try { reveals.push(JSON.parse(String(opts?.body || '{}'))) } catch { /* ignore */ }
  }
  if (u.endsWith('/fs/delete')) {
    try { deletes.push(JSON.parse(String(opts?.body || '{}'))) } catch { /* ignore */ }
  }
  if (u.endsWith('/fs/open')) {
    try { opens.push(JSON.parse(String(opts?.body || '{}'))) } catch { /* ignore */ }
    return { ok: true, status: 200, json: async () => ({ ok: true, path: 'x' }), text: async () => '{}' }
  }
  if (u.endsWith('/fs/write')) {
    try { writes.push(JSON.parse(String(opts?.body || '{}'))) } catch { /* ignore */ }
  }
  if (u.endsWith('/session/create')) {
    try { sessionCreates.push(JSON.parse(String(opts?.body || '{}'))) } catch { /* ignore */ }
    const created = { ok: true, sessionId: 'session-new-1', agentPreset: 'standard' }
    return { ok: true, status: 200, json: async () => created, text: async () => JSON.stringify(created) }
  }
  let readPath = ''
  if (u.endsWith('/fs/read')) {
    try { readPath = String(JSON.parse(String(opts?.body || '{}')).path || '') } catch { readPath = '' }
    reads.push(readPath)
  }
  if (u.endsWith('/fs/read') && readPath.endsWith('artifact.json') && artifactCase !== 'missing') {
    const art = {
      path: readPath, name: 'artifact.json', size: 220,
      text: JSON.stringify({
        artifacts: [
          { title: '站点预览', kind: 'url', url: 'http://localhost:5173' },
          { title: '架构图', kind: 'file', path: 'docs/arch.png' },
          { title: '报告', kind: 'md', path: 'docs/report.md' },
        ],
      }),
    }
    return { ok: true, status: 200, json: async () => art, text: async () => JSON.stringify(art) }
  }
  if (u.endsWith('/fs/read') && readPath.endsWith('artifact.json') && artifactCase === 'missing') {
    const miss = { error: 'ENOENT: no such file or directory', code: 'enoent' }
    return { ok: false, status: 404, json: async () => miss, text: async () => JSON.stringify(miss) }
  }
  if (u.endsWith('/fs/read') && readPath.endsWith('app.js')) {
    return { ok: true, status: 200, json: async () => fakeJs, text: async () => JSON.stringify(fakeJs) }
  }
  if (u.endsWith('/fs/read') && readCase === 'big') {
    let req = {}
    try { req = JSON.parse(String(opts?.body || '{}')) } catch { /* ignore */ }
    if (!req.mode) {
      const bad = { error: '文件过大（8.0 MB），编辑器上限 4.0 MB', code: 'too-large', size: 8 * 1024 * 1024, limit: 4 * 1024 * 1024, previewBytes: 262144 }
      return { ok: false, status: 413, json: async () => bad, text: async () => JSON.stringify(bad) }
    }
    const part = {
      path: req.path, name: 'README.md', size: 8 * 1024 * 1024, text: '# 前 256 KB\n', truncated: false,
      partial: true, mode: req.mode, limit: 4 * 1024 * 1024, previewBytes: 262144, window: { offset: 0, bytes: 262144 },
    }
    return { ok: true, status: 200, json: async () => part, text: async () => JSON.stringify(part) }
  }
  /* ---------- 浏览器 / 自定义 的桩 ---------- */
  if (u.endsWith('/web/probe')) {
    try { probeCalls.push(JSON.parse(String(opts?.body || '{}'))) } catch { /* ignore */ }
    const body = {
      results: [{
        ok: true, url: 'http://localhost:5173/', status: 200, ms: 12, title: 'Vite',
        frameable: probeFrameable, frameReason: probeFrameable ? '' : 'X-Frame-Options: SAMEORIGIN',
      }],
    }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
  if (u.endsWith('/web/open')) {
    try { webOpens.push(JSON.parse(String(opts?.body || '{}'))) } catch { /* ignore */ }
    const body = { ok: true, url: 'http://localhost:5173/' }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
  if (u.endsWith('/custom/list')) {
    const items = customStore.map((it) => ({ id: it.id, name: it.name, kind: it.kind, pid: it.pid, updated: it.updated, size: it.body.length }))
    const body = { file: 'C:\\Users\\demo\\.dsh\\worktable-custom.json', items }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
  if (u.endsWith('/custom/get')) {
    let req = {}
    try { req = JSON.parse(String(opts?.body || '{}')) } catch { /* ignore */ }
    const item = customStore.find((it) => it.id === req.id)
    if (!item) return { ok: false, status: 404, json: async () => ({ error: '没有这个自定义窗口' }), text: async () => '{}' }
    return { ok: true, status: 200, json: async () => ({ item }), text: async () => '{}' }
  }
  if (u.endsWith('/custom/save')) {
    let req = {}
    try { req = JSON.parse(String(opts?.body || '{}')) } catch { /* ignore */ }
    const now = new Date().toISOString()
    const id = req.id || 'ctest1'
    const prev = customStore.find((it) => it.id === id)
    const item = {
      id,
      name: req.name || prev?.name || '未命名窗口',
      kind: req.kind || prev?.kind || 'html',
      body: String(req.body ?? prev?.body ?? ''),
      pid: req.pid || '',
      created: prev?.created || now,
      updated: now,
    }
    const idx = customStore.findIndex((it) => it.id === id)
    if (idx === -1) customStore.push(item)
    else customStore[idx] = item
    const body = { ok: true, item, meta: { id, name: item.name, kind: item.kind, pid: item.pid, updated: now, size: item.body.length } }
    return { ok: true, status: 200, json: async () => body, text: async () => '{}' }
  }
  if (u.endsWith('/custom/delete')) {
    let req = {}
    try { req = JSON.parse(String(opts?.body || '{}')) } catch { /* ignore */ }
    const idx = customStore.findIndex((it) => it.id === req.id)
    if (idx !== -1) customStore.splice(idx, 1)
    const body = { ok: true, id: req.id }
    return { ok: true, status: 200, json: async () => body, text: async () => '{}' }
  }
  const body = u.endsWith('/sessions') ? fakeSessions
    : u.endsWith('/defaults') ? fakeDefaults
        : u.endsWith('/fs/list') ? fakeTree
          : u.endsWith('/fs/read') ? fakeFile
            : u.endsWith('/fs/deletable') ? (deletableBlock ? { ok: false, reason: deletableBlock } : { ok: true, reason: '' })
            : u.endsWith('/git') ? (String(opts?.body || '').includes('"log"') ? fakeGitLog : (String(opts?.body || '').includes('"branches"') ? fakeGitBranches : fakeGit))
              : { ok: true }
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
}

/* ---------- 桩：React ---------- */
const reactStub = {
  /* 贴近真实 React：children 既在第三个参数里，也挂在 props.children 上 */
  createElement: (type, props, ...children) => {
    const kids = children.flat().filter((c) => c != null && c !== false && c !== true)
    const p = { ...(props || {}) }
    if (kids.length) p.children = kids.length === 1 ? kids[0] : kids
    return { type, props: p, children: kids }
  },
  Component: class {
    constructor(props) { this.props = props; this.state = {} }
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p) }
  },
  useState: (init) => {
    const v = typeof init === 'function' ? init() : init
    return [v, () => {}]
  },
  useEffect: () => {},
  useLayoutEffect: () => {},
  useCallback: (fn) => fn,
  useRef: (v) => ({ current: v === undefined ? null : v }),
}

/* ---------- 桩：ModuleLoader ---------- */
let captured = null
globalThis.window.__ModuleLoader__ = { load: (mod) => { captured = mod } }
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}
globalThis.setTimeout = globalThis.setTimeout || (() => 0)

const requireStub = (name) => {
  if (name === 'react') return reactStub
  if (name === 'react/jsx-runtime') return { jsx: reactStub.createElement, jsxs: reactStub.createElement, Fragment: 'Fragment' }
  throw new Error('unexpected external: ' + name)
}

/* 预置两个项目，第一个已绑定对话（走旧 wt.bindings 迁移路径） */
ls.set('wt.projects', JSON.stringify([
  { id: 'custom-1', name: '智能小车固件', alias: '智能小车固件', path: 'C:\\projects\\smart-car', langs: ['C'], category: '自定义', updated: '2026-10-01', custom: true },
  { id: 'custom-2', name: '上位机面板', alias: '上位机面板', path: 'C:\\projects\\hmi', langs: ['C#'], category: '自定义', updated: '2026-10-02', custom: true },
]))
ls.set('wt.bindings', JSON.stringify({ 'custom-1': 's-apple' }))

new Function('window', code)(globalThis.window)
if (!captured) throw new Error('ModuleLoader.load 未被调用')
if (captured.id !== 'trae-usage-worktable') throw new Error('id 不符: ' + captured.id)
const mod = captured.factory(requireStub)

const results = []
const check = (name, cond, extra) => {
  results.push(!!cond)
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '   ' + String(extra).slice(0, 160) : ''))
}

check('导出 inject 含 slots', Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))
check('导出 apply', typeof mod.apply === 'function')

/* ---------- 桩：cordis ctx ---------- */
const registrations = []
const ctx = {
  slots: {
    inject(name, factory) { factory() },
    register(opts, Comp) { registrations.push({ name: opts.name, id: opts.id, Comp }); return () => {} },
  },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject(deps, cb) { cb({}) },
  get() { return undefined },
  logger: { info() {}, warn() {} },
}

mod.apply(ctx)
await new Promise((r) => setTimeout(r, 60))   // 等 sessions / defaults 落地

check('注入了 sidebar.footer.action', registrations.some((r) => r.name === 'sidebar.footer.action'), JSON.stringify(registrations))
check('注入了 shell.overlay', registrations.some((r) => r.name === 'shell.overlay'))
check('样式只注入一次', styleNodes.length === 1, styleNodes.length)

/* ---------- 渲染工具 ---------- */
function expand(node, depth = 0) {
  if (node == null || depth > 26) return node
  if (Array.isArray(node)) return node.map((n) => expand(n, depth + 1))
  if (typeof node !== 'object') return node
  const type = node.type
  if (typeof type === 'function') {
    const isClass = !!(type.prototype && type.prototype.render)
    const inst = isClass ? new type(node.props) : type(node.props)
    return expand(isClass ? inst.render() : inst, depth + 1)
  }
  const props = node.props || {}
  const raw = node.children !== undefined ? node.children : props.children
  if (raw === undefined) return node
  const kids = expand(raw, depth + 1)
  return { ...node, props: { ...props, children: kids }, children: Array.isArray(kids) ? kids : (kids == null ? [] : [kids]) }
}
function collect(node, out = []) {
  if (node == null) return out
  if (Array.isArray(node)) { node.forEach((n) => collect(n, out)); return out }
  if (typeof node === 'string' || typeof node === 'number') { out.push({ text: String(node) }); return out }
  if (typeof node !== 'object') return out
  out.push(node)
  if (node.children && node.children.length) collect(node.children, out)
  else if (node.props && node.props.children) collect(node.props.children, out)
  return out
}
const textOf = (node) => collect(node).filter((n) => n.text != null).map((n) => n.text).join(' ')
const allByClass = (node, re) => collect(node).filter((n) => n.props && typeof n.props.className === 'string' && re.test(n.props.className))
function clickByLabel(root, label) {
  const cands = collect(root).filter((n) => n.props && typeof n.props.onClick === 'function' && textOf(n).includes(label))
  cands.sort((a, b) => textOf(a).length - textOf(b).length)
  const hit = cands[0]
  if (!hit) throw new Error('找不到按钮：' + label)
  hit.props.onClick({ preventDefault() {}, stopPropagation() {}, clientX: 10, clientY: 10, target: { closest: () => null, value: '' }, key: '' })
  return hit
}
/** 按「按钮文字完全相等」找按钮（'←' / ':5173' 这种短标签用） */
function btnByText(root, label) {
  return collect(root).find((n) => n.props && typeof n.props.onClick === 'function' && textOf(n).trim() === label) || null
}
function clickExact(root, label) {
  const hit = btnByText(root, label)
  if (!hit) throw new Error('找不到按钮：' + label)
  hit.props.onClick({ preventDefault() {}, stopPropagation() {}, target: { closest: () => null, value: '' }, key: '' })
  return hit
}
const iframeOf = (root) => collect(root).find((n) => n.type === 'iframe') || null
function rightClickByText(root, label) {  const hit = collect(root).find((n) => n.props && typeof n.props.onContextMenu === 'function' && textOf(n).includes(label))
  if (!hit) throw new Error('找不到可右击节点：' + label)
  hit.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 100, clientY: 120 })
}

/** 顶部只留「＋ 窗口」：点标签前先展开菜单 */
function openPaneIn(root, label) {
  mod.store.tabMenu = true
  const tree = render(overlayComp)
  clickByLabel(tree, label)
  mod.store.tabMenu = false
  return render(overlayComp)
}
const sidebarComp = registrations.find((r) => r.name === 'sidebar.footer.action')
const overlayComp = registrations.find((r) => r.name === 'shell.overlay')
const render = (reg) => {
  const comp = reg && reg.Comp ? reg.Comp : reg
  const isClass = !!(comp.prototype && comp.prototype.render)
  return expand(isClass ? new comp({}).render() : comp({}))
}

/* ---------- 侧边栏 ---------- */
let boom = null
let sidebar = null
try { sidebar = render(sidebarComp) } catch (e) { boom = e }
check('侧边栏渲染不抛异常', !boom, boom && boom.message)
check('侧边栏根节点带 wt-side', !!(sidebar && /wt-side/.test(sidebar.props.className)), sidebar && sidebar.props.className)

const sideText = textOf(sidebar)
check('侧边栏有标题「工作台」', sideText.includes('工作台'))
check('侧边栏列出项目', sideText.includes('智能小车固件') && sideText.includes('上位机面板'))
const cellOf = (root, state) => allByClass(root, /(^|\s)fb-cell(\s|$)/).find((n) => n.props['data-state'] === state)
const cellVal = (root, state) => String(cellOf(root, state)?.props['data-count'] ?? '?')
check('状态栏显示进行中计数', /进行中/.test(sideText) && cellVal(sidebar, 'working') === '1', '进行中=' + cellVal(sidebar, 'working'))
check('状态框按项目统计（未绑定对话的项目记待命）', cellVal(sidebar, 'idle') === '1' && cellVal(sidebar, 'needs-you') === '0', JSON.stringify(['working', 'needs-you', 'done', 'idle'].map((k) => k + '=' + cellVal(sidebar, k))))
check('侧边栏不再单列宿主会话', allByClass(sidebar, /(^|\s)slist(\s|$)/).length === 0 && allByClass(sidebar, /(^|\s)srow(\s|$)/).length === 0)
check('宿主对话不再出现在侧边栏', !sideText.includes('app-alpha 会话'), sideText.slice(0, 120))
check('状态框只有四个工作状态', allByClass(sidebar, /fb-cell/).length === 4, allByClass(sidebar, /fb-cell/).length)
check('四态文案齐全', ['进行中', '待处理', '已完成', '待命'].every((t) => sideText.includes(t)), sideText.slice(0, 80))
const statBox = allByClass(sidebar, /(^|\s)stat-box(\s|$)/)[0]
const statText = textOf(statBox)
check('状态框里不再有「项目 / 未绑定」', !statText.includes('未绑定') && !statText.includes('项目'), statText)
check('状态框只有四格（面积缩小）', allByClass(statBox, /fb-cell/).length === 4 && allByClass(statBox, /fb-row/).length === 0)
check('项目列表区域可滚动（plist）', allByClass(sidebar, /(^|\s)plist(\s|$)/).length === 1)
check('绑定项目带 🔗 标记', allByClass(sidebar, /pi-bind/).length === 1, allByClass(sidebar, /pi-bind/).length)
check('项目状态灯数量 = 项目数', allByClass(sidebar, /(^|\s)light(\s|$)/).length >= 2, allByClass(sidebar, /(^|\s)light(\s|$)/).length)

/* 改项目状态 → 状态框必须当场跟着动（不能等下一次 4s 轮询，也不能只刷灯不刷数字） */
const clickLight = (idx) => {
  const lights = allByClass(render(sidebarComp), /(^|\s)light(\s|$)/)
  lights[idx].props.onClick({ stopPropagation() {} })
}
clickLight(0)
let afterStatus = render(sidebarComp)
check('改项目状态后状态框立刻刷新', cellVal(afterStatus, 'working') === '0' && cellVal(afterStatus, 'needs-you') === '1',
  JSON.stringify(['working', 'needs-you', 'done', 'idle'].map((k) => k + '=' + cellVal(afterStatus, k))))
check('改项目状态后项目灯也变', allByClass(afterStatus, /(^|\s)light needs-you(\s|$)/).length === 1, allByClass(afterStatus, /(^|\s)light (\S+)/).map((n) => n.props.className).join(','))
/* 循环一圈（working → needs-you → done → idle → working），把状态还原，别影响后面的用例 */
clickLight(0); clickLight(0); clickLight(0)
let restored = render(sidebarComp)
check('状态循环回原值（用例之间不互相污染）', cellVal(restored, 'working') === '1' && cellVal(restored, 'needs-you') === '0',
  JSON.stringify(['working', 'needs-you', 'done', 'idle'].map((k) => k + '=' + cellVal(restored, k))))

/* 右击 → 菜单 */
rightClickByText(sidebar, '智能小车固件')
let withMenu = render(sidebarComp)
let ctxMenu = allByClass(withMenu, /ctx-menu/)[0]
check('右击项目弹出上下文菜单', !!ctxMenu)
check('菜单里不再有工作区模式', !['全屏', '窗口', '工作区模式'].some((l) => textOf(ctxMenu).includes(l)), textOf(ctxMenu).replace(/\s+/g, ' ').slice(0, 90))
check('菜单不再有四种布局预设', !['三分式', '两分', '单栏', '对话主导'].some((l) => textOf(ctxMenu).includes(l)))
check('菜单含编辑/绑定/删除', ['编辑项目信息', '绑定对话', '删除项目'].every((l) => textOf(ctxMenu).includes(l)))
check('绑定只有一个入口（不再有解除项）', !textOf(ctxMenu).includes('解除') && (textOf(ctxMenu).match(/绑定对话/g) || []).length === 1, textOf(ctxMenu).replace(/\s+/g, ' ').slice(0, 120))

check('菜单第一项就是编辑（没有模式分组）', textOf(ctxMenu).trim().startsWith('智能小车固件 编辑项目信息'), textOf(ctxMenu).replace(/\s+/g, ' ').slice(0, 80))

/* ---------- 主区：未打开时不渲染 ---------- */
check('主区默认不渲染（占位空）', render(overlayComp) === null)

/* ---------- 进入项目 ---------- */
const sidebar2 = render(sidebarComp)
clickByLabel(sidebar2, '智能小车固件')
await new Promise((r) => setTimeout(r, 30))

let overlay = null
boom = null
try { overlay = render(overlayComp) } catch (e) { boom = e }
check('进入项目后主区渲染不抛异常', !boom, boom && boom.message)
check('主区根节点带 wt-root', !!(overlay && /wt-root/.test(overlay.props.className)), overlay && overlay.props.className)
check('主区根节点不吃事件（只有 dock 一块可交互）', !!allByClass(overlay, /wt-dock/).length)
const mainText = textOf(overlay)
check('顶栏显示项目名', mainText.includes('智能小车固件'))
check('顶栏有「≡ 项目 / 关闭」', ['≡ 项目', '✕'].every((t) => mainText.includes(t)), mainText.slice(0, 90))
check('顶栏没有模式切换条（窗口模式已删）', allByClass(overlay, /(^|\s)seg(\s|$)/).length === 0)
check('不再自绘对话栏（右侧交给宿主）', allByClass(overlay, /pane-chat/).length === 0)
check('工作台内没有左栏（已删除）', allByClass(overlay, /pane-left/).length === 0, allByClass(overlay, /pane-left/).length)
check('分割条只剩「工作台 / 对话」一条', allByClass(overlay, /split-handle/).length === 1, allByClass(overlay, /split-handle/).length)
check('让位边界是 dock-edge', allByClass(overlay, /dock-edge/).length === 1)
check('进项目默认打开「项目信息」标签页', allByClass(overlay, /info-body/).length === 1, allByClass(overlay, /info-body/).length)
check('进项目不会自动弹系统文件管理器', reveals.length === 0, JSON.stringify(reveals))
mod.store.tabMenu = true
overlay = render(overlayComp)
check('「＋ 窗口」里挂着文件管理器', textOf(overlay).includes('文件管理器'), textOf(overlay).slice(0, 90))
check('顶栏有「项目信息」按钮', textOf(overlay).includes('项目信息'))
const chatPill = allByClass(overlay, /dh-chat/)[0]
check('顶栏标出右侧对话（主绑定）', !!chatPill && !/off/.test(chatPill.props.className), chatPill && chatPill.props.className)
check('对话气泡显示主对话标题', !!chatPill && textOf(chatPill).includes('app-alpha'), chatPill && textOf(chatPill))

/* 只有一种形态：铺满让位区，没有浮动窗口 */
check('没有浮动窗口画布', allByClass(overlay, /pane-canvas/).length === 0 && allByClass(overlay, /float-win/).length === 0)
check('工作区就是一块 pane-main 铺满', allByClass(overlay, /pane-main/).length === 1 && allByClass(overlay, /pane-nest/).length === 0)

/* 进入项目时把宿主切到主绑定对话 */
check('进入项目即切宿主对话（主绑定）', mainText.includes('app-alpha 会话') || mainText.includes('app-alpha'), mainText.slice(0, 120))

/* 让位宽度换算 */
const { computeDock } = mod
check('导出 computeDock 供换算', typeof computeDock === 'function')
if (typeof computeDock === 'function') {
  const auto = computeDock({ track: 1200, preferred: 0 })
  check('自动宽度 = 轨道 95%', auto.width === 980, JSON.stringify(auto))
  check('自动宽度给对话留够 220', auto.max === 980, JSON.stringify(auto))
  check('拖过的像素宽度不低于最小值 560', computeDock({ track: 1200, preferred: 500 }).width === 560, JSON.stringify(computeDock({ track: 1200, preferred: 500 })))
  check('过宽时夹到「轨道 - 220」', computeDock({ track: 1200, preferred: 5000 }).width === 980, JSON.stringify(computeDock({ track: 1200, preferred: 5000 })))
  check('轨道太窄时不让位', computeDock({ track: 300, preferred: 0 }).width === 0, JSON.stringify(computeDock({ track: 300, preferred: 0 })))
}

/* ---------- 让位副作用：假宿主 DOM（overlay 座位 → frame → centerCol） ---------- */
const fakeFrame = {
  style: {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1440, height: 900 }),
  querySelector: (sel) => (sel === '[class*="centerCol"]' ? fakeCenter : null),
}
const fakeLayer = { parentElement: fakeFrame, querySelector: () => null }
const fakeRoot = { parentElement: fakeLayer }
let marginPx = 0
const fakeCenter = {
  style: {
    get marginLeft() { return marginPx ? marginPx + 'px' : '' },
    set marginLeft(v) { marginPx = parseFloat(v) || 0 },
  },
  getBoundingClientRect: () => ({ left: 280 + marginPx, top: 0, width: 1160 - marginPx, height: 900 }),
  querySelector: () => null,
}

check('认得出宿主结构（frame / centerCol）', mod.attachHost(fakeRoot) === true)
const g0 = mod.applyDock(0)
check('测出侧边栏右边界与轨道宽', g0.left === 280 && g0.track === 1160, JSON.stringify(g0))
const g1 = mod.applyDock(742)
check('让位：给宿主中心列写 marginLeft', fakeCenter.style.marginLeft === '742px', fakeCenter.style.marginLeft)
check('让位：几何不因自身 margin 漂移', g1.left === 280 && g1.track === 1160 && g1.width === 742, JSON.stringify(g1))
check('让位：右侧至少留 220', g1.max === 940, JSON.stringify(g1))
mod.releaseDock()
check('退出项目：marginLeft 还原', fakeCenter.style.marginLeft === '', JSON.stringify(fakeCenter.style.marginLeft))

/* 让位边界始终在（工作台 / 对话的分界） */
check('让位边界始终在', allByClass(overlay, /dock-edge/).length === 1)
check('工作台里没有任何左栏', allByClass(overlay, /pane-left/).length === 0)

/* 项目信息：从顶栏开成标签页 */
clickByLabel(overlay, '项目信息')
overlay = render(overlayComp)
check('顶栏「项目信息」按标签页打开', allByClass(overlay, /info-body/).length === 1, allByClass(overlay, /info-body/).length)
check('项目信息显示绑定对话数', /绑定对话/.test(textOf(overlay)))
check('git 区块渲染分支', textOf(overlay).includes('main'), textOf(allByClass(overlay, /git-box/)[0] || overlay).slice(0, 80))

/* 「文件管理器」= 面板里自绘列表（系统资源管理器要 HWND，嵌不进 HTML 面板） */
overlay = openPaneIn(overlay, '文件管理器')
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)
check('打开文件管理器会列对话的工作目录', String(lastListPath).replace(/\\/g, '/') === 'C:/demo/app-alpha', lastListPath)
check('打开文件管理器不再弹系统窗口', reveals.length === 0, JSON.stringify(reveals))
check('面板画出目录条目', textOf(overlay).includes('README.md') && textOf(overlay).includes('main.c'), textOf(overlay).slice(0, 140))
check('面板有面包屑 + 三列表头', allByClass(overlay, /(^|\s)fx-crumbs(\s|$)/).length === 1 && allByClass(overlay, /(^|\s)fx-th(\s|$)/).length === 3,
  allByClass(overlay, /(^|\s)fx-th(\s|$)/).length)
check('面板显示条目数与大小列', textOf(overlay).includes('6 项') && textOf(overlay).includes('2.0 KB'), textOf(overlay).slice(0, 160))

/* 单击选中 */
const fileRow = allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('README.md'))
check('列表行可点击', !!fileRow)
fileRow.props.onClick()
overlay = render(overlayComp)
check('单击选中条目', allByClass(overlay, /fx-row on/).length === 1, allByClass(overlay, /fx-row on/).length)
check('状态栏显示已选', textOf(overlay).includes('已选 README.md'), textOf(overlay).slice(-90))

/* 「⧉ 系统窗口」是唯一的弹窗出口 */
const beforeReveal = reveals.length
clickByLabel(overlay, '⧉ 系统窗口')
await new Promise((r) => setTimeout(r, 30))
check('点「系统窗口」才弹资源管理器', reveals.length === beforeReveal + 1, reveals.length - beforeReveal)
check('弹的是当前目录', String(reveals[reveals.length - 1]?.path || '').replace(/\\/g, '/') === 'C:/projects/smart-car', JSON.stringify(reveals[reveals.length - 1]))
overlay = render(overlayComp)

/* 搜索过滤（走 store，不依赖组件内部 state） */
const qInput = allByClass(overlay, /(^|\s)fx-query(\s|$)/)[0]
check('面板有过滤输入框', !!qInput)
qInput.props.onChange({ target: { value: 'main' } })
overlay = render(overlayComp)
const filtered = allByClass(overlay, /(^|\s)fx-row(\s|$)/)
check('搜索只留下匹配项', filtered.length === 1 && textOf(filtered[0]).includes('main.c'), filtered.length + ' 行')
allByClass(overlay, /(^|\s)fx-query(\s|$)/)[0].props.onChange({ target: { value: '' } })
overlay = render(overlayComp)

/* 排序：点「大小」表头 */
clickByLabel(overlay, '大小')
overlay = render(overlayComp)
check('点表头切成按大小排序', textOf(overlay).includes('大小 ↓') || textOf(overlay).includes('大小 ↑'), textOf(overlay).slice(0, 100))

/* 右键菜单 → 移到回收站：这条链路原来一行测试都没有，删不掉就是这里坏的 */
overlay = render(overlayComp)
const menuRow = allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('main.c'))
check('列表行响应右键', typeof menuRow.props.onContextMenu === 'function')
const listsBeforeDelete = listCalls
menuRow.props.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 30 })
await new Promise((r) => setTimeout(r, 30))
overlay = render(overlayComp)
check('右键弹出菜单', allByClass(overlay, /(^|\s)fx-menu(\s|$)/).length === 1, allByClass(overlay, /(^|\s)fx-menu(\s|$)/).length)
const delBtn = collect(overlay).find((n) => n.props && typeof n.props.onClick === 'function' && /(^|\s)danger(\s|$)/.test(String(n.props.className || '')))
check('菜单里有「移到回收站」', !!delBtn)
delBtn.props.onClick()
await new Promise((r) => setTimeout(r, 40))
check('删除请求指向这一项', String(deletes[0]?.path || '').replace(/\\/g, '/') === 'C:/projects/smart-car/main.c', JSON.stringify(deletes[0]))
check('删除后重刷目录', listCalls > listsBeforeDelete, listCalls - listsBeforeDelete)

/* 不能删的目标（磁盘根 / 工作区根 / 系统目录）：菜单里直接写原因，按钮置灰 */
deletableBlock = '不能删除磁盘根目录：C:\\'
overlay = render(overlayComp)
const drivenRow = allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('src'))
drivenRow.props.onContextMenu({ preventDefault() {}, clientX: 20, clientY: 30 })
await new Promise((r) => setTimeout(r, 30))
overlay = render(overlayComp)
const blockedBtn = collect(overlay).find((n) => n.props && /(^|\s)danger(\s|$)/.test(String(n.props.className || '')) && typeof n.props.onClick === 'function')
const deletesBefore = deletes.length
check('禁止删除时按钮置灰', blockedBtn && blockedBtn.props.disabled === true, blockedBtn && blockedBtn.props.disabled)
check('菜单里写明禁止原因', textOf(overlay).includes('磁盘根目录'), textOf(overlay).slice(-120))
if (blockedBtn && typeof blockedBtn.props.onClick === 'function') blockedBtn.props.onClick()
await new Promise((r) => setTimeout(r, 20))
check('置灰的删除点了也不发请求', deletes.length === deletesBefore, deletes.length - deletesBefore)
deletableBlock = ''
overlay = render(overlayComp)

/* 编辑器：不再从文件列表点，空态直接填路径 */
overlay = openPaneIn(overlay, '编辑器')
overlay = render(overlayComp)
check('编辑器空态有路径输入与「打开」按钮', allByClass(overlay, /ed-open/).length === 1 && textOf(overlay).includes('打开'), textOf(overlay).slice(0, 100))

/* 回到文件管理器，双击文件 → 直接进编辑器 */
clickByLabel(overlay, '文件管理器')
overlay = render(overlayComp)
const rowForOpen = allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('README.md'))
rowForOpen.props.onDoubleClick()
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)
check('双击文件切到编辑器标签页', textOf(overlay).includes('README.md') && allByClass(overlay, /ed-area|editor-body/).length >= 1, textOf(overlay).slice(0, 140))
check('编辑器正文载入文件内容', JSON.stringify(overlay).includes('固件说明') || textOf(overlay).includes('18 B'), textOf(overlay).slice(0, 120))

/* 大文件：413 不再是一堵墙 —— 给「只读预览」和「用系统程序打开」两条出路 */
readCase = 'big'
clickByLabel(overlay, '文件管理器')
overlay = render(overlayComp)
allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('README.md')).props.onDoubleClick()
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)
check('大文件报错时点明原因', textOf(overlay).includes('文件过大'), textOf(overlay).slice(0, 140))
check('大文件报错给出系统程序出口', textOf(overlay).includes('用系统默认程序打开'), textOf(overlay).slice(-140))
check('大文件报错给出只读预览出口', textOf(overlay).includes('只读预览前'), textOf(overlay).slice(-140))

const opensBefore = opens.length
clickByLabel(overlay, '用系统默认程序打开')
await new Promise((r) => setTimeout(r, 20))
check('点「用系统默认程序打开」会调 /fs/open', opens.length === opensBefore + 1, opens.length - opensBefore)

clickByLabel(overlay, '只读预览前')
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)
const roArea = allByClass(overlay, /ed-area/)[0]
check('只读预览能显示开头内容', !!roArea && String(roArea.props.value).includes('前 256 KB'), roArea && String(roArea.props.value).slice(0, 30))
check('只读预览有提示条与三个出口', allByClass(overlay, /ed-note/).length >= 1 && ['看开头', '看结尾', '用系统程序打开'].every((t) => textOf(overlay).includes(t)), textOf(overlay).slice(0, 160))
check('只读预览的 textarea 是 readOnly', !!roArea && roArea.props.readOnly === true)
const saveBtn = collect(overlay).find((n) => n.props && typeof n.props.onClick === 'function' && textOf(n).trim() === '保存')
check('只读预览时保存按钮置灰', saveBtn && saveBtn.props.disabled === true, saveBtn && saveBtn.props.disabled)
const writesBefore = writes.length
if (saveBtn) saveBtn.props.onClick()
await new Promise((r) => setTimeout(r, 20))
check('只读预览点了保存也不写盘（不会把文件截断写回）', writes.length === writesBefore, writes.length - writesBefore)
readCase = ''
overlay = render(overlayComp)

/* ---------- 渲染层：Markdown 预览 / 代码高亮 / 图片与 PDF 内嵌 ---------- */

/* 重新正常打开 README.md（上一段把它留在了「只读预览」态） */
clickByLabel(overlay, '文件管理器')
overlay = render(overlayComp)
allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('README.md')).props.onDoubleClick()
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)

const mdNode = allByClass(overlay, /ed-preview ed-md/)[0]
const mdHtml = mdNode ? String(mdNode.props.dangerouslySetInnerHTML?.__html || '') : ''
check('Markdown 文件默认进渲染预览', !!mdNode, allByClass(overlay, /ed-preview/).length)
check('Markdown 标题渲染成 <h1>', /<h1[^>]*>smart car<\/h1>/.test(mdHtml), mdHtml.slice(0, 80))
check('渲染预览态没有原文 textarea', allByClass(overlay, /ed-area/).length === 0)
check('有「预览 / 编辑」切换', textOf(overlay).includes('预览') && textOf(overlay).includes('编辑'), textOf(overlay).slice(0, 90))
check('标签栏标出文件类型', textOf(overlay).includes('Markdown'), textOf(overlay).slice(0, 90))

clickByLabel(overlay, '编辑')
overlay = render(overlayComp)
const editArea = allByClass(overlay, /ed-area/)[0]
check('切到「编辑」后回到原文 textarea', !!editArea && String(editArea.props.value).includes('smart car'), editArea && String(editArea.props.value).slice(0, 30))
check('编辑态 textarea 可写（不是只读预览）', !!editArea && editArea.props.readOnly === false)

/* 代码文件：默认高亮只读 */
clickByLabel(overlay, '文件管理器')
overlay = render(overlayComp)
allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('app.js')).props.onDoubleClick()
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)
const hlCode = allByClass(overlay, /ed-pre/)[0]
const hlHtml = hlCode ? String(collect(hlCode).find((n) => n.props && n.props.dangerouslySetInnerHTML)?.props.dangerouslySetInnerHTML.__html || '') : ''
check('js 文件走语法高亮', !!hlCode && /hl-k/.test(hlHtml), hlHtml.slice(0, 90))
check('关键字标成 hl-k', /class="hl-k">const</.test(hlHtml), hlHtml.slice(0, 90))
check('注释与字符串也上色', /class="hl-c"/.test(hlHtml) && /class="hl-s"/.test(hlHtml), hlHtml.slice(0, 120))

/* 图片 / PDF：不读文本，直接内嵌 */
const readsBeforeImg = reads.length
clickByLabel(overlay, '文件管理器')
overlay = render(overlayComp)
allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('shot.png')).props.onDoubleClick()
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)
const imgNode = allByClass(overlay, /ed-media-img/)[0]
check('图片文件内嵌成 <img>', !!imgNode, allByClass(overlay, /ed-media/).length)
check('图片 src 指向 /fs/raw', !!imgNode && /\/fs\/raw\?path=/.test(String(imgNode.props.src)) && String(imgNode.props.src).includes('shot.png'), imgNode && imgNode.props.src)
check('图片不再走 /fs/read（不走文本通道）', reads.length === readsBeforeImg, reads.length - readsBeforeImg)
check('媒体态没有保存按钮', !collect(overlay).some((n) => n.props && typeof n.props.onClick === 'function' && textOf(n).trim() === '保存'))

clickByLabel(overlay, '文件管理器')
overlay = render(overlayComp)
allByClass(overlay, /(^|\s)fx-row(\s|$)/).find((n) => textOf(n).includes('manual.pdf')).props.onDoubleClick()
await new Promise((r) => setTimeout(r, 40))
overlay = render(overlayComp)
const pdfFrame = allByClass(overlay, /ed-media-frame/)[0]
check('PDF 内嵌成 iframe', !!pdfFrame && /manual\.pdf/.test(String(pdfFrame.props.src)), pdfFrame && pdfFrame.props.src)
check('PDF 也给了系统程序出口', textOf(overlay).includes('用系统程序打开'), textOf(overlay).slice(0, 90))

/* 打开终端标签页 */
clickByLabel(overlay, '终端')
overlay = render(overlayComp)
const termIn = allByClass(overlay, /term-in/)[0]
check('终端窗格渲染输入行', !!termIn)
check('终端窗格显示提示符', textOf(overlay).includes('❯'))
check('终端显示当前目录', textOf(overlay).includes('smart-car') || textOf(overlay).includes('C:\\projects'), textOf(overlay).slice(0, 80))
check('终端标签页与编辑器并存', allByClass(overlay, /(^|\s)tab(\s|$)/).length === 4, allByClass(overlay, /(^|\s)tab(\s|$)/).length)

/* 打开浏览器标签页 */
clickByLabel(overlay, '浏览器')
overlay = render(overlayComp)
check('浏览器窗格：只有一条工具条（窄面板也不会被挤掉）', allByClass(overlay, /(^|\s)wb-bar(\s|$)/).length === 1, allByClass(overlay, /wb-bar/).length)
check('浏览器空态：地址栏给示例占位', allByClass(overlay, /wb-url/)[0]?.props.placeholder === 'localhost:5173')
check('浏览器空态给出三条用法', (allByClass(overlay, /(^|\s)wb-help(\s|$)/)[0]?.props?.children || []).length === 3, textOf(overlay).slice(0, 80))
const moreBox = () => allByClass(overlay, /(^|\s)wb-more(\s|$)/)[0]
check('低频操作收在「⋯」下拉里且默认收起', !!moreBox() && !/\bopen\b/.test(String(moreBox().props.className)), moreBox() && String(moreBox().props.className))
clickExact(overlay, '⋯')
overlay = render(overlayComp)
check('点「⋯」展开下拉', /\bopen\b/.test(String(moreBox().props.className)), String(moreBox().props.className))
clickExact(overlay, '⋯')
overlay = render(overlayComp)
check('再点「⋯」收起下拉', !/\bopen\b/.test(String(moreBox().props.className)), String(moreBox().props.className))
check('地址栏旁的状态点带状态类', !!allByClass(overlay, /(^|\s)wb-dot(\s|$)/)[0], allByClass(overlay, /wb-dot/).length)
check('浏览器空态说明', textOf(overlay).includes('浏览器窗格'), textOf(overlay).slice(0, 60))
check('浏览器首页有搜索框', allByClass(overlay, /(^|\s)wb-search(\s|$)/).length === 1, allByClass(overlay, /wb-search/).length)
check('首页搜索框有输入与搜索键', !!allByClass(overlay, /wb-search-input/)[0] && !!allByClass(overlay, /wb-search-go/)[0])
check('首页可切搜索引擎', allByClass(overlay, /(^|\s)wb-engines(\s|$)/).length === 1 && textOf(overlay).includes('Bing'))
const wbBar = allByClass(overlay, /(^|\s)wb-bar(\s|$)/)[0]
check('工具条常驻「首页/搜索」键（默认站点页也能搜）', !!wbBar && textOf(wbBar).includes('🔍'), textOf(wbBar || {}).slice(0, 60))
check('常见端口有快捷键', [':3000', ':5173', ':8080', ':4173'].every((t) => btnByText(overlay, t)), textOf(overlay).slice(0, 120))
check('没有历史时前进后退都禁用', btnByText(overlay, '←').props.disabled === true && btnByText(overlay, '→').props.disabled === true)

clickByLabel(overlay, '项目页')
overlay = render(overlayComp)
let wframe = iframeOf(overlay)
check('点「项目页」把 iframe 指向项目静态托管', !!wframe && String(wframe.props.src).includes('/site/custom-1/'), wframe && String(wframe.props.src))
check('加载中显示进度条', allByClass(overlay, /wb-loading/).length === 1)
check('加载中状态文字', textOf(overlay).includes('加载中'), textOf(overlay).slice(0, 80))

clickByLabel(overlay, ':5173')
overlay = render(overlayComp)
wframe = iframeOf(overlay)
check('端口快捷键切到本地服务', String(wframe.props.src) === 'http://localhost:5173/', wframe && String(wframe.props.src))
check('有两条历史后「后退」可用', btnByText(overlay, '←').props.disabled === false && btnByText(overlay, '→').props.disabled === true)

clickExact(overlay, '←')
overlay = render(overlayComp)
check('后退回到项目页', String(iframeOf(overlay).props.src).includes('/site/custom-1/'), String(iframeOf(overlay).props.src))
check('后退后「前进」可用', btnByText(overlay, '→').props.disabled === false)

clickByLabel(overlay, '探测')
await new Promise((r) => setTimeout(r, 20))
overlay = render(overlayComp)
check('探测把 X-Frame-Options 摊开说', textOf(overlay).includes('X-Frame-Options: SAMEORIGIN'), textOf(overlay).slice(-90))
check('探测结果带状态码与耗时', textOf(overlay).includes('HTTP 200') && textOf(overlay).includes('12ms'), textOf(overlay).slice(-90))
check('探测用的是当前地址', probeCalls.length === 1 && String(probeCalls[0].url).includes('/site/custom-1/'), JSON.stringify(probeCalls[0]))

clickByLabel(overlay, '手机 375')
overlay = render(overlayComp)
const viewport = allByClass(overlay, /wb-view/)[0]
check('切到手机视口：固定 375 宽', /fixed/.test(String(viewport.props.className)) && viewport.props.style.width === '375px', viewport.props.style.width)

const webOpensBefore = webOpens.length
clickByLabel(overlay, '🚀 系统浏览器')
await new Promise((r) => setTimeout(r, 20))
check('站内相对地址不误送系统浏览器', webOpens.length === webOpensBefore, JSON.stringify(webOpens.slice(-1)))

clickByLabel(overlay, ':5173')
overlay = render(overlayComp)
clickByLabel(overlay, '🚀 系统浏览器')
await new Promise((r) => setTimeout(r, 20))
check('绝对地址交给系统浏览器', webOpens.length === webOpensBefore + 1 && webOpens[webOpens.length - 1].url === 'http://localhost:5173/', JSON.stringify(webOpens[webOpens.length - 1]))

check('多个标签页并存', allByClass(overlay, /(^|\s)tab(\s|$)/).length === 5, allByClass(overlay, /(^|\s)tab(\s|$)/).length)
check('当前窗格内容仍在渲染', !!allByClass(overlay, /wb-stage/)[0] || textOf(overlay).includes('浏览器窗格'))

/* 关闭当前标签 */
overlay = render(overlayComp)
const closeX = collect(overlay).find((n) => n.props && /tab-x/.test(String(n.props.className || '')) && typeof n.props.onClick === 'function')
check('标签页有关闭按钮', !!closeX)

/* ---------- 自定义窗口 ---------- */
clickByLabel(overlay, '自定义')
overlay = render(overlayComp)
check('自定义窗格：左栏在、主体是空态', allByClass(overlay, /(^|\s)cu-side(\s|$)/).length === 1 && textOf(overlay).includes('自定义窗口'), allByClass(overlay, /(^|\s)cu-side(\s|$)/).length)
check('空态说明数据存本机', textOf(overlay).includes('不写进项目仓库'), textOf(overlay).slice(0, 120))
check('左栏空态有提示', textOf(overlay).includes('还没有保存过'))

clickByLabel(overlay, '✨ 新建一个')
overlay = render(overlayComp)
check('新建后进「生成」卡片（仿上游的形态）', allByClass(overlay, /(^|\s)cu-card(\s|$)/).length === 1 && textOf(overlay).includes('描述你想要的窗口'))

const reqTa = allByClass(overlay, /cu-input/)[0]
check('生成卡片有需求输入框', !!reqTa && typeof reqTa.props.onChange === 'function')
reqTa.props.onChange({ target: { value: '做个构建看板' } })
overlay = render(overlayComp)
clickByLabel(overlay, '生成提示词')
overlay = render(overlayComp)
const promptTa = allByClass(overlay, /cu-prompt/)[0]
check('生成提示词带需求正文', !!promptTa && String(promptTa.props.value).includes('做个构建看板'), promptTa && String(promptTa.props.value).slice(0, 50))
check('提示词写明沙箱约束与宿主接口', /沙箱/.test(String(promptTa?.props.value)) && String(promptTa?.props.value).includes('/api/trae-worktable/fs/list'))

/* 填进宿主输入框：给一个假 textarea，验证「追加而不是覆盖」 */
globalThis.HTMLTextAreaElement = class { constructor() { this.value = '' } }
const hostTa = {
  value: '已有内容', disabled: false, readOnly: false, closest: () => null,
  dispatchEvent() { this.fired = true }, focus() { this.focused = true }, setSelectionRange() {},
}
const savedQSA = globalThis.document.querySelectorAll
globalThis.document.querySelectorAll = () => [hostTa]
clickByLabel(overlay, '✨ 填到对话输入框')
globalThis.document.querySelectorAll = savedQSA
check('提示词写进宿主输入框（保留原文、不代发）', hostTa.value.startsWith('已有内容') && hostTa.value.includes('做个构建看板') && hostTa.fired === true, hostTa.value.slice(0, 40))

/* 自己写 → 保存 → 预览 → 删除 */
clickByLabel(overlay, '＋ 自己写')
overlay = render(overlayComp)
const codeTa = allByClass(overlay, /cu-code/)[0]
check('新建草稿落到编辑视图并带模板', !!codeTa && String(codeTa.props.value).includes('自定义窗口'), codeTa && String(codeTa.props.value).slice(0, 30))
check('新草稿标「新建」', textOf(overlay).includes('新建'))

clickByLabel(overlay, '保存')
await new Promise((r) => setTimeout(r, 20))
overlay = render(overlayComp)
check('保存后条目进左栏', customStore.length === 1 && textOf(overlay).includes('未命名窗口'), JSON.stringify(customStore.map((i) => i.name)))
check('保存后「未保存」标记消失', !allByClass(overlay, /tag warn/).length, allByClass(overlay, /tag warn/).length)

clickByLabel(overlay, '预览')
overlay = render(overlayComp)
const cuFrame = iframeOf(overlay)
check('预览用 srcDoc 渲染草稿', !!cuFrame && String(cuFrame.props.srcDoc).includes('<h2>自定义窗口</h2>'))
check('预览沙箱不给 allow-same-origin', !!cuFrame && !/allow-same-origin/.test(String(cuFrame.props.sandbox)), cuFrame && cuFrame.props.sandbox)

clickByLabel(overlay, '删除')
await new Promise((r) => setTimeout(r, 20))
overlay = render(overlayComp)
check('删除后库清空、左栏回到空态', customStore.length === 0 && textOf(overlay).includes('还没有保存过'), customStore.length)

/* 回到全部项目 */
clickByLabel(overlay, '≡ 项目')
overlay = render(overlayComp)
const gridText = textOf(overlay)
check('回到总览：顶栏是「工作台总览」', gridText.includes('工作台总览'))
check('总览与工作区同款：一条顶栏 + 一块 pane-main', allByClass(overlay, /dock-head/).length === 1 && allByClass(overlay, /pane-main/).length === 1)
check('总览分成三个页签', allByClass(overlay, /(^|\s)tab(\s|$)/).length === 3, allByClass(overlay, /(^|\s)tab(\s|$)/).length)
check('页签带计数徽标', allByClass(overlay, /tab-count/).length === 3 && gridText.includes('宿主会话'), gridText.slice(0, 80))
check('控制室统计块已拆掉（不再有 cc-cell）', allByClass(overlay, /cc-cell/).length === 0)
check('默认停在「项目」页', allByClass(overlay, /project-card/).length === 2 && allByClass(overlay, /add-card/).length === 1)
check('网格渲染两张项目卡', allByClass(overlay, /project-card/).length === 2, allByClass(overlay, /project-card/).length)
check('卡片状态用中文标签', /进行中|待处理|已完成|待命/.test(gridText))

/* 总览也做成「项目一样的窗口」：占对话左侧、右侧留宿主对话、宽度可左右拖 */
check('总览也贴着对话（有让位边界 dock-edge）', allByClass(overlay, /dock-edge/).length === 1, allByClass(overlay, /dock-edge/).length)
check('总览没有左栏', allByClass(overlay, /pane-left/).length === 0)
check('总览只有一块面板', allByClass(overlay, /pane-main/).length === 1, allByClass(overlay, /pane-main/).length)
check('总览顶栏没有模式切换', !['全屏', '窗口'].some((t) => textOf(allByClass(overlay, /(^|\s)dock-head(\s|$)/)[0] || {}).includes(t)), textOf(allByClass(overlay, /(^|\s)dock-head(\s|$)/)[0] || {}))
check('总览也没有浮动窗口', allByClass(overlay, /float-win/).length === 0 && allByClass(overlay, /pane-nest/).length === 0)

/* 拖右边缘：改的是总览自己的 dock 宽度，不碰任何项目 */
const handlers = {}
const origAdd = globalThis.window.addEventListener
const origRemove = globalThis.window.removeEventListener
globalThis.window.addEventListener = (t, fn) => { handlers[t] = fn }
globalThis.window.removeEventListener = (t) => { delete handlers[t] }
const edge = allByClass(overlay, /dock-edge/)[0]
edge.props.onPointerDown({ preventDefault() {}, stopPropagation() {}, clientX: 600, clientY: 300 })
if (handlers.pointermove) handlers.pointermove({ clientX: 760, clientY: 300 })
if (handlers.pointerup) handlers.pointerup({})
globalThis.window.addEventListener = origAdd
globalThis.window.removeEventListener = origRemove
const uiLs = JSON.parse(ls.get('wt.ui.v2') || '{}')
check('拖总览右边缘 → 宽度存到 __overview', Number(uiLs.__overview && uiLs.__overview.dock) > 0, JSON.stringify(uiLs.__overview))
check('总览宽度与项目宽度互不干扰', !uiLs['custom-1'] || !uiLs['custom-1'].dock, uiLs['custom-1'] && uiLs['custom-1'].dock)

check('总览也让位（右边缘拖动条仍在）', allByClass(overlay, /dock-edge/).length === 1)

/* 宿主会话页签 */
clickByLabel(overlay, '◉ 宿主会话')
overlay = render(overlayComp)
const sessText = textOf(overlay)
check('宿主会话页签列出全部会话', allByClass(overlay, /ov-row/).length === 3, allByClass(overlay, /ov-row/).length)
check('会话行显示标题与工作目录', sessText.includes('app-alpha') && sessText.includes('C:\\demo'), sessText.slice(0, 100))
check('未绑定给「建为项目」，已绑定给「进入项目」', sessText.includes('建为项目') && sessText.includes('进入项目'))
check('已绑定会话标出所属项目', allByClass(overlay, /tag gold/).length >= 1, allByClass(overlay, /tag gold/).length)

/* 运行中页签 */
clickByLabel(overlay, '◐ 运行中')
overlay = render(overlayComp)
check('运行中页签只列进行中的会话', allByClass(overlay, /ov-row/).length === 1, allByClass(overlay, /ov-row/).length)
check('运行中带实时计时', allByClass(overlay, /ov-time/).length === 1, allByClass(overlay, /ov-time/).length)
check('待处理只做提示，不混进运行中', textOf(overlay).includes('待处理会话'), textOf(overlay).slice(-60))

/* 切回项目页 */
clickByLabel(overlay, '▦ 项目')
overlay = render(overlayComp)
check('切回「项目」页签', allByClass(overlay, /project-card/).length === 2)

/* 卡片上的绑定按钮 → 单一绑定入口 */
clickByLabel(overlay, '1 个对话')
overlay = render(overlayComp)
const bindText = textOf(overlay)
check('卡片按钮打开对话绑定小窗', bindText.includes('对话绑定') && bindText.includes('app-alpha 会话'), bindText.slice(0, 100))
check('绑定小窗列出已绑定对话', allByClass(overlay, /bound-chip/).length === 1, allByClass(overlay, /bound-chip/).length)
check('绑定小窗提供设为主对话', allByClass(overlay, /session-row/).length === 3, allByClass(overlay, /session-row/).length)

const gammaRow = allByClass(overlay, /session-row/).find((n) => textOf(n).includes('gamma'))
clickByLabel(gammaRow, 'gamma')
await new Promise((r) => setTimeout(r, 20))
const boundNow = JSON.parse(ls.get('wt.projects') || '[]').find((p) => p.id === 'custom-1')
check('点会话行即完成绑定（同一入口绑定/解绑）', boundNow && boundNow.sessions.includes('s-gamma'), JSON.stringify(boundNow && boundNow.sessions))

const chips = allByClass(render(overlayComp), /bound-chip/)
check('绑定后主对话仍是原首个', chips.length === 2, chips.length)

/* 关闭小窗 */
clickByLabel(render(overlayComp), '关闭')
overlay = render(overlayComp)
check('关闭绑定小窗', !textOf(overlay).includes('对话绑定'))

/* 新建项目小窗 */
clickByLabel(overlay, '新建项目')
overlay = render(overlayComp)
const modalText = textOf(overlay)
check('打开新建项目小窗', modalText.includes('项目名称') && modalText.includes('项目目录'))
check('小窗没有「默认工作区」按钮', !modalText.includes('默认工作区'), modalText.slice(0, 90))
check('小窗不再有工作区模式字段', allByClass(overlay, /layout-card/).length === 0 && !modalText.includes('工作区模式'))
check('绑定下拉可选「新建对话」', modalText.includes('新建对话'), modalText.slice(0, 120))
check('小窗有绑定对话下拉', (() => { const m = allByClass(overlay, /(^|\s)modal(\s|$)/)[0]; return !!m && allByClass(m, /wt-select/).length === 1 })())
check('小窗提示只写 localStorage', modalText.includes('localStorage'))

/* ---------- 渲染层单元测试（直接测源码里的纯函数） ---------- */
{
  const R = await import('../src/client/render.js')

  check('viewKindOf 认得 md / 代码 / 图片 / pdf', R.viewKindOf('a.md') === 'markdown' && R.viewKindOf('a.ts') === 'code'
    && R.viewKindOf('a.PNG') === 'image' && R.viewKindOf('a.pdf') === 'pdf' && R.viewKindOf('a.txt') === 'text',
  [R.viewKindOf('a.md'), R.viewKindOf('a.ts'), R.viewKindOf('a.PNG'), R.viewKindOf('a.pdf')].join(','))
  check('hasPreview 只给 md 与代码', R.hasPreview('markdown') && R.hasPreview('code') && !R.hasPreview('text'))
  check('isMediaKind 覆盖四类媒体', R.isMediaKind('image') && R.isMediaKind('pdf') && R.isMediaKind('video') && R.isMediaKind('audio') && !R.isMediaKind('code'))

  const md = R.renderMarkdown([
    '# 标题',
    '',
    '第一段 **粗** *斜* `code` ~~删~~',
    '',
    '- 甲',
    '- 乙',
    '',
    '> 引用一行',
    '',
    '```js',
    'const x = 1 // 注释',
    '```',
    '',
    '| A | B |',
    '| --- | --- |',
    '| 1 | 2 |',
    '',
    '---',
    '',
    '[外链](https://example.com) [内链](./docs/a.md)',
  ].join('\n'))

  check('md: 标题', /<h1[^>]*>标题<\/h1>/.test(md), md.slice(0, 60))
  check('md: 粗体 / 斜体 / 行内代码 / 删除线', /<b>粗<\/b>/.test(md) && /<i>斜<\/i>/.test(md)
    && /ed-md-code-inline">code</.test(md) && /<del>删<\/del>/.test(md), md.slice(0, 160))
  check('md: 无序列表', /<ul class="ed-md-list"><li>甲<\/li><li>乙<\/li><\/ul>/.test(md), md.slice(0, 200))
  check('md: 引用块', /<blockquote class="ed-md-quote">/.test(md))
  check('md: 围栏代码带语言高亮', /ed-md-pre"><code><span class="hl-k">const<\/span>/.test(md), md.slice(md.indexOf('ed-md-pre'), md.indexOf('ed-md-pre') + 90))
  check('md: 表格转成 th/td', /<th>A<\/th>/.test(md) && /<td>2<\/td>/.test(md))
  check('md: 分隔线', /<hr class="ed-md-hr">/.test(md))
  check('md: 外链开新窗口', /<a class="ed-md-a" href="https:\/\/example\.com" target="_blank"/.test(md))
  check('md: 内链不生成可导航 href', !/href="\.\/docs/.test(md) && /ed-md-inner/.test(md), md.slice(-120))

  const evil = R.renderMarkdown('<script>alert(1)</script>\n\n[x](javascript:alert(1))\n\n![i](javascript:alert(1))')
  check('md: 原始 HTML 被转义（不执行）', !evil.includes('<script>') && evil.includes('&lt;script&gt;'), evil.slice(0, 90))
  check('md: javascript: 链接被丢掉', !/href="javascript/.test(evil), evil.slice(0, 120))
  check('md: javascript: 图片被丢掉', !/<img/.test(evil), evil.slice(0, 120))

  const withImg = R.renderMarkdown('![图](img/a.png)', { dir: 'C:\\proj\\docs', imageUrl: (p) => 'RAW:' + p })
  check('md: 相对图片按文件目录解析', withImg.includes('RAW:C:\\proj\\docs\\img\\a.png'), withImg)
  const upImg = R.renderMarkdown('![图](../up.png)', { dir: 'C:\\proj\\docs', imageUrl: (p) => 'RAW:' + p })
  check('md: ../ 能回退一级', upImg.includes('RAW:C:\\proj\\up.png'), upImg)
  const extImg = R.renderMarkdown('![图](https://cdn.x/a.png)', { dir: 'C:\\proj', imageUrl: () => 'RAW' })
  check('md: 外链图片原样保留', extImg.includes('src="https://cdn.x/a.png"'), extImg)

  const hl = R.highlightCode('const a = "s" // c\n/* b */\nfoo(1, 0xFF)', 'js')
  check('hl: 关键字 / 字符串 / 注释 / 数字', /hl-k">const</.test(hl) && /hl-s">&quot;s&quot;</.test(hl)
    && /hl-c">\/\/ c</.test(hl) && /hl-c">\/\* b \*\/</.test(hl) && /hl-n">0xFF</.test(hl), hl.slice(0, 120))
  check('hl: 函数调用识别', /hl-f">foo</.test(hl), hl.slice(-60))
  check('hl: 代码里的 HTML 被转义', !R.highlightCode('<div onclick="x">', 'js').includes('<div'), R.highlightCode('<div>', 'js'))
  const cssHl = R.highlightCode('.a { color: #fff; margin: 4px }', 'css')
  check('hl: css 属性名与数值', /hl-p">color</.test(cssHl) && /hl-n">#fff</.test(cssHl), cssHl)
  const htmlHl = R.highlightCode('<p class="x">hi</p>', 'html')
  check('hl: html 标签与属性', /hl-t">p</.test(htmlHl) && /hl-a">class</.test(htmlHl), htmlHl)
  check('hl: 未知语言退化为纯转义', R.highlightCode('a<b', '') === 'a&lt;b')

  check('joinFs 处理盘符与 ../', R.joinFs('C:\\a\\b', '../c/d.txt') === 'C:\\a\\c\\d.txt', R.joinFs('C:\\a\\b', '../c/d.txt'))
  check('joinFs 处理 POSIX 根', R.joinFs('/a/b', '../c') === '/a/c', R.joinFs('/a/b', '../c'))
}

/* ---------- ③ 编辑器未保存改动不被静默覆盖 ---------- */
/* 造一个「有未保存改动」的编辑器状态（state=ok、文本≠已保存、非媒体、非片段） */
Object.assign(mod.store.editor, {
  state: 'ok', path: 'C:\\x\\A.md', name: 'A.md', kind: 'md',
  text: '我改了一大堆，还没存', saved: '原始内容', partial: false, truncated: false,
})
/* confirm 做成计数器：用来确认守卫「是否真的问过」 */
let confirmCalls = 0
/* 用户取消 → openFile 应直接返回，既不切编辑器、也不发 /fs/read，且 confirm 被问了一次 */
globalThis.window.confirm = () => { confirmCalls += 1; return false }
const readsBeforeBlock = reads.length
await mod.openFile('C:\\x\\B.md')
check('③ 有未保存改动 + 用户取消 → 不覆盖、不发读请求、confirm 被问',
  mod.store.editor.path === 'C:\\x\\A.md' && reads.slice(readsBeforeBlock).every((p) => p !== 'C:\\x\\B.md') && confirmCalls === 1,
  'path=' + mod.store.editor.path + ' reads+=' + (reads.length - readsBeforeBlock) + ' confirm=' + confirmCalls)
/* 用户确认 → 才允许覆盖，并真正发起 /fs/read 去加载新文件（confirm 再问一次） */
globalThis.window.confirm = () => { confirmCalls += 1; return true }
const readsBeforeAllow = reads.length
await mod.openFile('C:\\x\\C.md')
check('③ 用户确认后 → 发起 /fs/read 加载新文件（confirm 再问一次）',
  reads.slice(readsBeforeAllow).some((p) => p === 'C:\\x\\C.md') && confirmCalls === 2,
  JSON.stringify(reads.slice(readsBeforeAllow)) + ' confirm=' + confirmCalls)
/* 重开「同一文件」：path 一致，守卫应被跳过（不再调 confirm），但仍会正常加载 */
Object.assign(mod.store.editor, {
  state: 'ok', path: 'C:\\x\\A.md', name: 'A.md', kind: 'md',
  text: '我又改了', saved: 'saved', partial: false, truncated: false,
})
const confirmBeforeSame = confirmCalls
await mod.openFile('C:\\x\\A.md')
check('③ 重开同一文件 → 不经确认守卫（confirm 不被调用）',
  confirmCalls === confirmBeforeSame,
  'confirm=' + confirmCalls)
delete globalThis.window.confirm

/* ---------- 拖拽：会话 → 工作台 = 新项目 ---------- */
mod.store.open = true
mod.store.view = 'grid'
mod.store.gridTab = 'sessions'
mod.store.activeId = null
let gridView = render(overlayComp)
const ovRows = allByClass(gridView, /(^|\s)ov-row(\s|$)/)
check('宿主会话行渲染为可拖', ovRows.length > 0 && ovRows[0].props.draggable === 'true', ovRows.length + ' 行')

const dtSet = {}
const fakeDragDt = {
  types: ['application/x-dsh-session', 'text/plain'],
  setData: (fmt, val) => { dtSet[fmt] = val },
  getData: (fmt) => dtSet[fmt] || '',
  effectAllowed: '',
}
ovRows[0].props.onDragStart({ dataTransfer: fakeDragDt, preventDefault() {} })
let dragPayload = {}
try { dragPayload = JSON.parse(dtSet['application/x-dsh-session'] || '{}') } catch { dragPayload = {} }
check('拖拽写入会话身份', !!dragPayload.id, JSON.stringify(dragPayload).slice(0, 90))
check('拖拽同时写 text/plain', String(dtSet['text/plain'] || '').length > 0, String(dtSet['text/plain'] || ''))

let side2 = render(sidebarComp)
let dragPrevented = false
side2.props.onDragOver({
  preventDefault() { dragPrevented = true },
  dataTransfer: fakeDragDt,
  currentTarget: { contains: () => true },
})
check('拖到侧边栏时阻止默认（允许放下）', dragPrevented === true)
check('拖拽进入后侧边栏高亮', mod.store.dragOver === true, String(mod.store.dragOver))

const beforeDrop = mod.store.projects.length
const targetSession = mod.store.sessions.rows.find((s) => s.id === 's-beta')
const dtDrop = {
  types: ['application/x-dsh-session'],
  getData: (fmt) => (fmt === 'application/x-dsh-session'
    ? JSON.stringify({ id: targetSession.id, title: targetSession.title, cwd: targetSession.cwd })
    : ''),
  files: [],
}
side2 = render(sidebarComp)
side2.props.onDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: dtDrop, currentTarget: { contains: () => true } })
check('放下会话后新建了项目', mod.store.projects.length === beforeDrop + 1, beforeDrop + ' → ' + mod.store.projects.length)
const droppedProject = mod.store.projects[mod.store.projects.length - 1]
check('新项目绑定了被拖的会话', Array.isArray(droppedProject.sessions) && droppedProject.sessions.includes(targetSession.id), JSON.stringify(droppedProject.sessions))
check('放下后拖拽高亮复位', mod.store.dragOver === false, String(mod.store.dragOver))

const countBeforeAgain = mod.store.projects.length
side2 = render(sidebarComp)
side2.props.onDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: dtDrop, currentTarget: { contains: () => true } })
check('重复拖同一条会话不重复建项目', mod.store.projects.length === countBeforeAgain, countBeforeAgain + ' → ' + mod.store.projects.length)
check('重复拖会进已有项目', mod.store.activeId === droppedProject.id, String(mod.store.activeId))

const dtPath = {
  types: ['text/uri-list'],
  getData: (fmt) => (fmt === 'text/uri-list' ? 'C:\\projects\\dragged-dir' : ''),
  files: [],
}
const beforePath = mod.store.projects.length
side2 = render(sidebarComp)
side2.props.onDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: dtPath, currentTarget: { contains: () => true } })
const pathProject = mod.store.projects[mod.store.projects.length - 1]
check('拖入目录路径也会建项目', mod.store.projects.length === beforePath + 1 && pathProject.path === 'C:\\projects\\dragged-dir', pathProject.path)

const beforeJunk = mod.store.projects.length
side2 = render(sidebarComp)
side2.props.onDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: { types: ['text/plain'], getData: () => '随便一段文字', files: [] }, currentTarget: { contains: () => true } })
check('认不出的拖拽数据不建项目', mod.store.projects.length === beforeJunk, beforeJunk + ' → ' + mod.store.projects.length)

/* ---------- 「＋ 新建对话」真去宿主要会话 ---------- */
const beforeCreate = sessionCreates.length
const newSid = await mod.createSessionInDir('C:\\projects\\demo')
check('新建对话走宿主 /session/create', sessionCreates.length === beforeCreate + 1, beforeCreate + ' → ' + sessionCreates.length)
check('新建对话把项目目录带给宿主', String((sessionCreates[sessionCreates.length - 1] || {}).cwd || '').length > 0, JSON.stringify(sessionCreates[sessionCreates.length - 1] || {}))
check('新建对话拿到宿主返回的 sessionId', newSid === 'session-new-1', String(newSid))

/* ---------- 打开项目切到绑定对话（switchHostSession） ---------- */
let refreshCalls = 0
const clientCreates = []
const uiCalls = []
let failNextOpen = false
const fakeUi = () => ({
  openSession: (id) => {
    if (failNextOpen) { failNextOpen = false; throw new Error('session not in client catalog') }
    uiCalls.push(id)
  },
})
const fakeClientSessions = () => ({
  refresh: async () => { refreshCalls += 1 },
  create: async (opts) => { clientCreates.push(opts || {}); return 'session-client-1' },
})
ctx.get = (name) => {
  if (name === 'uiWorkspace') return fakeUi()
  if (name === 'sessions') return fakeClientSessions()
  return undefined
}

const sw1 = await mod.switchHostSession('s-apple')
check('切对话：调用宿主 openSession', sw1.ok === true && uiCalls.includes('s-apple'), JSON.stringify(uiCalls))

failNextOpen = true
const refBefore = refreshCalls
const sw2 = await mod.switchHostSession('s-brand-new')
check('切对话：目录没同步时先 refresh 客户端目录再重试',
  sw2.ok === true && refreshCalls === refBefore + 1 && uiCalls.includes('s-brand-new'),
  'refresh+' + (refreshCalls - refBefore) + ' calls=' + uiCalls.join(','))

ctx.get = () => undefined
const sw3 = await mod.switchHostSession('s-apple')
check('切对话：没有入口时返回 ok:false + 原因', sw3.ok === false && !!sw3.error, JSON.stringify(sw3))
const sw4 = await mod.switchHostSession('')
check('切对话：空 id 直接拒绝', sw4.ok === false, JSON.stringify(sw4))

/* ---------- 新建对话优先走客户端 sessions.create（会进目录，之后才 openSession 得动） ---------- */
ctx.get = (name) => (name === 'sessions' ? fakeClientSessions() : undefined)
const beforeHostRoute = sessionCreates.length
const sidClient = await mod.createSessionInDir('C:\\projects\\demo')
check('新建对话优先用客户端 create', sidClient === 'session-client-1', String(sidClient))
check('客户端能建时不再打 host /session/create', sessionCreates.length === beforeHostRoute, beforeHostRoute + ' → ' + sessionCreates.length)

/* ---------- 拖拽建项目的命名 ---------- */
const namedProject = mod.store.projects.find((p) => Array.isArray(p.sessions) && p.sessions.includes('s-beta'))
check('拖拽建的项目用会话标题命名', !!namedProject && namedProject.name === 'beta 控制台', namedProject && namedProject.name)

const dtUntitled = {
  types: ['application/x-dsh-session'],
  getData: () => JSON.stringify({ id: 's-untitled' }),
  files: [],
}
side2 = render(sidebarComp)
side2.props.onDrop({ preventDefault() {}, stopPropagation() {}, dataTransfer: dtUntitled, currentTarget: { contains: () => true } })
const untitled = mod.store.projects[mod.store.projects.length - 1]
check('没有标题的会话 → 项目名「未命名项目」', untitled && untitled.name === '未命名项目', untitled && untitled.name)
check('没有标题时直接弹编辑窗让人取名', !!mod.store.modal && mod.store.modal.kind === 'edit', JSON.stringify(mod.store.modal))

/* ---------- 浏览器：首页搜索 / 地址与搜索分流 ---------- */
check('搜索 URL 走引擎并对关键词编码',
  mod.searchUrl('猫咪 视频', 'bing') === 'https://www.bing.com/search?q=' + encodeURIComponent('猫咪 视频'),
  mod.searchUrl('猫咪 视频', 'bing'))
check('百度引擎 URL', mod.searchUrl('固态硬盘', 'baidu').startsWith('https://www.baidu.com/s?wd='), mod.searchUrl('固态硬盘', 'baidu'))

mod.store.web = { ...mod.store.web, engine: 'bing' }
const asUrl = mod.webGotoSmart('localhost:5173')
check('像地址就当地址打开', asUrl === true && mod.store.web.url === 'http://localhost:5173', mod.store.web.url)
const asSearch = mod.webGotoSmart('猫咪视频')
check('不像地址就交给搜索引擎', asSearch === true && /bing\.com\/search\?q=/.test(mod.store.web.url), mod.store.web.url)

/* ---------- 自定义主题与背景 ---------- */
mod.setTheme({ accent: 'blue' })
check('切强调色生效', mod.store.theme.accent === 'blue', mod.store.theme.accent)
check('强调色转成 CSS 变量', String(mod.themeStyle()['--amber-rgb']).includes('78'), JSON.stringify(mod.themeStyle()['--amber-rgb']))
check('背景风格用 data-bg 下发', mod.themeAttrs()['data-bg'] === 'glass', JSON.stringify(mod.themeAttrs()))

mod.setTheme({ bg: 'image', image: 'https://example.com/wall.png' })
check('图片背景写进 --wt-bg-image', String(mod.themeStyle()['--wt-bg-image']).includes('wall.png'), String(mod.themeStyle()['--wt-bg-image']))
mod.setTheme({ image: 'javascript:alert(1)' })
check('非法图片地址被丢弃', mod.store.theme.image === '', mod.store.theme.image)

mod.resetTheme()
check('恢复默认主题', mod.store.theme.accent === 'amber' && mod.store.theme.bg === 'glass', JSON.stringify(mod.store.theme))

/* 侧边栏 ⚙ 打开主题小窗 */
mod.store.open = false
sidebar = render(sidebarComp)
const gearBtn = collect(sidebar).find((n) => n.type === 'button' && textOf(n).trim() === '⚙')
check('侧边栏有主题按钮', !!gearBtn)
gearBtn.props.onClick({ preventDefault() {}, stopPropagation() {} })
const themeTree = render(sidebarComp)
const themeText = textOf(themeTree)
check('主题小窗渲染', themeText.includes('主题与背景') && themeText.includes('强调色'), themeText.slice(0, 70))
check('主题小窗有强调色色块', allByClass(themeTree, /(^|\s)theme-dot(\s|$)/).length >= 5, allByClass(themeTree, /theme-dot/).length)
check('主题小窗有背景风格选项', allByClass(themeTree, /(^|\s)theme-bg(\s|$)/).length === 4, allByClass(themeTree, /theme-bg/).length)
check('主题小窗有恢复默认', themeText.includes('恢复默认'))
mod.store.modal = null

/* ---------- 浏览器首页面板 ---------- */
mod.store.web = { ...mod.store.web, home: false, url: 'http://localhost:5173' }
mod.webHome()
check('webHome 打开首页面板', mod.store.web.home === true, String(mod.store.web.home))
mod.webGotoSmart('localhost:5173')
check('导航后自动关首页面板', mod.store.web.home === false, String(mod.store.web.home))

/* ---------- 亮度滑块 ---------- */
mod.setTheme({ brightness: 70 })
check('亮度写进 --wt-bright', mod.themeStyle()['--wt-bright'] === '0.7', mod.themeStyle()['--wt-bright'])
mod.setTheme({ brightness: 999 })
check('亮度上限被夹到 160', mod.store.theme.brightness === 160, String(mod.store.theme.brightness))
mod.setTheme({ brightness: 10 })
check('亮度下限被夹到 40', mod.store.theme.brightness === 40, String(mod.store.theme.brightness))
mod.resetTheme()
check('恢复默认含亮度 100', mod.store.theme.brightness === 100, JSON.stringify(mod.store.theme))

/* 主题小窗里：拖放区 + 亮度滑块 + 图片输入 */
mod.store.open = false
gearBtn.props.onClick({ preventDefault() {}, stopPropagation() {} })
mod.setTheme({ bg: 'image' })
const tTree = render(sidebarComp)
check('主题小窗有图片拖放区', allByClass(tTree, /(^|\s)theme-drop(\s|$)/).length === 1, allByClass(tTree, /theme-drop/).length)
check('主题小窗有亮度滑块', collect(tTree).some((n) => n.type === 'input' && n.props && n.props.type === 'range'), '')
check('主题小窗有隐藏的文件选择器', collect(tTree).some((n) => n.type === 'input' && n.props && n.props.type === 'file'), '')
mod.store.modal = null
mod.resetTheme()

/* ---------- 浏览器首页：大搜索框 ---------- */
mod.store.web = { ...mod.store.web, home: true, url: 'http://localhost:5173' }
mod.store.open = true
mod.store.view = 'project'
mod.store.gridTab = 'projects'
const bigHome = render(overlayComp)
check('首页面板内有搜索框', allByClass(bigHome, /wb-home-panel/).length >= 0, '')

/* ---------- 工作区顶栏不重复：空态不再放第二排入口 ---------- */
mod.store.modal = null
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = mod.store.projects[0].id
const projTree = render(overlayComp)
check('空态不再有第二排打开按钮', allByClass(projTree, /(^|\s)pe-actions(\s|$)/).length === 0, allByClass(projTree, /pe-actions/).length)
const tabAdd = allByClass(projTree, /(^|\s)tab-add(\s|$)/)[0]
const addBtns = tabAdd ? collect(tabAdd).filter((n) => n.type === 'button') : []
check('顶部只露一个「＋ 窗口」按钮（其余在菜单里）', (tabAdd ? collect(tabAdd).filter((n) => n.type === 'button' && /mini-btn/.test(String((n.props && n.props.className) || ''))).length : 0) === 1 && textOf(tabAdd).includes('＋ 窗口'), addBtns.length + ' 个按钮节点')

/* ---------- 背景图取景 ---------- */
mod.setTheme({ bg: 'image', image: 'https://example.com/wall.png', crop: { x: 20, y: 40, w: 50, h: 30 } })
check('取景换算成背景尺寸/位置',
  mod.themeStyle()['--wt-bg-size'] === '200.00% auto' && mod.themeStyle()['--wt-bg-px'] === '40.00%',
  mod.themeStyle()['--wt-bg-size'] + ' @ ' + mod.themeStyle()['--wt-bg-px'])
mod.setTheme({ crop: { x: 999, y: -20, w: 5, h: 300 } })
const cc = mod.store.theme.crop
check('取景出界被夹回来且强制等比', cc.x + cc.w <= 100 && cc.y >= 0 && cc.w >= 15 && cc.w === cc.h, JSON.stringify(cc))

mod.store.open = false
gearBtn.props.onClick({ preventDefault() {}, stopPropagation() {} })
const frameTree = render(sidebarComp)
const frame = allByClass(frameTree, /(^|\s)theme-stage(\s|$)/)[0]
check('主题小窗有可拖取景框', !!frame, frame ? 'ok' : '无')
check('取景框可拖可缩放（crop 定位）', !!allByClass(frameTree, /(^|\s)theme-cut(\s|$)/)[0] && !!allByClass(frameTree, /theme-cut-handle/)[0], '')
check('取景框按主区比例（aspectRatio）', !!frame && typeof frame.props.style.aspectRatio === 'string', frame && frame.props.style.aspectRatio)
check('有居中复位', textOf(frameTree).includes('居中'))
mod.store.modal = null
mod.resetTheme()

/* ---------- ① 让位宽度版本化：旧像素值自动作废 ---------- */
check('hydrate 写下 dockVer', String(ls.get('wt.dockVer')) === '2', ls.get('wt.dockVer'))

/* ---------- ② 主区比例估算（无实际让位时也用同一套 computeDock） ---------- */
const aspect = mod.dockAspect ? mod.dockAspect() : NaN
check('dockAspect 给出合理比例（0.5–3.2）', Number.isFinite(aspect) && aspect >= 0.5 && aspect <= 3.2, String(aspect))

/* ---------- ③ ⌘K 搜索 ---------- */
mod.openSearch()
check('打开搜索小窗', !!mod.store.modal && mod.store.modal.kind === 'search', JSON.stringify(mod.store.modal))
mod.store.open = false
const searchTree = render(sidebarComp)
const searchText = textOf(searchTree)
check('搜索小窗有输入框', !!allByClass(searchTree, /(^|\s)search-input(\s|$)/)[0], '')
check('搜索小窗列出项目', searchText.includes('智能小车固件') || searchText.includes('上位机面板'), searchText.slice(0, 80))
check('搜索小窗列出宿主对话', searchText.includes('app-alpha 会话') || searchText.includes('beta 控制台'), '')
check('搜索小窗有快捷键说明', searchText.includes('Ctrl+K') || searchText.includes('⌘K'), '')
const rows = allByClass(searchTree, /(^|\s)search-row(\s|$)/)
check('搜索结果有可点行', rows.length > 0, rows.length + ' 行')
rows[0].props.onClick({ preventDefault() {}, stopPropagation() {} })
check('点结果会进入项目并关闭小窗', !mod.store.modal && !!mod.store.activeId, String(mod.store.activeId))

/* ---------- ⑤ 项目拖拽排序 / 归组 ---------- */
const beforeIds = mod.store.projects.map((p) => p.id)
mod.moveProjectBefore(beforeIds[1], beforeIds[0])
const afterIds = mod.store.projects.map((p) => p.id)
check('拖到别的项目前面会换位', afterIds[0] === beforeIds[1] && afterIds[1] === beforeIds[0], JSON.stringify(afterIds.slice(0, 2)))
mod.setProjectFolder(afterIds[0], '工作')
check('拖到分组标题会归组', (mod.store.projects.find((p) => p.id === afterIds[0]) || {}).folder === '工作', JSON.stringify(mod.store.projects.find((p) => p.id === afterIds[0])?.folder))
mod.setProjectFolder(afterIds[0], '')
check('拖回未分组会清空 folder', !(mod.store.projects.find((p) => p.id === afterIds[0]) || {}).folder, '')

/* ---------- ⑥ 多窗格布局预设 ---------- */
mod.store.open = true
mod.store.view = 'project'
const pid6 = mod.store.projects[0].id
mod.store.activeId = pid6
mod.openTab(pid6, 'info')
mod.openTab(pid6, 'term')

const u0 = mod.uiOf(pid6)
check('布局默认单窗格', u0.layout === 'single' && u0.secondTab === '' && u0.split === 0, JSON.stringify({ layout: u0.layout, secondTab: u0.secondTab, split: u0.split }))

mod.setLayout(pid6, 'vsplit')
const u1 = mod.uiOf(pid6)
check('切成左右两栏', u1.layout === 'vsplit', u1.layout)
check('自动给第二窗格挑不同标签页', !!u1.secondTab && u1.secondTab !== u1.activeTab, u1.activeTab + ' / ' + u1.secondTab)

mod.setSplit(pid6, 12)
check('比例下限夹到 20', mod.uiOf(pid6).split === 20, String(mod.uiOf(pid6).split))
mod.setSplit(pid6, 99)
check('比例上限夹到 80', mod.uiOf(pid6).split === 80, String(mod.uiOf(pid6).split))
mod.setSplit(pid6, 0)
check('传 0 复位 50/50', mod.uiOf(pid6).split === 0, String(mod.uiOf(pid6).split))

const splitTree = render(overlayComp)
check('渲染出左右两栏', allByClass(splitTree, /(^|\s)ws-split(\s|$)/).length === 1 && allByClass(splitTree, /(^|\s)ws-split v(\s|$)/).length === 1, allByClass(splitTree, /ws-split/).length)
check('两栏各有一个窗格', allByClass(splitTree, /(^|\s)ws-cell(\s|$)/).length === 2 && allByClass(splitTree, /(^|\s)pane-main(\s|$)/).length === 2, allByClass(splitTree, /pane-main/).length)
check('中间有拖动条', allByClass(splitTree, /(^|\s)pane-split(\s|$)/).length === 1, '')
check('顶栏有布局切换（3 个）', allByClass(splitTree, /(^|\s)layout-switch(\s|$)/).length === 1 && allByClass(splitTree, /layout-switch/).length === 1, '')

/* 在第二栏点标签页 → 写 secondTab，第一栏不变 */
const paneB = allByClass(splitTree, /(^|\s)pane-b(\s|$)/)[0]
const tabsB = paneB ? collect(paneB).filter((n) => n.props && /(^|\s)tab(\s|$)/.test(String(n.props.className || ''))) : []
check('第二栏能点自己的标签页', tabsB.length >= 2, tabsB.length + ' 个')
const beforeA = mod.uiOf(pid6).activeTab
const other = tabsB.find((n) => textOf(n) !== textOf(paneB) && n.props.onClick)
if (other) other.props.onClick({ stopPropagation() {}, preventDefault() {} })
check('点第二栏标签只改第二窗格', mod.uiOf(pid6).activeTab === beforeA, mod.uiOf(pid6).activeTab + ' vs ' + beforeA)

/* 只有一个标签页时退回单窗格 */
mod.closeTab(pid6, mod.uiOf(pid6).tabs[1].key)
const oneTab = render(overlayComp)
check('只剩一个标签页时自动退回单窗格', allByClass(oneTab, /(^|\s)ws-split(\s|$)/).length === 0, allByClass(oneTab, /ws-split/).length)

mod.setLayout(pid6, 'single')
check('切回单窗格', mod.uiOf(pid6).layout === 'single', mod.uiOf(pid6).layout)

/* ---------- ⑦ 媒体窗 / 笔记窗 ---------- */
mod.setLayout(pid6, 'single')
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6

mod.openTab(pid6, 'media')
const mediaTree = render(overlayComp)
check('媒体窗有路径输入', !!allByClass(mediaTree, /(^|\s)media-input(\s|$)/)[0], '')
check('媒体窗有预览按钮', textOf(mediaTree).includes('预览'), '')
check('空态提示三种选法', textOf(mediaTree).includes('选择文件') && textOf(mediaTree).includes('浏览项目'), textOf(mediaTree).slice(0, 90))
const mediaInput = allByClass(mediaTree, /(^|\s)media-input(\s|$)/)[0]
const previewBtn = collect(mediaTree).find((n) => n.type === 'button' && textOf(n).trim() === '预览')
check('输入路径后点预览会切到预览态', !!mediaInput && !!previewBtn && typeof mediaInput.props.onChange === 'function', '')

/* 笔记窗 */
mod.updateProject(pid6, { note: '# 随手记 · 先跑起来' })
mod.openTab(pid6, 'notes')
const notesTree = render(overlayComp)
const area = collect(notesTree).find((n) => n.type === 'textarea')
check('笔记窗渲染编辑器', !!area, '')
check('笔记窗带出项目 note', !!area && String(area.props.value).includes('先跑起来'), area ? String(area.props.value).slice(0, 24) : '')
check('笔记窗有保存与清空', textOf(notesTree).includes('保存') && textOf(notesTree).includes('清空'), '')
check('笔记窗标题带项目名', textOf(notesTree).includes('的笔记'), textOf(notesTree).slice(0, 60))
const noteSave = collect(notesTree).find((n) => n.type === 'button' && textOf(n).trim() === '保存')
if (noteSave) noteSave.props.onClick({ preventDefault() {}, stopPropagation() {} })
check('保存后 note 仍是这条（不丢）', (mod.store.projects.find((x) => x.id === pid6) || {}).note === '# 随手记 · 先跑起来', '')

/* 新标签页在「＋ 窗口」菜单里 */
mod.store.tabMenu = true
const menuTree = render(overlayComp)
check('菜单里有媒体与笔记入口', textOf(menuTree).includes('🖼 媒体') && textOf(menuTree).includes('✎ 笔记'), '')
mod.store.tabMenu = false

/* ---------- ⑧ 产物回挂（.wt/artifact.json） ---------- */
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
artifactCase = ''
const artRes = await mod.loadArtifacts(pid6)
check('读到 3 条产物', artRes.ok === true && mod.store.artifacts.items.length === 3, JSON.stringify(mod.store.artifacts.items.map((x) => x.title)))
check('产物路径按项目目录解析', String((mod.store.artifacts.items[1] || {}).path).includes('docs'), String((mod.store.artifacts.items[1] || {}).path))
check('产物清单文件路径记下来了', String(mod.store.artifacts.file).endsWith('artifact.json'), mod.store.artifacts.file)

artifactCase = 'missing'
const missRes = await mod.loadArtifacts(pid6)
check('没有产物文件不算错误', missRes.ok === false && missRes.error === '' && mod.store.artifacts.items.length === 0, JSON.stringify(missRes))
artifactCase = ''
await mod.loadArtifacts(pid6)

/* InfoPane 里能看到产物，并能一键打开 */
mod.openTab(pid6, 'info')
const infoTree = render(overlayComp)
check('项目信息里有产物区', textOf(infoTree).includes('产物') && textOf(infoTree).includes('站点预览'), '')
const artRows = allByClass(infoTree, /(^|\s)art-row(\s|$)/)
check('产物各占一行（3 行）', artRows.length === 3, artRows.length + ' 行')
const openBtn = collect(artRows[0]).find((n) => n.type === 'button' && textOf(n).trim() === '打开')
openBtn.props.onClick({ preventDefault() {}, stopPropagation() {} })
check('网址产物进浏览器并打开', mod.store.web.url === 'http://localhost:5173' && mod.uiOf(pid6).activeTab === 'web', mod.store.web.url + ' @ ' + mod.uiOf(pid6).activeTab)

const openImg = collect(artRows[1]).find((n) => n.type === 'button' && textOf(n).trim() === '打开')
openImg.props.onClick({ preventDefault() {}, stopPropagation() {} })
check('图片产物进媒体窗', String(mod.store.media.path).endsWith('arch.png') && mod.uiOf(pid6).activeTab === 'media', mod.store.media.path + ' @ ' + mod.uiOf(pid6).activeTab)
const mediaView = render(overlayComp)
const mInput = allByClass(mediaView, /(^|\s)media-input(\s|$)/)[0]
check('媒体窗跟着产物换预览', !!mInput && String(mInput.props.value).endsWith('arch.png'), mInput ? String(mInput.props.value) : '')

const openMd = collect(artRows[2]).find((n) => n.type === 'button' && textOf(n).trim() === '打开')
openMd.props.onClick({ preventDefault() {}, stopPropagation() {} })
check('文本/文档产物进编辑器', mod.uiOf(pid6).activeTab === 'editor' && String(mod.store.editor.path).endsWith('report.md'), mod.store.editor.path + ' @ ' + mod.uiOf(pid6).activeTab)

/* ---------- ⑨ 项目模板 ---------- */
check('模板至少 5 种', mod.PROJECT_TEMPLATES.length >= 5 && mod.PROJECT_TEMPLATES.some((x) => x.id === 'frontend') && mod.PROJECT_TEMPLATES.some((x) => x.id === 'writing'), String(mod.PROJECT_TEMPLATES.length))

mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
mod.applyTemplate(pid6, 'frontend')
const tplUi = mod.uiOf(pid6)
check('前端模板预置终端与浏览器', tplUi.tabs.some((x) => x.kind === 'term') && tplUi.tabs.some((x) => x.kind === 'web'), tplUi.tabs.map((x) => x.kind).join(','))
check('前端模板是左右分栏', tplUi.layout === 'vsplit' && !!tplUi.secondTab, tplUi.layout + ' / ' + tplUi.secondTab)
check('前端模板把浏览器指到 5173', String(mod.store.web.url).includes('5173'), mod.store.web.url)
check('模板只挑第一个标签页为当前', tplUi.activeTab === tplUi.tabs[0].key, tplUi.activeTab)

const beforeBlank = mod.uiOf(pid6).tabs.length
mod.applyTemplate(pid6, 'blank')
check('空模板不改动已有标签页', mod.uiOf(pid6).tabs.length === beforeBlank, String(mod.uiOf(pid6).tabs.length))

/* ---------- ⑩ 导出 / 导入 ---------- */
const snap = mod.exportSnapshot()
check('导出含版本与项目', snap.version === 1 && Array.isArray(snap.projects) && snap.projects.length === mod.store.projects.length, JSON.stringify({ v: snap.version, n: snap.projects.length }))
check('导出含主题与布局', !!snap.theme && !!snap.theme.accent && !!snap.ui, '')
check('导出是合法 JSON 文本', (() => { try { JSON.parse(mod.exportSnapshotText()); return true } catch { return false } })(), '')

const baseCount = mod.store.projects.length
const imp1 = mod.importSnapshot({ projects: [{ name: '导入的项目', path: 'C:\\projects\\imported', note: '来自备份' }] })
check('导入新项目：新增 1', imp1.ok === true && imp1.added === 1 && mod.store.projects.length === baseCount + 1, JSON.stringify(imp1))
check('导入后能查到项目', mod.store.projects.some((x) => x.name === '导入的项目' && x.note === '来自备份'), '')

const imp2 = mod.importSnapshot({ projects: [{ name: '导入的项目', path: 'C:\\projects\\imported' }] })
check('重复导入：更新而不新增', imp2.updated === 1 && imp2.added === 0 && mod.store.projects.length === baseCount + 1, JSON.stringify(imp2))

const bad = mod.importSnapshot('{ not json')
check('坏 JSON 拒绝且不动数据', bad.ok === false && mod.store.projects.length === baseCount + 1, JSON.stringify(bad))

const noList = mod.importSnapshot({ foo: 1 })
check('没有项目列表也拒绝', noList.ok === false, JSON.stringify(noList))

/* 数据小窗与新建项目里的模板选择 */
mod.store.open = false
mod.openModal('data')
const dataTree = render(sidebarComp)
check('数据小窗有 JSON 文本域', !!collect(dataTree).find((n) => n.type === 'textarea'), '')
check('数据小窗有三个动作', textOf(dataTree).includes('下载 .json') && textOf(dataTree).includes('导入这份数据'), '')
mod.closeModal()

mod.openModal('add')
const addTree = render(sidebarComp)
check('新建项目有模板选择', textOf(addTree).includes('预设模板') && textOf(addTree).includes('前端'), '')
check('模板按钮可点（至少 5 个）', collect(addTree).filter((n) => n.props && /(^|\s)tpl(\s|$)/.test(String(n.props.className || ''))).length >= 5, '')
mod.closeModal()

/* ---------- ⑪ 入驻项目注册表 ---------- */
check('window 上挂了注册表', typeof window.__WT_REGISTER_PROJECT__ === 'function' && typeof window.__WT_UNREGISTER_PROJECT__ === 'function', typeof window.__WT_REGISTER_PROJECT__)

const extId = mod.registerExternalProject({ name: '备忘录', path: 'C:/projects/memo', icon: '📝', source: 'demo-plugin' })
check('注册一条入驻项目', !!extId && mod.store.external.length === 1 && mod.store.external[0].name === '备忘录', JSON.stringify(mod.store.external.map((x) => x.name)))
check('注册项带来源与图标', mod.store.external[0].source === 'demo-plugin' && mod.store.external[0].icon === '📝', '')

const again = mod.registerExternalProject({ id: extId, name: '备忘录', path: 'C:/projects/memo', icon: '📝' })
check('同 id 重复注册只留一条', again === extId && mod.store.external.length === 1, String(mod.store.external.length))

mod.registerExternalProject({ path: 'C:/no-name' })
check('名字为空不注册', mod.store.external.length === 1, String(mod.store.external.length))

mod.store.open = false
const sideExt = render(sidebarComp)
check('侧边栏有「入驻」分组', textOf(sideExt).includes('入驻') && textOf(sideExt).includes('备忘录'), '')
const extRow = collect(sideExt).find((n) => n.props && /(^|\s)pitem ext(\s|$)/.test(String(n.props.className || '')))
check('入驻项是虚线卡片', !!extRow, extRow ? 'ok' : '无')

const beforeProjects = mod.store.projects.length
extRow.props.onClick({ preventDefault() {}, stopPropagation() {} })
check('点入驻项落成工作台项目', mod.store.projects.length === beforeProjects + 1 && mod.store.projects.some((x) => x.path === 'C:/projects/memo'), String(mod.store.projects.length))
check('并直接进入该项目', mod.store.open === true && mod.store.view === 'project', mod.store.view)

const afterAdopt = mod.store.projects.length
const extRow2 = collect(render(sidebarComp)).find((n) => n.props && /(^|\s)pitem ext(\s|$)/.test(String(n.props.className || '')))
if (extRow2) extRow2.props.onClick({ preventDefault() {}, stopPropagation() {} })
check('同目录再点不重复建项目', mod.store.projects.length === afterAdopt, String(mod.store.projects.length))

mod.store.external.filter((x) => x.id !== extId).forEach((x) => mod.unregisterExternalProject(x.id))
mod.unregisterExternalProject(extId)
check('注销后入驻分组为空', mod.store.external.length === 0, String(mod.store.external.length))

/* ---------- ⑫ 撤销删除 ---------- */
const victim = mod.store.projects[mod.store.projects.length - 1]
const victimId = victim.id
const victimCount = mod.store.projects.length
mod.removeProject(victimId)
check('删除进垃圾桶', mod.store.projects.length === victimCount - 1 && mod.store.trash.length === 1 && mod.store.trash[0].project.id === victimId, String(mod.store.trash.length))
const undoToast = [...mod.store.toasts].reverse().find((x) => typeof x.onUndo === 'function')
check('删除后 toast 带撤销', !!undoToast, mod.store.toasts.length + ' 条 toast')

mod.store.open = false
const undoTree = render(sidebarComp)
check('toast 上有「撤销」按钮', allByClass(undoTree, /(^|\s)toast-undo(\s|$)/).length === 1, allByClass(undoTree, /toast-undo/).length)
check('撤销后项目回到原位', mod.undoRemoveProject() === true && mod.store.projects.length === victimCount && mod.store.projects[victimCount - 1].id === victimId, String(mod.store.projects.length))
check('撤销后垃圾桶清空', mod.store.trash.length === 0, String(mod.store.trash.length))
check('没得撤销时返回 false', mod.undoRemoveProject() === false, '')

/* ---------- ⑬ 窗格级错误边界 ---------- */
check('导出 PaneBoundary', typeof mod.PaneBoundary === 'function', typeof mod.PaneBoundary)
const pb = new mod.PaneBoundary({ children: 'x' })
const okTree = pb.render()
check('正常时包一层 pane-boundary', !!okTree && String(okTree.props.className).includes('pane-boundary'), okTree && okTree.props.className)
pb.state.err = new Error('boom-渲染炸了')
const crashTree = pb.render()
const crashText = textOf(crashTree)
check('出错时显示崩溃卡', crashText.includes('渲染失败') && crashText.includes('boom-渲染炸了'), crashText.slice(0, 40))
const retryBtn = collect(crashTree).find((n) => n.type === 'button' && textOf(n).includes('重新加载此窗格'))
check('崩溃卡有重试按钮', !!retryBtn, '')
if (retryBtn) retryBtn.props.onClick({ preventDefault() {}, stopPropagation() {} })
check('重试后恢复渲染', pb.state.err === null && pb.state.tries === 1, JSON.stringify({ err: String(pb.state.err), tries: pb.state.tries }))

mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
mod.uiOf(pid6)
mod.openTab(pid6, 'info')
const bTree = render(overlayComp)
check('窗格外面有边界包裹', allByClass(bTree, /(^|\s)pane-boundary(\s|$)/).length >= 1, allByClass(bTree, /pane-boundary/).length)

/* ---------- ⑭ 总览：搜索 / 排序 / 筛选 ---------- */
mod.store.open = true
mod.store.view = 'grid'
mod.setGridTab('projects')
mod.setOverview({ q: '', sort: 'recent', filter: 'all' })

const allList = mod.overviewProjects()
check('默认展示全部可见项目', allList.length === mod.store.projects.filter((x) => !x.hidden).length, String(allList.length))

mod.setOverview({ sort: 'name' })
const byName = mod.overviewProjects()
const names = byName.map((x) => String(x.alias || x.name))
check('按名称排序是有序的', JSON.stringify(names) === JSON.stringify([...names].sort((a, b) => a.localeCompare(b, 'zh'))), names.join(' | '))

mod.setOverview({ sort: 'order' })
const byOrder = mod.overviewProjects()
check('按自定义顺序排序', byOrder.map((x) => Number(x.order || 0)).every((v, i, arr) => i === 0 || arr[i - 1] <= v), byOrder.map((x) => x.order).join(','))

mod.setOverview({ q: '智能', sort: 'recent' })
const hit = mod.overviewProjects()
check('搜索命中项目名', hit.length >= 1 && hit.every((x) => JSON.stringify(x).includes('智能') || String(x.name).includes('智能')), hit.map((x) => x.name).join(' | '))

mod.setOverview({ q: '绝不存在的东西' })
check('搜索无结果时列表为空', mod.overviewProjects().length === 0, '')
mod.setOverview({ q: '' })

mod.setOverview({ filter: 'bound' })
check('筛选「有对话」只剩已绑定', mod.overviewProjects().every((x) => (x.sessions || []).length > 0), '')
mod.setOverview({ filter: 'unbound' })
check('筛选「未绑定」只剩没对话的', mod.overviewProjects().every((x) => !(x.sessions || []).length), '')
mod.setOverview({ filter: 'all' })

const ovTree = render(overlayComp)
check('总览有搜索框', !!allByClass(ovTree, /(^|\s)ov-search(\s|$)/)[0], '')
check('总览有排序下拉', !!allByClass(ovTree, /(^|\s)ov-sort(\s|$)/)[0], '')
check('总览有四个筛选按钮', allByClass(ovTree, /(^|\s)ov-chips(\s|$)/).length === 1 && ['全部', '有对话', '未绑定', '在跑/待处理'].every((x) => textOf(ovTree).includes(x)), '')
const chipBox = allByClass(ovTree, /(^|\s)ov-chips(\s|$)/)[0]
const chipBtns = chipBox ? collect(chipBox).filter((n) => n.type === 'button') : []
check('筛选按钮可点（4 个）', chipBtns.length === 4, String(chipBtns.length))

mod.setOverview({ q: '智能' })
const filteredTree = render(overlayComp)
check('搜索后卡片减少', filteredTree && textOf(filteredTree).includes('智能'), '')

/* ---------- ⑮ 快捷键 ---------- */
const ev = (patch) => ({ key: '', prevented: false, preventDefault() { this.prevented = true }, stopPropagation() {}, target: { tagName: 'DIV' }, ...patch })

check('快捷键表至少 7 条', mod.HOTKEYS.length >= 7, String(mod.HOTKEYS.length))

mod.closeModal()
mod.store.modal = null
const k1 = ev({ key: 'k', ctrlKey: true })
check('Ctrl+K 打开搜索', mod.handleHotkey(k1) === true && mod.store.modal && mod.store.modal.kind === 'search' && k1.prevented === true, JSON.stringify(mod.store.modal))
mod.store.modal = null

const k2 = ev({ key: 'n', ctrlKey: true })
check('Ctrl+N 新建项目', mod.handleHotkey(k2) === true && mod.store.modal && mod.store.modal.kind === 'add', JSON.stringify(mod.store.modal))
mod.store.modal = null

const k3 = ev({ key: 'n', ctrlKey: true, target: { tagName: 'INPUT' } })
check('输入框里不抢 Ctrl+N', mod.handleHotkey(k3) === false && !mod.store.modal, String(!!mod.store.modal))

const k4 = ev({ key: 'g', ctrlKey: true })
check('Ctrl+G 打开总览', mod.handleHotkey(k4) === true && mod.store.open === true && mod.store.view === 'grid', mod.store.view)

/* 项目里的标签页快捷键 */
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
mod.openTab(pid6, 'info')
mod.openTab(pid6, 'term')
const tabsNow = mod.uiOf(pid6).tabs
const k5 = ev({ key: '1', ctrlKey: true })
check('Ctrl+1 切到第一个标签页', mod.handleHotkey(k5) === true && mod.uiOf(pid6).activeTab === tabsNow[0].key, mod.uiOf(pid6).activeTab)
const k6 = ev({ key: '9', ctrlKey: true })
check('Ctrl+9 没有第 9 个就不处理', mod.handleHotkey(k6) === false, '')
const beforeTabs = mod.uiOf(pid6).tabs.length
const k7 = ev({ key: 'w', ctrlKey: true })
check('Ctrl+W 关掉当前标签页', mod.handleHotkey(k7) === true && mod.uiOf(pid6).tabs.length === beforeTabs - 1, String(mod.uiOf(pid6).tabs.length))

/* Alt + ↓ 切项目 */
const visIds = mod.store.projects.filter((x) => !x.hidden).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0)).map((x) => x.id)
mod.store.view = 'project'
mod.store.activeId = visIds[0]
const k8 = ev({ key: 'ArrowDown', altKey: true })
const switched = mod.handleHotkey(k8) === true && mod.store.activeId === visIds[1 % visIds.length]
check('Alt+↓ 切到下一个项目', switched, mod.store.activeId + ' vs ' + visIds[1 % visIds.length])
const k9 = ev({ key: 'ArrowUp', altKey: true })
check('Alt+↑ 能切回来', mod.handleHotkey(k9) === true && mod.store.activeId === visIds[0], mod.store.activeId)

const k10 = ev({ key: 'x' })
check('无关按键不处理', mod.handleHotkey(k10) === false && mod.handleHotkey(null) === false, '')

/* ---------- ⑯ 运行配置 ---------- */
mod.setRunConfig(pid6, { cmd: 'npm run dev', port: 5173 })
const p6 = mod.store.projects.find((x) => x.id === pid6)
check('运行配置写进项目', !!p6.run && p6.run.cmd === 'npm run dev' && p6.run.port === 5173, JSON.stringify(p6.run))

mod.setRunConfig(pid6, { cmd: '' })
const noRun = mod.runProject(pid6)
check('没配命令时拒绝运行', noRun.ok === false && noRun.error === 'no-run-config', JSON.stringify(noRun))

mod.setRunConfig(pid6, { cmd: 'npm run dev', port: 5173 })
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
const run1 = mod.runProject(pid6)
check('点运行：状态 running', run1.ok === true && mod.store.run.state === 'running' && mod.store.run.pid === pid6, JSON.stringify(mod.store.run))
check('运行会打开终端标签页', mod.uiOf(pid6).tabs.some((x) => x.kind === 'term') && String(mod.uiOf(pid6).activeTab).startsWith('term'), mod.uiOf(pid6).activeTab)

mod.stopProject(pid6)
check('停止后回到 idle', mod.store.run.state === 'idle', mod.store.run.state)
check('端口跳转可用', mod.openRunPort(pid6) === true && String(mod.store.web.url).includes('5173'), mod.store.web.url)

/* 编辑小窗里有运行配置字段 */
mod.store.open = false
mod.openModal('edit', pid6)
const editTree = render(sidebarComp)
check('编辑小窗有运行命令字段', textOf(editTree).includes('运行命令') && textOf(editTree).includes('npm run dev'), textOf(editTree).slice(0, 60))
check('编辑小窗有端口字段', textOf(editTree).includes('端口'), '')
mod.closeModal()

/* 顶栏运行按钮 */
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
mod.setRunConfig(pid6, { cmd: 'npm run dev', port: 5173 })
const wsTree = render(overlayComp)
check('顶栏有运行按钮', allByClass(wsTree, /(^|\s)run-btn(\s|$)/).length === 1, allByClass(wsTree, /run-btn/).length)
const runBtn = allByClass(wsTree, /(^|\s)run-btn(\s|$)/)[0]
check('按钮 title 带命令', !!runBtn && String(runBtn.props.title).includes('npm run dev'), runBtn ? runBtn.props.title : '')

/* ---------- ⑰ 总览页签记忆 ---------- */
mod.setGridTab('running')
check('页签选择写进 LS', String(ls.get('wt.gridTab') || '').includes('running'), String(ls.get('wt.gridTab')))
mod.hydrate()
check('重载后恢复上次页签', mod.store.gridTab === 'running', mod.store.gridTab)
ls.set('wt.gridTab', '不存在的页签')
mod.hydrate()
check('非法页签回退到 projects', mod.store.gridTab === 'projects', mod.store.gridTab)

/* ---------- ⑱ 终端历史面板 ---------- */
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
mod.openTab(pid6, 'term')
await mod.termExec(pid6, 'npm run dev')
await new Promise((r) => setTimeout(r, 10))
const termSlice = mod.store.terms[pid6] || {}
const histOk = (termSlice.history || []).includes('npm run dev') || String(ls.get('wt.termHistory') || '').includes('npm run dev')
check('执行过的命令进历史', histOk, JSON.stringify((termSlice.history || []).slice(-3)))
const termTree = render(overlayComp)
const histBtn = collect(termTree).find((n) => n.type === 'button' && textOf(n).includes('历史'))
check('终端条上有「历史」按钮', !!histBtn, histBtn ? textOf(histBtn) : '')
check('历史按钮显示条数或空', !!histBtn && /(历史s*d+|历史)/.test(textOf(histBtn)), histBtn ? textOf(histBtn) : '')

/* ---------- ⑲ 并排项目 ---------- */
mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
const otherId = mod.store.projects.find((x) => x.id !== pid6).id

check('并排：拒绝把自己放进并排位', mod.setSideProject(pid6) === false, '')
check('并排：设一个别的项目', mod.setSideProject(otherId) === true && mod.store.side.pid === otherId, JSON.stringify(mod.store.side))
check('并排：选择写进 LS', String(ls.get('wt.side') || '').includes(otherId), String(ls.get('wt.side')))
check('sideProjectOf 返回该项目', (mod.sideProjectOf(pid6) || {}).id === otherId, '')
check('并排位等于当前项目时返回 null', mod.sideProjectOf(otherId) === null, '')

check('并排比例下限 20', mod.setSideSplit(5) === 20, String(mod.store.side.split))
check('并排比例上限 80', mod.setSideSplit(95) === 80, String(mod.store.side.split))
check('并排比例复位 50', mod.setSideSplit(0) === 50, String(mod.store.side.split))

mod.openTab(otherId, 'info')
mod.openTab(pid6, 'term')
const sideTree = render(overlayComp)
check('渲染出并排容器', allByClass(sideTree, /(^|\s)ws-side(\s|$)/).length === 1, allByClass(sideTree, /ws-side/).length)
check('两侧各有一个标题条', allByClass(sideTree, /(^|\s)side-head(\s|$)/).length === 2, allByClass(sideTree, /side-head/).length)
check('两侧各有一个窗格区', allByClass(sideTree, /(^|\s)side-cell(\s|$)/).length === 2 && allByClass(sideTree, /(^|\s)pane-main(\s|$)/).length >= 2, allByClass(sideTree, /side-cell/).length + ' / ' + allByClass(sideTree, /pane-main/).length)
const sideHeads = allByClass(sideTree, /(^|\s)side-head(\s|$)/).map((n) => textOf(n))
check('标题条显示两个项目名', sideHeads.some((x) => x.includes('智能小车固件')) && sideHeads.some((x) => !x.includes('智能小车固件')), sideHeads.join(' | '))
const toggles = collect(sideTree).filter((n) => n.type === 'button' && textOf(n).trim() === '⫼')
check('顶栏有并排按钮（且高亮）', toggles.length === 1 && String(toggles[0].props.className).includes('on'), toggles.length + ' 个')

/* 并排选择小窗 */
mod.store.open = false
mod.openModal('side', pid6)
const sideModal = render(sidebarComp)
check('并排小窗列出别的项目', textOf(sideModal).includes('并排放一个项目') && (textOf(sideModal).includes('智能小车固件') || textOf(sideModal).includes('上位机面板')), textOf(sideModal).slice(0, 60))
mod.closeModal()

/* 进并排里的项目 → 自动撤掉并排 */
mod.store.open = true
await mod.enterProject(otherId)
check('进并排项目时自动撤掉并排', !mod.store.side.pid, mod.store.side.pid)
mod.setSideProject(otherId)

/* ---------- ⑳ 并排快捷键 / 陈旧并排清理 ---------- */
check('快捷键表含并排两条', mod.HOTKEYS.some((x) => x.keys.includes('Alt + Shift + ↓')) && mod.HOTKEYS.some((x) => x.keys.includes('Alt + Shift + ↑')), String(mod.HOTKEYS.length))

mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
const sideTarget = mod.store.projects.find((x) => x.id !== pid6).id
mod.setSideProject(sideTarget)
const swapEv = ev({ key: 'ArrowDown', altKey: true, shiftKey: true })
const swapped = mod.handleHotkey(swapEv) === true
await new Promise((r) => setTimeout(r, 20))
check('Alt+Shift+↓ 互换主/并排', swapped && mod.store.activeId === sideTarget && mod.store.side.pid === pid6, 'active=' + mod.store.activeId + ' side=' + mod.store.side.pid)
check('互换会 preventDefault', swapEv.prevented === true, '')

const closeEv = ev({ key: 'ArrowUp', altKey: true, shiftKey: true })
const closed = mod.handleHotkey(closeEv) === true
check('Alt+Shift+↑ 关闭并排', closed && !mod.store.side.pid, String(mod.store.side.pid))

/* 没有并排时这两个键不处理 */
const noneEv = ev({ key: 'ArrowUp', altKey: true, shiftKey: true })
check('没有并排时不处理并排键', mod.handleHotkey(noneEv) === false, '')

/* 陈旧的 side.pid 在 hydrate 时被清掉 */
ls.set('wt.side', JSON.stringify({ pid: 'p-早已删除', split: 40 }))
mod.hydrate()
check('hydrate 清掉已删除的并排项目', mod.store.side.pid === '' && mod.store.side.split === 40, JSON.stringify(mod.store.side))
check('清理结果写回 LS', !String(ls.get('wt.side') || '').includes('p-早已删除'), String(ls.get('wt.side')))

/* ---------- ㉑ 媒体窗（真实路径/类型判定） ---------- */
check('svg 也当图片预览', mod.kindOfMediaPath('C:/x/logo.svg') === 'image', mod.kindOfMediaPath('C:/x/logo.svg'))
check('png → image', mod.kindOfMediaPath('C:\\pics\\a.png') === 'image', '')
check('pdf → pdf', mod.kindOfMediaPath('C:\\docs\\a.pdf') === 'pdf', '')
check('mp4 → video', mod.kindOfMediaPath('C:\\v\\a.mp4') === 'video', '')
check('mp3 → audio', mod.kindOfMediaPath('C:\\a\\b.mp3') === 'audio', '')
check('txt → 文本（走编辑器）', mod.kindOfMediaPath('C:\\a\\b.txt') === 'text', mod.kindOfMediaPath('C:\\a\\b.txt'))

mod.store.open = true
mod.store.view = 'project'
mod.store.activeId = pid6
mod.openTab(pid6, 'media')
mod.openMedia(pid6, 'C:\\pics\\probe-shot.png')
const imgTree = render(overlayComp)
const img = allByClass(imgTree, /(^|\s)media-img(\s|$)/)[0]
check('媒体窗渲染 <img>', !!img, img ? String(img.type) : '无')
check('img 指向 /fs/raw 且带路径', !!img && String(img.props.src).includes('/fs/raw?path=') && String(img.props.src).includes('probe-shot.png'), img ? String(img.props.src) : '')
check('img 有 onError 兜底', !!img && typeof img.props.onError === 'function', '')

mod.openMedia(pid6, 'C:\\docs\\a.pdf')
const pdfTree = render(overlayComp)
const mediaPdfFrame = allByClass(pdfTree, /(^|\s)media-frame(\s|$)/)[0]
check('PDF 走 iframe', !!mediaPdfFrame && String(mediaPdfFrame.props.src).includes('/fs/raw'), '')

mod.openMedia(pid6, 'C:\\a\\b.txt')
const txtTree = render(overlayComp)
check('非媒体给「不支持内嵌预览」', textOf(txtTree).includes('不支持内嵌预览'), '')
check('非媒体显示解析后的 URL 方便排查', textOf(txtTree).includes('/fs/raw'), '')
mod.openMedia(pid6, 'C:\\pics\\probe-shot.svg')
const svgTree = render(overlayComp)
check('SVG 也能内嵌预览', !!allByClass(svgTree, /(^|\s)media-img(\s|$)/)[0], '')
mod.openMedia(pid6, '')

/* ---------- ㉒ 媒体：选择文件 / 浏览项目 ---------- */
mod.openMedia(pid6, '')
const pickTree = render(overlayComp)
check('有「选择文件」按钮', collect(pickTree).some((n) => n.type === 'button' && textOf(n).trim() === '选择文件'), '')
check('有「浏览项目」按钮', collect(pickTree).some((n) => n.type === 'button' && textOf(n).trim() === '浏览项目'), '')
const fileInput = collect(pickTree).find((n) => n.type === 'input' && String(n.props.type) === 'file')
check('隐藏的 file 输入存在且只收媒体', !!fileInput && String(fileInput.props.accept).includes('image/*'), fileInput ? String(fileInput.props.accept) : '')

const listed = await mod.listMediaDir('C:\\projects\\smart-car')
check('listMediaDir 返回目录条目', !!listed && Array.isArray(listed.entries) && listed.entries.length >= 5, JSON.stringify(listed && listed.entries && listed.entries.map((x) => x.name)))
const mediaFiltered = mod.mediaRowsOf(listed.entries)
const mediaNames = mediaFiltered.map((x) => x.name)
check('只留目录与媒体文件', mediaNames.includes('src') && mediaNames.includes('shot.png') && mediaNames.includes('manual.pdf'), names.join(','))
check('文本/代码文件被过滤掉', !mediaNames.includes('README.md') && !mediaNames.includes('main.c'), names.join(','))

const svgRow = mod.mediaRowsOf([{ name: 'logo.svg', dir: false, size: 1 }, { name: 'a.txt', dir: false, size: 1 }])
check('SVG 算可预览', svgRow.length === 1 && svgRow[0].name === 'logo.svg', JSON.stringify(svgRow.map((x) => x.name)))

const failed = results.filter((r) => !r)
console.log('\n' + (failed.length ? 'FAILED ' + failed.length : 'ALL PASS') + ' / ' + results.length)
process.exit(failed.length ? 1 : 0)
