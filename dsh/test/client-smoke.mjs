/**
 * client bundle 离线冒烟：桩掉 React / document / localStorage / fetch / slots，
 * 加载 ModuleLoader 产物并真正渲染，验证：
 *   - 两个座位注册、样式注入一次
 *   - 侧边栏：顶部状态栏（进行中 / 待处理 / 会话快照 / DSH 对话）+ 临时项目列表，无控制室
 *   - 右击项目框：布局 / 对话绑定 / 删除
 *   - 项目内部：三分式分栏（左 项目 / 中 主界面留空 / 右 对话），布局可切换
 *   - 卡片网格与「新建临时项目」小窗（默认工作区 + 布局选择）
 */
import { readFileSync } from 'node:fs'

const code = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/* ---------- 桩：document / localStorage ---------- */
const styleNodes = []
globalThis.document = {
  createElement: (tag) => ({ tag, setAttribute() {}, textContent: '', remove() {} }),
  head: { appendChild: (n) => styleNodes.push(n) },
  querySelectorAll: () => [1],
  addEventListener() {},
  removeEventListener() {},
}

const ls = new Map()
globalThis.localStorage = {
  getItem: (k) => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => ls.set(k, String(v)),
  removeItem: (k) => ls.delete(k),
}

/* ---------- 桩：fetch（按路由分发） ---------- */
const NOW = Date.now()
const fakeSessions = {
  ok: true,
  at: NOW,
  source: 'sessionQuery',
  counts: { running: 2, waiting: 1, done: 3, idle: 1, total: 7 },
  sessions: [
    { id: 's-apple', title: 'app-alpha 会话', cwd: 'C:\\demo\\app-alpha', state: 'running', live: true, createdAt: 3, updatedAt: NOW },
    { id: 's-beta', title: 'beta 控制台', cwd: 'C:\\demo\\beta', state: 'waiting', live: true, createdAt: 2, updatedAt: NOW },
    { id: 's-gamma', title: 'gamma', cwd: 'C:\\demo\\gamma', state: 'done', live: false, createdAt: 1, updatedAt: NOW },
  ],
}
const fakeDefaults = { ok: true, at: NOW, workspace: 'C:\\Users\\demo\\default-workspace', home: 'C:\\Users\\demo\\.dsh', platform: 'win32' }
const fakeTranscript = {
  ok: true,
  sessionId: 's-apple',
  title: 'app-alpha 会话',
  messages: [
    { id: '1', role: 'user', text: '把构建脚本整理一下', time: NOW - 60000 },
    { id: '2', role: 'assistant', text: '好的，先看 package.json。', time: NOW - 30000 },
  ],
  truncated: false,
}

globalThis.fetch = async (url) => {
  const u = String(url)
  const body = u.includes('/sessions') ? fakeSessions
    : u.includes('/defaults') ? fakeDefaults
      : u.includes('/transcript') ? fakeTranscript
        : { ok: true }
  return { ok: true, status: 200, json: async () => body }
}

/* ---------- 桩：React ---------- */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
  Component: class {
    constructor(props) { this.props = props; this.state = {} }
    setState(p) { Object.assign(this.state, typeof p === 'function' ? p(this.state) : p) }
  },
  useState: (init) => {
    const v = typeof init === 'function' ? init() : init
    return [v, () => {}]
  },
  useEffect: () => {},
  useCallback: (fn) => fn,
}

/* ---------- 桩：ModuleLoader 握手 ---------- */
let captured = null
globalThis.window = { __ModuleLoader__: { load: (mod) => { captured = mod } } }
globalThis.setInterval = () => 0
globalThis.clearInterval = () => {}

const requireStub = (name) => {
  if (name === 'react') return reactStub
  if (name === 'react/jsx-runtime') return { jsx: reactStub.createElement, jsxs: reactStub.createElement, Fragment: 'Fragment' }
  throw new Error('unexpected external: ' + name)
}

/* 预置两个临时项目，第一个已绑定对话 */
ls.set('wt.projects', JSON.stringify([
  { id: 'custom-1', name: '智能小车固件', alias: '智能小车固件', path: 'C:\\projects\\smart-car', langs: ['C', 'ESP-IDF'], category: '自定义', sizeMB: 0, updated: '2026-10-01', custom: true },
  { id: 'custom-2', name: '上位机面板', alias: '上位机面板', path: 'C:\\projects\\hmi', langs: ['C#'], category: '自定义', sizeMB: 0, updated: '2026-10-02', custom: true },
]))
ls.set('wt.bindings', JSON.stringify({ 'custom-1': 's-apple' }))

new Function('window', code)(globalThis.window)
if (!captured) throw new Error('ModuleLoader.load 未被调用')
if (captured.id !== 'trae-usage-worktable') throw new Error('id 不符: ' + captured.id)
const mod = captured.factory(requireStub)

const results = []
const check = (name, cond, extra) => {
  results.push(!!cond)
  console.log((cond ? 'PASS  ' : 'FAIL  ') + name + (extra ? '   ' + String(extra).slice(0, 170) : ''))
}

check('导出 inject', Array.isArray(mod.inject) && mod.inject.includes('slots'), JSON.stringify(mod.inject))
check('导出 apply', typeof mod.apply === 'function')

/* ---------- 桩：cordis ctx ---------- */
const registrations = []
const ctx = {
  slots: {
    inject(name, factory) {
      registrations.push({ name, factory })
      registrations.at(-1).dispose = factory()
    },
    register(opts, Comp) {
      registrations.push({ registered: opts.name, id: opts.id, Comp })
      return () => {}
    },
  },
  effect(fn) { const d = fn(); return typeof d === 'function' ? d : () => {} },
  inject(deps, cb) { registrations.push({ deps: deps.join(',') }); cb({}) },
  get() { return undefined },
  logger: { info() {}, warn() {} },
}

mod.apply(ctx)
await new Promise((r) => setTimeout(r, 40)) // 等 sessions / defaults 落地

const names = registrations.map((r) => r.registered || r.name || ('deps:' + r.deps))
check('注入了 sidebar.footer.action', names.includes('sidebar.footer.action'), names.join(' | '))
check('注入了 shell.overlay', names.includes('shell.overlay'))
check('样式注入一次', styleNodes.length === 1, styleNodes.length + ' 个 <style>')

/* ---------- 渲染工具 ---------- */
function expand(node, depth = 0) {
  if (node == null || depth > 24) return node
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

function renderComp(Comp, props) {
  if (Comp.prototype && Comp.prototype.render) return expand(new Comp(props || {}).render())
  return expand(Comp(props || {}))
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
const findByClass = (node, re) => collect(node).find((n) => n.props && typeof n.props.className === 'string' && re.test(n.props.className))
const allByClass = (node, re) => collect(node).filter((n) => n.props && typeof n.props.className === 'string' && re.test(n.props.className))
function findButtonByLabel(root, label) {
  const buttons = collect(root).filter((n) => n.props && typeof n.props.onClick === 'function')
  for (const b of buttons) {
    const kids = b.children !== undefined ? b.children : b.props.children
    const arr = Array.isArray(kids) ? kids : [kids]
    if (arr.some((k) => typeof k === 'string' && k.trim() === label)) return b
  }
  // 菜单项：[名称][说明][勾选] 三段结构，退化成整段文本包含匹配；
  // 同时命中祖先容器时取文本最短（最内层）的那个，避免点到菜单壳上
  const cands = buttons.filter((b) => textOf(b).includes(label))
  cands.sort((a, b) => textOf(a).length - textOf(b).length)
  return cands[0] || null
}

const rightClick = (node) => node.props.onContextMenu({ preventDefault() {}, stopPropagation() {}, clientX: 120, clientY: 160 })

/* ---------- 侧边栏 ---------- */
const sidebarReg = registrations.find((r) => r.registered === 'sidebar.footer.action')
let sidebar = null
let boom = null
try { sidebar = renderComp(sidebarReg.Comp, { wide: true }) } catch (e) { boom = e }
check('侧边栏组件渲染不抛异常', !boom, boom ? boom.message : 'ok')
check('侧边栏根节点带 wt-side', !!(sidebar && /wt-side/.test(sidebar.props.className)), sidebar && sidebar.props.className)

const sideText = textOf(sidebar)
check('有「工作台」标题', sideText.includes('工作台'))
check('有「临时项目」区块', sideText.includes('临时项目'))
check('列出 localStorage 里的项目', sideText.includes('智能小车固件') && sideText.includes('上位机面板'))
check('已绑定项目显示 🔗', sideText.includes('🔗'))
check('没有控制室入口', !sideText.includes('CONTROL ROOM') && !findByClass(sidebar, /control-entry/))
check('状态栏含 DSH 对话数', sideText.includes('DSH 对话'))
check('侧边栏有右击提示', sideText.includes('右击项目'))

const order = ['工作台', '进行中', '待处理', '会话快照', 'DSH 对话', '临时项目']
const idx = order.map((k) => sideText.indexOf(k))
check('状态栏在顶部（临时项目之前）', idx.every((v) => v >= 0) && idx[1] < idx[5] && idx[4] < idx[5], JSON.stringify(idx))

const rows = allByClass(sidebar, /(^|\s)pitem(\s|$)/)
check('项目行数 = 2', rows.length === 2, rows.length + ' 行')
check('项目行带状态小圆点', allByClass(sidebar, /(^|\s)light(\s|$)/).length >= 2)

check('侧边栏有「工作区会话」区块', sideText.includes('工作区会话'))
const srows = allByClass(sidebar, /(^|\s)srow(\s|$)/)
check('工作区会话列出宿主会话', srows.length === 3, srows.length + ' 行')
check('会话行带状态点', allByClass(sidebar, /(^|\s)srow(\s|$)/).length >= 1)

const cssText = styleNodes[0].textContent
check('侧边栏改成琥珀金底', /\.wt-side\{[\s\S]{0,400}rgba\(240,180,41/.test(cssText), '')
check('交互按键有呼吸灯动画', cssText.includes('@keyframes wtKeyBreathe') && cssText.includes('animation:wtKeyBreathe'), '')
check('布局有预览草图样式', cssText.includes('.sketch') && cssText.includes('data-layout="l3"]{grid-template-columns:1fr 1.5fr 1fr}'), '')

/* ---------- 右击项目框 ---------- */
const overlayReg = registrations.find((r) => r.registered === 'shell.overlay')
let overlay = null
try { rightClick(rows[1]) } catch (e) { check('右击不抛异常', false, e.message) }
sidebar = renderComp(sidebarReg.Comp, { wide: true })   // 菜单挂在侧边栏，重渲染才拿得到
const menuText = textOf(sidebar)
check('右击弹出上下文菜单', !!findByClass(sidebar, /(^|\s)ctx-menu(\s|$)/), menuText.slice(0, 80))
check('菜单含三种布局', menuText.includes('三分式') && menuText.includes('两分') && menuText.includes('单栏'))
check('菜单含对话绑定项', menuText.includes('绑定 DSH 对话') || menuText.includes('改绑 DSH 对话'))
check('菜单含删除项目', menuText.includes('删除项目'))
check('菜单标题是项目名', menuText.includes('上位机面板'), menuText.slice(0, 60))

/* 选「单栏」→ 菜单关闭、布局写入 */
const oneCol = findButtonByLabel(sidebar, '单栏')
check('找到「单栏」菜单项', !!oneCol)
oneCol.props.onClick({ stopPropagation() {}, preventDefault() {} })
sidebar = renderComp(sidebarReg.Comp, { wide: true })
check('选完布局后菜单关闭', !findByClass(sidebar, /(^|\s)ctx-menu(\s|$)/))
check('布局写入 localStorage', String(ls.get('wt.layouts') || '').includes('"custom-2":"full"'), ls.get('wt.layouts'))

/* ---------- 进入项目内部 ---------- */
overlay = renderComp(overlayReg.Comp, {})
rows[0].props.onClick({ stopPropagation() {}, preventDefault() {} })
overlay = renderComp(overlayReg.Comp, {})
let ws = findByClass(overlay, /(^|\s)ws(\s|$)/)
check('点项目进入分栏工作区', !!ws, ws && ws.props && ws.props['data-layout'])
check('默认三分式（custom-1 未单独设置）', ws && ws.props['data-layout'] === 'l3', ws && ws.props['data-layout'])
check('三分式有左栏', !!findByClass(overlay, /pane-left/))
check('三分式有主界面栏', !!findByClass(overlay, /pane-main/))
check('三分式有对话栏', !!findByClass(overlay, /pane-chat/))
check('中间主界面留空占位', textOf(findByClass(overlay, /pane-main/)).includes('主界面先留空'))

await new Promise((r) => setTimeout(r, 30)) // 等 transcript 落地
overlay = renderComp(overlayReg.Comp, {})
const chatText = textOf(findByClass(overlay, /pane-chat/))
check('右栏显示绑定对话的消息', chatText.includes('把构建脚本整理一下') && chatText.includes('package.json'), chatText.slice(0, 100))
check('右栏标注只读预览', chatText.includes('只读预览'))
check('右栏有打开对话按钮', !!findButtonByLabel(overlay, '打开'))

/* 切布局：单栏 → 只剩主界面 */
const oneColSeg = findButtonByLabel(overlay, '单栏')
check('工作区有布局切换条', !!oneColSeg)
oneColSeg.props.onClick({ stopPropagation() {}, preventDefault() {} })
overlay = renderComp(overlayReg.Comp, {})
ws = findByClass(overlay, /(^|\s)ws(\s|$)/)
check('切到单栏：无对话栏', !findByClass(overlay, /pane-chat/), ws && ws.props['data-layout'])
check('切到单栏：无左栏', !findByClass(overlay, /pane-left/))

/* 切回三分式 */
findButtonByLabel(overlay, '三分式').props.onClick({ stopPropagation() {}, preventDefault() {} })
overlay = renderComp(overlayReg.Comp, {})
check('切回三分式：对话栏回来', !!findByClass(overlay, /pane-chat/))

/* 两分：主界面 + 对话 */
findButtonByLabel(overlay, '两分').props.onClick({ stopPropagation() {}, preventDefault() {} })
overlay = renderComp(overlayReg.Comp, {})
ws = findByClass(overlay, /(^|\s)ws(\s|$)/)
check('两分布局：无左栏、有对话栏', !findByClass(overlay, /pane-left/) && !!findByClass(overlay, /pane-chat/), ws && ws.props['data-layout'])

/* ---------- 回到网格 ---------- */
const back = findButtonByLabel(overlay, '← 全部项目')
check('顶栏有返回全部项目', !!back)
back.props.onClick({ stopPropagation() {}, preventDefault() {} })
overlay = renderComp(overlayReg.Comp, {})
check('回到卡片网格', !!findByClass(overlay, /(^|\s)grid(\s|$)/))
const cards = allByClass(overlay, /(^|\s)project-card(\s|$)/)
check('项目卡片数量 = 2', cards.length === 2, cards.length + ' 张')
check('网格里没有控制室大卡', !findByClass(overlay, /control-card/))
check('网格里有新建卡', !!findByClass(overlay, /add-card/))

/* ---------- 右击卡片也能改布局 ---------- */
rightClick(cards[0])
sidebar = renderComp(sidebarReg.Comp, { wide: true })
check('右击卡片同样弹菜单', !!findByClass(sidebar, /(^|\s)ctx-menu(\s|$)/))
check('卡片菜单含删除', textOf(sidebar).includes('删除项目'))
findButtonByLabel(sidebar, '三分式').props.onClick({ stopPropagation() {}, preventDefault() {} }) // 关菜单
sidebar = renderComp(sidebarReg.Comp, { wide: true })
overlay = renderComp(overlayReg.Comp, {})

/* ---------- 新建临时项目小窗（挂在侧边栏，不强制展开主区） ---------- */
overlay = renderComp(overlayReg.Comp, {})
findButtonByLabel(overlay, '＋ 新建临时项目').props.onClick({ stopPropagation() {}, preventDefault() {} })
sidebar = renderComp(sidebarReg.Comp, { wide: true })   // 小窗挂在侧边栏
const modalText = textOf(sidebar)
check('小窗标题「新建临时项目」', modalText.includes('新建临时项目') && modalText.includes('创建临时项目'), modalText.slice(0, 100))
check('小窗有布局选择', modalText.includes('界面布局') && modalText.includes('三分式') && modalText.includes('单栏'))
check('小窗显示 DSH 默认工作区', modalText.includes('默认工作区') && modalText.includes('default-workspace'), modalText.slice(0, 160))
const pathInput = collect(sidebar).find((n) => n.type === 'input' && n.props && n.props.className === 'mono')
check('路径输入默认填默认工作区', !!pathInput && String(pathInput.props.value).includes('default-workspace'), pathInput && pathInput.props.value)
check('小窗有名称与图标字段', modalText.includes('项目名称') && modalText.includes('项目图标'), modalText.slice(0, 120))
check('已删除语言标签字段', !modalText.includes('语言标签'))
check('图标提供 emoji 选项', allByClass(sidebar, /(^|\s)emoji(\s|$)/).length >= 8, allByClass(sidebar, /(^|\s)emoji(\s|$)/).length + ' 个')
check('布局选择带预览草图', allByClass(sidebar, /(^|\s)sketch(\s|$)/).length === 3, allByClass(sidebar, /(^|\s)sketch(\s|$)/).length + ' 张草图')
const sel = collect(sidebar).find((n) => n.type === 'select')
check('小窗有绑定对话下拉', !!sel)
check('下拉列出宿主对话', !!sel && collect(sel).filter((c) => c.type === 'option').length >= 4, sel ? String(collect(sel).filter((c) => c.type === 'option').length) : '0')
check('小窗是独立挂载（主区关着也能开）', !!findByClass(sidebar, /(^|\s)scrim(\s|$)/))
check('没有控制室统计卡', !findByClass(sidebar, /(^|\s)stats(\s|$)/) && !findByClass(overlay, /(^|\s)stats(\s|$)/))

/* ---------- 工作区会话 → 一键创建绑定项目 ---------- */
sidebar = renderComp(sidebarReg.Comp, { wide: true })
const beforeProjects = (JSON.parse(ls.get('wt.projects') || '[]')).length
const srows2 = allByClass(sidebar, /(^|\s)srow(\s|$)/)
srows2[1].props.onClick({ stopPropagation() {}, preventDefault() {} })   // s-beta（未绑定）
await new Promise((r) => setTimeout(r, 30))
const afterProjects = (JSON.parse(ls.get('wt.projects') || '[]')).length
check('点工作区会话直接创建项目', afterProjects === beforeProjects + 1, beforeProjects + ' → ' + afterProjects)
const bindingsNow = JSON.parse(ls.get('wt.bindings') || '{}')
check('新项目已绑定该会话', Object.values(bindingsNow).includes('s-beta'), JSON.stringify(bindingsNow))
overlay = renderComp(overlayReg.Comp, {})
check('创建后直接进入该项目', textOf(overlay).includes('beta 控制台'), textOf(overlay).slice(0, 80))

const failed = results.filter((r) => !r).length
console.log('\n' + (failed ? 'FAILED ' + failed : 'ALL PASS') + ' / ' + results.length)
process.exit(failed ? 1 : 0)
