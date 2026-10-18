/**
 * core：状态、持久化、host API、布局预设、全部动作。
 *
 * 分层约定（改代码前先看这里）：
 *   core 不认识任何 UI 组件，只认「状态 + 动作」；UI 只读 store、只调导出的动作。
 *   所有 host 调用都走 apiGet / apiPost，统一超时、错误形状与竞态令牌。
 */
import { useState, useEffect } from 'react'

export const API = '/api/trae-worktable'
export const VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__

/* ============================ 常量 ============================ */

const LS = {
  projects: 'wt.projects',
  bindings: 'wt.bindings',
  status: 'wt.status',
  layouts: 'wt.layouts',
  ui: 'wt.ui.v2',
  view: 'wt.view',
  termHist: 'wt.termHistory',
}

export const STATES = {
  idle: { label: '待命', cls: 'idle' },
  working: { label: '进行中', cls: 'working' },
  'needs-you': { label: '待处理', cls: 'needs-you' },
  done: { label: '已完成', cls: 'done' },
}
export const STATE_ORDER = ['idle', 'working', 'needs-you', 'done']

/** host 的四态（running/waiting）与 UI 的四态（working/needs-you）只在这里换算 */
export function normState(raw) {
  const s = String(raw || '')
  if (s === 'running') return 'working'
  if (s === 'waiting') return 'needs-you'
  if (s === 'done') return 'done'
  if (s === 'idle') return 'idle'
  if (s === 'working' || s === 'needs-you') return s
  return 'idle'
}

/**
 * 布局预设：parts 决定分几栏，split 是初始像素宽。
 * 新增预设只需往这里加一行 —— 渲染、草图、右击菜单、小窗都读这张表。
 */
export const LAYOUTS = [
  { id: 'l3', label: '三分式', hint: '项目 / 工作区 / 对话', parts: ['left', 'main', 'chat'], split: { left: 250, chat: 380 } },
  { id: 'l2', label: '两分', hint: '工作区 / 对话', parts: ['main', 'chat'], split: { chat: 400 } },
  { id: 'full', label: '单栏', hint: '仅工作区，对话隐藏', parts: ['main'], split: {} },
  { id: 'wide', label: '对话主导', hint: '窄工作区 / 宽对话', parts: ['main', 'chat'], split: { chat: 560 } },
]
export const LAYOUT_IDS = LAYOUTS.map((l) => l.id)
export const DEFAULT_LAYOUT = 'l3'

export function layoutDef(id) {
  return LAYOUTS.find((l) => l.id === id) || LAYOUTS[0]
}

export const PANE_TABS = [
  { id: 'editor', label: '编辑器', icon: '◆' },
  { id: 'term', label: '终端', icon: '›_' },
  { id: 'web', label: '浏览器', icon: '◍' },
  { id: 'custom', label: '自定义', icon: '❖' },
]

export const EMOJI_CHOICES = ['🧰', '📁', '🔌', '🐍', '🌐', '🖥️', '🎨', '📜', '🗄️', '🧩', '📚', '🛠️', '⚙️', '🚀']

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

/* ============================ 工具 ============================ */

export function baseName(p) {
  if (typeof p !== 'string') return ''
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : p
}

export function shortPath(p, max = 42) {
  const s = String(p ?? '')
  if (s.length <= max) return s
  return '…' + s.slice(s.length - max + 1)
}

export function relTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const diff = Date.now() - ts
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return Math.round(diff / 60_000) + ' 分钟前'
  if (diff < 86_400_000) return Math.round(diff / 3_600_000) + ' 小时前'
  if (diff < 30 * 86_400_000) return Math.round(diff / 86_400_000) + ' 天前'
  return new Date(ts).toISOString().slice(0, 10)
}

export function fmtSize(n) {
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n >= 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(1) + ' KB'
  return n + ' B'
}

/** 运行时长：进行中的会话卡片/控制室用 */
export function fmtDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h) return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0')
  return m + ':' + String(s).padStart(2, '0')
}

export function projEmoji(p) {
  if (p && typeof p.icon === 'string' && p.icon) return p.icon
  const langs = Array.isArray(p?.langs) ? p.langs : []
  for (const lang of langs) {
    for (const [re, emoji] of LANG_EMOJI) if (re.test(String(lang).trim())) return emoji
  }
  return CAT_EMOJI[p?.category] || '📁'
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
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 隐私模式/配额满 */ }
}

/* ============================ 状态 ============================ */

export const store = {
  ready: false,
  view: 'grid',                 // grid | project
  open: false,
  activeId: null,
  projects: [],
  ui: {},                       // { [pid]: { layout, split, leftTab, tabs, activeTab } }
  status: {},                   // 手工覆盖态（跟绑定会话冲突时以手工为准）
  defaults: { workspace: '', home: '', shell: '', loaded: false },
  sessions: { state: 'pending', counts: null, rows: [], at: 0, error: '', source: '' },
  transcript: { sid: '', state: 'idle', messages: [], title: '', error: '', truncated: false },
  tree: { state: 'idle', root: '', path: '', entries: [], error: '' },
  editor: { state: 'idle', path: '', name: '', text: '', saved: '', error: '', truncated: false, binary: false, size: 0, saving: false },
  terms: {},                    // { [pid]: { id, cwd, busy, lines: [] } }
  git: { state: 'idle', repo: false, branch: '', changes: [], counts: null, error: '', log: [], branches: [] },
  web: { url: '', state: 'idle' },
  custom: { html: '<!doctype html><html><body style="font-family:system-ui;background:#0f1218;color:#e6e8eb;padding:24px"><h2>自定义窗口</h2><p>在下方编辑 HTML，Ctrl+S 刷新预览。</p></body></html>' },
  modal: null,                  // { kind, pid }
  menu: null,                   // { pid, x, y }
  toasts: [],
  tick: 0,                      // 每秒心跳，用于计时显示
}

const listeners = new Set()
let seq = 0

export function emit(patch) {
  if (patch) Object.assign(store, patch)
  for (const fn of listeners) {
    try { fn() } catch { /* 单订阅者异常不影响其它 */ }
  }
}

export function useStore() {
  const [, force] = useState(0)
  useEffect(() => {
    const fn = () => force((n) => n + 1)
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }, [])
  return store
}

/* ============================ 迁移 / 初始化 ============================ */

function normalizeProject(raw) {
  const p = raw && typeof raw === 'object' ? raw : {}
  const id = String(p.id || 'p-' + Math.random().toString(36).slice(2, 9))
  const sessions = Array.isArray(p.sessions) ? p.sessions.filter((s) => typeof s === 'string' && s) : []
  return {
    id,
    name: String(p.name || p.alias || '未命名项目'),
    alias: String(p.alias || p.name || '未命名项目'),
    icon: String(p.icon || ''),
    path: String(p.path || ''),
    note: String(p.note || ''),
    folder: String(p.folder || ''),
    order: Number.isFinite(p.order) ? p.order : 0,
    hidden: p.hidden === true,
    langs: Array.isArray(p.langs) ? p.langs : [],
    category: String(p.category || '自定义'),
    created: String(p.created || p.updated || new Date().toISOString().slice(0, 10)),
    updated: String(p.updated || new Date().toISOString().slice(0, 10)),
    sessions,
  }
}

export function hydrate() {
  const rawProjects = readLS(LS.projects, [])
  const legacyBind = readLS(LS.bindings, {})
  const legacyLayouts = readLS(LS.layouts, {})
  const ui = readLS(LS.ui, {})

  const projects = (Array.isArray(rawProjects) ? rawProjects : []).map((p) => {
    const rec = normalizeProject(p)
    if (!rec.sessions.length && legacyBind && typeof legacyBind[rec.id] === 'string') {
      rec.sessions = [legacyBind[rec.id]]
    }
    if (!ui[rec.id] && LAYOUT_IDS.includes(legacyLayouts?.[rec.id])) {
      ui[rec.id] = { layout: legacyLayouts[rec.id] }
    }
    return rec
  })

  emit({
    ready: true,
    projects,
    status: readLS(LS.status, {}) || {},
    ui: ui && typeof ui === 'object' ? ui : {},
    view: readLS(LS.view, 'grid') === 'project' ? 'project' : 'grid',
    terms: {},
  })
}

/* ============================ ui 片段读写 ============================ */

function defaultUi(pid) {
  return { layout: DEFAULT_LAYOUT, split: {}, leftTab: 'info', tabs: [], activeTab: '' }
}

export function uiOf(pid) {
  const raw = store.ui[pid] || {}
  const def = defaultUi(pid)
  const layout = LAYOUT_IDS.includes(raw.layout) ? raw.layout : def.layout
  return {
    layout,
    split: raw.split && typeof raw.split === 'object' ? raw.split : {},
    leftTab: raw.leftTab === 'files' ? 'files' : 'info',
    tabs: Array.isArray(raw.tabs) ? raw.tabs : [],
    activeTab: typeof raw.activeTab === 'string' ? raw.activeTab : '',
  }
}

function patchUi(pid, patch, persist = true) {
  const next = { ...uiOf(pid), ...patch }
  const ui = { ...store.ui, [pid]: next }
  emit({ ui })
  if (persist) writeLS(LS.ui, ui)
  return next
}

/* ============================ 会话绑定 ============================ */

export function projectOf(pid) {
  return store.projects.find((p) => p.id === pid) || null
}

export function sessionById(sid) {
  return store.sessions.rows.find((s) => s.id === sid) || null
}

export function sessionsOf(project) {
  const ids = Array.isArray(project?.sessions) ? project.sessions : []
  return ids.map((id) => sessionById(id) || { id, title: id.slice(0, 18), state: 'idle', cwd: '' })
}

/** 主绑定 = 第一个会话；对话预览、状态灯都以它为准 */
export function primarySession(project) {
  const list = sessionsOf(project)
  return list.length ? list[0] : null
}

export function stateOf(pid) {
  const manual = store.status[pid]
  if (STATES[manual]) return manual
  const p = projectOf(pid)
  const primary = p ? primarySession(p) : null
  return primary ? normState(primary.state) : 'idle'
}

export function stateSource(pid) {
  if (STATES[store.status[pid]]) return 'manual'
  const p = projectOf(pid)
  const primary = p ? primarySession(p) : null
  return primary && store.sessions.state === 'ok' ? 'bound' : ''
}

/* ============================ host API ============================ */

async function request(method, path, body, { timeout = 20_000, signal } = {}) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0
  if (signal && ctrl) signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  let res
  try {
    res = await fetch(API + path, {
      method,
      headers: body === undefined
        ? { accept: 'application/json' }
        : { accept: 'application/json', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl ? ctrl.signal : undefined,
    })
  } catch (err) {
    throw new Error(timeoutMessage(err, timeout))
  } finally {
    if (timer) clearTimeout(timer)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status))
  return data
}

function timeoutMessage(err, ms) {
  const name = String(err?.name || '')
  if (name === 'AbortError') return '请求超时（' + Math.round(ms / 1000) + 's）'
  return String(err?.message ?? err)
}

export const apiGet = (path, opts) => request('GET', path, undefined, opts)
export const apiPost = (path, body, opts) => request('POST', path, body ?? {}, opts)

/* ============================ toast ============================ */

export function toast(text, kind) {
  const id = ++seq
  emit({ toasts: store.toasts.concat([{ id, text: String(text), kind: kind || 'info' }]) })
  setTimeout(() => emit({ toasts: store.toasts.filter((t) => t.id !== id) }), 3400)
}

/* ============================ 宿主会话服务 ============================ */

let hostCtx = null
export function setHost(ctx) { hostCtx = ctx }

export function jumpToSession(sessionId) {
  const id = String(sessionId || '')
  if (!id) return false
  try {
    const ui = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('uiWorkspace') : null
    if (ui && typeof ui.openSession === 'function') { ui.openSession(id); return true }
  } catch { /* 试下一种入口 */ }
  try {
    const sessions = hostCtx?.sessions
    if (sessions && typeof sessions.open === 'function') { sessions.open(id); return true }
  } catch { /* 无入口 */ }
  return false
}

export async function loadSessions() {
  try {
    const data = await apiGet('/sessions', { timeout: 12_000 })
    emit({
      sessions: {
        state: data && data.ok === false ? 'error' : 'ok',
        counts: data?.counts || null,
        rows: Array.isArray(data?.sessions) ? data.sessions : [],
        at: Number(data?.at) || Date.now(),
        error: String(data?.error || data?.note || ''),
        source: String(data?.source || ''),
      },
    })
  } catch (err) {
    emit({ sessions: { state: 'error', counts: null, rows: [], at: Date.now(), error: String(err?.message ?? err), source: '' } })
  }
}

export async function loadDefaults() {
  try {
    const data = await apiGet('/defaults', { timeout: 8000 })
    emit({
      defaults: {
        workspace: String(data?.workspace || ''),
        home: String(data?.home || ''),
        shell: String(data?.shell || ''),
        loaded: true,
      },
    })
  } catch {
    emit({ defaults: { workspace: '', home: '', shell: '', loaded: true } })
  }
}

/* ---------- 对话预览（带竞态令牌） ---------- */

let transcriptToken = 0

export async function loadTranscript(sid) {
  const id = String(sid || '')
  const token = ++transcriptToken
  if (!id) {
    emit({ transcript: { sid: '', state: 'idle', messages: [], title: '', error: '', truncated: false } })
    return
  }
  emit({ transcript: { sid: id, state: 'loading', messages: [], title: '', error: '', truncated: false } })
  try {
    const data = await apiPost('/transcript', { sessionId: id, limit: 60 }, { timeout: 15_000 })
    if (token !== transcriptToken) return      // 切项目后旧请求晚到，直接丢弃
    if (!data || data.ok === false) throw new Error((data && data.error) || '读取失败')
    emit({
      transcript: {
        sid: id,
        state: 'ok',
        messages: Array.isArray(data.messages) ? data.messages : [],
        title: String(data.title || ''),
        error: '',
        truncated: !!data.truncated,
      },
    })
  } catch (err) {
    if (token !== transcriptToken) return
    emit({ transcript: { sid: id, state: 'error', messages: [], title: '', error: String(err?.message ?? err), truncated: false } })
  }
}

/* ============================ 视图切换 ============================ */

export function openGrid() {
  emit({ open: true, view: 'grid', activeId: null, modal: null, menu: null })
  writeLS(LS.view, 'grid')
  loadSessions()
  if (!store.defaults.loaded) loadDefaults()
}

export function enterProject(pid) {
  const project = projectOf(pid)
  if (!project) return
  emit({ open: true, view: 'project', activeId: pid, modal: null, menu: null })
  writeLS(LS.view, 'project')
  const primary = primarySession(project)
  loadTranscript(primary ? primary.id : '')
  loadSessions()
  if (!store.defaults.loaded) loadDefaults()
  registerProjectRoot(project)
  loadTree(project.path)
  loadGit(pid)
}

export function closeOverlay() {
  emit({ open: false, modal: null, menu: null })
}

let rootToken = 0
async function registerProjectRoot(project) {
  const token = ++rootToken
  if (!project?.path) return
  try {
    const data = await apiPost('/project/register', { id: project.id, root: project.path }, { timeout: 8000 })
    if (token !== rootToken) return
    if (data && data.ok === false) toast('项目目录不可用：' + project.path, 'warn')
  } catch { /* 静态托管不可用不影响其它功能 */ }
}

/* ============================ 项目增删改 ============================ */

function persistProjects(projects) {
  writeLS(LS.projects, projects)
  emit({ projects })
}

export function addProject({ name, path, emoji, layout, sessionId, note }) {
  const cleanName = String(name || '').trim()
  if (!cleanName) { toast('请填写项目名称', 'warn'); return '' }
  const pid = 'p-' + Date.now().toString(36)
  const rec = normalizeProject({
    id: pid,
    name: cleanName,
    alias: cleanName,
    icon: String(emoji || ''),
    path: String(path || '').trim() || store.defaults.workspace || '',
    note: String(note || ''),
    order: store.projects.length,
    sessions: sessionId ? [String(sessionId)] : [],
  })
  const projects = store.projects.concat([rec])
  persistProjects(projects)
  patchUi(pid, { layout: LAYOUT_IDS.includes(layout) ? layout : DEFAULT_LAYOUT })
  toast('已创建项目 ' + cleanName, 'ok')
  return pid
}

export function updateProject(pid, patch) {
  const projects = store.projects.map((p) => (
    p.id === pid ? normalizeProject({ ...p, ...patch, id: p.id }) : p
  ))
  persistProjects(projects)
}

export function removeProject(pid) {
  const projects = store.projects.filter((p) => p.id !== pid)
  persistProjects(projects)
  const status = { ...store.status }
  delete status[pid]
  emit({ status, menu: null })
  writeLS(LS.status, status)
  if (store.activeId === pid) {
    emit({ activeId: null, view: 'grid', transcript: { sid: '', state: 'idle', messages: [], title: '', error: '', truncated: false } })
  }
  toast('已移除项目（磁盘文件未动）', 'info')
}

export function moveProject(pid, delta) {
  const list = store.projects.slice()
  const at = list.findIndex((p) => p.id === pid)
  const to = at + delta
  if (at < 0 || to < 0 || to >= list.length) return
  const [item] = list.splice(at, 1)
  list.splice(to, 0, item)
  persistProjects(list.map((p, i) => ({ ...p, order: i })))
}

export function toggleHidden(pid) {
  const p = projectOf(pid)
  if (!p) return
  updateProject(pid, { hidden: !p.hidden })
  toast(p.hidden ? '已恢复显示' : '已从列表隐藏（项目仍在）', 'info')
}

/* ============================ 绑定 ============================ */

export function bindSession(pid, sid) {
  const p = projectOf(pid)
  if (!p) return
  const next = p.sessions.includes(sid) ? p.sessions : p.sessions.concat([sid])
  updateProject(pid, { sessions: next })
  emit({ modal: null })
  if (store.activeId === pid) loadTranscript(next[0] || '')
  const s = sessionById(sid)
  toast('已绑定对话：' + (s ? s.title : sid), 'ok')
}

export function unbindSession(pid, sid) {
  const p = projectOf(pid)
  if (!p) return
  const next = p.sessions.filter((x) => x !== sid)
  updateProject(pid, { sessions: next })
  if (store.activeId === pid) loadTranscript(next[0] || '')
  toast('已解除绑定', 'info')
}

export function createFromSession(session) {
  const sid = String(session?.id || '')
  if (!sid) return
  const existing = store.projects.find((p) => p.sessions.includes(sid))
  if (existing) {
    toast('该对话已有项目：' + (existing.alias || existing.name), 'info')
    enterProject(existing.id)
    return
  }
  const title = String(session?.title || '').trim() || baseName(session?.cwd || '') || '未命名对话'
  const pid = addProject({ name: title.slice(0, 40), path: session?.cwd || '', sessionId: sid })
  if (pid) enterProject(pid)
}

/* ============================ 状态 / 布局 ============================ */

export function cycleStatus(pid) {
  const cur = stateOf(pid)
  const next = STATE_ORDER[(STATE_ORDER.indexOf(cur) + 1) % STATE_ORDER.length]
  const status = { ...store.status, [pid]: next }
  emit({ status })
  writeLS(LS.status, status)
}

export function setLayout(pid, layout) {
  if (!LAYOUT_IDS.includes(layout)) return
  patchUi(pid, { layout, split: {} })
  emit({ menu: null })
  toast('界面布局：' + layoutDef(layout).label, 'ok')
}

export function setSplit(pid, key, px, persist = false) {
  const ui = uiOf(pid)
  const split = { ...ui.split, [key]: Math.round(px) }
  patchUi(pid, { split }, persist)
}

/** 拖拽松手时把当前 ui 落盘（不能依赖闭包里的旧宽度） */
export function flushUi() {
  writeLS(LS.ui, store.ui)
}

export function setLeftTab(pid, tab) {
  patchUi(pid, { leftTab: tab })
}

/* ============================ 标签页 ============================ */

function tabKey(kind, extra) {
  return extra ? kind + ':' + extra : kind
}

export function openTab(pid, kind, opts = {}) {
  const ui = uiOf(pid)
  const key = tabKey(kind, opts.key)
  const title = opts.title || (PANE_TABS.find((t) => t.id === kind)?.label || kind)
  const exists = ui.tabs.some((t) => t.key === key)
  const tabs = exists ? ui.tabs : ui.tabs.concat([{ key, kind, title }])
  patchUi(pid, { tabs, activeTab: key })
}

export function closeTab(pid, key) {
  const ui = uiOf(pid)
  const idx = ui.tabs.findIndex((t) => t.key === key)
  if (idx < 0) return
  const tabs = ui.tabs.filter((t) => t.key !== key)
  const activeTab = ui.activeTab === key ? (tabs[Math.max(0, idx - 1)]?.key || '') : ui.activeTab
  patchUi(pid, { tabs, activeTab })
}

export function setActiveTab(pid, key) {
  patchUi(pid, { activeTab: key })
}

/* ============================ 文件树 ============================ */

const treeCache = new Map()          // path → { entries, at }
let treeToken = 0

export async function loadTree(path) {
  const target = String(path || '')
  if (!target) return
  const token = ++treeToken
  const cached = treeCache.get(target)
  if (cached && Date.now() - cached.at < 4000) {
    emit({ tree: { state: 'ok', root: target, path: target, entries: cached.entries, error: '' } })
    return
  }
  emit({ tree: { ...store.tree, state: 'loading', root: target, path: target, error: '' } })
  try {
    const data = await apiPost('/fs/list', { path: target }, { timeout: 15_000 })
    if (token !== treeToken) return
    const entries = Array.isArray(data?.entries) ? data.entries : []
    treeCache.set(target, { entries, at: Date.now() })
    treeCache.set(data.path, { entries, at: Date.now() })
    emit({ tree: { state: 'ok', root: data.path || target, path: data.path || target, entries, error: '' } })
  } catch (err) {
    if (token !== treeToken) return
    emit({ tree: { state: 'error', root: target, path: target, entries: [], error: String(err?.message ?? err) } })
  }
}

/* ============================ 编辑器 ============================ */

let fileToken = 0

export async function openFile(path, pid) {
  const target = String(path || '')
  if (!target) return
  const token = ++fileToken
  emit({ editor: { ...store.editor, state: 'loading', path: target, name: baseName(target), error: '', binary: false } })
  if (pid) openTab(pid, 'editor')
  try {
    const data = await apiPost('/fs/read', { path: target }, { timeout: 20_000 })
    if (token !== fileToken) return
    emit({
      editor: {
        state: 'ok',
        path: data.path || target,
        name: data.name || baseName(target),
        text: String(data.text ?? ''),
        saved: String(data.text ?? ''),
        error: '',
        truncated: !!data.truncated,
        binary: !!data.binary,
        size: Number(data.size) || 0,
      },
    })
    if (pid) {
      const ui = uiOf(pid)
      const tabs = ui.tabs.map((t) => (t.kind === 'editor' ? { ...t, title: data.name || baseName(target) } : t))
      patchUi(pid, { tabs })
    }
  } catch (err) {
    if (token !== fileToken) return
    emit({ editor: { ...store.editor, state: 'error', path: target, name: baseName(target), error: String(err?.message ?? err) } })
  }
}

export function editText(text) {
  emit({ editor: { ...store.editor, text: String(text ?? '') } })
}

export async function saveFile() {
  const ed = store.editor
  if (!ed.path || ed.state !== 'ok') return
  if (ed.text === ed.saved) { toast('没有改动需要保存', 'info'); return }
  emit({ editor: { ...ed, saving: true } })
  try {
    await apiPost('/fs/write', { path: ed.path, text: ed.text }, { timeout: 25_000 })
    emit({ editor: { ...store.editor, saved: store.editor.text, saving: false, size: new Blob([store.editor.text]).size } })
    treeCache.delete(store.tree.path)
    toast('已保存 ' + ed.name, 'ok')
  } catch (err) {
    emit({ editor: { ...store.editor, saving: false } })
    toast('保存失败：' + String(err?.message ?? err), 'warn')
  }
}

/* ============================ 终端 ============================ */

function termOf(pid) {
  if (!store.terms[pid]) store.terms[pid] = { id: 'wt-' + pid, cwd: '', busy: false, lines: [], history: [], hidx: -1 }
  return store.terms[pid]
}

function termPatch(pid, patch) {
  const terms = { ...store.terms, [pid]: { ...termOf(pid), ...patch } }
  emit({ terms })
}

export function termAppend(pid, line) {
  const term = termOf(pid)
  const lines = term.lines.concat([line]).slice(-1200)
  termPatch(pid, { lines })
}

export function termClear(pid) {
  termPatch(pid, { lines: [] })
}

function pushHistory(pid, cmd) {
  const term = termOf(pid)
  const history = (term.history || []).concat([cmd]).slice(-80)
  termPatch(pid, { history })
  writeLS(LS.termHist, history)
}

/** 执行一条命令：NDJSON 流逐块追加到终端日志 */
export async function termExec(pid, cmdRaw) {
  const cmd = String(cmdRaw || '').trim()
  if (!cmd) return
  const term = termOf(pid)
  if (term.busy) { toast('上一条命令还在跑', 'warn'); return }
  const project = projectOf(pid)
  pushHistory(pid, cmd)
  termPatch(pid, { busy: true })
  termAppend(pid, { kind: 'cmd', text: cmd })

  const ctrl = typeof AbortController === 'function' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 130_000) : 0
  try {
    const res = await fetch(API + '/term/exec', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: term.id, cmd, cwd: term.cwd || project?.path || '' }),
      signal: ctrl ? ctrl.signal : undefined,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => null)
      throw new Error((data && data.error) || ('HTTP ' + res.status))
    }
    const reader = res.body?.getReader?.()
    if (!reader) {
      const text = await res.text()
      for (const line of text.split('\n')) applyTermEvent(pid, line)
      return
    }
    const decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder ? decoder.decode(value, { stream: true }) : String(value)
      let at
      while ((at = buffer.indexOf('\n')) !== -1) {
        applyTermEvent(pid, buffer.slice(0, at))
        buffer = buffer.slice(at + 1)
      }
    }
    if (buffer.trim()) applyTermEvent(pid, buffer)
  } catch (err) {
    termAppend(pid, { kind: 'err', text: '执行失败：' + String(err?.message ?? err) })
  } finally {
    if (timer) clearTimeout(timer)
    termPatch(pid, { busy: false })
  }
}

function applyTermEvent(pid, raw) {
  if (!raw.trim()) return
  let ev
  try { ev = JSON.parse(raw) } catch { return }
  if (ev.t === 'out') termAppend(pid, { kind: 'out', text: String(ev.d ?? '') })
  else if (ev.t === 'err') termAppend(pid, { kind: 'err', text: String(ev.d ?? '') })
  else if (ev.t === 'sys') termAppend(pid, { kind: 'sys', text: String(ev.d ?? '') })
  else if (ev.t === 'cwd') termPatch(pid, { cwd: String(ev.d ?? '') })
  else if (ev.t === 'clear') termPatch(pid, { lines: [] })
  else if (ev.t === 'end') {
    if (ev.code !== 0 && ev.code != null) termAppend(pid, { kind: 'sys', text: '[退出码 ' + ev.code + ']' })
  }
}

export async function termKill(pid) {
  const term = termOf(pid)
  try { await apiPost('/term/kill', { id: term.id }) } catch { /* 已结束 */ }
  termAppend(pid, { kind: 'sys', text: '[已请求终止]' })
}

/* ============================ git ============================ */

export async function loadGit(pid) {
  const project = projectOf(pid)
  if (!project?.path) { emit({ git: { state: 'idle', repo: false, branch: '', changes: [], counts: null, error: '未设置项目路径', log: [], branches: [] } }); return }
  emit({ git: { ...store.git, state: 'loading', error: '' } })
  try {
    const status = await apiPost('/git', { path: project.path, op: 'status' }, { timeout: 15_000 })
    if (!status?.repo) {
      emit({ git: { state: 'ok', repo: false, branch: '', changes: [], counts: null, error: '', log: [], branches: [] } })
      return
    }
    const [log, branches] = await Promise.all([
      apiPost('/git', { path: project.path, op: 'log', limit: 15 }).catch(() => ({ commits: [] })),
      apiPost('/git', { path: project.path, op: 'branches' }).catch(() => ({ branches: [] })),
    ])
    emit({
      git: {
        state: 'ok',
        repo: true,
        branch: String(status.branch || ''),
        changes: Array.isArray(status.changes) ? status.changes : [],
        counts: status.counts || { staged: 0, unstaged: 0, untracked: 0, total: 0 },
        error: '',
        log: Array.isArray(log?.commits) ? log.commits : [],
        branches: Array.isArray(branches?.branches) ? branches.branches : [],
      },
    })
  } catch (err) {
    emit({ git: { state: 'error', repo: false, branch: '', changes: [], counts: null, error: String(err?.message ?? err), log: [], branches: [] } })
  }
}

/* ============================ 浏览器 / 自定义 ============================ */

export function siteUrlOf(project) {
  if (!project) return ''
  return API + '/site/' + encodeURIComponent(project.id) + '/'
}

export function setWebUrl(url) {
  emit({ web: { url: String(url || ''), state: 'ok' } })
}

export function setCustomHtml(html) {
  emit({ custom: { html: String(html ?? '') } })
}

/* ============================ 菜单 / 弹窗 ============================ */

export function openMenu(pid, x, y) { emit({ menu: { pid, x, y } }) }
export function closeMenu() { if (store.menu) emit({ menu: null }) }
export function openModal(kind, pid) { emit({ modal: { kind, pid: pid || null }, menu: null }) }
export function closeModal() { emit({ modal: null }) }

/* ============================ 心跳（计时） ============================ */

export function startTicker() {
  const timer = setInterval(() => { emit({ tick: store.tick + 1 }) }, 1000)
  return () => clearInterval(timer)
}
