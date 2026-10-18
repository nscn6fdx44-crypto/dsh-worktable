/**
 * core：状态、持久化、host API、布局预设、全部动作。
 *
 * 分层约定（改代码前先看这里）：
 *   core 不认识任何 UI 组件，只认「状态 + 动作」；UI 只读 store、只调导出的动作。
 *   所有 host 调用都走 apiGet / apiPost，统一超时、错误形状与竞态令牌。
 */
import { useState, useEffect } from 'react'
import { viewKindOf, isMediaKind, hasPreview } from './render.js'

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
  web: 'wt.web',
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
 * 工作区标签页。工作台里 **没有左栏**：项目信息 / 文件浏览都是标签页，
 * 和编辑器、终端、浏览器、自定义窗口平级，标签页本身就把整块让位区占满。
 */
export const PANE_TABS = [
  { id: 'files', label: '文件管理器', icon: '🗂' },
  { id: 'editor', label: '编辑器', icon: '◆' },
  { id: 'term', label: '终端', icon: '›_' },
  { id: 'web', label: '浏览器', icon: '◍' },
  { id: 'custom', label: '自定义', icon: '❖' },
]

/** 项目信息（状态 / 绑定 / git）不在快捷按钮里，单独从顶栏进 */
export const INFO_TAB = { id: 'info', label: '项目信息', icon: 'ⓘ' }

export function tabDef(id) {
  return PANE_TABS.find((t) => t.id === id) || (id === INFO_TAB.id ? INFO_TAB : null)
}

/**
 * 总览（卡片网格）的页签。总览现在是「顶栏 + 一条标签页」的工作台同款结构，
 * 不再是一个大统计块：数字都收进页签上的计数徽标。
 */
export const GRID_TABS = [
  { id: 'projects', label: '项目', icon: '▦' },
  { id: 'sessions', label: '宿主会话', icon: '◉' },
  { id: 'running', label: '运行中', icon: '◐' },
]

/**
 * 总览的「虚拟项目 id」：总览和工作区一样占让位区，
 * 它的宽度 / 模式 / 窗口几何也得有个 key 存进 wt.ui.v2。
 * 用 __ 开头保证不会和真实项目 id 撞上。
 */
export const GRID_PID = '__overview'

export const GRID_TAB_IDS = GRID_TABS.map((t) => t.id)

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

/** 拼路径：沿用 base 的分隔符风格（Windows 反斜杠 / POSIX 正斜杠） */
export function joinPath(base, name) {
  const b = String(base || '')
  const n = String(name || '')
  if (!b) return n
  const sep = b.includes('\\') ? '\\' : '/'
  return b.replace(/[\\/]+$/, '') + sep + n
}

/** 面包屑：把绝对路径切成 [{label, path}]，Windows 盘符单独一节 */
export function crumbsOf(p) {
  const s = String(p || '')
  if (!s) return []
  const win = /^[a-zA-Z]:/.test(s)
  const sep = s.includes('\\') ? '\\' : '/'
  const parts = s.split(/[\\/]+/).filter(Boolean)
  const out = []
  let acc = ''
  if (win) {
    acc = parts[0] + sep
    out.push({ label: parts[0].toUpperCase(), path: acc })
    parts.shift()
  }
  for (const seg of parts) {
    acc = acc ? (acc.endsWith(sep) ? acc + seg : acc + sep + seg) : (s.startsWith(sep) ? sep + seg : seg)
    out.push({ label: seg, path: acc })
  }
  return out
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
  gridTab: 'projects',          // 总览页签：projects | sessions | running
  open: false,
  activeId: null,
  projects: [],
  ui: {},                       // { [pid]: { dock, tabs, activeTab } }
  status: {},                   // 手工覆盖态（跟绑定会话冲突时以手工为准）
  defaults: { workspace: '', home: '', shell: '', loaded: false },
  sessions: { state: 'pending', counts: null, rows: [], at: 0, error: '', source: '' },
  /* 文件管理器：一次只列一个目录，path/parent 用于面包屑与「上一级」；pid 记住是哪个项目的树 */
  tree: { state: 'idle', pid: '', path: '', name: '', parent: '', writable: true, entries: [], total: 0, truncated: false, error: '', at: 0 },
  /* 文件管理器的视图偏好（排序 / 过滤 / 选中项），纯前端 */
  fs: { sort: 'name', dir: 1, query: '', sel: '', busy: '', menu: null },
  editor: {
    state: 'idle', path: '', name: '', text: '', saved: '', error: '', truncated: false,
    /* partial = 只读了文件的一段（大文件只读预览）；这种状态**禁止保存**，否则会把文件截断写回 */
    partial: false, tail: false, binary: false, errorCode: 0, size: 0, limit: 0, previewBytes: 0, saving: false,
    /* kind 决定正文怎么画（markdown / code / image / pdf / video / audio / text）；
       view 是用户的看法（preview 渲染 / edit 原文），媒体类没有 preview/edit 之分 */
    kind: 'text', view: 'edit', mediaUrl: '',
  },
  terms: {},                    // { [pid]: { id, cwd, busy, lines: [] } }
  git: { state: 'idle', repo: false, branch: '', changes: [], counts: null, error: '', log: [], branches: [] },
  /* 浏览器窗格：地址栏历史 + 加载态 + 视口 + 探测结果（探测能提前知道「能不能嵌」） */
  web: {
    pid: '', defaultUrl: '', url: '', state: 'idle', error: '',
    at: 0, startedAt: 0, ms: 0, viewport: 'auto',
    history: [], index: -1,
    /* 「⋯」下拉是否展开：跟 fs.menu 一样走 store，重渲染不掉 */
    more: false,
    probe: { state: 'idle', url: '', ok: false, status: 0, ms: 0, title: '', frameable: true, reason: '', error: '', at: 0 },
  },
  /* 自定义窗口库：列表 / 当前条目 / 编辑副本 / 三种视图（生成 · 预览 · 编辑） */
  custom: {
    state: 'idle', items: [], active: '', item: null, draft: null,
    view: 'prompt', busy: '', error: '', prompt: '', file: '',
    /* 需求草稿放 store：切标签页回来还在，不用重打 */
    requirement: '',
  },
  modal: null,                  // { kind, pid }
  menu: null,                   // { pid, x, y }
  toasts: [],
  /* 系统文件管理器最近一次调用结果：面板上要能看见「到底打开成功没有」 */
  reveal: { state: 'idle', path: '', at: 0, error: '', cmd: '' },
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
    if (!ui[rec.id] && legacyLayouts && legacyLayouts[rec.id]) {
      ui[rec.id] = {}                    // 旧布局预设已无意义：现在只有一种形态
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

/**
 * 每个项目（以及总览的 GRID_PID）的工作台状态。
 * 只剩「让位宽度 + 标签页」：窗口模式已删除，工作台永远铺满对话左侧那块。
 * 旧 localStorage 里的 mode / win / split / leftTab 等键直接忽略，不迁移。
 */
export function uiOf(pid) {
  const raw = store.ui[pid] || {}
  const dock = Number(raw.dock)
  return {
    /* 0 = 自动（按宿主轨道比例算），>0 = 用户拖过的像素宽 */
    dock: Number.isFinite(dock) && dock > 0 ? Math.round(dock) : 0,
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

/** 某个宿主会话被绑到了哪个项目（没有就 null） */
export function projectBySession(sid) {
  const id = String(sid || '')
  if (!id) return null
  return store.projects.find((p) => Array.isArray(p.sessions) && p.sessions.includes(id)) || null
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

/**
 * 项目灯 = 这个项目里**最需要你注意**的那个对话的状态：
 * 待处理 > 进行中 > 主对话。只绑一个对话时与主对话完全一致。
 */
export function stateOf(pid) {
  const manual = store.status[pid]
  if (STATES[manual]) return manual
  const p = projectOf(pid)
  if (!p) return 'idle'
  const list = sessionsOf(p)
  if (!list.length) return 'idle'
  const states = list.map((s) => normState(s.state))
  if (states.includes('needs-you')) return 'needs-you'
  if (states.includes('working')) return 'working'
  return states[0]
}

export function stateSource(pid) {
  if (STATES[store.status[pid]]) return 'manual'
  const p = projectOf(pid)
  const primary = p ? primarySession(p) : null
  return primary && store.sessions.state === 'ok' ? 'bound' : ''
}

/**
 * 状态框的四态计数 —— **按项目**统计，不是按宿主会话。
 *
 * 为什么不再用 host `/sessions` 返回的 `counts`：那份只认宿主会话，
 * 手工改过的项目状态（store.status）、没绑定对话的项目、被隐藏的项目都不在里面，
 * 而它的来源是 4s 一次的轮询快照 —— 于是「改了项目状态，状态栏纹丝不动」。
 * 这里跟 `stateOf()` 走同一条口径：项目灯是什么色，就记到哪一格，
 * 任何一次 emit（改状态 / 绑定对话 / 会话轮询 / 隐藏项目）都会重算。
 */
export function statusCounts(list) {
  const counts = { working: 0, 'needs-you': 0, done: 0, idle: 0, total: 0 }
  const src = Array.isArray(list) ? list : store.projects
  for (const p of src) {
    if (!p || p.hidden) continue
    counts[normState(stateOf(p.id))] += 1
    counts.total += 1
  }
  return counts
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
  if (!res.ok) {
    const err = new Error((data && data.error) || ('HTTP ' + res.status))
    /* 状态码要留给界面判断：413 = 文件过大（给只读预览出口），415 = 二进制（给系统程序出口） */
    err.status = res.status
    err.data = data || null
    throw err
  }
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
let workspaceUi = null

export function setHost(ctx) {
  hostCtx = ctx
  try {
    const ui = ctx && typeof ctx.get === 'function' ? ctx.get('uiWorkspace') : null
    if (ui) workspaceUi = ui
  } catch { /* 服务未注册 */ }
}

/** 延迟注入的 uiWorkspace（会话切换入口），缺席时退到 sessions.open */
export function setWorkspace(ui) {
  if (ui) workspaceUi = ui
}

/**
 * 在指定目录新建一个宿主对话（新建项目时「＋ 新建对话」用）。
 * 宿主各版本签名不统一，这里按「对象 → 字符串 → 无参」逐个试，谁先返回 id 就用谁。
 * 全都不可用就返回 ''，由调用方退化成「先建项目，稍后手动绑定」。
 */
export async function createSessionInDir(dir) {
  const cwd = String(dir || '').trim()
  const svcs = [workspaceUi, hostCtx && hostCtx.uiWorkspace, hostCtx && hostCtx.sessions].filter(Boolean)
  const methods = ['createSession', 'newSession', 'create', 'openSession']
  for (const svc of svcs) {
    for (const method of methods) {
      const fn = svc && svc[method]
      if (typeof fn !== 'function') continue
      const args = cwd ? [{ cwd }, cwd, undefined] : [undefined]
      for (const arg of args) {
        try {
          const out = await fn.call(svc, arg)
          const id = sessionIdOf(out)
          if (id) {
            await loadSessions()
            toast('已新建对话并绑定', 'ok')
            return id
          }
        } catch { /* 换下一个签名 */ }
      }
    }
  }
  toast('宿主没提供新建对话的入口，项目已建好，可稍后手动绑定', 'warn')
  return ''
}

/** 从各家的返回值里挖出会话 id */
function sessionIdOf(out) {
  if (!out) return ''
  if (typeof out === 'string') return out
  if (typeof out === 'object') {
    const id = out.id || out.sessionId || (out.header && out.header.id) || (out.session && out.session.id)
    if (typeof id === 'string' && id) return id
  }
  return ''
}

export function jumpToSession(sessionId) {
  const id = String(sessionId || '')
  if (!id) return false
  const cands = [workspaceUi, hostCtx && hostCtx.uiWorkspace]
  for (const ui of cands) {
    if (ui && typeof ui.openSession === 'function') {
      try { ui.openSession(id); return true } catch { /* 换下一个入口 */ }
    }
  }
  try {
    const sessions = hostCtx && hostCtx.sessions
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

/* ============================ 视图切换 ============================ */

export function openGrid() {
  emit({ open: true, view: 'grid', activeId: null, modal: null, menu: null })
  writeLS(LS.view, 'grid')
  loadSessions()
  if (!store.defaults.loaded) loadDefaults()
}

/** 切总览页签（项目 / 宿主会话 / 运行中）；再次打开总览保持上次页签 */
export function setGridTab(id) {
  if (!GRID_TAB_IDS.includes(id)) return
  if (store.gridTab !== id) emit({ gridTab: id })
}

export function enterProject(pid) {
  const project = projectOf(pid)
  if (!project) return
  emit({ open: true, view: 'project', activeId: pid, modal: null, menu: null })
  writeLS(LS.view, 'project')
  /* 右侧就是宿主对话：进项目就把宿主切到主绑定对话，所见即所聊 */
  const primary = primarySession(project)
  const switched = primary ? jumpToSession(primary.id) : false
  if (primary && !switched) toast('没找到宿主打开对话的入口，右侧可能停在别的对话', 'warn')
  loadSessions()
  if (!store.defaults.loaded) loadDefaults()
  /* 第一次进项目先摆「项目信息」：工作区不至于空着，也不会一进来就弹系统窗口 */
  if (!uiOf(pid).tabs.length) openTab(pid, INFO_TAB.id, { silent: true })
  /* 先登记项目根 + 对话工作目录：host 的路径白名单靠这次登记放行 */
  registerProjectRoot(project).finally(() => { loadGit(pid) })
}

export function closeOverlay() {
  emit({ open: false, modal: null, menu: null })
}

let rootToken = 0
async function registerProjectRoot(project) {
  const token = ++rootToken
  if (project?.path) {
    try {
      const data = await apiPost('/project/register', { id: project.id, root: project.path }, { timeout: 8000 })
      if (token !== rootToken) return
      if (data && data.ok === false) toast('项目目录不可用：' + project.path, 'warn')
    } catch { /* 静态托管不可用不影响其它功能 */ }
  }
  /* 对话的工作目录可能不在项目目录里（也可以是 D 盘任意位置），
     单独登记一条只为放行文件管理器读写；id 加后缀，不覆盖上面的静态托管根 */
  const dir = workspaceDirOf(project)
  if (!dir || samePath(dir, project.path)) return
  try {
    await apiPost('/project/register', { id: project.id + '~cwd', root: dir }, { timeout: 8000 })
  } catch { /* 目录不存在就等文件管理器自己报错 */ }
}

/** 比较两个绝对路径是否指向同一处（Windows 大小写 / 斜杠都不敏感） */
export function samePath(a, b) {
  const norm = (v) => String(v || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  const x = norm(a)
  return !!x && x === norm(b)
}

/**
 * 项目的「工作目录」= 主绑定对话的 cwd，取不到才退回项目目录。
 * 文件管理器默认开在这里：对话在哪个目录干活，就打开哪个目录。
 */
export function workspaceDirOf(project) {
  const primary = project ? primarySession(project) : null
  const cwd = String((primary && primary.cwd) || '').trim()
  return cwd || String((project && project.path) || '')
}

/* ============================ 项目增删改 ============================ */

function persistProjects(projects) {
  writeLS(LS.projects, projects)
  emit({ projects })
}

export function addProject({ name, path, emoji, sessionId, note }) {
  const cleanName = String(name || '').trim()
  if (!cleanName) { toast('请填写项目名称', 'warn'); return '' }
  const pid = 'p-' + Date.now().toString(36)
  const rec = normalizeProject({
    id: pid,
    name: cleanName,
    alias: cleanName,
    icon: String(emoji || ''),
    path: String(path || '').trim(),
    note: String(note || ''),
    order: store.projects.length,
    sessions: sessionId ? [String(sessionId)] : [],
  })
  const projects = store.projects.concat([rec])
  persistProjects(projects)
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
    emit({ activeId: null, view: 'grid' })
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
  if (store.activeId === pid && next[0] === sid) jumpToSession(sid)
  const s = sessionById(sid)
  toast('已绑定对话：' + (s ? s.title : sid), 'ok')
}

export function unbindSession(pid, sid) {
  const p = projectOf(pid)
  if (!p) return
  const next = p.sessions.filter((x) => x !== sid)
  updateProject(pid, { sessions: next })
  if (store.activeId === pid && next[0]) jumpToSession(next[0])
  toast('已解除绑定', 'info')
}

/** 把某个已绑定对话提为「主对话」：状态灯与右侧预览以主对话为准 */
export function setPrimarySession(pid, sid) {
  const p = projectOf(pid)
  if (!p || !p.sessions.includes(sid)) return
  const next = [sid].concat(p.sessions.filter((x) => x !== sid))
  updateProject(pid, { sessions: next })
  if (store.activeId === pid) jumpToSession(sid)
  toast('已设为主对话', 'ok')
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

/** 工作台让位宽度（px）；0 = 自动（按宿主轨道比例算） */
export function setDockPx(pid, px, persist = false) {
  const dock = Math.max(0, Math.round(Number(px) || 0))
  return patchUi(pid, { dock }, persist)
}

/** 拖拽松手时把当前 ui 落盘（不能依赖闭包里的旧宽度） */
export function flushUi() {
  writeLS(LS.ui, store.ui)
}

/* ============================ 标签页 ============================ */

function tabKey(kind, extra) {
  return extra ? kind + ':' + extra : kind
}

export function openTab(pid, kind, opts = {}) {
  const ui = uiOf(pid)
  const key = tabKey(kind, opts.key)
  const title = opts.title || (tabDef(kind)?.label || kind)
  const exists = ui.tabs.some((t) => t.key === key)
  const tabs = exists ? ui.tabs : ui.tabs.concat([{ key, kind, title }])
  patchUi(pid, { tabs, activeTab: key })
  /* 文件管理器在面板里自绘（系统资源管理器嵌不进 HTML），开标签页不再弹系统窗口 */
  if (kind === 'files' && pid !== GRID_PID) {
    const p = projectOf(pid)
    const dir = p ? workspaceDirOf(p) : ''
    if (dir && (store.tree.pid !== pid || !sameTreePath(dir))) loadTree(dir, { pid })
  }
}

/** 当前树已经在这个目录（含大小写/斜杠差异）就不要再列一次 */
function sameTreePath(dir) {
  const norm = (v) => String(v || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
  const cur = norm(store.tree.path)
  return !!cur && cur === norm(dir)
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

/* ============================ 文件管理器（交给系统窗口） ============================ */

/**
 * 让操作系统的文件管理器打开这个路径。
 * 本插件不再自绘文件列表：点「文件管理器」标签页 = 直接弹系统窗口，
 * 面板里只留路径、说明和「再打开一次」的按钮。
 *
 * 结果一律写进 store.reveal，面板会显示「刚才是打开了，还是失败了、失败在哪儿」。
 */
export async function revealPath(path, opts = {}) {
  const target = String(path || '').trim()
  if (!target) {
    toast('没有可打开的目录', 'warn')
    emit({ reveal: { state: 'error', path: '', at: Date.now(), error: '没有可打开的目录', cmd: '' } })
    return false
  }
  emit({ reveal: { state: 'loading', path: target, at: Date.now(), error: '', cmd: '' } })
  try {
    const data = await apiPost('/fs/reveal', { path: target, select: opts.select === true }, { timeout: 8000 })
    if (data && data.ok === false) throw new Error(data.error || '打开失败')
    emit({ reveal: { state: 'ok', path: target, at: Date.now(), error: '', cmd: String(data?.cmd || '') } })
    if (opts.quiet !== true) toast('已在系统文件管理器中打开', 'ok')
    return true
  } catch (err) {
    const text = String(err?.message ?? err)
    emit({ reveal: { state: 'error', path: target, at: Date.now(), error: text, cmd: '' } })
    toast('没能打开系统文件管理器：' + text, 'warn')
    return false
  }
}

/* ============================ 文件树 ============================ */

const treeCache = new Map()          // path → { entries, at }
let treeToken = 0

/**
 * 列一个目录。
 * @param {string} path 绝对路径
 * @param {{force?:boolean, pid?:string}} opts force = 不吃 4s 缓存（增删改之后必须强制刷新）；
 *        pid = 记下这棵树属于哪个项目，切项目时据此判断要不要换目录
 */
export async function loadTree(path, opts = {}) {
  const target = String(path || '')
  if (!target) return
  const token = ++treeToken
  const pid = String(opts.pid || store.tree.pid || '')
  const cached = treeCache.get(target)
  if (!opts.force && cached && Date.now() - cached.at < 4000) {
    emit({ tree: { ...store.tree, ...cached.meta, pid, state: 'ok', error: '' } })
    return
  }
  emit({ tree: { ...store.tree, state: 'loading', pid, path: target, error: '' } })
  try {
    const data = await apiPost('/fs/list', { path: target }, { timeout: 15_000 })
    if (token !== treeToken) return
    const entries = Array.isArray(data?.entries) ? data.entries : []
    const meta = {
      path: data.path || target,
      name: data.name || baseName(data.path || target),
      parent: String(data.parent || ''),
      writable: data.writable !== false,
      entries,
      total: Number(data.total) || entries.length,
      truncated: !!data.truncated,
      at: Date.now(),
    }
    treeCache.set(target, { meta, at: Date.now() })
    treeCache.set(meta.path, { meta, at: Date.now() })
    emit({ tree: { ...meta, pid, state: 'ok', error: '' } })
  } catch (err) {
    if (token !== treeToken) return
    emit({ tree: { ...store.tree, state: 'error', pid, path: target, entries: [], total: 0, error: String(err?.message ?? err) } })
  }
}

/* ---------- 文件管理器：视图偏好 ---------- */

export function setFsSort(field) {
  const f = ['name', 'size', 'mtime'].includes(field) ? field : 'name'
  if (store.fs.sort === f) return emit({ fs: { ...store.fs, dir: -store.fs.dir } })
  emit({ fs: { ...store.fs, sort: f, dir: f === 'name' ? 1 : -1 } })
}

export function setFsQuery(q) {
  emit({ fs: { ...store.fs, query: String(q || '') } })
}

export function selectEntry(name) {
  emit({ fs: { ...store.fs, sel: String(name || '') } })
}

/**
 * 文件列表的右键菜单放 store 里（和侧边栏项目菜单一致），不放组件 state：
 * 弹菜单要触发行高亮、还要异步补一条「能不能删」，走 store 才不会丢。
 */
export function openFsMenu(dir, row, x, y) {
  const menu = { dir, name: row.name, isDir: !!row.dir, x, y, block: '' }
  emit({ fs: { ...store.fs, menu } })
  deleteBlockReason(dir, row.name).then((reason) => {
    const cur = store.fs.menu
    if (!cur || cur.name !== menu.name || cur.dir !== menu.dir) return
    emit({ fs: { ...store.fs, menu: { ...cur, block: reason } } })
  })
}

export function closeFsMenu() {
  if (!store.fs.menu) return
  emit({ fs: { ...store.fs, menu: null } })
}

/**
 * 面板里显示的行：按 fs.sort / fs.dir 排序，按 fs.query 过滤。
 * 目录永远在前（这是文件管理器的常识，不跟排序字段混）。
 */
export function visibleEntries(tree = store.tree, fs = store.fs) {
  const q = String(fs.query || '').trim().toLowerCase()
  const rows = (tree.entries || []).filter((e) => (q ? String(e.name).toLowerCase().includes(q) : true))
  const k = fs.sort
  const sign = fs.dir < 0 ? -1 : 1
  return rows.sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    if (k === 'size') return ((a.size || 0) - (b.size || 0)) * sign
    if (k === 'mtime') return ((a.mtime || 0) - (b.mtime || 0)) * sign
    return String(a.name).localeCompare(String(b.name), 'zh-Hans-CN') * sign
  })
}

/* ---------- 文件管理器：写操作（一律 force 刷新目录） ---------- */

async function fsWrite(path, body, okText) {
  try {
    await apiPost(path, body, { timeout: 20_000 })
    if (okText) toast(okText, 'ok')
    return true
  } catch (err) {
    toast('操作失败：' + String(err?.message ?? err), 'warn')
    return false
  }
}

export async function fsMkdir(dir, name) {
  const clean = String(name || '').trim()
  if (!clean) { toast('名字不能为空', 'warn'); return false }
  if (/[\\/:*?"<>|]/.test(clean)) { toast('名字里不能有 \\ / : * ? " < > |', 'warn'); return false }
  const target = joinPath(dir, clean)
  const ok = await fsWrite('/fs/mkdir', { path: target }, '已新建文件夹 ' + clean)
  if (ok) { emit({ fs: { ...store.fs, sel: clean } }); loadTree(dir, { force: true }) }
  return ok
}

export async function fsRename(dir, from, to) {
  const clean = String(to || '').trim()
  if (!clean || clean === from) return false
  if (/[\\/:*?"<>|]/.test(clean)) { toast('名字里不能有 \\ / : * ? " < > |', 'warn'); return false }
  const ok = await fsWrite('/fs/rename', { from: joinPath(dir, from), to: joinPath(dir, clean) }, '已重命名为 ' + clean)
  if (ok) { emit({ fs: { ...store.fs, sel: clean } }); loadTree(dir, { force: true }) }
  return ok
}

export async function fsDelete(dir, name) {
  const target = joinPath(dir, name)
  const ok = await fsWrite('/fs/delete', { path: target }, '已移入回收站：' + name)
  if (ok) { emit({ fs: { ...store.fs, sel: '' } }); loadTree(dir, { force: true }) }
  return ok
}

/**
 * 这个路径能不能删。返回空串 = 能删，否则返回禁止的原因。
 * 右键菜单打开时先问一次，把「盘符根 / 工作区根 / 系统目录」这类原因直接写在菜单里，
 * 而不是点了才弹一条 toast。查不通（老版本 host）就当能删，交给真删去报错。
 */
export async function deleteBlockReason(dir, name) {
  try {
    const data = await apiPost('/fs/deletable', { path: joinPath(dir, name) }, { timeout: 8000 })
    return data && data.ok === true ? '' : String(data?.reason || '这个路径不能删除')
  } catch {
    return ''
  }
}

/** 在系统窗口里选中这一项（文件管理器仍然是「系统那个」更好用时留的出口） */
export function fsReveal(dir, name) {
  const target = name ? joinPath(dir, name) : dir
  return revealPath(target, { select: !!name })
}


/**
 * 用操作系统的**默认程序**打开（等同于在资源管理器里双击）。
 * 这是大文件、二进制、日志的正确出路：编辑器只是 textarea，装不下几 MB 的东西。
 */
export async function openExternal(path, opts = {}) {
  const target = String(path || '').trim()
  if (!target) { toast('没有可打开的文件', 'warn'); return false }
  try {
    const data = await apiPost('/fs/open', { path: target }, { timeout: 10_000 })
    if (data && data.ok === false) throw new Error(data.error || '打开失败')
    if (opts.quiet !== true) toast('已用系统默认程序打开：' + baseName(target), 'ok')
    return true
  } catch (err) {
    toast('没能用系统程序打开：' + String(err?.message ?? err), 'warn')
    return false
  }
}

/* ============================ 编辑器 ============================ */

let fileToken = 0

/** 媒体文件的原始字节地址（<img src> / <iframe src> 只能 GET，走不了 apiPost） */
export function rawUrl(p) {
  return API + '/fs/raw?path=' + encodeURIComponent(String(p || ''))
}

/**
 * 打开文件。
 * @param {string} path
 * @param {string} [pid] 项目 id（有就把编辑器标签页切过去）
 * @param {{mode?:'auto'|'head'|'tail'|'full', bytes?:number, forceText?:boolean}} [opts]
 *   auto（默认）＝小的整份读、大的自动降级成只读预览；
 *   head / tail ＝ 明确只看开头 / 结尾（大日志就用这个）；
 *   full ＝ 我就要整份，超上限就报 413。
 *   forceText ＝ 就算图片 / PDF 也当文本读（排查「为什么预览不出来」时用）。
 */
export async function openFile(path, pid, opts = {}) {
  const target = String(path || '')
  if (!target) return
  const name = baseName(target)
  const kind = viewKindOf(name)

  /* 图片 / PDF / 音视频：文本通道只会得到 415，直接交给浏览器渲染 */
  if (isMediaKind(kind) && !opts.forceText) {
    const token = ++fileToken
    emit({
      editor: {
        ...store.editor,
        state: 'ok', path: target, name, kind, view: 'preview',
        text: '', saved: '', error: '', errorCode: 0, binary: false,
        partial: false, truncated: false, tail: false, size: 0,
        mediaUrl: rawUrl(target),
      },
    })
    if (pid) openTab(pid, 'editor')
    setEditorTabTitle(pid, name)
    /* 体积另问一次（拿不到就算了，不挡预览） */
    apiPost('/fs/stat', { path: target }, { timeout: 8000 }).then((d) => {
      if (token !== fileToken) return
      emit({ editor: { ...store.editor, size: Number(d?.size) || 0 } })
    }).catch(() => {})
    return
  }

  const token = ++fileToken
  emit({
    editor: {
      ...store.editor, state: 'loading', path: target, name, kind,
      error: '', errorCode: 0, binary: false, partial: false, mediaUrl: '',
    },
  })
  if (pid) openTab(pid, 'editor')
  try {
    const body = { path: target }
    if (opts.mode) body.mode = opts.mode
    if (opts.bytes) body.bytes = opts.bytes
    const data = await apiPost('/fs/read', body, { timeout: 30_000 })
    if (token !== fileToken) return
    const partial = !!data.partial
    const truncated = !!data.truncated
    emit({
      editor: {
        state: 'ok',
        path: data.path || target,
        name: data.name || name,
        kind,
        /* 只看到片段时不进渲染预览：拿半截 Markdown 渲染出来只会误导，
           这时候让用户直接看原文（只读），跟「只读 · 开头/结尾」的语义一致。 */
        view: (partial || truncated || !hasPreview(kind)) ? 'edit' : 'preview',
        text: String(data.text ?? ''),
        saved: String(data.text ?? ''),
        error: '',
        errorCode: 0,
        mediaUrl: '',
        /* partial 与 truncated 都意味着「你看到的不是完整文件」→ 一律只读 */
        partial,
        truncated,
        tail: data.mode === 'tail',
        binary: !!data.binary,
        size: Number(data.size) || 0,
        limit: Number(data.limit) || 0,
        previewBytes: Number(data.previewBytes) || 0,
      },
    })
    setEditorTabTitle(pid, data.name || name)
  } catch (err) {
    if (token !== fileToken) return
    const info = err?.data || {}
    emit({
      editor: {
        ...store.editor,
        state: 'error',
        path: target,
        name,
        kind,
        view: 'edit',
        error: String(err?.message ?? err),
        errorCode: Number(err?.status) || 0,
        size: Number(info.size) || 0,
        limit: Number(info.limit) || 0,
        previewBytes: Number(info.previewBytes) || 0,
        binary: info.code === 'binary',
      },
    })
  }
}

function setEditorTabTitle(pid, title) {
  if (!pid || !title) return
  const ui = uiOf(pid)
  const tabs = ui.tabs.map((t) => (t.kind === 'editor' ? { ...t, title } : t))
  patchUi(pid, { tabs })
}

/** 切「预览 / 编辑」（Markdown 与代码才有意义） */
export function setEditorView(view) {
  const v = view === 'preview' ? 'preview' : 'edit'
  if (store.editor.view === v) return
  emit({ editor: { ...store.editor, view: v } })
}

export function editText(text) {
  emit({ editor: { ...store.editor, text: String(text ?? '') } })
}

export async function saveFile() {
  const ed = store.editor
  if (!ed.path || ed.state !== 'ok') return
  if (isMediaKind(ed.kind)) {
    toast('图片 / PDF / 音视频没有可写的文本内容', 'info')
    return
  }
  /* 只读预览绝不能写回：写回去就是「用一个片段覆盖整个文件」，等于把文件毁了 */
  if (ed.partial || ed.truncated) {
    toast('这是只读预览（文件太大，只读了一段），不能在编辑器里保存', 'warn')
    return
  }
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

/* ============================ 浏览器 ============================ */

export function siteUrlOf(project) {
  if (!project) return ''
  return API + '/site/' + encodeURIComponent(project.id) + '/'
}

/**
 * 地址归一：
 *  - `localhost:5173` / `127.0.0.1:8080` → 补 http://
 *  - `/api/...` 这类站内相对地址原样放行（项目静态托管就是这种）
 *  - 其它一律判非法（javascript:/file: 不该进 iframe）
 */
export function normalizeWebUrl(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  if (s.startsWith('/') && !s.startsWith('//')) return s
  if (/^https?:\/\/\S+$/i.test(s)) return s
  /* 只填了端口号（5173 / :5173）—— 开发时最常见的输入，别让人还要补 http://localhost: */
  const port = s.replace(/^:/, '')
  if (/^\d{2,5}$/.test(port)) return 'http://localhost:' + port + '/'
  if (/^[a-z0-9][a-z0-9.-]*(:\d+)?([/?#]\S*)?$/i.test(s) && /[.:]/.test(s)) return 'http://' + s
  return ''
}

/** 记住每个项目上次停在哪（切回项目不用重填） */
function rememberWeb(pid, url) {
  if (!pid) return
  const map = readLS(LS.web, {}) || {}
  const next = { ...map, [pid]: url }
  writeLS(LS.web, next)
}

/** 切项目时把地址、历史、探测结果都对到那个项目上 */
export function webSync(project) {
  const pid = project?.id || ''
  const def = siteUrlOf(project)
  if (store.web.pid === pid && store.web.defaultUrl === def) return
  const remembered = readLS(LS.web, {}) || {}
  const saved = typeof remembered[pid] === 'string' ? remembered[pid] : ''
  const url = saved || def
  emit({
    web: {
      pid,
      defaultUrl: def,
      url,
      state: 'idle',
      error: '',
      ms: 0,
      startedAt: 0,
      at: Date.now(),
      viewport: store.web.viewport || 'auto',
      history: url ? [url] : [],
      index: url ? 0 : -1,
      more: false,
      probe: { ...store.web.probe, state: 'idle', url, ok: false, status: 0, ms: 0, title: '', frameable: true, reason: '', error: '', at: 0 },
    },
  })
}

/*
 * iframe 的同源策略挡住了「读它的 location」，所以我们读不到真实的加载失败 ——
 * 只能靠 onLoad 计时：8 秒还没 load，就按「被拒绝嵌入 / 服务没起来」处理，
 * 给用户一个能动的出口，而不是让他盯着白框猜。
 */
let webTimer = 0

function armWebTimeout(url) {
  if (webTimer) clearTimeout(webTimer)
  webTimer = setTimeout(() => {
    webTimer = 0
    const w = store.web
    if (w.state === 'loading' && w.url === url) {
      emit({
        web: {
          ...w,
          state: 'blocked',
          error: '8 秒内没有加载完成：多半是这个地址用 X-Frame-Options / CSP 拒绝了 iframe 嵌入，或者服务根本没起来。',
          ms: Date.now() - (w.startedAt || Date.now()),
        },
      })
    }
  }, 8000)
  if (webTimer && typeof webTimer.unref === 'function') webTimer.unref()
}

export function webClearTimer() {
  if (webTimer) { clearTimeout(webTimer); webTimer = 0 }
}

export function webLoaded() {
  webClearTimer()
  const w = store.web
  if (w.state === 'loading') {
    emit({ web: { ...w, state: 'ok', error: '', ms: Date.now() - (w.startedAt || Date.now()) } })
  }
}

/**
 * 导航。
 * @param {{push?: boolean}} [opts] push=false 表示这次不算新历史（重载 / 回退用）
 */
export function webGoto(raw, opts = {}) {
  const url = normalizeWebUrl(raw)
  if (!url) {
    toast('地址不合法：只支持 http / https，或者站内 / 开头的相对地址', 'warn')
    return false
  }
  const w = store.web
  let history = w.history
  let index = w.index
  if (opts.push !== false) {
    history = w.history.slice(0, w.index + 1)
    if (history[history.length - 1] !== url) history = history.concat([url])
    index = history.length - 1
  }
  const now = Date.now()
  emit({
    web: {
      ...w,
      url,
      state: 'loading',
      error: '',
      ms: 0,
      startedAt: now,
      at: now,
      history,
      index,
      more: false,
      probe: { ...w.probe, state: 'idle' },
    },
  })
  armWebTimeout(url)
  rememberWeb(w.pid, url)
  return true
}

export function webReload() {
  const w = store.web
  if (!w.url) return
  webGoto(w.url, { push: false })
}

export function webBack() {
  const w = store.web
  if (w.index <= 0) return
  const next = w.index - 1
  const url = w.history[next]
  emit({ web: { ...w, index: next } })
  webGoto(url, { push: false })
}

export function webForward() {
  const w = store.web
  if (w.index >= w.history.length - 1) return
  const next = w.index + 1
  const url = w.history[next]
  emit({ web: { ...w, index: next } })
  webGoto(url, { push: false })
}

export function webSetViewport(v) {
  const allowed = ['auto', 'tablet', 'mobile']
  emit({ web: { ...store.web, viewport: allowed.includes(v) ? v : 'auto' } })
}

/** 「⋯」下拉开合。放 store 而不是组件 state：切标签页、重渲染都不会莫名收起。 */
export function webSetMore(v) {
  const next = !!v
  if (store.web.more === next) return
  emit({ web: { ...store.web, more: next } })
}

/** 站内相对地址（项目静态托管）要探测就得补成 absolute —— 宿主只认带协议的 URL */
function absoluteWebUrl(u) {
  const s = String(u || '')
  if (!s.startsWith('/')) return s
  try {
    if (typeof location !== 'undefined' && location.origin) return new URL(s, location.origin).href
  } catch { /* 没有 location（离线自测）就原样传 */ }
  return s
}

/** 探测：活没活 + 能不能嵌。比「先打开再看白框」有用地多。 */
export async function webProbe(raw) {
  const target = absoluteWebUrl(normalizeWebUrl(raw) || String(raw || '').trim())
  if (!target) { toast('先填个地址再探测', 'warn'); return null }
  emit({ web: { ...store.web, probe: { ...store.web.probe, state: 'loading', url: target, error: '', at: Date.now() } } })
  try {
    const data = await apiPost('/web/probe', { url: target }, { timeout: 15_000 })
    const r = (Array.isArray(data?.results) ? data.results[0] : null) || {}
    const probe = {
      state: 'ok',
      url: r.url || target,
      ok: r.ok === true,
      status: Number(r.status) || 0,
      ms: Number(r.ms) || 0,
      title: String(r.title || ''),
      frameable: r.frameable !== false,
      reason: String(r.frameReason || ''),
      error: String(r.error || ''),
      at: Date.now(),
    }
    emit({ web: { ...store.web, probe } })
    return probe
  } catch (err) {
    const probe = { ...store.web.probe, state: 'error', url: target, ok: false, error: String(err?.message ?? err), at: Date.now() }
    emit({ web: { ...store.web, probe } })
    return probe
  }
}

/** 交给系统默认浏览器（iframe 打不开的最后一招） */
export async function webOpenExternal(raw) {
  const target = normalizeWebUrl(raw) || String(raw || '').trim()
  if (!target) { toast('没有可打开的地址', 'warn'); return false }
  if (target.startsWith('/')) { toast('站内相对地址只能在工作台里看，没法交给系统浏览器', 'warn'); return false }
  try {
    const data = await apiPost('/web/open', { url: target }, { timeout: 10_000 })
    if (data?.ok === false) throw new Error(data.error || '打开失败')
    toast('已用系统浏览器打开：' + target.replace(/^https?:\/\//i, '').slice(0, 40), 'ok')
    return true
  } catch (err) {
    toast('没能打开系统浏览器：' + String(err?.message ?? err), 'warn')
    return false
  }
}

/* ============================ 自定义窗口 ============================ */

export const CUSTOM_PRESET = [
  '<div class="wt-custom-demo">',
  '  <h2>自定义窗口</h2>',
  '  <p>这段 HTML 会在沙箱 iframe 里跑，可以用 <code>&lt;style&gt;</code> 和 <code>&lt;script&gt;</code>。</p>',
  '</div>',
  '<style>',
  '  body { margin: 0; padding: 20px; background: #0f1218; color: #e6e8eb;',
  '         font: 13px/1.6 system-ui, "Segoe UI", sans-serif; }',
  '  .wt-custom-demo h2 { margin: 0 0 8px; font-size: 15px; color: #5b9dff; }',
  '  .wt-custom-demo p { margin: 0; color: #9aa4b2; }',
  '</style>',
].join('\n')

function customMetaOf(it) {
  return { id: it.id, name: it.name, kind: it.kind, pid: it.pid || '', updated: it.updated || '', size: Number(it.size) || 0 }
}

export async function loadCustom(opts = {}) {
  emit({ custom: { ...store.custom, state: 'loading', error: '' } })
  try {
    const data = await apiPost('/custom/list', {}, { timeout: 10_000 })
    const items = (Array.isArray(data?.items) ? data.items : []).map(customMetaOf)
    const active = items.some((it) => it.id === store.custom.active) ? store.custom.active : (items[0]?.id || '')
    emit({ custom: { ...store.custom, state: 'ready', items, active, file: String(data?.file || ''), error: '' } })
    if (active && (!store.custom.item || store.custom.item.id !== active)) await openCustom(active, { quiet: opts.quiet })
    return items
  } catch (err) {
    emit({ custom: { ...store.custom, state: 'error', error: String(err?.message ?? err) } })
    return []
  }
}

export async function openCustom(id, opts = {}) {
  const target = String(id || '')
  if (!target) return null
  emit({ custom: { ...store.custom, active: target, busy: 'loading', error: '' } })
  try {
    const data = await apiPost('/custom/get', { id: target }, { timeout: 10_000 })
    const item = data?.item || null
    if (!item) throw new Error('条目为空')
    emit({
      custom: {
        ...store.custom,
        state: 'ready',
        active: target,
        item,
        draft: { id: item.id, name: item.name, kind: item.kind, body: item.body, pid: item.pid || '' },
        busy: '',
        error: '',
      },
    })
    return item
  } catch (err) {
    emit({ custom: { ...store.custom, busy: '', error: String(err?.message ?? err), item: null, draft: null } })
    if (opts.quiet !== true) toast('读取自定义窗口失败：' + String(err?.message ?? err), 'warn')
    return null
  }
}

/** 新建一份草稿（还没落盘，保存时才由宿主发号） */
export function newCustomDraft(kind = 'html', view = '') {
  emit({
    custom: {
      ...store.custom,
      active: '',
      item: null,
      view: view || (kind === 'url' ? 'edit' : 'prompt'),
      busy: '',
      error: '',
      prompt: '',
      draft: {
        id: '',
        name: '',
        kind: kind === 'url' ? 'url' : 'html',
        body: kind === 'url' ? '' : CUSTOM_PRESET,
        pid: store.web.pid || '',
      },
    },
  })
}

export function setCustomRequirement(text) {
  emit({ custom: { ...store.custom, requirement: String(text ?? '') } })
}

export function editCustom(patch) {
  if (!store.custom.draft) return
  emit({ custom: { ...store.custom, draft: { ...store.custom.draft, ...patch } } })
}

export function setCustomView(view) {
  const allowed = ['prompt', 'preview', 'edit']
  emit({ custom: { ...store.custom, view: allowed.includes(view) ? view : 'prompt' } })
}

export async function saveCustom() {
  const draft = store.custom.draft
  if (!draft) return null
  const body = String(draft.body || '')
  if (draft.kind === 'url' && !normalizeWebUrl(body)) {
    toast('窗口地址不合法：只支持 http / https', 'warn')
    return null
  }
  emit({ custom: { ...store.custom, busy: 'saving', error: '' } })
  try {
    const data = await apiPost('/custom/save', {
      id: draft.id || undefined,
      name: draft.name || undefined,
      kind: draft.kind,
      body,
      pid: draft.pid || store.web.pid || '',
    }, { timeout: 15_000 })
    const item = data?.item || null
    const meta = data?.meta || (item ? customMetaOf(item) : null)
    const items = meta
      ? (store.custom.items.some((it) => it.id === meta.id)
        ? store.custom.items.map((it) => (it.id === meta.id ? meta : it))
        : store.custom.items.concat([meta]))
      : store.custom.items
    emit({
      custom: {
        ...store.custom,
        state: 'ready',
        busy: '',
        items,
        active: item?.id || store.custom.active,
        item,
        draft: item ? { id: item.id, name: item.name, kind: item.kind, body: item.body, pid: item.pid || '' } : draft,
      },
    })
    toast('已保存自定义窗口：' + (item?.name || '未命名'), 'ok')
    return item
  } catch (err) {
    emit({ custom: { ...store.custom, busy: '', error: String(err?.message ?? err) } })
    toast('保存失败：' + String(err?.message ?? err), 'warn')
    return null
  }
}

export async function deleteCustom(id) {
  const target = String(id || store.custom.active || '')
  if (!target) return false
  emit({ custom: { ...store.custom, busy: 'deleting', error: '' } })
  try {
    await apiPost('/custom/delete', { id: target }, { timeout: 10_000 })
    const items = store.custom.items.filter((it) => it.id !== target)
    const next = items[0]?.id || ''
    emit({
      custom: {
        ...store.custom,
        busy: '',
        items,
        active: next,
        item: null,
        draft: next ? store.custom.draft : null,
        view: next ? store.custom.view : 'prompt',
      },
    })
    toast('已删除', 'ok')
    if (next) await openCustom(next, { quiet: true })
    else newCustomDraft()
    return true
  } catch (err) {
    emit({ custom: { ...store.custom, busy: '', error: String(err?.message ?? err) } })
    toast('删除失败：' + String(err?.message ?? err), 'warn')
    return false
  }
}

/**
 * 生成提示词 —— 这一招是从上游 dsh-worktable 抄的：上游的「自定义窗口」本质是
 * 「一句话需求 → 交给 AI 做成一个窗口」，我们保留了同样的形态，
 * 只是把最后一步改成把提示词填进宿主对话输入框（我们拿不到它的建会话接口）。
 */
export function buildCustomPrompt(project, requirement, name) {
  const req = String(requirement || '').trim()
  if (!req) return ''
  const p = project || {}
  const lines = [
    '在工作台里做一个自定义窗口' + (name ? '「' + name + '」' : '') + '。',
    '',
    '需求：' + req,
    '',
    '项目：' + (p.alias || p.name || '未指定') + (p.path ? '（' + p.path + '）' : ''),
    '',
    '约束（很重要）：',
    '1. 产物是一份自包含的 HTML 片段：可以带 <style> 和 <script>，不要外链 CDN，不要 <html>/<head> 外壳；',
    '2. 它会在沙箱 iframe 里跑，拿不到父页面 DOM，也没有 localStorage；状态放内存，持久化需求告诉我们再商量；',
    '3. 深色主题：背景 #0f1218、正文 #e6e8eb、次要文字 #9aa4b2、强调 #5b9dff；尺寸自适应；',
    '4. 需要文件数据时调宿主接口 POST /api/trae-worktable/fs/list 与 POST /api/trae-worktable/fs/read（body: { path }）；',
    '5. 先只输出 HTML 代码块，我会把它粘进工作台「自定义 → 编辑 → 保存」。',
  ]
  return lines.join('\n')
}

/** 把提示词写进宿主右侧对话的输入框（不代为发送） */
export function fillHostInput(text) {
  const value = String(text || '')
  if (!value) return false
  if (typeof document === 'undefined') return false
  try {
    /* 我们自己的 textarea 绝不能误填 —— 那会把用户的输入冲掉 */
    const pick = (sel) => {
      const list = Array.from(document.querySelectorAll(sel))
      return list.find((n) => !n.closest('.wt-scope')) || null
    }
    const ta = pick('textarea[data-phase]') || pick('textarea')
    if (ta && !ta.disabled && !ta.readOnly) {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      const next = String(ta.value || '').trim() ? ta.value + '\n\n' + value : value
      if (setter) setter.call(ta, next)
      else ta.value = next
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      try {
        ta.focus()
        ta.setSelectionRange(ta.value.length, ta.value.length)
      } catch { /* 有的输入框不支持选区 */ }
      return true
    }
    const editable = pick('[contenteditable="true"]')
    if (editable) {
      const next = (editable.textContent || '').trim() ? editable.textContent + '\n\n' + value : value
      editable.textContent = next
      editable.dispatchEvent(new Event('input', { bubbles: true }))
      try { editable.focus() } catch { /* 忽略 */ }
      return true
    }
  } catch { /* 宿主结构变了：走复制兜底 */ }
  return false
}

export function setCustomPrompt(text) {
  emit({ custom: { ...store.custom, prompt: String(text || '') } })
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
