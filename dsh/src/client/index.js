/**
 * trae-usage-worktable · client 侧 Cordis 插件（MVP）
 *
 * 由 DSH 浏览器运行时经 ModuleLoader 握手加载（见 build.mjs 的 banner/footer）。
 * 宿主以普通 require 提供 react / @deepseek-ai/* —— 保持 external，不打包。
 *
 * 座位布局（两个座位，一套 store）：
 *   sidebar.footer.action —— 顶部状态栏 + 临时项目列表 + 右击菜单 + 小窗 + toast（常驻挂载）
 *   shell.overlay         —— 主区：卡片网格 / 单个项目的分栏工作区（左项目 · 中主界面 · 右对话）
 *
 * 视觉基准：仓库根 workbench/index.html（单文件网页版）。配色、字号、间距、
 * 玻璃拟态与状态霓虹光全部照搬，只做两件必要的适配：
 *   1. 所有选择器收进 .wt-scope，避免污染宿主 DSH 的通用类名（.card/.btn/.grid…）；
 *   2. 侧边栏块改为「宽度 100%、高度自适应、列表内部滚动」，以便塞进 DSH 侧边栏底部。
 *
 * 关键契约（踩坑记录，勿改）：
 *   1. props.renderSlot 绑定到 entry 自己的 children 声明，必须传座位名调用；
 *      空参调用抛 SlotOwnershipError，会被 React 错误边界吞成空白。
 *   2. Register 成功 ≠ 渲染成功：渲染期异常必须有错误边界兜住并上报。
 *   3. 会话服务是可选的，必须用 ctx.inject(['sessions'], cb) 延迟接入。
 *   4. 会话跳转优先 uiWorkspace.openSession，其次 sessions.open —— 都没有就提示。
 *   5. 右击菜单 / 小窗 / toast 挂侧边栏，且侧边栏容器不能有 backdrop-filter / overflow:hidden，
 *      否则 fixed 定位的后代会被裁剪（真机踩过）。
 */
import { createElement, Component, useState, useEffect } from 'react'

const PANEL_ID = 'trae-usage-worktable'
const NS = 'worktable'
const OVERLAY_ID = PANEL_ID + '-main'
/** 独立命名空间：上游 dsh-worktable 占用 `/api/worktable/*`，避免抢注冲突 */
const API = '/api/trae-worktable'
const PLUGIN_VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__

/** 只硬依赖 slots；sessions 走 ctx.inject 延迟接入 */
export const inject = ['slots']

/* ============================ 常量 ============================ */

/** localStorage 统一 wt. 前缀（视觉与数据分离：网页版用 wt2.*，插件用 wt.*） */
const LS = {
  view: 'wt.view',
  projects: 'wt.projects',
  bindings: 'wt.bindings',
  status: 'wt.status',
  layouts: 'wt.layouts',
}

const STATES = {
  idle: { label: '待命', cls: 'idle' },
  working: { label: '进行中', cls: 'working' },
  'needs-you': { label: '待处理', cls: 'needs-you' },
  done: { label: '已完成', cls: 'done' },
}
const STATE_ORDER = ['idle', 'working', 'needs-you', 'done']

/** 项目界面布局（右击项目 → 界面布局）：对话区固定在右侧 */
const LAYOUTS = [
  { id: 'l3', label: '三分式', k: '项目 + 主界面 + 对话' },
  { id: 'l2', label: '两分', k: '主界面 + 对话' },
  { id: 'full', label: '单栏', k: '仅主界面' },
]
const LAYOUT_IDS = LAYOUTS.map((l) => l.id)
const DEFAULT_LAYOUT = 'l3'

/** 项目名称的 emoji 标签（第一项是「自动」，按类型/目录名推） */
const EMOJI_CHOICES = ['🧰', '📁', '🔌', '🐍', '🌐', '🖥️', '🎨', '📜', '🗄️', '🧩', '📚', '🛠️', '⚙️', '🚀']

const LANG_EMOJI = [
  [/^(c|c\+\+|cpp|h|hpp|rust|go|zig|asm)$/i, '🔌'],
  [/^(python|py)$/i, '🐍'],
  [/^(javascript|js|typescript|ts|tsx|jsx|vue|svelte|astro)$/i, '🌐'],
  [/^(java|kotlin|kt|swift|dart|cs|c#)$/i, '🖥️'],
  [/^(html|css|scss|less)$/i, '🎨'],
  [/^(shell|bash|zsh|powershell|ps1|bat|cmd)$/i, '📜'],
  [/^(sql)$/i, '🗄️'],
]
const CAT_EMOJI = { 嵌入式: '🔌', 上位机: '🖥️', 练习: '📚', 工具: '🛠️', 扩展: '🧩', 脚本: '📜', 前端: '🌐', 后端: '🗄️', 自定义: '📁' }

/* ============================ 小工具 ============================ */

/** createElement 包装：过滤 null/false、扁平化数组 */
function el(tag, props, ...children) {
  const kids = []
  const push = (c) => {
    if (c == null || c === false || c === true) return
    if (Array.isArray(c)) { c.forEach(push); return }
    kids.push(c)
  }
  children.forEach(push)
  return createElement(tag, props, kids.length ? kids : undefined)
}

function baseName(p) {
  if (typeof p !== 'string') return ''
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

function normPath(p) {
  return String(p ?? '').replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase()
}

function shortPath(p, max = 42) {
  const s = String(p ?? '')
  if (s.length <= max) return s
  return '…' + s.slice(s.length - max + 1)
}

function fmtSize(mb) {
  if (!Number.isFinite(mb) || mb <= 0) return '—'
  if (mb >= 1024) return (mb / 1024).toFixed(2) + ' GB'
  if (mb < 1) return (mb * 1024).toFixed(0) + ' KB'
  return mb.toFixed(1) + ' MB'
}

function relTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.round(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + ' 小时前'
  if (diff < 30 * 86_400_000) return Math.round(diff / 86_400_000) + ' 天前'
  return new Date(ts).toISOString().slice(0, 10)
}

function projEmoji(p) {
  if (p && typeof p.icon === 'string' && p.icon) return p.icon
  const langs = Array.isArray(p?.langs) ? p.langs : []
  for (const lang of langs) {
    for (const [re, emoji] of LANG_EMOJI) if (re.test(String(lang).trim())) return emoji
  }
  return CAT_EMOJI[p?.category] || '📁'
}

/** 项目状态：手工覆盖（wt.status）优先，其次跟随已绑定 DSH 对话的运行状态 */
function stOf(pid) {
  const manual = store.status[pid]
  if (STATES[manual]) return manual
  const bound = boundSession(pid)
  if (bound && STATES[bound.state]) return bound.state
  return 'idle'
}

/** 状态点来源：'bound' = 来自绑定对话，'manual' = 手工设置 */
function stateSourceOf(pid) {
  if (STATES[store.status[pid]]) return 'manual'
  const bound = boundSession(pid)
  return bound && STATES[bound.state] ? 'bound' : ''
}

function layoutOf(pid) {
  const layout = store.layouts[pid]
  return LAYOUT_IDS.includes(layout) ? layout : DEFAULT_LAYOUT
}

function layoutLabel(layout) {
  const hit = LAYOUTS.find((l) => l.id === layout)
  return hit ? hit.label : DEFAULT_LAYOUT
}

function lightNode(pid) {
  const s = stOf(pid)
  const src = stateSourceOf(pid)
  const hint = src === 'bound' ? '（跟随绑定对话）' : (src === 'manual' ? '（手工设置）' : '')
  return el('button', {
    type: 'button',
    className: 'light ' + s,
    title: STATES[s].label + hint + ' · 点击切换',
    'aria-label': '状态：' + STATES[s].label,
    onClick: (e) => { e.stopPropagation(); cycleStatus(pid) },
  })
}

/* ============================ 持久化 ============================ */

function readLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const val = JSON.parse(raw)
    return val == null ? fallback : val
  } catch {
    return fallback
  }
}

function writeLS(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 隐私模式/配额满时静默 */ }
}

/* ============================ 共享状态 ============================ */

const store = {
  view: 'projects',                  // projects（卡片网格）| project（项目内部·分栏）
  open: false,                       // 主区视图是否展开
  activeProjectId: null,
  projects: [],                      // 临时项目（localStorage: wt.projects）
  bindings: {},                      // { [projectId]: sessionId }（wt.bindings）
  status: {},                        // { [projectId]: 'idle'|'working'|'needs-you'|'done' }（wt.status，手工覆盖）
  layouts: {},                       // { [projectId]: 'l3'|'l2'|'full' }（wt.layouts）
  defaults: { workspace: '', home: '', loaded: false },
  sessions: { state: 'pending', counts: null, rows: [], updatedAt: 0, error: '', source: '' },
  transcript: { sessionId: '', state: 'idle', messages: [], title: '', error: '', truncated: false },
  modal: '',                         // '' | 'add' | 'bind'
  bindTarget: '',
  menu: null,                        // { pid, x, y } 右击菜单
  toasts: [],
}

const listeners = new Set()
let seq = 0

function emit(patch) {
  if (patch) Object.assign(store, patch)
  for (const fn of listeners) {
    try { fn() } catch { /* 单个订阅者异常不影响其他 */ }
  }
}

function useStore() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return store
}

function hydrate() {
  const view = readLS(LS.view, 'projects')
  const projects = readLS(LS.projects, [])
  const bindings = readLS(LS.bindings, {})
  const status = readLS(LS.status, {})
  const layouts = readLS(LS.layouts, {})
  emit({
    view: view === 'project' ? 'project' : 'projects',
    projects: Array.isArray(projects) ? projects : [],
    bindings: bindings && typeof bindings === 'object' ? bindings : {},
    status: status && typeof status === 'object' ? status : {},
    layouts: layouts && typeof layouts === 'object' ? layouts : {},
  })
}

/* ============================ toast ============================ */

function toast(text, kind) {
  const id = ++seq
  emit({ toasts: store.toasts.concat([{ id, text: String(text), kind: kind || 'info' }]) })
  setTimeout(() => {
    emit({ toasts: store.toasts.filter((t) => t.id !== id) })
  }, 3200)
}

/* ============================ 宿主会话 ============================ */

let hostCtx = null

async function loadSessions() {
  try {
    const res = await fetch(API + '/sessions', { headers: { accept: 'application/json' } })
    let data = null
    try { data = await res.json() } catch { data = null }
    if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
    const counts = data && data.counts ? data.counts : null
    emit({
      sessions: {
        state: data && data.ok === false ? 'error' : 'ok',
        counts,
        rows: Array.isArray(data?.sessions) ? data.sessions : [],
        updatedAt: Number(data?.at) || Date.now(),
        error: (data && data.error) || '',
        source: String(data?.source || ''),
      },
    })
  } catch (e) {
    emit({
      sessions: { state: 'error', counts: null, rows: [], updatedAt: Date.now(), error: String(e?.message ?? e), source: '' },
    })
  }
}

/** 跳转到宿主会话：新版 uiWorkspace.openSession → 旧版 sessions.open */
function jumpToSession(sessionId) {
  const id = String(sessionId || '')
  if (!id) return false
  try {
    const ui = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('uiWorkspace') : null
    if (ui && typeof ui.openSession === 'function') { ui.openSession(id); return true }
  } catch { /* 继续尝试下一种入口 */ }
  try {
    const sessions = hostCtx?.sessions
    if (sessions && typeof sessions.open === 'function') { sessions.open(id); return true }
  } catch { /* 无可用入口 */ }
  return false
}

function sessionsOf() {
  return store.sessions.rows
}

function sessionById(id) {
  return sessionsOf().find((s) => s.id === id) || null
}

function boundSession(pid) {
  const id = store.bindings[pid]
  if (!id) return null
  return sessionById(id) || { id, title: String(id).slice(0, 18), state: 'unknown', cwd: '' }
}

/** 默认路径：DSH 宿主当前工作区（host 端取最近活跃会话的 cwd）+ DSH_HOME */
async function loadDefaults() {
  try {
    const res = await fetch(API + '/defaults', { headers: { accept: 'application/json' } })
    const data = await res.json().catch(() => null)
    emit({
      defaults: {
        workspace: String(data?.workspace || ''),
        home: String(data?.home || ''),
        loaded: true,
      },
    })
  } catch {
    emit({ defaults: { workspace: '', home: '', loaded: true } })
  }
}

/** 读绑定对话的最近消息（只读，host 侧扫事件日志，不调模型） */
async function loadTranscript(sessionId) {
  const id = String(sessionId || '')
  if (!id) {
    emit({ transcript: { sessionId: '', state: 'idle', messages: [], title: '', error: '', truncated: false } })
    return
  }
  emit({ transcript: { sessionId: id, state: 'loading', messages: [], title: '', error: '', truncated: false } })
  try {
    const res = await fetch(API + '/transcript', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: id, limit: 40 }),
    })
    const data = await res.json().catch(() => null)
    if (!res.ok || !data) throw new Error((data && data.error) || ('HTTP ' + res.status))
    emit({
      transcript: {
        sessionId: id,
        state: 'ok',
        messages: Array.isArray(data.messages) ? data.messages : [],
        title: String(data.title || ''),
        error: '',
        truncated: !!data.truncated,
      },
    })
  } catch (e) {
    emit({
      transcript: { sessionId: id, state: 'error', messages: [], title: '', error: String(e?.message ?? e), truncated: false },
    })
  }
}

/* ============================ 动作 ============================ */

/** 回到卡片网格（全部临时项目） */
function openGrid() {
  emit({ open: true, view: 'projects', activeProjectId: null, modal: '', menu: null })
  writeLS(LS.view, 'projects')
  loadSessions()
  loadDefaults()
}

/** 进入临时项目内部：布局由 wt.layouts 决定，对话区固定在右侧 */
function enterProject(pid) {
  emit({ open: true, view: 'project', activeProjectId: pid, modal: '', menu: null })
  writeLS(LS.view, 'project')
  loadSessions()
  loadTranscript(store.bindings[pid])
}

function closeOverlay() {
  emit({ open: false, modal: '', bindTarget: '', menu: null })
}

/** 右击项目框：打开上下文菜单 */
function openMenu(pid, x, y) {
  emit({ menu: { pid, x, y } })
}

function closeMenu() {
  if (store.menu) emit({ menu: null })
}

function setLayout(pid, layout) {
  if (!LAYOUT_IDS.includes(layout)) return
  const layouts = { ...store.layouts, [pid]: layout }
  emit({ layouts, menu: null })
  writeLS(LS.layouts, layouts)
  toast('界面布局：' + layoutLabel(layout), 'ok')
}

function cycleStatus(pid) {
  const cur = stOf(pid)
  const next = STATE_ORDER[(STATE_ORDER.indexOf(cur) + 1) % STATE_ORDER.length]
  const status = { ...store.status, [pid]: next }
  emit({ status })
  writeLS(LS.status, status)
}

function openAddModal() {
  emit({ modal: 'add', menu: null })
  if (!store.defaults.loaded) loadDefaults()
}

function closeModal() {
  emit({ modal: '', bindTarget: '' })
}

function addProject({ name, path, emoji, layout, sessionId }) {
  const cleanName = String(name || '').trim()
  if (!cleanName) { toast('请填写项目名称', 'warn'); return '' }
  const pid = 'custom-' + Date.now()
  const rec = {
    id: pid,
    name: cleanName,
    alias: cleanName,
    icon: String(emoji || ''),
    path: String(path || '').trim() || store.defaults.workspace || '（未填写路径）',
    category: '自定义',
    sizeMB: 0,
    git: false,
    updated: new Date().toISOString().slice(0, 10),
    files: 0,
    custom: true,
  }
  const projects = store.projects.concat([rec])
  const layouts = { ...store.layouts, [pid]: LAYOUT_IDS.includes(layout) ? layout : DEFAULT_LAYOUT }
  const bindings = sessionId ? { ...store.bindings, [pid]: String(sessionId) } : store.bindings
  emit({ projects, layouts, bindings, modal: '' })
  writeLS(LS.projects, projects)
  writeLS(LS.layouts, layouts)
  if (sessionId) writeLS(LS.bindings, bindings)
  toast('已创建临时项目 ' + cleanName, 'ok')
  return pid
}

/** 工作区会话 → 一键建成「已绑定的临时项目」（已绑过的直接进去） */
function createFromSession(session) {
  const sid = String(session?.id || '')
  if (!sid) return
  const existing = store.projects.find((p) => store.bindings[p.id] === sid)
  if (existing) {
    toast('该对话已绑定项目：' + (existing.alias || existing.name), 'info')
    enterProject(existing.id)
    return
  }
  const title = String(session?.title || '').trim() || baseName(session?.cwd || '') || '未命名对话'
  const pid = addProject({
    name: title.slice(0, 40),
    path: session?.cwd || '',
    emoji: '',
    layout: DEFAULT_LAYOUT,
    sessionId: sid,
  })
  if (pid) enterProject(pid)
}

function removeProject(pid) {
  const projects = store.projects.filter((p) => p.id !== pid)
  const bindings = { ...store.bindings }
  delete bindings[pid]
  const status = { ...store.status }
  delete status[pid]
  const layouts = { ...store.layouts }
  delete layouts[pid]
  const active = store.activeProjectId === pid
  emit({
    projects, bindings, status, layouts, menu: null,
    ...(active ? { activeProjectId: null, view: 'projects' } : {}),
    ...(active ? { transcript: { sessionId: '', state: 'idle', messages: [], title: '', error: '', truncated: false } } : {}),
  })
  writeLS(LS.projects, projects)
  writeLS(LS.bindings, bindings)
  writeLS(LS.status, status)
  writeLS(LS.layouts, layouts)
  toast('已移除临时项目（磁盘文件未动）', 'info')
}

function openBindModal(pid) {
  emit({ modal: 'bind', bindTarget: pid, menu: null })
  loadSessions()
  loadDefaults()
}

function bindSession(pid, sessionId) {
  const bindings = { ...store.bindings, [pid]: sessionId }
  emit({ bindings, modal: '', bindTarget: '' })
  writeLS(LS.bindings, bindings)
  if (store.activeProjectId === pid) loadTranscript(sessionId)
  const s = sessionById(sessionId)
  toast('已绑定 DSH 对话：' + (s ? s.title : sessionId), 'ok')
}

function unbindSession(pid) {
  const bindings = { ...store.bindings }
  delete bindings[pid]
  emit({ bindings, menu: null })
  writeLS(LS.bindings, bindings)
  if (store.activeProjectId === pid) loadTranscript('')
  toast('已解除绑定', 'info')
}

/** 从项目内部回到卡片网格 */
function leaveProject() {
  openGrid()
}

/** 打开临时项目绑定的 DSH 对话 */
function openBoundSession(pid) {
  const bound = boundSession(pid)
  if (!bound) {
    toast('这个临时项目还没有绑定 DSH 对话', 'warn')
    return
  }
  const ok = jumpToSession(bound.id)
  if (!ok) toast('宿主没有暴露会话跳转入口，请在 DSH 侧边栏打开该对话', 'warn')
  else closeOverlay()
}

/* ============================ 插件入口 ============================ */

export function apply(ctx) {
  hostCtx = ctx

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-dsh-plugin', PANEL_ID)
    style.textContent = CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'trae-usage-worktable: styles')

  hydrate()

  /* 侧边栏整条工作台（状态栏 / 临时项目列表） */
  try {
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action',
      id: PANEL_ID,
      order: 20,
    }, SidebarBoundary), 'trae-usage-worktable: worktable sidebar')
  } catch (e) {
    console.warn('[worktable] sidebar.footer.action 注入失败', e)
  }

  /* 主区视图（卡片网格 / 项目内部三分式分栏） */
  try {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay',
      id: OVERLAY_ID,
      order: 100,
    }, OverlayBoundary), 'trae-usage-worktable: main view')
  } catch (e) {
    console.warn('[worktable] shell.overlay 注入失败', e)
  }

  /* 会话服务：延迟接入，缺席不影响侧边栏自身渲染 */
  try {
    ctx.inject(['sessions'], () => { loadSessions() })
  } catch { /* 无会话服务的 profile 直接跳过 */ }

  loadSessions()
  loadDefaults()
}

/* ============================ 错误边界 ============================ */

class SidebarBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err: String(err?.message ?? err) } }
  render() {
    if (this.state.err) {
      return el('div', { className: 'wt-scope wt-side', 'data-ns': NS },
        el('div', { className: 'brand' },
          el('div', { className: 'brand-mark' }, '🧰'),
          el('div', null,
            el('div', { className: 'brand-name' }, '工作台'),
            el('div', { className: 'brand-sub' }, '渲染失败'),
          ),
        ),
        el('p', { className: 'wt-error' }, this.state.err),
      )
    }
    return el(WorktableSidebar, this.props)
  }
}

class OverlayBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err: String(err?.message ?? err) } }
  render() {
    if (this.state.err) {
      if (!store.open) return null
      return el('div', { className: 'wt-scope wt-overlay', 'data-ns': NS },
        el('div', { className: 'wt-shell' },
          el('header', { className: 'topbar' },
            el('div', null,
              el('div', { className: 'tb-title' }, el('h1', null, '工作台'), el('span', { className: 'eyebrow' }, 'ERROR')),
            ),
            el('div', { className: 'tb-actions' },
              el('button', { type: 'button', className: 'btn', onClick: closeOverlay }, '关闭'),
            ),
          ),
          el('p', { className: 'wt-error wt-pad' }, this.state.err),
        ),
      )
    }
    return el(MainView, this.props)
  }
}

/* ============================ 侧边栏：整条工作台 ============================ */

function WorktableSidebar() {
  useStore()
  const projects = store.projects
  const counts = store.sessions.counts || { running: 0, waiting: 0, done: 0, idle: 0, total: 0 }
  const running = counts.running || 0
  const total = projects.length
  const sessions = store.sessions.rows

  return el('div', { className: 'wt-scope wt-side', 'data-ns': NS, 'data-wide': '1' },
    /* 顶部：标题 + 工具 */
    el('div', { className: 'brand' },
      el('div', { className: 'brand-mark', 'aria-hidden': 'true' }, '🧰'),
      el('div', null,
        el('div', { className: 'brand-name' }, '工作台'),
        el('div', { className: 'brand-sub' }, 'Workbench'),
      ),
      el('div', { className: 'brand-tools' },
        el('button', { type: 'button', title: '刷新会话统计', 'aria-label': '刷新会话统计', onClick: () => loadSessions() },
          el('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round' },
            el('path', { d: 'M20.4 12a8.4 8.4 0 1 1-2.46-5.94' }),
            el('path', { d: 'M20.6 4.2v4.6h-4.6' }),
          ),
        ),
        el('button', { type: 'button', title: '新建临时项目', 'aria-label': '新建临时项目', onClick: openAddModal },
          el('svg', { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round' },
            el('path', { d: 'M12 5v14M5 12h14' }),
          ),
        ),
      ),
    ),

    /* 顶部状态栏（原底部统计盒上移：进行中 / 待处理 / 会话快照 / 对话） */
    el('div', { className: 'stat-box' },
      el('div', { className: 'fb-row' }, el('span', null, '进行中'), el('b', null, String(running) + ' / ' + String(total))),
      el('div', { className: 'fb-row' }, el('span', null, '待处理'), el('b', null, String(counts.waiting || 0))),
      el('div', { className: 'fb-row' }, el('span', null, '会话快照'), el('b', null,
        store.sessions.state === 'ok'
          ? (store.sessions.updatedAt ? relTime(store.sessions.updatedAt) : '—')
          : (store.sessions.state === 'pending' ? '读取中…' : '不可用'),
      )),
      el('div', { className: 'fb-row' }, el('span', null, 'DSH 对话'), el('b', null, String(counts.total || 0))),
    ),

    /* 临时项目：列表本身就是导航（点进去看内部） */
    el('div', { className: 'side-projects' },
      el('div', { className: 'nav-label' },
        el('span', null, '临时项目', el('span', { className: 'mono', style: { marginLeft: '6px' } }, String(total))),
        el('span', { className: 'nl-tools' },
          el('button', { type: 'button', className: 'nl-btn', title: '新建临时项目', onClick: openAddModal }, '添加'),
        ),
      ),
      el('div', { className: 'plist' },
        projects.length
          ? projects.map((p) => {
            const bound = boundSession(p.id)
            return el('div', {
              key: p.id,
              className: 'pitem' + (store.activeProjectId === p.id && store.open ? ' active' : ''),
              title: p.path + (bound ? '\n对话：' + (bound.title || bound.id) : '\n未绑定 DSH 对话'),
              role: 'button',
              tabIndex: 0,
              onClick: () => enterProject(p.id),
              onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(p.id, e.clientX, e.clientY) },
            },
              el('span', { className: 'pi-ico', 'aria-hidden': 'true' }, projEmoji(p)),
              el('span', { className: 'pi-name' }, p.alias || p.name),
              bound ? el('span', { className: 'pi-bind', title: '已绑定 DSH 对话：' + (bound.title || bound.id) }, '🔗') : null,
              lightNode(p.id),
              el('svg', { className: 'pi-arrow', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '2.2', strokeLinecap: 'round', strokeLinejoin: 'round' },
                el('path', { d: 'm9 6 6 6-6 6' }),
              ),
            )
          })
          : el('p', { className: 'wt-mute' }, store.sessions.state === 'pending' ? '正在读取会话…' : '还没有临时项目，点「添加」开始'),
      ),
    ),

    /* 工作区会话：点一下即把这条会话建成「已绑定的临时项目」 */
    el('div', { className: 'side-sessions' },
      el('div', { className: 'nav-label' },
        el('span', null, '工作区会话'),
        el('span', { className: 'mono' }, String(sessions.length)),
      ),
      el('div', { className: 'slist' },
        sessions.length
          ? sessions.slice(0, 30).map((session) => {
            const boundProject = projects.find((p) => store.bindings[p.id] === session.id)
            return el('div', {
              key: session.id,
              className: 'srow' + (boundProject ? ' bound' : ''),
              role: 'button',
              tabIndex: 0,
              title: (session.cwd || '') + '\n' + (boundProject ? '已绑定项目：' + (boundProject.alias || boundProject.name) : '点击创建绑定该对话的项目'),
              onClick: () => createFromSession(session),
            },
              el('span', { className: 'light ' + (STATES[session.state] ? session.state : 'idle'), 'aria-hidden': 'true' }),
              el('span', { className: 'srow-main' },
                el('span', { className: 'srow-title' }, session.title || session.id),
                el('span', { className: 'srow-sub' }, shortPath(session.cwd || '', 24)),
              ),
              el('span', { className: 'srow-add', 'aria-hidden': 'true' }, boundProject ? '›' : '＋'),
            )
          })
          : el('p', { className: 'wt-mute' }, store.sessions.state === 'pending' ? '正在读取会话…' : '宿主暂无会话'),
      ),
    ),

    /* 底部提示：右击项目可设布局 / 绑定 / 删除 */
    el('p', { className: 'side-tip' }, '右击项目：布局 · 对话绑定 · 删除'),

    /* 右击菜单 / 小窗 / toast 都挂在侧边栏（常驻挂载）：fixed 定位，主区开没开都能用，
       这样「新建临时项目」不必先把整块主区铺开。 */
    el(ContextMenu),
    store.modal === 'add' ? el(AddProjectModal) : null,
    store.modal === 'bind' ? el(BindSessionModal, { pid: store.bindTarget }) : null,
    el(Toasts),
  )
}

/* ============================ 主区视图 ============================ */

function MainView() {
  useStore()
  const open = store.open

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (store.menu) { closeMenu(); return }
      if (store.modal) { closeModal(); return }
      closeOverlay()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  useEffect(() => {
    if (!open) return undefined
    const timer = setInterval(() => { loadSessions() }, 20_000)
    return () => clearInterval(timer)
  }, [open])

  if (!open) return null

  const active = store.projects.find((p) => p.id === store.activeProjectId) || null

  return el('div', { className: 'wt-scope wt-overlay', 'data-ns': NS, role: 'dialog', 'aria-label': '工作台' },
    el('div', { className: 'wt-bg', 'aria-hidden': 'true' },
      el('i', { className: 'wt-blob wt-b1' }),
      el('i', { className: 'wt-blob wt-b2' }),
      el('i', { className: 'wt-blob wt-b3' }),
      el('i', { className: 'wt-blob wt-b4' }),
    ),
    el('div', { className: 'wt-shell' },
      el(Topbar, { active }),
      active ? el(ProjectView, { project: active }) : el(GridView),
    ),
  )
}

function Topbar({ active }) {
  const counts = store.sessions.counts || {}
  const sub = active
    ? (String(active.path || '') + ' · ' + layoutLabel(layoutOf(active.id)))
    : ('临时项目 ' + store.projects.length + ' 个 · 已绑定对话 ' + Object.keys(store.bindings).length + ' 个 · 宿主会话 ' + (counts.total || 0) + ' 个')

  return el('header', { className: 'topbar' },
    el('div', null,
      el('div', { className: 'tb-title' },
        el('h1', null, active ? (active.alias || active.name) : '临时项目'),
        el('span', { className: 'eyebrow' }, active ? 'Workspace' : 'Projects'),
      ),
      el('p', { className: 'tb-sub', title: sub }, sub),
    ),
    el('div', { className: 'tb-actions' },
      active ? el('button', { type: 'button', className: 'btn', onClick: leaveProject }, '← 全部项目') : null,
      el('button', { type: 'button', className: 'btn', onClick: () => { loadSessions(); toast('已刷新会话快照', 'info') } }, '刷新'),
      el('button', { type: 'button', className: 'btn primary', onClick: openAddModal }, '＋ 新建临时项目'),
      el('button', { type: 'button', className: 'btn ico', title: '关闭 (Esc)', onClick: closeOverlay }, '✕'),
    ),
  )
}

/* ---------- 视图一：卡片网格 ---------- */

function GridView() {
  const projects = store.projects
  const counts = store.sessions.counts || {}

  return el('section', { className: 'view active' },
    el('div', { className: 'grid' },
      projects.map((p) => el(ProjectCard, { key: p.id, project: p })),
      el(AddCard),
      projects.length ? null : el('div', { className: 'empty' }, '还没有临时项目，点「新建临时项目」加入工作台'),
    ),
    el('p', { className: 'grid-note' },
      '会话快照 ' + (store.sessions.updatedAt ? relTime(store.sessions.updatedAt) : '—') +
      ' · 运行中 ' + (counts.running || 0) + ' · 待处理 ' + (counts.waiting || 0) +
      ' · 右击侧边栏项目可设置布局 / 绑定 / 删除'),
  )
}

function ProjectCard({ project }) {
  const st = stOf(project.id)
  const cls = 'card project-card' +
    (st === 'working' ? ' busy' : '') +
    (st === 'done' ? ' glow-done' : '') +
    (st === 'needs-you' ? ' glow-needs' : '')
  const bound = boundSession(project.id)
  const meta = bound ? (bound.title || '') : relTime(Date.parse(String(project.updated || '').slice(0, 10) + 'T00:00:00'))

  return el('article', {
    className: cls,
    tabIndex: 0,
    title: project.alias + ' · ' + project.path + ' · 点击进入项目',
    onClick: () => enterProject(project.id),
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(project.id, e.clientX, e.clientY) },
  },
    st === 'working' ? el('span', { className: 'wt-sweep', 'aria-hidden': 'true' }) : null,
    el('div', { className: 'c-head' },
      el('span', { className: 'c-ico', 'aria-hidden': 'true' }, projEmoji(project)),
      el('span', { className: 'c-name' }, project.alias || project.name),
      lightNode(project.id),
    ),
    el('div', { className: 'c-div' }),
    el('div', { className: 'c-srow' },
      el('span', { className: 'c-status ' + st }, STATES[st].label),
      meta ? el('span', { className: 'c-meta', title: meta }, String(meta).slice(0, 20)) : null,
    ),
    el('div', { className: 'c-preview' }, shortPath(project.path, 34)),
    el('div', { className: 'c-actions' },
      el('span', { className: 'c-layout' }, layoutLabel(layoutOf(project.id))),
      el('button', {
        type: 'button',
        className: 'mini-btn' + (bound ? ' on' : ''),
        title: '绑定一个 DSH 对话',
        onClick: (e) => { e.stopPropagation(); openBindModal(project.id) },
      }, bound ? '改绑对话' : '绑定对话'),
    ),
  )
}

function AddCard() {
  return el('article', {
    className: 'card add-card',
    role: 'button',
    tabIndex: 0,
    title: '新建临时项目',
    onClick: openAddModal,
  },
    el('span', { className: 'add-plus', 'aria-hidden': 'true' }, '＋'),
    el('span', { className: 'add-label' }, '新建临时项目'),
  )
}

/* ---------- 视图二：项目内部（分栏工作区） ---------- */

function ProjectView({ project }) {
  const layout = layoutOf(project.id)
  const bound = boundSession(project.id)
  const st = stOf(project.id)
  const t = store.transcript
  const showLeft = layout === 'l3'
  const showChat = layout !== 'full'
  const sameSession = bound && t.sessionId === bound.id

  useEffect(() => {
    const id = store.bindings[project.id]
    if (id && store.transcript.sessionId !== id) loadTranscript(id)
    if (!id && store.transcript.sessionId) loadTranscript('')
  }, [project.id, store.bindings[project.id]])

  return el('section', { className: 'view active' },
    /* 布局切换条 */
    el('div', { className: 'detail-bar' },
      el('div', { className: 'detail-crumb' },
        el('span', { className: 'c-ico', 'aria-hidden': 'true', style: { fontSize: '18px' } }, projEmoji(project)),
        el('b', null, project.alias || project.name),
        el('span', { className: 'p', title: project.path }, shortPath(project.path, 48)),
        el('span', { className: 'tag gold' }, STATES[st].label),
      ),
      el('div', { className: 'seg', title: '界面布局（也可右击侧边栏项目切换）' },
        LAYOUTS.map((l) => el('button', {
          key: l.id,
          type: 'button',
          className: l.id === layout ? 'on' : '',
          title: l.k,
          onClick: () => setLayout(project.id, l.id),
        }, l.label)),
      ),
    ),

    el('div', { className: 'ws', 'data-layout': layout },
      /* 左：项目信息 */
      showLeft
        ? el('aside', { className: 'pane pane-left' },
          el('div', { className: 'pane-head' },
            el('span', { className: 'kind-chip' }, el('i', null, '▤'), '项目'),
            lightNode(project.id),
          ),
          el('div', { className: 'pane-body' },
            el('div', { className: 'dc-row' }, el('span', { className: 'k' }, '路径'), el('span', { className: 'v', title: project.path }, shortPath(project.path, 40))),
            el('div', { className: 'dc-row' }, el('span', { className: 'k' }, '图标'), el('span', { className: 'v' }, projEmoji(project))),
            el('div', { className: 'dc-row' }, el('span', { className: 'k' }, '状态'), el('span', { className: 'v' }, STATES[st].label)),
            el('div', { className: 'dc-row' }, el('span', { className: 'k' }, '创建'), el('span', { className: 'v' }, String(project.updated || '—'))),
            el('div', { className: 'dc-actions' },
              el('button', { type: 'button', className: 'btn small', onClick: () => cycleStatus(project.id) }, '切换状态'),
              el('button', { type: 'button', className: 'btn small danger', onClick: () => removeProject(project.id) }, '删除项目'),
            ),
            el('p', { className: 'dc-empty' }, '左栏 P2 会换成项目文件树 / 任务清单；现在先放项目元信息。'),
          ),
        )
        : null,

      /* 中：主界面（先留空） */
      el('main', { className: 'pane pane-main' },
        el('div', { className: 'pane-head' },
          el('span', { className: 'kind-chip' }, el('i', null, '◫'), '主界面'),
          el('span', { className: 'pane-hint' }, 'P2：文件树 / 终端 / 浏览器'),
        ),
        el('div', { className: 'pane-body' },
          el('div', { className: 'pane-empty' },
            el('span', { className: 'pe-ico', 'aria-hidden': 'true' }, '◫'),
            el('p', null, '主界面先留空'),
            el('p', { className: 'hint' }, '这里之后会挂项目工作区（文件树 / 终端 / 浏览器），当前版本只做项目与对话的骨架。'),
          ),
        ),
      ),

      /* 右：绑定的对话 */
      showChat
        ? el('aside', { className: 'pane pane-chat' },
          el('div', { className: 'pane-head' },
            el('span', { className: 'kind-chip' }, el('i', null, '✦'), '对话'),
            el('span', { className: 'pane-title-text', title: bound ? (bound.title || bound.id) : '' }, bound ? (bound.title || String(bound.id).slice(0, 14)) : '未绑定'),
            bound ? el('span', { className: 'pane-tools' },
              el('button', { type: 'button', className: 'mini-btn', title: '在宿主中打开该对话', onClick: () => openBoundSession(project.id) }, '打开'),
            ) : null,
          ),
          el('div', { className: 'pane-body chat-body' },
            !bound
              ? el('div', { className: 'chat-empty' },
                el('p', null, '这个项目还没有绑定 DSH 对话。'),
                el('button', { type: 'button', className: 'btn small primary', onClick: () => openBindModal(project.id) }, '绑定 DSH 对话'),
              )
              : null,
            bound && t.state === 'loading' && !sameSession
              ? el('div', { className: 'chat-empty' }, el('p', null, '正在读取对话…'))
              : null,
            bound && t.state === 'error'
              ? el('div', { className: 'chat-empty' },
                el('p', null, '读取对话失败：' + (t.error || '未知原因')),
                el('button', { type: 'button', className: 'btn small', onClick: () => loadTranscript(bound.id) }, '重试'),
              )
              : null,
            bound && sameSession && t.state === 'ok'
              ? el('div', { className: 'chat-list' },
                t.truncated ? el('div', { className: 'chat-more' }, '仅显示最近 ' + t.messages.length + ' 条') : null,
                t.messages.length
                  ? t.messages.map((m) => el('div', { key: m.id, className: 'msg ' + (m.role === 'user' ? 'me' : 'ai') },
                    el('div', { className: 'msg-role' }, m.role === 'user' ? '你' : '助手', m.time ? el('span', { className: 'msg-time' }, relTime(m.time)) : null),
                    el('div', { className: 'msg-text' }, m.text),
                  ))
                  : el('div', { className: 'chat-empty' }, el('p', null, '这段对话还没有可显示的消息')),
              )
              : null,
            bound
              ? el('div', { className: 'chat-foot' },
                el('button', { type: 'button', className: 'btn small', onClick: () => openBindModal(project.id) }, '改绑'),
                el('button', { type: 'button', className: 'btn small danger', onClick: () => unbindSession(project.id) }, '解绑'),
                el('span', { className: 'chat-note' }, '只读预览 · 输入请点「打开」回宿主'),
              )
              : null,
          ),
        )
        : null,
    ),
  )
}

/* ---------- 右击菜单 ---------- */

function ContextMenu() {
  useStore()
  const menu = store.menu

  useEffect(() => {
    if (!menu) return undefined
    const onDown = (e) => {
      const target = e && e.target
      if (target && typeof target.closest === 'function' && target.closest('.ctx-menu')) return
      closeMenu()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [menu])

  if (!menu) return null
  const project = store.projects.find((p) => p.id === menu.pid)
  if (!project) return null

  const bound = boundSession(menu.pid)
  const layout = layoutOf(menu.pid)
  const winW = (typeof window !== 'undefined' && window.innerWidth) || 1200
  const winH = (typeof window !== 'undefined' && window.innerHeight) || 800
  const x = Math.max(8, Math.min(menu.x, winW - 250))
  const y = Math.max(8, Math.min(menu.y, winH - 330))

  return el('div', {
    className: 'ctx-menu',
    role: 'menu',
    style: { left: x + 'px', top: y + 'px' },
    onClick: (e) => e.stopPropagation(),
    onContextMenu: (e) => e.preventDefault(),
  },
    el('div', { className: 'ctx-head', title: project.path }, project.alias || project.name),
    el('div', { className: 'ctx-label' }, '界面布局'),
    LAYOUTS.map((l) => el('button', {
      key: l.id,
      type: 'button',
      className: 'ctx-item' + (l.id === layout ? ' on' : ''),
      onClick: () => setLayout(menu.pid, l.id),
    },
      el('span', { className: 'ctx-name' }, l.label),
      el('small', null, l.k),
      l.id === layout ? el('b', { className: 'ctx-check' }, '✓') : null,
    )),
    el('div', { className: 'ctx-sep' }),
    el('button', {
      type: 'button',
      className: 'ctx-item',
      onClick: () => openBindModal(menu.pid),
    }, bound ? '改绑 DSH 对话' : '绑定 DSH 对话'),
    bound
      ? el('button', {
        type: 'button', className: 'ctx-item',
        onClick: () => { unbindSession(menu.pid); closeMenu() },
      }, '解除对话绑定')
      : null,
    el('div', { className: 'ctx-sep' }),
    el('button', {
      type: 'button', className: 'ctx-item danger',
      onClick: () => removeProject(menu.pid),
    }, '删除项目'),
  )
}

/* ============================ 弹窗 ============================ */

function LayoutSketch({ layout }) {
  const panes = layout === 'l3' ? 3 : (layout === 'l2' ? 2 : 1)
  return el('span', { className: 'sketch', 'data-layout': layout, 'aria-hidden': 'true' },
    Array.from({ length: panes }, (_, i) => el('i', { key: i })),
  )
}

function AddProjectModal() {
  useStore()
  const defaults = store.defaults
  const [name, setName] = useState('')
  const [path, setPath] = useState(defaults.workspace || '')
  const [emoji, setEmoji] = useState('')
  const [layout, setLayoutState] = useState(DEFAULT_LAYOUT)
  const [sessionId, setSessionId] = useState('')
  const rows = sessionsOf()

  const submit = () => {
    const pid = addProject({ name, path, emoji, layout, sessionId })
    if (pid) { setName(''); setPath(''); setEmoji(''); setSessionId('') }
  }

  const onKey = (e) => { if (e.key === 'Enter') submit() }

  return el('div', { className: 'scrim', onClick: (e) => { if (e.target === e.currentTarget) closeModal() } },
    el('div', { className: 'modal add-modal', role: 'dialog', 'aria-modal': 'true' },
      el('h3', null, '新建临时项目'),
      el('p', null, '只写入本机浏览器 localStorage（wt.projects），不动磁盘文件。'),

      el('div', { className: 'field' },
        el('label', null, '项目名称'),
        el('input', { value: name, placeholder: '例如：智能小车固件', autoComplete: 'off', onChange: (e) => setName(e.target.value), onKeyDown: onKey }),
      ),

      el('div', { className: 'field' },
        el('label', null, '项目图标'),
        el('div', { className: 'emoji-row' },
          el('button', {
            type: 'button', className: 'emoji' + (emoji === '' ? ' on' : ''), title: '按目录名 / 分类自动', 'aria-label': '自动',
            onClick: (e) => { e.preventDefault(); setEmoji('') },
          }, '自动'),
          EMOJI_CHOICES.map((choice) => el('button', {
            key: choice,
            type: 'button',
            className: 'emoji' + (emoji === choice ? ' on' : ''),
            'aria-label': choice,
            onClick: (e) => { e.preventDefault(); setEmoji(choice) },
          }, choice)),
        ),
      ),

      el('div', { className: 'field' },
        el('label', null, '目录路径', defaults.loaded && defaults.workspace
          ? el('button', {
            type: 'button', className: 'field-reset', title: '用 DSH 默认工作区',
            onClick: (e) => { e.preventDefault(); setPath(defaults.workspace) },
          }, '默认工作区')
          : null),
        el('input', {
          className: 'mono', value: path,
          placeholder: defaults.loaded ? (defaults.workspace || 'C:\\projects\\smart-car') : '正在读取 DSH 默认工作区…',
          autoComplete: 'off', onChange: (e) => setPath(e.target.value), onKeyDown: onKey,
        }),
        el('div', { className: 'field-hint' }, defaults.workspace ? ('DSH 默认工作区：' + shortPath(defaults.workspace, 44)) : '未取到默认工作区，可手填绝对路径'),
      ),

      el('div', { className: 'field' },
        el('label', null, '界面布局（预览）'),
        el('div', { className: 'layout-row' },
          LAYOUTS.map((item) => el('button', {
            key: item.id,
            type: 'button',
            className: 'layout-card' + (item.id === layout ? ' on' : ''),
            title: item.k,
            onClick: (e) => { e.preventDefault(); setLayoutState(item.id) },
          },
            el(LayoutSketch, { layout: item.id }),
            el('span', { className: 'lc-label' }, item.label),
            el('small', { className: 'lc-k' }, item.k),
          )),
        ),
      ),

      el('div', { className: 'field' },
        el('label', null, '绑定 DSH 对话'),
        el('select', {
          className: 'wt-select',
          value: sessionId,
          onChange: (e) => setSessionId(e.target.value),
        },
          el('option', { value: '' }, '不绑定（稍后可右击绑定）'),
          rows.slice(0, 40).map((session) => el('option', { key: session.id, value: session.id },
            (session.title || session.id) + ' · ' + (STATES[session.state] ? STATES[session.state].label : '未知'),
          )),
        ),
        el('div', { className: 'field-hint' }, rows.length
          ? ('共 ' + rows.length + ' 个宿主对话可选，选中即建立绑定')
          : (store.sessions.state === 'pending' ? '正在读取宿主对话…' : '宿主暂无对话，可稍后右击项目绑定')),
      ),

      el('div', { className: 'modal-foot' },
        el('button', { type: 'button', className: 'btn', onClick: closeModal }, '取消'),
        el('button', { type: 'button', className: 'btn primary', onClick: submit }, '创建临时项目'),
      ),
    ),
  )
}
function BindSessionModal({ pid }) {
  useStore()
  const project = store.projects.find((p) => p.id === pid) || null
  const rows = sessionsOf()
  const current = store.bindings[pid] || ''
  const state = store.sessions.state

  return el('div', { className: 'scrim', onClick: (e) => { if (e.target === e.currentTarget) closeModal() } },
    el('div', { className: 'modal wide', role: 'dialog', 'aria-modal': 'true' },
      el('h3', null, '绑定 DSH 对话'),
      el('p', null, (project ? project.alias || project.name : '临时项目') + ' · 从宿主对话列表里选一个绑定（存 wt.bindings）'),
      state === 'error'
        ? el('div', { className: 'modal-note err' }, '读取会话失败：' + (store.sessions.error || '未知原因'))
        : null,
      state === 'pending' ? el('div', { className: 'modal-note' }, '正在读取会话…') : null,
      el('div', { className: 'session-list' },
        rows.length
          ? rows.slice(0, 60).map((s) => el('button', {
            key: s.id,
            type: 'button',
            className: 'session-row' + (s.id === current ? ' active' : ''),
            onClick: () => bindSession(pid, s.id),
          },
            el('span', { className: 'light ' + (STATES[s.state] ? s.state : 'idle'), 'aria-hidden': 'true' }),
            el('span', { className: 'sr-main' },
              el('span', { className: 'sr-title' }, s.title || s.id),
              el('span', { className: 'sr-sub' }, shortPath(s.cwd || s.id, 46)),
            ),
            el('span', { className: 'tag' }, STATES[s.state] ? STATES[s.state].label : '未知'),
          ))
          : el('div', { className: 'empty' }, state === 'pending' ? '读取中…' : '宿主没有返回任何会话'),
      ),
      el('div', { className: 'modal-foot' },
        current ? el('button', { type: 'button', className: 'btn danger', onClick: () => { unbindSession(pid); closeModal() } }, '解除绑定') : null,
        el('button', { type: 'button', className: 'btn', onClick: closeModal }, '关闭'),
      ),
    ),
  )
}

function Toasts() {
  useStore()
  if (!store.toasts.length) return null
  return el('div', { className: 'toasts' },
    store.toasts.map((t) => el('div', { key: t.id, className: 'toast ' + (t.kind || '') }, t.text)),
  )
}

/* ============================ 样式（视觉基准：workbench/index.html） ============================ */

const CSS = `
.wt-scope{
  --bg:#0a0d13;
  --card:rgba(18,23,32,.34);
  --panel:rgba(255,255,255,.032);
  --panel-2:rgba(255,255,255,.055);
  --line:rgba(255,255,255,.075);
  --line-strong:rgba(255,255,255,.16);
  --border:#2a3140;
  --border-hover:#39445a;
  --txt:#e6e8eb;
  --txt-dim:#9aa4b2;
  --txt-mute:#6e7683;
  --amber:#f0b429;
  --amber-2:#c98f1c;
  --amber-soft:rgba(240,180,41,.12);
  --amber-line:rgba(240,180,41,.30);
  --st-idle:#6e7683;
  --st-working:#f0b429;
  --st-needs:#e8734a;
  --st-done:#3fb950;
  --grid-line:rgba(255,255,255,.045);
  --mono:ui-monospace,"JetBrains Mono","Cascadia Mono",Consolas,"Liberation Mono",monospace;
  --sans:"Inter",system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  --r:16px;
  --ease:cubic-bezier(.22,.7,.3,1);
  font-family:var(--sans);color:var(--txt);font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased;
}
.wt-scope *{box-sizing:border-box}
.wt-scope button,.wt-scope input,.wt-scope textarea,.wt-scope select{font-family:inherit}
.wt-scope .mono{font-family:var(--mono)}
.wt-scope ::-webkit-scrollbar{width:10px;height:10px}
.wt-scope ::-webkit-scrollbar-track{background:transparent}
.wt-scope ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.10);border-radius:8px;border:3px solid transparent;background-clip:content-box}
.wt-scope ::-webkit-scrollbar-thumb:hover{background:rgba(240,180,41,.30);background-clip:content-box}

/* ---------- 侧边栏（塞进 DSH 侧边栏底部，高度自适应） ----------
   深色玻璃底是刻意加的：宿主侧边栏底色随主题变（浅色主题下透明会让浅色文字不可读），
   而视觉基准本身就是深色玻璃拟态，给整块自绘底反而更接近网页版。 */
/* 注意：这里刻意不用 backdrop-filter / overflow:hidden ——
   二者会给 fixed 定位的后代创建 containing block 并裁剪，右击菜单会被侧边栏切掉。
   列表自身 overflow-y:auto 保证不撑破，圆角靠背景自身即可。 */
.wt-side{
  display:flex;flex-direction:column;gap:10px;width:100%;min-width:0;
  max-height:min(68vh,620px);
  padding:10px 9px 9px;border-radius:14px;
  border:1px solid rgba(240,180,41,.34);
  /* 琥珀金底：顶部暖色渐变压到深底，既保留玻璃质感又不抢宿主的暗色 */
  background:
    radial-gradient(120% 70% at 12% -10%,rgba(240,180,41,.30),rgba(240,180,41,.06) 55%,transparent 78%),
    linear-gradient(170deg,rgba(58,44,16,.62),rgba(28,24,16,.86) 46%,rgba(16,15,13,.92));
  box-shadow:0 12px 30px -22px rgba(240,180,41,.55),inset 0 1px 0 rgba(255,224,150,.14);
}
.wt-side .brand-name{color:#f7dd9f}
.wt-side .brand-sub{color:rgba(246,218,156,.55)}
.wt-side .brand-mark{background:linear-gradient(150deg,rgba(240,180,41,.30),rgba(240,180,41,.06));border-color:rgba(240,180,41,.42)}
.wt-side .nav-label{color:rgba(246,218,156,.62)}
.wt-side .stat-box{border-color:rgba(240,180,41,.28);background:linear-gradient(135deg,rgba(240,180,41,.14),rgba(255,255,255,.02))}
.wt-side .fb-row{color:rgba(246,218,156,.6)}
.wt-side .fb-row b{color:#f7dd9f}
.wt-side .pitem{background:rgba(0,0,0,.18);border-color:rgba(240,180,41,.10)}
.wt-side .pitem:hover{background:rgba(240,180,41,.16);border-color:rgba(240,180,41,.4)}
.wt-side .pitem .pi-name{color:rgba(246,218,156,.86)}
.wt-side .side-tip{color:rgba(246,218,156,.42)}
.wt-side .brand{display:flex;align-items:center;gap:9px;padding:0 4px 2px;min-width:0}
.wt-side .brand-mark{
  width:28px;height:28px;flex:none;border-radius:9px;display:grid;place-items:center;
  background:linear-gradient(150deg,rgba(255,255,255,.14),rgba(255,255,255,.03));
  border:1px solid rgba(255,255,255,.16);font-size:15px;line-height:1;
}
.wt-side .brand-name{font-size:13px;font-weight:650;letter-spacing:.2px;color:var(--txt)}
.wt-side .brand-sub{font-size:9.5px;color:var(--txt-mute);letter-spacing:.7px;text-transform:uppercase}
.wt-side .brand-tools{margin-left:auto;display:flex;align-items:center;gap:2px;flex:none}
.wt-side .brand-tools button{
  width:22px;height:22px;padding:0;display:grid;place-items:center;border:1px solid transparent;border-radius:6px;
  background:transparent;color:var(--txt-mute);cursor:pointer;transition:.18s var(--ease);
}
.wt-side .brand-tools button:hover{background:rgba(255,255,255,.07);border-color:var(--line-strong);color:var(--txt)}
.wt-side .brand-tools svg{width:13px;height:13px}

.wt-side .nav-label{
  font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--txt-mute);
  padding:0 8px;margin:2px 0 0;display:flex;align-items:center;justify-content:space-between;gap:6px;
}
.wt-side .nav-label .mono{letter-spacing:0;text-transform:none;font-size:10.5px}

.wt-side .side-projects{display:flex;flex-direction:column;flex:1;min-height:0}
.wt-side .nl-tools{display:flex;gap:4px;align-items:center}.wt-side .nl-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:4px;height:19px;padding:0 7px;
  border-radius:6px;border:1px solid var(--line);background:rgba(255,255,255,.03);color:var(--txt-mute);
  cursor:pointer;font-family:var(--mono);font-size:10px;letter-spacing:.04em;
  transition:background .18s var(--ease),color .18s,border-color .18s;
}
.wt-side .nl-btn:hover{background:rgba(255,255,255,.08);color:var(--txt);border-color:var(--line-strong)}

.wt-side .plist{
  display:flex;flex-direction:column;gap:3px;margin-top:5px;
  flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding-right:2px;
}
.wt-side .pitem{
  display:flex;align-items:center;gap:8px;width:100%;height:34px;flex:none;
  padding:0 8px;border-radius:9px;border:1px solid transparent;
  background:rgba(255,255,255,.02);cursor:pointer;text-align:left;font:inherit;
  transition:background .18s var(--ease),border-color .18s var(--ease),transform .18s var(--ease);
}
.wt-side .pitem:hover{background:rgba(255,255,255,.055);border-color:var(--line-strong);transform:translateX(1px)}
.wt-side .pitem.active{background:rgba(240,180,41,.10);border-color:rgba(240,180,41,.30)}
.wt-side .pitem .pi-ico{flex:none;font-size:14px;line-height:1}
.wt-side .pitem .pi-name{
  flex:1;min-width:0;font-size:12.2px;font-weight:500;color:var(--txt-dim);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.wt-side .pitem.active .pi-name{color:#f5d68f;font-weight:600}
.wt-side .pitem .pi-bind{flex:none;font-size:10px;opacity:.75}
.wt-side .pitem .pi-arrow{flex:none;width:12px;height:12px;opacity:.3;transition:opacity .18s}
.wt-side .pitem:hover .pi-arrow{opacity:.72}

.wt-scope .light{
  width:9px;height:9px;flex:none;border-radius:50%;border:0;padding:0;cursor:pointer;
  transition:transform .2s var(--ease),box-shadow .2s;
}
.wt-scope .light:hover{transform:scale(1.35)}
.wt-scope .light.idle{background:var(--st-idle);box-shadow:0 0 0 3px rgba(107,104,99,.16)}
.wt-scope .light.working{background:var(--st-working);box-shadow:0 0 0 3px rgba(240,180,41,.20),0 0 10px rgba(240,180,41,.7);animation:wtLpulse 2.1s ease-in-out infinite}
.wt-scope .light.needs-you{background:var(--st-needs);box-shadow:0 0 0 3px rgba(232,115,74,.20),0 0 10px rgba(232,115,74,.6);animation:wtLpulse 1.5s ease-in-out infinite}
.wt-scope .light.done{background:var(--st-done);box-shadow:0 0 0 3px rgba(95,211,154,.20),0 0 10px rgba(95,211,154,.55)}
@keyframes wtLpulse{0%,100%{opacity:1}50%{opacity:.42}}

.wt-side .sidebar-foot{margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:2px}
/* 顶部状态栏（原底部统计盒上移） */
.wt-side .stat-box{
  display:flex;flex-direction:column;gap:1px;padding:7px 10px 8px;border-radius:12px;
  border:1px solid var(--line);
  background:linear-gradient(135deg,rgba(255,255,255,.10),rgba(255,255,255,.015));
  backdrop-filter:blur(8px) saturate(1.15);-webkit-backdrop-filter:blur(8px) saturate(1.15);
  flex:none;
}
.wt-side .fb-row{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 0;font-size:11px;color:var(--txt-mute)}
.wt-side .fb-row b{font-family:var(--mono);font-size:11.5px;font-weight:600;color:var(--txt-dim);font-variant-numeric:tabular-nums}

.wt-side .control-entry{
  position:relative;display:flex;align-items:center;gap:9px;width:100%;
  padding:9px 10px;border-radius:12px;cursor:pointer;overflow:hidden;
  border:1px solid rgba(240,180,41,.36);
  background:linear-gradient(135deg,rgba(240,180,41,.16),rgba(240,180,41,.03));
  color:#f6da9c;font-size:12.5px;font-weight:600;
  transition:transform .24s var(--ease),border-color .24s,background .24s;
  animation:wtBreathe 3.1s ease-in-out infinite;
}
.wt-side .control-entry:hover{transform:translateY(-2px);border-color:rgba(240,180,41,.62)}
.wt-side .control-entry:active{transform:translateY(0) scale(.985)}
.wt-side .control-entry.active{background:linear-gradient(135deg,rgba(240,180,41,.24),rgba(240,180,41,.06))}
.wt-side .control-entry .ce-ico{width:16px;height:16px;flex:none}
.wt-side .control-entry .ce-txt{display:flex;flex-direction:column;line-height:1.25;min-width:0}
.wt-side .control-entry .ce-txt small{font-size:9.5px;font-weight:500;color:rgba(246,218,156,.62);letter-spacing:.04em}
.wt-side .control-entry .ce-arrow{margin-left:auto;opacity:.55;flex:none}
.wt-side .control-entry::after{
  content:"";position:absolute;inset:0;border-radius:12px;pointer-events:none;
  background:linear-gradient(105deg,transparent 30%,rgba(255,224,150,.14) 48%,transparent 66%);
  transform:translateX(-120%);animation:wtSheen 4.6s ease-in-out infinite;
}
@keyframes wtBreathe{
  0%,100%{box-shadow:0 0 0 1px rgba(240,180,41,.12),0 0 0 rgba(240,180,41,0)}
  50%{box-shadow:0 0 0 1px rgba(240,180,41,.34),0 0 26px -2px rgba(240,180,41,.36)}
}
@keyframes wtSheen{0%{transform:translateX(-120%)}42%,100%{transform:translateX(130%)}}
.wt-scope .pulse-dot{width:8px;height:8px;border-radius:50%;background:var(--amber);flex:none;animation:wtPulse 2.3s ease-out infinite}
@keyframes wtPulse{
  0%{box-shadow:0 0 0 0 rgba(240,180,41,.55)}
  70%{box-shadow:0 0 0 9px rgba(240,180,41,0)}
  100%{box-shadow:0 0 0 0 rgba(240,180,41,0)}
}

/* ---------- 主区浮层 ---------- */
.wt-overlay{position:fixed;inset:0;z-index:900;background:var(--bg);color:var(--txt);overflow:hidden;display:flex;flex-direction:column}
.wt-scope .wt-bg{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:var(--bg)}
.wt-scope .wt-bg::after{
  content:"";position:absolute;inset:0;
  background-image:linear-gradient(var(--grid-line) 1px,transparent 1px),linear-gradient(90deg,var(--grid-line) 1px,transparent 1px);
  background-size:30px 30px;
  -webkit-mask-image:radial-gradient(1300px 820px at 48% 0%,#000 0%,transparent 78%);
  mask-image:radial-gradient(1300px 820px at 48% 0%,#000 0%,transparent 78%);
}
.wt-scope .wt-blob{position:absolute;width:56vmax;height:56vmax;border-radius:50%;filter:blur(64px);mix-blend-mode:screen;will-change:transform}
.wt-scope .wt-b1{background:radial-gradient(circle,#f0b429,transparent 66%);top:-18%;left:-14%;opacity:.34;animation:wtBlob1 13s ease-in-out infinite alternate}
.wt-scope .wt-b2{background:radial-gradient(circle,#e8734a,transparent 66%);top:2%;right:-20%;opacity:.26;animation:wtBlob2 17s ease-in-out infinite alternate}
.wt-scope .wt-b3{background:radial-gradient(circle,#2fd4b0,transparent 66%);bottom:-22%;left:12%;opacity:.20;animation:wtBlob3 11s ease-in-out infinite alternate}
.wt-scope .wt-b4{background:radial-gradient(circle,#c98f1c,transparent 66%);bottom:-10%;right:2%;opacity:.28;animation:wtBlob4 15s ease-in-out infinite alternate}
@keyframes wtBlob1{from{transform:translate(0,0) scale(1)}to{transform:translate(12vw,8vh) scale(1.12)}}
@keyframes wtBlob2{from{transform:translate(0,0) scale(1)}to{transform:translate(-11vw,9vh) scale(1.10)}}
@keyframes wtBlob3{from{transform:translate(0,0) scale(1)}to{transform:translate(10vw,-7vh) scale(1.14)}}
@keyframes wtBlob4{from{transform:translate(0,0) scale(1)}to{transform:translate(-9vw,-8vh) scale(1.11)}}

.wt-scope .wt-shell{position:relative;z-index:1;display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto}

.wt-scope .topbar{
  position:sticky;top:12px;z-index:20;
  display:flex;align-items:center;justify-content:space-between;gap:20px;
  margin:14px 24px 16px;padding:11px 16px;border-radius:15px;
  border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.055);
  box-shadow:0 8px 24px rgba(0,0,0,.34);
  backdrop-filter:blur(14px) saturate(1.3);-webkit-backdrop-filter:blur(14px) saturate(1.3);
}
.wt-scope .tb-title{display:flex;align-items:center;gap:10px;min-width:0}
.wt-scope .tb-title h1{margin:0;font-size:19px;font-weight:680;letter-spacing:-.01em;white-space:nowrap}
.wt-scope .eyebrow{
  font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--amber);
  border:1px solid var(--amber-line);border-radius:99px;padding:2px 9px;background:var(--amber-soft);white-space:nowrap;
}
.wt-scope .tb-sub{margin:4px 0 0;font-size:12px;color:var(--txt-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(56vw,560px)}
.wt-scope .tb-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap;justify-content:flex-end;flex:none}

.wt-scope .btn{
  display:inline-flex;align-items:center;gap:7px;padding:8px 13px;border-radius:10px;
  border:1px solid var(--line-strong);background:var(--panel);color:var(--txt-dim);
  font-size:12.5px;font-weight:560;cursor:pointer;white-space:nowrap;transition:.2s var(--ease);
}
.wt-scope .btn:hover{background:var(--panel-2);color:var(--txt);border-color:rgba(255,255,255,.22);transform:translateY(-1px)}
.wt-scope .btn:active{transform:translateY(0) scale(.98)}
.wt-scope .btn.primary{border-color:var(--amber-line);color:#f7dd9f;background:linear-gradient(135deg,rgba(240,180,41,.20),rgba(240,180,41,.05))}
.wt-scope .btn.primary:hover{border-color:rgba(240,180,41,.55);box-shadow:0 6px 22px -10px rgba(240,180,41,.6)}
.wt-scope .btn.small{padding:6px 10px;font-size:11.5px;border-radius:9px}
.wt-scope .btn.ico{padding:7px 9px;border-radius:9px}
.wt-scope .btn.danger:hover{color:#f0a08a;border-color:rgba(232,115,74,.42)}

.wt-scope .view{display:none;padding:0 24px 34px}
.wt-scope .view.active{display:block;animation:wtFadeUp .34s var(--ease)}
@keyframes wtFadeUp{from{opacity:0;transform:translateY(9px)}to{opacity:1;transform:none}}

/* ---------- 统计卡片 ---------- */
.wt-scope .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(168px,1fr));gap:12px;margin:0 auto 16px;max-width:1064px}
.wt-scope .stat{
  position:relative;overflow:hidden;padding:13px 15px 14px;border-radius:14px;border:1px solid transparent;
  background:
    linear-gradient(135deg,rgba(255,255,255,.14) 0%,rgba(255,255,255,.05) 34%,rgba(255,255,255,.012) 64%,rgba(0,0,0,.05) 100%),
    rgba(18,23,32,.30);
  box-shadow:0 8px 22px rgba(0,0,0,.26),inset 0 1px 0 rgba(255,255,255,.10);
  backdrop-filter:blur(8px) saturate(1.15);-webkit-backdrop-filter:blur(8px) saturate(1.15);
  transition:border-color .25s var(--ease),transform .25s var(--ease),box-shadow .25s var(--ease);
}
.wt-scope .stat::after{
  content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;
  background:conic-gradient(from 45deg,rgba(0,0,0,.34) 0deg,rgba(255,255,255,.42) 90deg,rgba(0,0,0,.34) 180deg,rgba(255,255,255,.42) 270deg,rgba(0,0,0,.34) 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude;pointer-events:none;opacity:.45;
}
.wt-scope .stat:hover{transform:translateY(-3px);box-shadow:0 16px 36px -20px #000,0 0 26px -12px rgba(240,180,41,.5)}
.wt-scope .stat:hover::after{background:conic-gradient(from 45deg,rgba(240,180,41,.2) 0deg,rgba(240,180,41,.8) 90deg,rgba(240,180,41,.2) 180deg,rgba(240,180,41,.8) 270deg,rgba(240,180,41,.2) 360deg)}
.wt-scope .stat-k{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--txt-mute)}
.wt-scope .stat-v{font-family:var(--mono);font-size:24px;font-weight:600;letter-spacing:-.02em;margin-top:6px}
.wt-scope .stat-v .unit{font-size:12.5px;color:var(--txt-mute);margin-left:3px;font-weight:500}
.wt-scope .stat-note{margin-top:4px;font-size:11.5px;color:var(--txt-mute)}
.wt-scope .stat-v.gold{color:var(--amber)}
.wt-scope .stat-v.working{color:var(--st-working)}
.wt-scope .stat-v.needs{color:var(--st-needs)}
.wt-scope .stat-v.done{color:var(--st-done)}

.wt-scope .section-head{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:4px 0 12px}
.wt-scope .section-head h2{margin:0;font-size:13px;font-weight:600;letter-spacing:.02em;color:var(--txt-dim)}
.wt-scope .section-head h2 span{color:var(--txt-mute);font-weight:500;font-family:var(--mono);font-size:11.5px;margin-left:8px}
.wt-scope .hint{font-size:11.5px;color:var(--txt-mute)}

/* ---------- 卡片网格 ---------- */
.wt-scope .grid{
  --cols:4;--gap:56px;
  display:grid;grid-template-columns:repeat(var(--cols),minmax(0,246px));
  grid-auto-rows:auto;justify-content:center;align-items:start;gap:var(--gap);
  width:100%;margin:clamp(24px,6vh,80px) auto 0;
}
@media (max-width:1660px){.wt-scope .grid{--cols:3}}
/* ---------- 工作区会话（侧边栏，一键建成绑定项目） ---------- */
.wt-side .side-sessions{display:flex;flex-direction:column;flex:none;min-height:0;gap:2px}
.wt-side .slist{
  display:flex;flex-direction:column;gap:2px;margin-top:5px;padding-right:2px;
  max-height:22vh;overflow-y:auto;overscroll-behavior:contain;
}
.wt-side .srow{
  display:flex;align-items:center;gap:7px;width:100%;padding:5px 7px;
  border-radius:9px;border:1px solid transparent;background:rgba(0,0,0,.16);
  cursor:pointer;text-align:left;
  transition:background .18s var(--ease),border-color .18s var(--ease),transform .18s var(--ease);
}
.wt-side .srow:hover{background:rgba(240,180,41,.18);border-color:rgba(240,180,41,.45);transform:translateX(1px)}
.wt-side .srow.bound{opacity:.66}
.wt-side .srow-main{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.wt-side .srow-title{font-size:11.5px;font-weight:540;color:rgba(246,218,156,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-side .srow-sub{font-family:var(--mono);font-size:9px;color:rgba(246,218,156,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-side .srow-add{flex:none;font-size:12px;color:rgba(240,180,41,.9)}

/* ---------- 小窗：emoji 标签 ---------- */
.wt-scope .emoji-row{display:flex;flex-wrap:wrap;gap:5px}
.wt-scope .emoji{
  width:28px;height:28px;display:grid;place-items:center;border-radius:8px;cursor:pointer;
  border:1px solid var(--line);background:rgba(255,255,255,.04);
  font-size:14px;line-height:1;color:var(--txt-mute);transition:.18s var(--ease);
}
.wt-scope .emoji:first-child{width:auto;padding:0 9px;font-size:10px;font-family:var(--mono);letter-spacing:.02em}
.wt-scope .emoji:hover{border-color:var(--amber-line);background:rgba(240,180,41,.12);transform:translateY(-1px)}
.wt-scope .emoji.on{border-color:rgba(240,180,41,.6);background:rgba(240,180,41,.18);box-shadow:0 0 12px -3px rgba(240,180,41,.75);color:#f7dd9f}

/* ---------- 小窗：布局预览草图 ---------- */
.wt-scope .layout-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.wt-scope .layout-card{
  display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px 6px;
  border-radius:11px;border:1px solid var(--line);background:rgba(255,255,255,.03);
  color:var(--txt-mute);cursor:pointer;transition:.18s var(--ease);
}
.wt-scope .layout-card:hover{border-color:var(--line-strong);background:rgba(255,255,255,.06);color:var(--txt-dim)}
.wt-scope .layout-card.on{border-color:rgba(240,180,41,.55);background:rgba(240,180,41,.12);color:#f7dd9f;box-shadow:0 0 16px -8px rgba(240,180,41,.9)}
.wt-scope .layout-card .lc-label{font-size:11.5px;font-weight:600}
.wt-scope .layout-card .lc-k{font-size:9px;font-family:var(--mono);opacity:.75;text-align:center;line-height:1.35}
.wt-scope .sketch{
  display:grid;gap:2px;width:46px;height:28px;padding:3px;
  border:1px solid var(--line-strong);border-radius:6px;background:rgba(0,0,0,.38);
}
.wt-scope .sketch i{display:block;border-radius:2px;background:rgba(240,180,41,.22);border:1px solid rgba(240,180,41,.38)}
.wt-scope .sketch[data-layout="l3"]{grid-template-columns:1fr 1.5fr 1fr}
.wt-scope .sketch[data-layout="l2"]{grid-template-columns:1.5fr 1fr}
.wt-scope .sketch[data-layout="full"]{grid-template-columns:1fr}
.wt-scope .sketch[data-layout="l3"] i:nth-child(2){background:rgba(240,180,41,.42)}
.wt-scope .sketch[data-layout="l2"] i:nth-child(1){background:rgba(240,180,41,.42)}

/* ---------- 下拉选择（绑定对话） ---------- */
.wt-scope .wt-select{
  width:100%;padding:9px 11px;border-radius:10px;border:1px solid var(--line-strong);
  background:rgba(0,0,0,.38);color:var(--txt);font-size:12.5px;outline:0;cursor:pointer;
}
.wt-scope .wt-select:focus{border-color:var(--amber-line);box-shadow:0 0 0 3px rgba(240,180,41,.10)}

/* ---------- 交互按键：呼吸灯 ---------- */
@keyframes wtKeyBreathe{
  0%,100%{box-shadow:0 0 0 1px rgba(240,180,41,.10),0 0 0 rgba(240,180,41,0)}
  50%{box-shadow:0 0 0 1px rgba(240,180,41,.38),0 0 16px -3px rgba(240,180,41,.55)}
}
.wt-side .nl-btn,.wt-side .brand-tools button,.wt-side .srow,
.wt-scope .btn,.wt-scope .mini-btn,.wt-scope .emoji,.wt-scope .layout-card,.wt-scope .field-reset{
  animation:wtKeyBreathe 3.8s ease-in-out infinite;
}
.wt-side .brand-tools button{animation-delay:.5s}
.wt-side .nl-btn{animation-delay:.9s}
.wt-side .srow{animation-delay:1.3s}
.wt-scope .emoji{animation-delay:.7s}
.wt-scope .layout-card{animation-delay:1.1s}
.wt-scope .btn.primary{animation-duration:3.1s}

@media (max-width:1240px){.wt-scope .grid{--cols:2}}
@media (max-width:780px){.wt-scope .grid{--cols:1}}
.wt-scope .grid-note{margin:18px auto 0;text-align:center;font-family:var(--mono);font-size:10.5px;color:var(--txt-mute);opacity:.7}

.wt-scope .card{
  position:relative;box-sizing:border-box;display:flex;flex-direction:column;gap:11px;
  min-width:0;aspect-ratio:1;min-height:196px;padding:19px;
  border-radius:16px;border:1px solid transparent;overflow:hidden;cursor:pointer;
  background:
    linear-gradient(135deg,rgba(255,255,255,.20) 0%,rgba(255,255,255,.065) 30%,rgba(255,255,255,.012) 60%,rgba(0,0,0,.07) 100%),
    rgba(18,23,32,.24);
  box-shadow:0 10px 28px rgba(0,0,0,.30),inset 0 1px 0 rgba(255,255,255,.13);
  transition:transform .16s var(--ease),box-shadow .16s var(--ease);
}
.wt-scope .card::after{
  content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;
  background:conic-gradient(from 45deg,rgba(0,0,0,.40) 0deg,rgba(255,255,255,.55) 90deg,rgba(0,0,0,.40) 180deg,rgba(255,255,255,.55) 270deg,rgba(0,0,0,.40) 360deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude;pointer-events:none;opacity:.5;
}
.wt-scope .card:hover{transform:translateY(-2px);box-shadow:0 14px 32px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.09)}
.wt-scope .card:active{transform:translateY(0) scale(.995)}
.wt-scope .card:focus-visible{outline:2px solid var(--amber-line);outline-offset:3px}

.wt-scope .c-head{display:flex;align-items:center;gap:12px;min-width:0}
.wt-scope .c-ico{flex:none;font-size:29px;line-height:1;font-family:var(--sans)}
.wt-scope .c-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:19px;font-weight:700;line-height:26px;letter-spacing:-.01em;color:var(--txt)}
.wt-scope .c-div{flex:none;height:1px;background:var(--line)}
.wt-scope .c-srow{display:flex;align-items:baseline;justify-content:space-between;gap:9px;min-width:0}
.wt-scope .c-status{flex:none;font-size:20px;font-weight:700;line-height:28px;color:var(--txt-dim)}
.wt-scope .c-status.idle{color:var(--txt-mute)}
.wt-scope .c-status.working{color:var(--amber)}
.wt-scope .c-status.needs-you{color:var(--st-needs)}
.wt-scope .c-status.done{color:var(--st-done)}
.wt-scope .c-meta{flex:none;font-family:var(--mono);font-size:11.5px;font-weight:600;line-height:28px;color:var(--txt-mute);font-variant-numeric:tabular-nums;white-space:nowrap;max-width:52%;overflow:hidden;text-overflow:ellipsis}
.wt-scope .c-preview{
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;
  font-size:8.5px;line-height:13px;color:var(--txt-mute);word-break:break-word;
}
.wt-scope .c-preview.mute{font-style:italic;-webkit-line-clamp:2;font-size:9px}
.wt-scope .c-actions{display:flex;align-items:center;gap:6px;margin-top:auto;flex-wrap:wrap}
.wt-scope .mini-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:5px;
  height:23px;padding:0 9px;border-radius:7px;border:1px solid var(--line);
  background:rgba(255,255,255,.035);color:var(--txt-mute);font-size:10.5px;cursor:pointer;transition:.18s var(--ease);
}
.wt-scope .mini-btn:hover{color:var(--txt);border-color:var(--line-strong);background:rgba(255,255,255,.07)}
.wt-scope .mini-btn.on{color:#f7dd9f;border-color:var(--amber-line);background:rgba(240,180,41,.12)}
.wt-scope .mini-btn.danger:hover{color:#f0a08a;border-color:rgba(232,115,74,.42)}

.wt-scope .card.glow-done{border-color:rgba(63,185,80,.85);box-shadow:0 0 8px rgba(63,185,80,.45),0 0 26px rgba(63,185,80,.26),inset 0 0 16px rgba(63,185,80,.07)}
.wt-scope .card.glow-needs{border-color:rgba(232,115,74,.9);box-shadow:0 0 8px rgba(232,115,74,.45),0 0 26px rgba(232,115,74,.26),inset 0 0 16px rgba(232,115,74,.08)}
.wt-scope .card.glow-done::after,.wt-scope .card.glow-needs::after{opacity:0}

@property --wt-angle{syntax:"<angle>";initial-value:0deg;inherits:false}
.wt-scope .card.busy{box-shadow:0 0 10px rgba(240,180,41,.55),0 0 34px rgba(240,180,41,.40)}
.wt-scope .card.busy::before{
  content:"";position:absolute;inset:0;border-radius:16px;padding:3px;pointer-events:none;
  background:conic-gradient(from var(--wt-angle),transparent 0deg,rgba(240,180,41,0) 22deg,#fff6d8 54deg,#f0b429 86deg,rgba(240,180,41,0) 126deg,transparent 205deg);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  -webkit-mask-composite:xor;
  mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);
  mask-composite:exclude;animation:wtAngleSpin 1.4s linear infinite;
  filter:drop-shadow(0 0 8px rgba(240,180,41,.9));
}
@keyframes wtAngleSpin{to{--wt-angle:360deg}}
.wt-scope .card.busy::after{opacity:0}
.wt-scope .wt-sweep{
  position:absolute;inset:-30%;border-radius:inherit;pointer-events:none;z-index:-1;
  background:linear-gradient(115deg,rgba(255,255,255,.01) 0%,rgba(255,255,255,.045) 30%,rgba(255,255,255,.12) 50%,rgba(255,255,255,.045) 70%,rgba(255,255,255,.01) 100%);
  opacity:0;animation:wtSweep 3.2s ease-in-out infinite;
}
@keyframes wtSweep{
  0%{opacity:0;transform:translate(-12%,-12%)}
  35%{opacity:1}55%{opacity:1}
  92%,100%{opacity:0;transform:translate(12%,12%)}
}

.wt-scope .control-card{
  grid-column:span 2;grid-row:span 2;aspect-ratio:1;gap:14px;
  border-color:rgba(240,180,41,.26);
  background:
    radial-gradient(560px 260px at 6% -26%,rgba(240,180,41,.16),transparent 70%),
    linear-gradient(135deg,rgba(255,255,255,.20) 0%,rgba(255,255,255,.06) 30%,rgba(255,255,255,.012) 60%,rgba(0,0,0,.07) 100%),
    rgba(18,23,32,.24);
}
.wt-scope .control-card:hover{transform:translateY(-3px);border-color:rgba(240,180,41,.52);box-shadow:0 22px 50px -26px #000,0 0 46px -14px rgba(240,180,41,.5)}
.wt-scope .control-card .c-ico{font-size:36px}
.wt-scope .control-card .c-name{font-size:23px;line-height:32px}
.wt-scope .control-card .c-status{font-size:23px;line-height:32px}
.wt-scope .cc-badge{display:inline-flex;align-items:center;gap:7px;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:#f6da9c;border:1px solid var(--amber-line);background:var(--amber-soft);padding:3px 10px;border-radius:99px;white-space:nowrap;flex:none}
.wt-scope .cc-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;flex:1;align-content:center}
.wt-scope .cc-cell{padding:12px 13px;border-radius:12px;border:1px solid var(--line);background:rgba(0,0,0,.24)}
.wt-scope .cc-cell .k{font-size:10.5px;letter-spacing:.06em;color:var(--txt-mute);white-space:nowrap}
.wt-scope .cc-cell .v{font-family:var(--mono);font-size:20px;font-weight:600;margin-top:5px;letter-spacing:-.02em}
.wt-scope .cc-cell .v.gold{color:var(--amber)}
.wt-scope .cc-cell .v.working{color:var(--st-working)}
.wt-scope .cc-cell .v.needs{color:var(--st-needs)}
.wt-scope .cc-cell .v.done{color:var(--st-done)}

.wt-scope .add-card{
  justify-content:center;align-items:center;gap:10px;text-align:center;
  border:1.5px dashed var(--border-hover);
  background:radial-gradient(circle at 50% 42%,rgba(255,255,255,.09),rgba(255,255,255,0) 65%),rgba(18,23,32,.34);
}
.wt-scope .add-card::after{display:none}
.wt-scope .add-card:hover{border-color:rgba(240,180,41,.6);background:radial-gradient(circle at 50% 42%,rgba(240,180,41,.10),rgba(255,255,255,0) 65%),rgba(23,28,37,.45)}
.wt-scope .add-plus{font-size:32px;line-height:1;font-weight:400;color:var(--txt-dim)}
.wt-scope .add-card:hover .add-plus{color:var(--amber)}
.wt-scope .add-label{font-size:13px;font-weight:600;color:var(--txt-dim)}
.wt-scope .add-card:hover .add-label{color:var(--txt)}

.wt-scope .empty{grid-column:1/-1;padding:44px 0;text-align:center;font-size:12.5px;color:var(--txt-mute)}

/* ---------- 表格（控制室项目列表） ---------- */
.wt-scope .table-wrap{border:1px solid var(--line);border-radius:var(--r);overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.032),rgba(255,255,255,.008))}
.wt-scope .tbl-scroll{overflow-x:auto}
.wt-scope table{width:100%;border-collapse:collapse;min-width:860px}
.wt-scope thead th{
  position:sticky;top:0;z-index:2;text-align:left;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;
  color:var(--txt-mute);font-weight:600;padding:10px 13px;background:rgba(16,17,20,.94);backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line);white-space:nowrap;
}
.wt-scope tbody tr{border-bottom:1px solid rgba(255,255,255,.045);transition:background .18s}
.wt-scope tbody tr:last-child{border-bottom:0}
.wt-scope tbody tr:hover{background:rgba(240,180,41,.045)}
.wt-scope tbody td{padding:11px 13px;vertical-align:middle;font-size:12.5px}
.wt-scope .cell-name{display:flex;align-items:center;gap:10px;min-width:150px}
.wt-scope .sq{width:26px;height:26px;flex:none;border-radius:8px;display:grid;place-items:center;font-size:12px;background:rgba(240,180,41,.12);border:1px solid rgba(240,180,41,.22)}
.wt-scope .cell-name .nm{font-weight:580;white-space:nowrap;color:var(--txt-dim)}
.wt-scope .cell-path{font-family:var(--mono);font-size:11px;color:var(--txt-mute);max-width:250px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-scope .state-cell{display:flex;align-items:center;gap:8px;white-space:nowrap}
.wt-scope .state-cell .lb{font-size:11.5px;color:var(--txt-dim)}
.wt-scope .row-actions{display:flex;gap:6px;justify-content:flex-end}
.wt-scope .tag{font-family:var(--mono);font-size:10.5px;padding:2.5px 7px;border-radius:6px;color:var(--txt-dim);background:rgba(255,255,255,.045);border:1px solid var(--line);white-space:nowrap;display:inline-block;margin-right:4px}
.wt-scope .tag.gold{color:#e9c778;background:rgba(240,180,41,.08);border-color:rgba(240,180,41,.22)}

/* ---------- 项目内部（临时项目 → DSH 对话） ---------- */
.wt-scope .detail-bar{
  display:flex;align-items:center;gap:12px;flex-wrap:wrap;
  max-width:1064px;margin:0 auto 14px;padding:10px 12px;border-radius:12px;
  border:1px solid var(--line);background:var(--panel);
}
.wt-scope .detail-crumb{display:flex;align-items:center;gap:9px;min-width:0;flex:1}
.wt-scope .detail-crumb b{font-size:14px;font-weight:620;white-space:nowrap}
.wt-scope .detail-crumb .p{font-family:var(--mono);font-size:10.5px;color:var(--txt-mute);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-scope .detail-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px;max-width:1064px;margin:0 auto}
.wt-scope .detail-card{
  min-width:0;padding:16px 18px;border-radius:16px;
  border:1px solid var(--line);
  background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));
  box-shadow:0 12px 30px -26px #000;
}
.wt-scope .dc-head{display:flex;align-items:center;gap:10px;margin-bottom:10px}
.wt-scope .dc-title{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--txt-mute)}
.wt-scope .dc-head .tag{margin-left:auto}
.wt-scope .dc-row{display:flex;align-items:baseline;justify-content:space-between;gap:14px;padding:7px 0;border-bottom:1px dashed rgba(255,255,255,.06);font-size:12.5px}
.wt-scope .dc-row:last-child{border-bottom:0}
.wt-scope .dc-row .k{flex:none;font-size:11.5px;color:var(--txt-mute)}
.wt-scope .dc-row .v{min-width:0;text-align:right;color:var(--txt-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-scope .dc-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.wt-scope .dc-empty{margin:8px 0 0;font-size:12px;line-height:1.7;color:var(--txt-mute)}

/* ---------- 弹窗 ---------- */
.wt-scope .scrim{position:fixed;inset:0;z-index:960;display:grid;place-items:center;background:rgba(6,7,9,.62);backdrop-filter:blur(5px);animation:wtFade .22s var(--ease)}
@keyframes wtFade{from{opacity:0}to{opacity:1}}
.wt-scope .modal{
  width:min(440px,92vw);max-height:82vh;display:flex;flex-direction:column;
  border-radius:16px;border:1px solid var(--line-strong);
  background:linear-gradient(180deg,#15161a,#101114);
  box-shadow:0 40px 90px -40px #000,0 0 0 1px rgba(240,180,41,.10);padding:20px;animation:wtPop .28s var(--ease);
  color:var(--txt);
}
.wt-scope .modal.wide{width:min(560px,94vw)}
@keyframes wtPop{from{opacity:0;transform:translateY(12px) scale(.98)}to{opacity:1;transform:none}}
.wt-scope .modal h3{margin:0 0 3px;font-size:15px;color:var(--txt)}
.wt-scope .modal p{margin:0 0 14px;font-size:12px;color:var(--txt-mute);line-height:1.6}
.wt-scope .modal-note{font-size:11.5px;color:var(--txt-mute);padding:7px 10px;border-radius:9px;border:1px solid var(--line);background:rgba(0,0,0,.22);margin-bottom:10px}
.wt-scope .modal-note.err{color:#f0a08a;border-color:rgba(232,115,74,.32)}
.wt-scope .field{margin-bottom:12px}
.wt-scope .field label{display:flex;align-items:center;gap:8px;font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--txt-mute);margin-bottom:6px}
.wt-scope .field input{
  width:100%;padding:9px 11px;border-radius:10px;border:1px solid var(--line-strong);
  background:rgba(0,0,0,.35);color:var(--txt);font-size:13px;outline:0;transition:.2s;
}
.wt-scope .field input:focus{border-color:var(--amber-line);box-shadow:0 0 0 3px rgba(240,180,41,.10)}
.wt-scope .field input.mono{font-family:var(--mono);font-size:12px}
.wt-scope .modal-foot{display:flex;justify-content:flex-end;gap:9px;margin-top:16px;flex:none}
.wt-scope .session-list{display:flex;flex-direction:column;gap:4px;overflow-y:auto;min-height:60px;max-height:44vh;padding-right:2px}
.wt-scope .session-row{
  display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border-radius:9px;
  border:1px solid transparent;background:rgba(255,255,255,.022);color:inherit;cursor:pointer;text-align:left;
  transition:.18s var(--ease);
}
.wt-scope .session-row:hover{border-color:var(--amber-line);background:rgba(240,180,41,.06)}
.wt-scope .session-row.active{border-color:rgba(240,180,41,.42);background:rgba(240,180,41,.10)}
.wt-scope .sr-main{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.wt-scope .sr-title{font-size:12.5px;font-weight:600;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;color:var(--txt-dim)}
.wt-scope .sr-sub{font-family:var(--mono);font-size:10px;color:var(--txt-mute);text-overflow:ellipsis;overflow:hidden;white-space:nowrap}

/* ---------- toast / 错误 ---------- */
.wt-scope .toasts{position:fixed;right:22px;bottom:22px;z-index:980;display:flex;flex-direction:column;gap:9px;align-items:flex-end;pointer-events:none}
.wt-scope .toast{
  display:flex;align-items:center;gap:10px;min-width:200px;max-width:360px;padding:11px 14px;border-radius:12px;
  border:1px solid var(--line-strong);border-left:3px solid var(--amber);
  background:rgba(19,20,24,.94);backdrop-filter:blur(12px);color:var(--txt);font-size:12.5px;
  box-shadow:0 22px 50px -24px #000;animation:wtToastIn .3s var(--ease);
}
.wt-scope .toast.ok{border-left-color:var(--st-done)}
.wt-scope .toast.warn{border-left-color:var(--st-needs)}
@keyframes wtToastIn{from{opacity:0;transform:translateX(18px) scale(.96)}to{opacity:1;transform:none}}
.wt-scope .wt-error{color:var(--st-needs);font-size:11.5px;padding:8px 10px;line-height:1.6;word-break:break-word}
.wt-scope .wt-pad{padding:10px 12px}
.wt-scope .wt-mute{opacity:.55;font-size:11px;margin:6px 8px;line-height:1.5}

/* ---------- 分段控件（界面布局切换） ---------- */
.wt-scope .seg{display:inline-flex;border:1px solid var(--line-strong);border-radius:10px;overflow:hidden;background:rgba(0,0,0,.22);flex:none}
.wt-scope .seg button{padding:5px 11px;font-size:11.5px;font-weight:560;color:var(--txt-mute);background:transparent;border:0;cursor:pointer;border-right:1px solid var(--line);transition:.18s var(--ease);white-space:nowrap}
.wt-scope .seg button:last-child{border-right:0}
.wt-scope .seg button:hover{background:rgba(255,255,255,.05);color:var(--txt-dim)}
.wt-scope .seg button.on{background:rgba(240,180,41,.14);color:#f7dd9f}

/* ---------- 项目内部：分栏工作区（对话固定右侧，中间主界面留空） ---------- */
.wt-scope .ws{display:grid;gap:12px;padding:0 20px 20px;height:calc(100vh - 172px);min-height:380px}
.wt-scope .ws[data-layout="l3"]{grid-template-columns:250px minmax(0,1fr) 380px}
.wt-scope .ws[data-layout="l2"]{grid-template-columns:minmax(0,1fr) 400px}
.wt-scope .ws[data-layout="full"]{grid-template-columns:minmax(0,1fr)}
.wt-scope .pane{
  display:flex;flex-direction:column;min-height:0;min-width:0;
  border:1px solid var(--line);border-radius:var(--r);overflow:hidden;
  background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.01));
  transition:border-color .25s var(--ease),box-shadow .25s var(--ease);
}
.wt-scope .pane:hover{border-color:rgba(255,255,255,.16)}
.wt-scope .pane-head{
  display:flex;align-items:center;gap:9px;padding:8px 10px;flex:none;
  border-bottom:1px solid var(--line);background:rgba(0,0,0,.20);
}
.wt-scope .kind-chip{
  display:inline-flex;align-items:center;gap:6px;font-size:10.5px;letter-spacing:.06em;
  color:var(--txt-dim);border:1px solid var(--line);border-radius:7px;padding:2px 7px;background:rgba(255,255,255,.04);flex:none;
}
.wt-scope .kind-chip i{font-style:normal;color:var(--amber);font-size:11px}
.wt-scope .pane-head .light{margin-left:auto}
.wt-scope .pane-body{flex:1;min-height:0;overflow:auto;padding:11px 12px 13px}
.wt-scope .pane-hint{font-size:10px;color:var(--txt-mute);margin-left:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-scope .pane-title-text{flex:1;min-width:40px;font-size:12.5px;font-weight:600;color:var(--txt-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding-left:4px}
.wt-scope .pane-tools{display:flex;gap:5px;flex:none}
.wt-scope .pane-empty{
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;
  height:100%;min-height:220px;padding:22px;text-align:center;
  border:1px dashed rgba(255,255,255,.14);border-radius:12px;background:rgba(0,0,0,.14);
}
.wt-scope .pane-empty .pe-ico{font-size:34px;line-height:1;color:rgba(240,180,41,.5)}
.wt-scope .pane-empty p{margin:0;font-size:12.5px;color:var(--txt-dim)}
.wt-scope .pane-empty .hint{font-size:11.5px;color:var(--txt-mute);max-width:340px;line-height:1.7}

/* 右侧对话区 */
.wt-scope .chat-body{display:flex;flex-direction:column;gap:8px;overflow:hidden;padding:10px 11px 12px}
.wt-scope .chat-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;display:flex;flex-direction:column;gap:8px;padding-right:2px}
.wt-scope .msg{min-width:0;padding:8px 10px;border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.03)}
.wt-scope .msg.me{border-color:rgba(240,180,41,.24);background:rgba(240,180,41,.07)}
.wt-scope .msg-role{display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--txt-mute)}
.wt-scope .msg-time{margin-left:auto;letter-spacing:0;text-transform:none;font-family:var(--mono);font-size:9.5px;opacity:.7}
.wt-scope .msg-text{font-size:12px;line-height:1.65;color:var(--txt-dim);white-space:pre-wrap;word-break:break-word}
.wt-scope .chat-more{flex:none;text-align:center;font-family:var(--mono);font-size:9.5px;color:var(--txt-mute)}
.wt-scope .chat-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;flex:1;text-align:center;padding:18px}
.wt-scope .chat-empty p{margin:0;font-size:12px;line-height:1.7;color:var(--txt-mute)}
.wt-scope .chat-foot{display:flex;align-items:center;gap:8px;flex:none;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:8px}
.wt-scope .chat-note{margin-left:auto;font-size:9.5px;color:var(--txt-mute)}

/* ---------- 右击菜单 ---------- */
.wt-scope .ctx-menu{
  position:fixed;z-index:970;width:238px;padding:6px;border-radius:12px;
  border:1px solid var(--line-strong);
  background:rgba(16,18,23,.98);
  box-shadow:0 26px 60px -30px #000,0 0 0 1px rgba(240,180,41,.08);
  backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
  animation:wtPop .16s var(--ease);
}
.wt-scope .ctx-head{padding:6px 8px 8px;font-size:12px;font-weight:600;color:var(--txt);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-scope .ctx-label{padding:4px 8px;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--txt-mute)}
.wt-scope .ctx-item{
  display:flex;align-items:center;gap:8px;width:100%;padding:7px 8px;border:0;border-radius:8px;
  background:transparent;color:var(--txt-dim);font:inherit;font-size:12px;text-align:left;cursor:pointer;
}
.wt-scope .ctx-item:hover{background:rgba(255,255,255,.07);color:var(--txt)}
.wt-scope .ctx-item.on{color:#f7dd9f;background:rgba(240,180,41,.10)}
.wt-scope .ctx-item small{margin-left:auto;font-family:var(--mono);font-size:9.5px;color:var(--txt-mute);white-space:nowrap}
.wt-scope .ctx-check{margin-left:6px;font-size:11px;color:var(--amber)}
.wt-scope .ctx-item.danger:hover{color:#f0a08a;background:rgba(232,115,74,.10)}
.wt-scope .ctx-sep{height:1px;margin:5px 4px;background:var(--line)}

/* 侧边栏 / 卡片的小配件 */
.wt-scope .side-tip{margin:0;padding:2px 8px 0;font-size:9.5px;line-height:1.5;color:var(--txt-mute);opacity:.75}
.wt-scope .c-layout{
  margin-right:auto;padding:2px 6px;border:1px solid var(--line);border-radius:6px;
  font-family:var(--mono);font-size:9.5px;color:var(--txt-mute);white-space:nowrap;
}
.wt-scope .field-hint{margin-top:5px;font-size:10px;line-height:1.5;color:var(--txt-mute);word-break:break-all}
.wt-scope .field-reset{
  margin-left:auto;padding:2px 6px;border:1px solid var(--line);border-radius:6px;
  background:rgba(255,255,255,.04);color:var(--txt-mute);font-size:9.5px;letter-spacing:0;
  text-transform:none;cursor:pointer;
}
.wt-scope .field-reset:hover{color:var(--txt);border-color:var(--line-strong)}
.wt-scope .modal.add-modal{width:min(480px,94vw)}

/* ---------- 工作区会话（侧边栏，一键建成绑定项目） ---------- */
.wt-side .side-sessions{display:flex;flex-direction:column;flex:none;min-height:0;gap:2px}
.wt-side .slist{
  display:flex;flex-direction:column;gap:2px;margin-top:5px;padding-right:2px;
  max-height:22vh;overflow-y:auto;overscroll-behavior:contain;
}
.wt-side .srow{
  display:flex;align-items:center;gap:7px;width:100%;padding:5px 7px;
  border-radius:9px;border:1px solid transparent;background:rgba(0,0,0,.16);
  cursor:pointer;text-align:left;
  transition:background .18s var(--ease),border-color .18s var(--ease),transform .18s var(--ease);
}
.wt-side .srow:hover{background:rgba(240,180,41,.18);border-color:rgba(240,180,41,.45);transform:translateX(1px)}
.wt-side .srow.bound{opacity:.66}
.wt-side .srow-main{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.wt-side .srow-title{font-size:11.5px;font-weight:540;color:rgba(246,218,156,.9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-side .srow-sub{font-family:var(--mono);font-size:9px;color:rgba(246,218,156,.45);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.wt-side .srow-add{flex:none;font-size:12px;color:rgba(240,180,41,.9)}

/* ---------- 小窗：emoji 标签 ---------- */
.wt-scope .emoji-row{display:flex;flex-wrap:wrap;gap:5px}
.wt-scope .emoji{
  width:28px;height:28px;display:grid;place-items:center;border-radius:8px;cursor:pointer;
  border:1px solid var(--line);background:rgba(255,255,255,.04);
  font-size:14px;line-height:1;color:var(--txt-mute);transition:.18s var(--ease);
}
.wt-scope .emoji:first-child{width:auto;padding:0 9px;font-size:10px;font-family:var(--mono);letter-spacing:.02em}
.wt-scope .emoji:hover{border-color:var(--amber-line);background:rgba(240,180,41,.12);transform:translateY(-1px)}
.wt-scope .emoji.on{border-color:rgba(240,180,41,.6);background:rgba(240,180,41,.18);box-shadow:0 0 12px -3px rgba(240,180,41,.75);color:#f7dd9f}

/* ---------- 小窗：布局预览草图 ---------- */
.wt-scope .layout-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.wt-scope .layout-card{
  display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px 6px;
  border-radius:11px;border:1px solid var(--line);background:rgba(255,255,255,.03);
  color:var(--txt-mute);cursor:pointer;transition:.18s var(--ease);
}
.wt-scope .layout-card:hover{border-color:var(--line-strong);background:rgba(255,255,255,.06);color:var(--txt-dim)}
.wt-scope .layout-card.on{border-color:rgba(240,180,41,.55);background:rgba(240,180,41,.12);color:#f7dd9f;box-shadow:0 0 16px -8px rgba(240,180,41,.9)}
.wt-scope .layout-card .lc-label{font-size:11.5px;font-weight:600}
.wt-scope .layout-card .lc-k{font-size:9px;font-family:var(--mono);opacity:.75;text-align:center;line-height:1.35}
.wt-scope .sketch{
  display:grid;gap:2px;width:46px;height:28px;padding:3px;
  border:1px solid var(--line-strong);border-radius:6px;background:rgba(0,0,0,.38);
}
.wt-scope .sketch i{display:block;border-radius:2px;background:rgba(240,180,41,.22);border:1px solid rgba(240,180,41,.38)}
.wt-scope .sketch[data-layout="l3"]{grid-template-columns:1fr 1.5fr 1fr}
.wt-scope .sketch[data-layout="l2"]{grid-template-columns:1.5fr 1fr}
.wt-scope .sketch[data-layout="full"]{grid-template-columns:1fr}
.wt-scope .sketch[data-layout="l3"] i:nth-child(2){background:rgba(240,180,41,.42)}
.wt-scope .sketch[data-layout="l2"] i:nth-child(1){background:rgba(240,180,41,.42)}

/* ---------- 下拉选择（绑定对话） ---------- */
.wt-scope .wt-select{
  width:100%;padding:9px 11px;border-radius:10px;border:1px solid var(--line-strong);
  background:rgba(0,0,0,.38);color:var(--txt);font-size:12.5px;outline:0;cursor:pointer;
}
.wt-scope .wt-select:focus{border-color:var(--amber-line);box-shadow:0 0 0 3px rgba(240,180,41,.10)}

/* ---------- 交互按键：呼吸灯 ---------- */
@keyframes wtKeyBreathe{
  0%,100%{box-shadow:0 0 0 1px rgba(240,180,41,.10),0 0 0 rgba(240,180,41,0)}
  50%{box-shadow:0 0 0 1px rgba(240,180,41,.38),0 0 16px -3px rgba(240,180,41,.55)}
}
.wt-side .nl-btn,.wt-side .brand-tools button,.wt-side .srow,
.wt-scope .btn,.wt-scope .mini-btn,.wt-scope .emoji,.wt-scope .layout-card,.wt-scope .field-reset{
  animation:wtKeyBreathe 3.8s ease-in-out infinite;
}
.wt-side .brand-tools button{animation-delay:.5s}
.wt-side .nl-btn{animation-delay:.9s}
.wt-side .srow{animation-delay:1.3s}
.wt-scope .emoji{animation-delay:.7s}
.wt-scope .layout-card{animation-delay:1.1s}
.wt-scope .btn.primary{animation-duration:3.1s}

@media (max-width:1240px){
  .wt-scope .ws[data-layout="l3"]{grid-template-columns:minmax(0,1fr) 340px}
  .wt-scope .ws[data-layout="l3"] .pane-left{display:none}
}
@media (max-width:900px){
  .wt-scope .ws[data-layout="l2"]{grid-template-columns:minmax(0,1fr)}
  .wt-scope .ws[data-layout="l2"] .pane-chat{display:none}
}

@media (max-width:820px){
  .wt-scope .topbar{margin:10px 12px 12px;flex-wrap:wrap}
  .wt-scope .view{padding:0 12px 24px}
  .wt-scope .stats{grid-template-columns:repeat(2,1fr)}
  .wt-scope .grid{--gap:28px}
}
@media (prefers-reduced-motion:reduce){
  .wt-scope *{animation-duration:.001ms !important;animation-iteration-count:1 !important;transition-duration:.001ms !important}
}
`
