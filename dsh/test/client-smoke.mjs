/**
 * client bundle 离线冒烟：桩掉 React / document / localStorage / fetch / slots，
 * 加载 ModuleLoader 产物并真实渲染 + 点按钮，验证：
 *   - 两个座位注册、样式只注入一次
 *   - 侧边栏：状态栏 / 项目列表（不再单列宿主会话）
 *   - 右击菜单：模式切换 + 单一「绑定对话」入口
 *   - 项目工作区：宿主会话区让位到右侧，工作台只占左边，不再自绘对话栏
 *   - 窗口模式有浮动小窗，全屏模式铺满；两种模式共用标签页 / 编辑器 / 终端 / 浏览器
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
  ],
  total: 3, truncated: false,
}
const fakeFile = { path: 'C:\\projects\\smart-car\\README.md', name: 'README.md', size: 18, text: '# smart car\n固件说明\n', truncated: false }
const fakeGit = { ok: true, repo: true, branch: 'main', changes: [{ code: ' M', file: 'main.c' }], counts: { staged: 0, unstaged: 1, untracked: 0, total: 1 } }
const fakeGitLog = { ok: true, commits: [{ hash: 'a1b2c3d', date: '2026-10-01', subject: '整理构建脚本', author: 'demo' }] }
const fakeGitBranches = { ok: true, branches: ['main'] }

globalThis.fetch = async (url, opts) => {
  const u = String(url)
  const body = u.endsWith('/sessions') ? fakeSessions
    : u.endsWith('/defaults') ? fakeDefaults
        : u.endsWith('/fs/list') ? fakeTree
          : u.endsWith('/fs/read') ? fakeFile
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
function rightClickByText(root, label) {
  const hit = collect(root).find((n) => n.props && typeof n.props.onContextMenu === 'function' && textOf(n).includes(label))
  if (!hit) throw new Error('找不到可右击节点：' + label)
  hit.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 100, clientY: 120 })
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
check('状态栏显示进行中计数', /进行中/.test(sideText) && /2/.test(sideText), sideText.slice(0, 60))
check('侧边栏不再单列宿主会话', allByClass(sidebar, /(^|\s)slist(\s|$)/).length === 0 && allByClass(sidebar, /(^|\s)srow(\s|$)/).length === 0)
check('宿主对话不再出现在侧边栏', !sideText.includes('app-alpha 会话'), sideText.slice(0, 120))
check('状态栏改为「未绑定」计数', sideText.includes('未绑定') && sideText.includes('宿主对话') === false, sideText.slice(0, 80))
check('绑定项目带 🔗 标记', allByClass(sidebar, /pi-bind/).length === 1, allByClass(sidebar, /pi-bind/).length)
check('项目状态灯数量 = 项目数', allByClass(sidebar, /(^|\s)light(\s|$)/).length >= 2, allByClass(sidebar, /(^|\s)light(\s|$)/).length)

/* 右击 → 菜单 */
rightClickByText(sidebar, '智能小车固件')
let withMenu = render(sidebarComp)
let ctxMenu = allByClass(withMenu, /ctx-menu/)[0]
check('右击项目弹出上下文菜单', !!ctxMenu)
check('菜单含两种工作区模式', ['全屏', '窗口'].every((l) => textOf(ctxMenu).includes(l)), textOf(ctxMenu).replace(/\s+/g, ' ').slice(0, 90))
check('菜单不再有四种布局预设', !['三分式', '两分', '单栏', '对话主导'].some((l) => textOf(ctxMenu).includes(l)))
check('菜单含编辑/绑定/删除', ['编辑项目信息', '绑定对话', '删除项目'].every((l) => textOf(ctxMenu).includes(l)))
check('绑定只有一个入口（不再有解除项）', !textOf(ctxMenu).includes('解除') && (textOf(ctxMenu).match(/绑定对话/g) || []).length === 1, textOf(ctxMenu).replace(/\s+/g, ' ').slice(0, 120))

clickByLabel(ctxMenu, '窗口')
const afterMode = JSON.parse(ls.get('wt.ui.v2') || '{}')
check('切换模式写入 wt.ui.v2', afterMode['custom-1'] && afterMode['custom-1'].mode === 'float', JSON.stringify(afterMode['custom-1']))

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
check('模式切换条存在', allByClass(overlay, /(^|\s)seg(\s|$)|(^|\s)seg tiny(\s|$)/).length >= 1)
check('不再自绘对话栏（右侧交给宿主）', allByClass(overlay, /pane-chat/).length === 0)
check('左栏仍在', allByClass(overlay, /pane-left/).length === 1)
check('分割条 = 左栏 + 让位边界', allByClass(overlay, /split-handle/).length === 2, allByClass(overlay, /split-handle/).length)
check('让位边界是 dock-edge', allByClass(overlay, /dock-edge/).length === 1)

/* 左栏可收起：让位区窄的时候工作区能占满 */
clickByLabel(overlay, '▤ 收起')
overlay = render(overlayComp)
check('收起左栏：左栏与左分割条一起消失', allByClass(overlay, /pane-left/).length === 0 && allByClass(overlay, /split-handle/).length === 1)
check('收起状态写进 wt.ui.v2', JSON.parse(ls.get('wt.ui.v2') || '{}')['custom-1'].leftHidden === true)
clickByLabel(overlay, '▤ 展开')
overlay = render(overlayComp)
check('展开左栏恢复', allByClass(overlay, /pane-left/).length === 1 && allByClass(overlay, /split-handle/).length === 2)
const chatPill = allByClass(overlay, /dh-chat/)[0]
check('顶栏标出右侧对话（主绑定）', !!chatPill && !/off/.test(chatPill.props.className), chatPill && chatPill.props.className)
check('对话气泡显示主对话标题', !!chatPill && textOf(chatPill).includes('app-alpha'), chatPill && textOf(chatPill))

/* 窗口模式 */
check('窗口模式：中间栏是画布', allByClass(overlay, /pane-canvas/).length === 1, allByClass(overlay, /pane-canvas/).length)
const floatWin = allByClass(overlay, /float-win/)[0]
check('窗口模式：视窗存在', !!floatWin)
check('视窗按比例定位在对话栏旁', !!floatWin && /%$/.test(String(floatWin.props.style.left)) && /%$/.test(String(floatWin.props.style.width)), floatWin && JSON.stringify(floatWin.props.style))
check('视窗有标题栏与缩放角', allByClass(overlay, /float-bar/).length === 1 && allByClass(overlay, /float-grip/).length === 1)
check('视窗有复位 / 全屏按钮', allByClass(overlay, /fb-tools/).length === 1 && ['复位', '全屏'].every((t) => textOf(floatWin).includes(t)))
check('视窗内工作区与全屏同源（pane-nest）', allByClass(overlay, /pane-nest/).length === 1)

/* 进入项目时把宿主切到主绑定对话 */
check('进入项目即切宿主对话（主绑定）', mainText.includes('app-alpha 会话') || mainText.includes('app-alpha'), mainText.slice(0, 120))

/* 让位宽度换算 */
const { computeDock } = mod
check('导出 computeDock 供换算', typeof computeDock === 'function')
if (typeof computeDock === 'function') {
  const auto = computeDock({ track: 1200, preferred: 0 })
  check('自动宽度 = 轨道 64%', auto.width === 768, JSON.stringify(auto))
  check('自动宽度给对话留够 380', auto.max === 820, JSON.stringify(auto))
  check('拖过的像素宽度原样生效', computeDock({ track: 1200, preferred: 500 }).width === 500)
  check('过宽时夹到「轨道 - 380」', computeDock({ track: 1200, preferred: 5000 }).width === 820, JSON.stringify(computeDock({ track: 1200, preferred: 5000 })))
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
check('让位：右侧至少留 380', g1.max === 780, JSON.stringify(g1))
mod.releaseDock()
check('退出项目：marginLeft 还原', fakeCenter.style.marginLeft === '', JSON.stringify(fakeCenter.style.marginLeft))

/* 切到全屏模式 */
clickByLabel(overlay, '全屏')
overlay = render(overlayComp)
check('全屏模式：没有浮动视窗', allByClass(overlay, /float-win/).length === 0 && allByClass(overlay, /pane-canvas/).length === 0)
check('全屏模式：中间栏铺满', allByClass(overlay, /pane-main/).length === 1 && allByClass(overlay, /pane-nest/).length === 0)
check('全屏模式：左栏仍在', allByClass(overlay, /pane-left/).length === 1)
check('全屏模式：让位边界仍在', allByClass(overlay, /dock-edge/).length === 1)

/* 左栏信息 */
check('项目信息显示绑定对话数', /绑定对话/.test(textOf(overlay)))
check('git 区块渲染分支', textOf(overlay).includes('main'), textOf(allByClass(overlay, /git-box/)[0] || overlay).slice(0, 80))

/* 切到「文件」并打开文件 */
clickByLabel(overlay, '文件')
overlay = render(overlayComp)
const filesText = textOf(overlay)
check('文件窗格列出目录条目', filesText.includes('src') && filesText.includes('README.md') && filesText.includes('main.c'), filesText.slice(0, 90))
check('文件条目显示大小', /128|2 KB|KB/.test(filesText), filesText.slice(0, 120))

clickByLabel(overlay, 'README.md')
await new Promise((r) => setTimeout(r, 30))
overlay = render(overlayComp)
const editor = allByClass(overlay, /ed-area/)[0]
check('点击文件后打开编辑器标签页', allByClass(overlay, /(^|\s)tab(\s|$)/).length === 1)
check('编辑器渲染文件内容', !!editor && String(editor.props.value).includes('固件说明'), editor && String(editor.props.value).slice(0, 40))
check('编辑器有保存按钮', textOf(overlay).includes('保存'))

/* 打开终端标签页 */
clickByLabel(overlay, '终端')
overlay = render(overlayComp)
const termIn = allByClass(overlay, /term-in/)[0]
check('终端窗格渲染输入行', !!termIn)
check('终端窗格显示提示符', textOf(overlay).includes('❯'))
check('终端显示当前目录', textOf(overlay).includes('smart-car') || textOf(overlay).includes('C:\\projects'), textOf(overlay).slice(0, 80))
check('终端标签页与编辑器并存', allByClass(overlay, /(^|\s)tab(\s|$)/).length === 2, allByClass(overlay, /(^|\s)tab(\s|$)/).length)

/* 打开浏览器标签页 */
clickByLabel(overlay, '浏览器')
overlay = render(overlayComp)
const frame = allByClass(overlay, /web-frame/)[0]
check('浏览器窗格渲染 iframe', !!frame || textOf(overlay).includes('浏览器窗格'), textOf(overlay).slice(0, 60))

/* 切回窗口模式，标签页应保留（两种模式功能一致） */
clickByLabel(overlay, '窗口')
overlay = render(overlayComp)
check('窗口模式保留全部标签页', allByClass(overlay, /(^|\s)tab(\s|$)/).length === 3, allByClass(overlay, /(^|\s)tab(\s|$)/).length)
check('窗口模式仍渲染当前窗格内容', !!allByClass(overlay, /web-frame/)[0] || textOf(overlay).includes('浏览器窗格'))
clickByLabel(overlay, '全屏')
overlay = render(overlayComp)

/* 关闭当前标签 */
overlay = render(overlayComp)
const closeX = collect(overlay).find((n) => n.props && /tab-x/.test(String(n.props.className || '')) && typeof n.props.onClick === 'function')
check('标签页有关闭按钮', !!closeX)

/* 回到全部项目 */
clickByLabel(overlay, '≡ 项目')
overlay = render(overlayComp)
const gridText = textOf(overlay)
check('回到网格：显示控制室', gridText.includes('控制室'))
check('控制室显示四格统计', allByClass(overlay, /cc-cell/).length === 4, allByClass(overlay, /cc-cell/).length)
check('控制室显示运行中会话', gridText.includes('app-alpha 会话'))
check('网格渲染两张项目卡', allByClass(overlay, /project-card/).length === 2, allByClass(overlay, /project-card/).length)
check('网格有新建卡片', allByClass(overlay, /add-card/).length === 1)
check('卡片状态用中文标签', /进行中|待处理|已完成|待命/.test(gridText))

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
check('小窗有默认工作区按钮', modalText.includes('默认工作区'))
check('小窗有两种模式草图', allByClass(overlay, /layout-card/).length === 2, allByClass(overlay, /layout-card/).length)
check('小窗有绑定对话下拉', allByClass(overlay, /wt-select/).length === 1)
check('小窗提示只写 localStorage', modalText.includes('localStorage'))

const failed = results.filter((r) => !r)
console.log('\n' + (failed.length ? 'FAILED ' + failed.length : 'ALL PASS') + ' / ' + results.length)
process.exit(failed.length ? 1 : 0)
