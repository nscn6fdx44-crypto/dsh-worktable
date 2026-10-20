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

/** 让位宽度记忆版本：默认占比/最小值一变就 +1，旧项目存的像素值自动作废、回到「自动」 */
const DOCK_VERSION = 2

const LS = {
  projects: 'wt.projects',
  bindings: 'wt.bindings',
  status: 'wt.status',
  layouts: 'wt.layouts',
  ui: 'wt.ui.v2',
  view: 'wt.view',
  termHist: 'wt.termHistory',
  web: 'wt.web',
  search: 'wt.search',
  theme: 'wt.theme',
  dockVer: 'wt.dockVer',
  overview: 'wt.overview',
  gridTab: 'wt.gridTab',
  gitInsecure: 'wt.git.insecure',
  side: 'wt.side',
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
 * 和终端、浏览器、自定义窗口平级，标签页本身就把整块让位区占满。
 *
 * 0.10.6 起不再自带「编辑器」：它和宿主的编辑器 / 系统默认程序重复，
 * 文本文件一律交给系统程序打开，网页（.html）交给自定义窗口预览。
 */
export const PANE_TABS = [
  { id: 'editor', label: '编辑器', icon: '◆' },
  { id: 'files', label: '文件管理器', icon: '🗂' },
  { id: 'scm', label: '源代码管理', icon: '⑂' },
  { id: 'term', label: '终端', icon: '›_' },
  { id: 'web', label: '浏览器', icon: '◍' },
  { id: 'custom', label: '自定义', icon: '❖' },
  { id: 'media', label: '媒体', icon: '🖼' },
  { id: 'notes', label: '笔记', icon: '✎' },
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

/** 取所在目录（保留原分隔符风格）；拿不到就返回空 */
export function dirName(p) {
  const s = String(p || '')
  const cut = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'))
  return cut > 0 ? s.slice(0, cut) : ''
}

export function shortPath(p, max = 42) {  const s = String(p ?? '')
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
  dragOver: false,              // 有会话/目录正拖到侧边栏上（决定高亮与提示）
  theme: { accent: 'amber', bg: 'glass', image: '', brightness: 100, crop: { x: 0, y: 0, w: 100, h: 100 } },   // 自定义主题与背景（wt.theme）
  external: [],   // 别的插件透过 __WT_REGISTER_PROJECT__ 注册进来的项目（不落盘，插件重启会重注册）
  trash: [],      // 最近删除的项目（内存里留 5 个，供「撤销」）
  run: { pid: '', state: 'idle', cmd: '', at: 0, error: '' },   // 当前项目的运行状态（内存）
  /* 并排：同一块让位区里再放一个项目的工作区（存 wt.side） */
  side: { pid: '', split: 50 },
  chatDropHover: false,   // 有文件/链接正拖到工作台顶栏的「对话」区
  /* 内联编辑器：文件管理器里点文件就地改，不占独立窗格 */
  editor: { pid: '', path: '', name: '', text: '', saved: '', size: 0, truncated: false, state: 'idle', view: 'edit', error: '' },
  /* 总览的排序 / 筛选 / 就地搜索（存 wt.overview） */
  overview: { q: '', sort: 'recent', filter: 'all' },
  media: { pid: '', path: '' },   // 媒体窗当前预览的文件（由「产物」或编辑器推过来）
  artifacts: { pid: '', dir: '', file: '', items: [], error: '', at: 0 },   // 项目目录 .wt/artifact.json
  /* 文件管理器：一次只列一个目录，path/parent 用于面包屑与「上一级」；pid 记住是哪个项目的树 */
  tree: { state: 'idle', pid: '', path: '', name: '', parent: '', writable: true, entries: [], total: 0, truncated: false, error: '', at: 0 },
  /* 文件管理器的视图偏好（排序 / 过滤 / 选中项），纯前端 */
  fs: { sort: 'name', dir: 1, query: '', sel: '', busy: '', menu: null },
  terms: {},                    // { [pid]: { id, cwd, busy, lines: [] } }
  git: { state: 'idle', repo: false, branch: '', changes: [], counts: null, error: '', log: [], branches: [] },
  /* 源代码管理窗（0.10.0）：一个仓库的完整读写视图 —— 暂存 / 提交 / 推送 / 分支 / 标签 / 历史 */
  scm: {
    pid: '', state: 'idle', repo: false, error: '',
    branch: '', detached: false, unborn: false, head: '', ahead: 0, behind: 0, upstream: '', remote: '',
    changes: [], counts: null, log: [], branches: [], remoteBranches: [], tags: [], remotes: [],
    sel: '', selStaged: false,
    diff: { state: 'idle', file: '', text: '', error: '', binary: false, truncated: false },
    msg: '', busy: '', view: 'changes', note: '',
    /* 本机 git 证书吊销检查失败时的退路（默认关；只影响推送/拉取/克隆） */
    insecure: false,
  },
  /* GitHub 账号：全局一份，不分项目 */
  gh: {
    state: 'idle', loggedIn: false, login: '', name: '', avatar: '', scopes: '', source: '', profile: '',
    error: '', repos: [], reposState: 'idle', reposError: '', q: '', page: 1, hasMore: false,
  },
  /* 浏览器窗格：地址栏历史 + 加载态 + 视口 + 探测结果（探测能提前知道「能不能嵌」） */
  web: {
    pid: '', defaultUrl: '', url: '', state: 'idle', error: '',
    at: 0, startedAt: 0, ms: 0, viewport: 'auto', engine: 'bing',
    history: [], index: -1,
    /* 「⋯」下拉是否展开：跟 fs.menu 一样走 store，重渲染不掉 */
    more: false,
    home: false,
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
    /* 运行配置：一键起服务用的命令（不自动执行任何东西，用户点了才跑） */
    run: {
      cmd: String((p.run && p.run.cmd) || p.runCmd || ''),
      port: Number((p.run && p.run.port) || p.runPort || 0) || 0,
      cwd: String((p.run && p.run.cwd) || ''),
    },
  }
}

/**
 * 0.10.6 下架了「编辑器」窗格。老版本存下来的 wt.ui.v2 里可能还挂着 editor 标签页
 * （甚至是当时唯一的标签页），统一清掉并把槽位改到还活着的标签页上，
 * 免得一开项目就撞见一个打不开的空窗。
 */
const RETIRED_TAB_KINDS = new Set([])   /* 0.10.9：编辑器回归，不再有任何「已下架」的标签页 */

export function stripRetiredTabs(ui) {
  let changed = false
  const out = {}
  for (const [pid, raw] of Object.entries(ui || {})) {
    if (!raw || typeof raw !== 'object') { out[pid] = raw; continue }
    const tabs = Array.isArray(raw.tabs) ? raw.tabs : []
    const kept = tabs.filter((t) => !RETIRED_TAB_KINDS.has(String(t && t.kind || '')))
    if (kept.length !== tabs.length) changed = true
    const alive = (k) => (kept.some((t) => t.key === k) ? k : '')
    const activeTab = alive(raw.activeTab) || (kept[0] && kept[0].key) || ''
    if (activeTab !== raw.activeTab) changed = true
    const next = { ...raw, tabs: kept, activeTab }
    if (raw.secondTab !== undefined) {
      next.secondTab = alive(raw.secondTab)
      if (next.secondTab !== raw.secondTab) changed = true
    }
    if (Array.isArray(raw.cells)) {
      next.cells = raw.cells.map(alive)
      if (next.cells.some((k, i) => k !== raw.cells[i])) changed = true
    }
    out[pid] = next
  }
  return { ui: out, changed }
}

export function hydrate() {
  const rawProjects = readLS(LS.projects, [])
  const legacyBind = readLS(LS.bindings, {})
  const legacyLayouts = readLS(LS.layouts, {})
  const migratedUi = stripRetiredTabs(readLS(LS.ui, {}))
  const ui = migratedUi.ui
  if (migratedUi.changed) writeLS(LS.ui, ui)

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

  /* 旧版本存的是「当时的默认占比」算出的像素：占比一改就跟预期不符，这里整批作废回自动 */
  const dockVer = readLS(LS.dockVer, 0)
  if (dockVer !== DOCK_VERSION) {
    for (const key of Object.keys(ui)) {
      if (ui[key] && typeof ui[key] === 'object') ui[key] = { ...ui[key], dock: 0 }
    }
    writeLS(LS.ui, ui)
    writeLS(LS.dockVer, DOCK_VERSION)
  }

  const ovRaw = readLS(LS.overview, {}) || {}
  const overview = {
    q: typeof ovRaw.q === 'string' ? ovRaw.q : '',
    sort: OVERVIEW_SORTS.some((s) => s.id === ovRaw.sort) ? ovRaw.sort : 'recent',
    filter: OVERVIEW_FILTERS.some((f) => f.id === ovRaw.filter) ? ovRaw.filter : 'all',
  }

  /* 并排项目被删了：静默清掉，免得每次渲染都找人 */
  const rawSide = normalizeSide(readLS(LS.side, {}))
  const sideClean = rawSide.pid && !projects.some((p) => p.id === rawSide.pid) ? { ...rawSide, pid: '' } : rawSide
  if (sideClean.pid !== rawSide.pid) writeLS(LS.side, sideClean)

  const engine = readLS(LS.search, 'bing')
  emit({
    ready: true,
    projects,
    status: readLS(LS.status, {}) || {},
    ui: ui && typeof ui === 'object' ? ui : {},
    view: readLS(LS.view, 'grid') === 'project' ? 'project' : 'grid',
    terms: {},
    web: { ...store.web, engine: SEARCH_ENGINES.some((e) => e.id === engine) ? engine : 'bing' },
    theme: normalizeTheme(readLS(LS.theme, DEFAULT_THEME)),
    overview,
    gridTab: GRID_TABS.some((t) => t.id === readLS(LS.gridTab, '')) ? readLS(LS.gridTab, '') : 'projects',
    side: sideClean,
    scm: { ...store.scm, insecure: readLS(LS.gitInsecure, false) === true },
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
    /* 布局预设：单窗格 / 左右 / 上下；split=0 表示 50/50 */
    layout: LAYOUTS.some((l) => l.id === raw.layout) ? raw.layout : 'single',
    secondTab: typeof raw.secondTab === 'string' ? raw.secondTab : '',
    split: Number.isFinite(Number(raw.split)) && Number(raw.split) > 0 ? Math.round(Number(raw.split)) : 0,
    /* 第 3、4 格显示的标签页（索引 2、3；0/1 分别由 activeTab / secondTab 承担） */
    cells: Array.isArray(raw.cells)
      ? raw.cells.map((k) => (typeof k === 'string' ? k : '')).concat(['', '', '', '']).slice(0, 4)
      : ['', '', '', ''],
    /* 第二条分割线（三列 / 四格用），0 = 50/50 */
    splitB: Number.isFinite(Number(raw.splitB)) && Number(raw.splitB) > 0 ? Math.round(Number(raw.splitB)) : 0,
  }
}

function patchUi(pid, patch, persist = true) {
  const next = { ...uiOf(pid), ...patch }
  const ui = { ...store.ui, [pid]: next }
  emit({ ui })
  if (persist) writeLS(LS.ui, ui)
  return next
}


/* ============================ 主题与背景 ============================ */

/** 强调色预设（只换色相，深浅关系不变） */
export const ACCENTS = [
  { id: 'amber', label: '琥珀金', rgb: '240, 180, 41', ink: '246, 218, 156' },
  { id: 'blue', label: '深海蓝', rgb: '78, 161, 255', ink: '198, 222, 255' },
  { id: 'green', label: '松石绿', rgb: '63, 185, 80', ink: '200, 240, 210' },
  { id: 'violet', label: '夜紫', rgb: '167, 139, 250', ink: '225, 214, 255' },
  { id: 'rose', label: '玫瑰红', rgb: '244, 114, 182', ink: '255, 214, 235' },
]

/** 背景风格 */
export const BACKDROPS = [
  { id: 'glass', label: '玻璃渐变', hint: '默认：暖色光斑 + 玻璃底' },
  { id: 'grid', label: '蓝图网格', hint: '30px 井字格，工程感更重' },
  { id: 'plain', label: '纯色', hint: '只留深底，最省电' },
  { id: 'image', label: '自定义图片', hint: '填图片 URL，铺满并压暗' },
]

const DEFAULT_THEME = { accent: 'amber', bg: 'glass', image: '', brightness: 100, crop: { x: 0, y: 0, w: 100, h: 100 } }
const EMPTY_CROP = { x: 0, y: 0, w: 100, h: 100 }

/** 取景框：图片区域百分比；最小 15%，不许出界 */
function normalizeCrop(raw) {
  const c = raw && typeof raw === 'object' ? raw : EMPTY_CROP
  const num = (v, dv) => (Number.isFinite(Number(v)) ? Math.round(Number(v)) : dv)
  /* 取景台本身是主区比例，所以「宽高百分比相等」的框 = 和主区同比例 */
  const size = Math.min(100, Math.max(15, num(c.w, 100)))
  return {
    w: size,
    h: size,
    x: Math.min(100 - size, Math.max(0, num(c.x, 0))),
    y: Math.min(100 - size, Math.max(0, num(c.y, 0))),
  }
}

function normalizeTheme(raw) {
  const t = raw && typeof raw === 'object' ? raw : {}
  return {
    accent: ACCENTS.some((a) => a.id === t.accent) ? t.accent : DEFAULT_THEME.accent,
    bg: BACKDROPS.some((b) => b.id === t.bg) ? t.bg : DEFAULT_THEME.bg,
    image: typeof t.image === 'string' && /^(https?:|data:image\/)/i.test(t.image) ? t.image : '',
    brightness: Math.min(160, Math.max(40, Number.isFinite(Number(t.brightness)) ? Math.round(Number(t.brightness)) : 100)),
    crop: normalizeCrop(t.crop),
  }
}

/** 改主题：只传要改的字段，非法值会被归一掉，落 localStorage */
export function setTheme(patch) {
  const theme = normalizeTheme({ ...store.theme, ...(patch || {}) })
  emit({ theme })
  writeLS(LS.theme, theme)
}

export function resetTheme() {
  setTheme(DEFAULT_THEME)
  toast('已恢复默认主题', 'ok')
}

/** 根节点行内样式：把强调色拆成 RGB 变量，CSS 里 rgba(var(--amber-rgb), x) 全部跟着变 */
export function themeStyle() {
  const t = store.theme || DEFAULT_THEME
  const a = ACCENTS.find((x) => x.id === t.accent) || ACCENTS[0]
  const style = {
    '--amber-rgb': a.rgb,
    '--amber-ink-rgb': a.ink,
    '--amber': 'rgb(' + a.rgb + ')',
    '--amber-soft': 'rgba(' + a.rgb + ', .12)',
    '--amber-line': 'rgba(' + a.rgb + ', .30)',
  }
  style['--wt-bright'] = String((Number(t.brightness) || 100) / 100)
  const c = t.crop || EMPTY_CROP
  /* 取景框 → 背景：放大到框宽占满，再用百分比对位（pos% = x / (100 - w)） */
  style['--wt-bg-size'] = (10000 / Math.max(1, c.w)).toFixed(2) + '% auto'
  style['--wt-bg-px'] = (c.w >= 100 ? 0 : (c.x / (100 - c.w)) * 100).toFixed(2) + '%'
  style['--wt-bg-py'] = (c.h >= 100 ? 0 : (c.y / (100 - c.h)) * 100).toFixed(2) + '%'
  style['--wt-bg-x'] = (c.x + c.w / 2).toFixed(0) + '%'
  style['--wt-bg-y'] = (c.y + c.h / 2).toFixed(0) + '%'
  if (t.image) style['--wt-bg-image'] = 'url("' + t.image.replace(/"/g, '%22') + '")'
  return style
}

/** 根节点 data 属性：背景风格靠它切 CSS */
export function themeAttrs() {
  const t = store.theme || DEFAULT_THEME
  return { 'data-bg': t.bg, 'data-accent': t.accent }
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

/** 带「撤销」按钮的 toast：留 9 秒，点了就执行 onUndo */
export function toastUndo(text, onUndo) {
  const id = ++seq
  const item = { id, text: String(text), kind: 'info', onUndo }
  emit({ toasts: store.toasts.concat([item]) })
  setTimeout(() => emit({ toasts: store.toasts.filter((t) => t.id !== id) }), 9000)
  return id
}

export function dismissToast(id) {
  emit({ toasts: store.toasts.filter((t) => t.id !== id) })
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
  const cwd = String(dir || '').trim() || String(store.defaults.workspace || '')

  /* 0) 客户端 sessions.create：与 GUI「新会话」完全同一条链路，并且会把新会话
        立刻写进客户端目录 —— 紧接着 openSession 才打得开（host 路由建的不会进目录） */
  let hostError = ''
  const client = clientSessions()
  if (client && typeof client.create === 'function') {
    try {
      const id = await client.create(cwd ? { cwd } : {})
      if (id) {
        await loadSessions()
        toast('已新建对话并绑定', 'ok')
        return String(id)
      }
    } catch (err) {
      hostError = String(err?.message ?? err)
    }
  }

  /* 1) 退到宿主路由 /session/create：host 侧调 sessionController.create */
  try {
    const data = await apiPost('/session/create', { cwd }, { timeout: 20_000 })
    const id = data && data.ok !== false ? String(data.sessionId || '') : ''
    if (id) {
      await loadSessions()
      toast('已新建对话并绑定', 'ok')
      return id
    }
    if (data && data.error) hostError = String(data.error)
  } catch (err) {
    hostError = String(err?.message ?? err)
  }

  /* 2) 老宿主没有这条路由时，退回客户端服务猜测（保留兼容） */
  const svcs = [workspaceUi, hostCtx && hostCtx.uiWorkspace, hostCtx && hostCtx.sessions].filter(Boolean)
  const methods = ['createSession', 'newSession', 'create']
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
  if (hostError) toast('宿主新建对话失败：' + hostError, 'warn')
  else toast('宿主没提供新建对话的入口，项目已建好，可稍后手动绑定', 'warn')
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


/** 客户端会话服务（提供 create / refresh / retain 的那个）；拿不到就 null */
function clientSessions() {
  try {
    const svc = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('sessions') : null
    if (svc) return svc
  } catch { /* 未注册 */ }
  return (hostCtx && hostCtx.sessions) || null
}

/** uiWorkspace：宿主「打开某条对话」的入口；懒取一次，拿不到就 null */
function workspaceService() {
  if (workspaceUi) return workspaceUi
  try {
    const svc = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('uiWorkspace') : null
    if (svc) return svc
  } catch { /* 未注册 */ }
  return (hostCtx && hostCtx.uiWorkspace) || null
}

/**
 * 把宿主主视图切到某条对话（进项目时右侧要显示项目绑定的那条）。
 *
 * 只调 openSession 不够：它内部走 sessions.retain()，会话不在**客户端目录**里就会抛
 * （刚新建 / 还没同步的会话最常见），所以失败后先 sessions.refresh() 把目录拉一遍再重试。
 * @param sessionId - 目标对话 id。
 * @returns {Promise<{ok:boolean, error?:string}>} 失败时带原因，调用方决定要不要提示。
 */
export async function switchHostSession(sessionId) {
  const id = String(sessionId || '')
  if (!id) return { ok: false, error: '没有对话 id' }

  let lastError = ''
  const attempt = () => {
    const ui = workspaceService()
    for (const method of ['openSession', 'open', 'revealSession']) {
      const fn = ui && ui[method]
      if (typeof fn !== 'function') continue
      try { fn.call(ui, id); return true } catch (err) { lastError = String(err?.message ?? err) }
    }
    return false
  }

  if (attempt()) return { ok: true }

  /* 目录可能还没同步这条会话：拉一次再来 */
  const svc = clientSessions()
  if (svc && typeof svc.refresh === 'function') {
    try { await svc.refresh() } catch (err) { lastError = lastError || String(err?.message ?? err) }
    if (attempt()) return { ok: true }
  }

  /* 最后再试客户端的 sessions.open（老宿主可能有） */
  if (svc && typeof svc.open === 'function') {
    try { svc.open(id); return { ok: true } } catch (err) { lastError = String(err?.message ?? err) }
  }

  return { ok: false, error: lastError || '宿主没有提供打开对话的入口' }
}

export function jumpToSession(sessionId) {
  const id = String(sessionId || '')
  if (!id) return false
  /* 宿主可能在不同版本里换过名字：服务上是 openSession，也有把 open 挂出来的 */
  const svcs = [workspaceUi, hostCtx && hostCtx.uiWorkspace]
  try {
    const lazy = hostCtx && typeof hostCtx.get === 'function' ? hostCtx.get('uiWorkspace') : null
    if (lazy) svcs.push(lazy)
  } catch { /* 无该服务 */ }
  for (const svc of svcs) {
    if (!svc) continue
    for (const method of ['openSession', 'open', 'revealSession']) {
      const fn = svc[method]
      if (typeof fn !== 'function') continue
      try { fn.call(svc, id); return true } catch { /* 换下一个入口 */ }
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

/** ⌘K / Ctrl+K 全局搜索：项目 + 宿主对话 */
export function openSearch() {
  emit({ modal: { kind: 'search', pid: null }, menu: null })
}

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
  writeLS(LS.gridTab, id)
}

export function enterProject(pid) {
  /* 要进的项目正好在并排位里：先撤掉并排，避免自己和自己并排 */
  if (store.side && store.side.pid === pid) {
    emit({ side: { ...store.side, pid: '' } })
    writeLS(LS.side, { ...store.side, pid: '' })
  }
  /* 进项目就把产物清单拉一次（没有 .wt/artifact.json 就安静跳过） */
  loadArtifacts(pid)
  const project = projectOf(pid)
  if (!project) return
  emit({ open: true, view: 'project', activeId: pid, modal: null, menu: null })
  writeLS(LS.view, 'project')
  /* 右侧就是宿主对话：进项目就把宿主切到主绑定对话，所见即所聊 */
  /* 右侧就是宿主对话：进项目就把宿主切到主绑定对话。
     走 switchHostSession：openSession 失败会先 refresh 客户端目录再重试，
     新建/未同步的会话也能切过去；真失败才提示，并可从顶栏对话名手点重试。 */
  const primary = primarySession(project)
  if (primary) {
    switchHostSession(primary.id).then((r) => {
      if (!r.ok) toast('切到绑定对话失败：' + (r.error || '未知原因') + '（点顶栏对话名可重试）', 'warn')
    })
  }
  loadSessions()
  if (!store.defaults.loaded) loadDefaults()
  /* 第一次进项目先摆「项目信息」：工作区不至于空着，也不会一进来就弹系统窗口 */
  if (!uiOf(pid).tabs.length) openTab(pid, INFO_TAB.id, { silent: true })
  /* 先登记项目根 + 对话工作目录：host 的路径白名单靠这次登记放行 */
  registerProjectRoot(project).finally(() => { loadGit(pid) })
}

export function closeOverlay() {
  /* 关工作台要顺手把「拖放高亮」和宿主让位都收干净，
     否则偶尔会留下 marginLeft / 高亮残留，看上去像按钮没反应 */
  if (store.chatDropHover) emit({ chatDropHover: false })
  try { releaseDock() } catch { /* 没锚上宿主时忽略 */ }
  emit({ open: false, modal: null, menu: null })
}

/** 顶栏 ✕ / Esc 的统一入口（外部/测试都调这个） */
export function closeWorkbench() {
  /* 关工作台要「彻底」：拖放高亮、拖动态、菜单/弹窗/标签菜单、浏览器更多面板、
     文件管理器右键菜单，以及宿主那边的 marginLeft，全部收干净 */
  if (store.chatDropHover) emit({ chatDropHover: false })
  if (store.dragOver) emit({ dragOver: false })
  try { releaseDock() } catch { /* 没锚上宿主时忽略 */ }
  try { forceClearHostMargin() } catch { /* 同上 */ }
  try {
    if (typeof document !== 'undefined' && document.body && document.body.classList) document.body.classList.remove('wt-dragging')
  } catch { /* 只读环境 */ }
  emit({
    open: false,
    modal: null,
    menu: null,
    tabMenu: false,
    fs: { ...store.fs, menu: null },
    web: { ...store.web, more: false },
  })
  return true
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


/* ============================ 音乐插件桥 ============================ */



/* ============================ 拖拽：会话 / 目录 → 新项目 ============================ */

const DRAG_SESSION = 'application/x-dsh-session'

/**
 * 会话行拖拽起点：把会话身份写进 dataTransfer。
 * 宿主自己的侧边栏会话行没有实现拖拽（ui-sidebar 里没有 drag 代码），
 * 所以「从工作区拖一条会话进来」由工作台的会话列表提供拖拽源，落到侧边栏即建项目。
 */
export function startSessionDrag(e, session) {
  const dt = e && e.dataTransfer
  if (!dt || !session) return
  try {
    dt.setData(DRAG_SESSION, JSON.stringify({
      id: session.id, title: session.title || '', cwd: session.cwd || '', state: session.state || '',
    }))
    dt.setData('text/plain', String(session.id || ''))
    dt.effectAllowed = 'copy'
  } catch { /* 某些环境禁止写 dataTransfer */ }
}

/** 这次拖拽的数据能不能落到工作台（决定 dragover 要不要 preventDefault） */
export function canDropOnWorktable(e) {
  const dt = e && e.dataTransfer
  if (!dt) return false
  const types = Array.from(dt.types || [])
  if (types.includes(DRAG_SESSION)) return true
  if (types.includes('text/plain') || types.includes('text/uri-list') || types.includes('Files')) return true
  return !!(dt.files && dt.files.length)
}

/**
 * dragover 里该把 dropEffect 设成什么。
 *
 * 必须和拖拽源声明的 effectAllowed 兼容，否则浏览器**根本不派发 drop**（不是被我们拦掉，
 * 是光标显示禁止、松手什么都不发生）。宿主的会话行用 effectAllowed='move'，
 * 我们以前固定写 'copy' —— 两者不兼容，这就是「拖过去没反应」的根因。
 */
export function pickDropEffect(e) {
  const dt = e && e.dataTransfer
  const allow = String((dt && dt.effectAllowed) || '').toLowerCase()
  if (!allow || allow === 'uninitialized' || allow === 'all' || allow.indexOf('copy') >= 0) return 'copy'
  if (allow.indexOf('move') >= 0) return 'move'
  if (allow.indexOf('link') >= 0) return 'link'
  return 'copy'
}

/** 会话 id 归一：宿主树节点、我们自己写的载荷、UUID 三种写法都算同一个会话 */
export function normSessionId(raw) {
  const s = String(raw || '').trim()
  if (!s) return ''
  return s.replace(/^session[-_:]/i, '').toLowerCase()
}

/** 从 id 列表里认会话：先精确，再按「去掉 session- 前缀」宽松比 */
function lookupSession(raw) {
  const sid = String(raw || '').trim()
  if (!sid) return null
  const exact = store.sessions.rows.find((s) => s.id === sid)
  if (exact) return exact
  const n = normSessionId(sid)
  if (!n) return null
  return store.sessions.rows.find((s) => normSessionId(s.id) === n) || null
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/**
 * 从 dataTransfer 里认出「会话」「目录路径」或「一段文本（当项目名用）」。
 *
 * 三种来源都要认：
 *   ① 工作台自己的会话行 —— application/x-dsh-session，带标题和 cwd；
 *   ② 宿主侧边栏的会话行 —— 只写 text/plain = 会话 id（见宿主 ui-sidebar 的 onDragStart）；
 *   ③ 别处拖来的纯文本（比如选中的会话标题）—— 当成项目名，总比「没反应」好。
 */
export function readDrop(e) {
  const dt = e && e.dataTransfer
  if (!dt) return null
  const get = (fmt) => { try { return String(dt.getData(fmt) || '') } catch { return '' } }

  const custom = get(DRAG_SESSION)
  if (custom) {
    try {
      const j = JSON.parse(custom)
      if (j && j.id) {
        return { session: { id: String(j.id), title: String(j.title || ''), cwd: String(j.cwd || ''), state: String(j.state || '') } }
      }
    } catch { /* 继续看别的格式 */ }
  }

  /* 把所有能读的格式都过一遍：宿主可能塞在自定义类型里，也可能只在 text/plain */
  const types = Array.from(dt.types || []).map((t) => String(t))
  const formats = types.filter((t) => t !== 'Files').concat(['application/json', 'text/plain', 'text/uri-list'])
  const seen = new Set()

  for (const fmt of formats) {
    if (seen.has(fmt)) continue
    seen.add(fmt)
    const raw = get(fmt).trim()
    if (!raw) continue

    if (raw.startsWith('{') || raw.startsWith('[')) {
      try {
        const j = JSON.parse(raw)
        const id = j && (j.id || j.sessionId || j.session_id || (j.session && j.session.id))
        if (id) {
          const hidden = j.session && typeof j.session === 'object' ? j.session : j
          return { session: {
            id: String(id),
            title: String(hidden.title || j.title || ''),
            cwd: String(hidden.cwd || hidden.path || j.cwd || ''),
          } }
        }
      } catch { /* 不是 JSON，按文本继续判 */ }
    }

    /* 会话 id：session-<uuid> / session-xxx / 裸 uuid */
    const hit = raw.match(/session-[0-9a-z_.:-]+/i) || raw.match(UUID_RE)
    if (hit) return { session: { id: hit[0] } }

    const filePath = raw.replace(/^file:\/\//i, '')
    if (/^[a-zA-Z]:[\\/]/.test(filePath) || /^\\\\[^\\]/.test(filePath)) return { path: filePath }
  }

  const files = dt.files
  if (files && files.length) {
    const f = files[0]
    const p = String((f && (f.path || f.webkitRelativePath)) || '')
    if (p) return { path: p }
  }

  /* 认不出就不建：误拖一段文字进来凭空多一个项目，比「没反应」更烦人 */
  return null
}

/** 松手：会话 → 建一个绑定它的项目并进入；目录 → 按目录建项目；纯文本 → 用这段文本命名 */
export function dropOnWorktable(e) {
  clearDragOver()
  const payload = readDrop(e)
  if (!payload) { toast('没认出拖进来的是会话还是目录', 'warn'); return }
  if (payload.session) {
    createFromSession(sessionById(payload.session.id) || payload.session)
    return
  }
  if (payload.path) {
    const name = baseName(payload.path) || '新项目'
    const pid = addProject({ name, path: payload.path })
    if (pid) { toast('已按目录添加项目：' + name, 'ok'); enterProject(pid) }
    return
  }
  toast('没认出拖进来的是会话还是目录', 'warn')
}

/**
 * 松手在某个项目上：把会话绑过去，而不是又建一个新项目。
 *
 * 这一步是「拖入项目中」的正确落点 —— 以前 .pitem 没有 drop 处理，事件冒泡到侧边栏根，
 * 结果用户想绑定，却凭空多出一个项目（还常常没有名字）。
 */
export function dropOnProject(e, pid) {
  clearDragOver()
  const p = projectOf(pid)
  if (!p) return false
  const payload = readDrop(e)
  if (!payload) return false

  if (payload.session) {
    const sid = payload.session.id
    if (p.sessions.includes(sid)) {
      toast('这条对话已经绑定在「' + (p.alias || p.name) + '」里了', 'info')
      enterProject(pid)
      return true
    }
    const other = projectBySession(sid)
    if (other) {
      toast('这条对话已绑定到「' + (other.alias || other.name) + '」，先在那里解绑', 'warn')
      return true
    }
    /* 项目还没设工作目录：顺手用会话的 cwd 补上（有才补，不覆盖已有值） */
    const row = lookupSession(sid) || payload.session
    const cwd = String(row.cwd || '')
    const patch = { sessions: p.sessions.concat([sid]) }
    if (!p.path && cwd) patch.path = cwd
    updateProject(pid, patch)
    const title = String(row.title || '') || sid
    toast('已把对话绑到「' + (p.alias || p.name) + '」：' + title, 'ok')
    return true
  }

  if (payload.path) {
    if (p.path && p.path !== payload.path) {
      toast('「' + (p.alias || p.name) + '」已有工作目录，没有改动', 'info')
      return true
    }
    updateProject(pid, { path: payload.path })
    toast('已设置工作目录：' + payload.path, 'ok')
    return true
  }

  return false
}

export function setDragOver(on) {
  const next = !!on
  if (store.dragOver !== next) emit({ dragOver: next })
}

export function clearDragOver() { setDragOver(false) }
/* ============================ 项目增删改 ============================ */

function persistProjects(projects) {
  writeLS(LS.projects, projects)
  emit({ projects })
}

export function addProject({ name, path, emoji, sessionId, note }) {
  const cleanName = String(name || '').trim()
  if (!cleanName) { toast('请填写项目名称', 'warn'); return '' }
  /* id 用毫秒时间戳，但同一毫秒内建两个项目会撞（拖拽连点、批量导入、测试里都是这样），
     撞了以后 updateProject / find 全都会指到错的那条 —— 所以撞了就往后加序号 */
  const base = 'p-' + Date.now().toString(36)
  let pid = base
  for (let i = 2; store.projects.some((p) => p.id === pid); i += 1) pid = base + '-' + i
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
  const victim = projectOf(pid)
  if (victim) {
    /* 先记一笔，供 9 秒内撤销；只留最近 5 个 */
    const at = store.projects.findIndex((p) => p.id === pid)
    emit({ trash: [{ kind: 'project', project: victim, at, when: Date.now() }].concat(store.trash || []).slice(0, 4) })
  }
  const projects = store.projects.filter((p) => p.id !== pid)
  persistProjects(projects)
  const status = { ...store.status }
  delete status[pid]
  emit({ status, menu: null })
  writeLS(LS.status, status)
  if (store.activeId === pid) {
    emit({ activeId: null, view: 'grid' })
  }
  toastUndo('已移除项目（磁盘文件未动）', () => undoRemoveProject())
}

/** 撤销最近一次删除：放回原来的位置 */
export function undoRemoveProject() {
  const last = (store.trash || []).find((t) => t.kind === 'project')
  if (!last) {
    toast('没有可撤销的删除', 'warn')
    return false
  }
  const list = store.projects.slice()
  const at = Math.max(0, Math.min(Number.isFinite(Number(last.at)) ? Number(last.at) : list.length, list.length))
  list.splice(at, 0, last.project)
  persistProjects(list.map((p, i) => ({ ...p, order: i })))
  emit({ trash: store.trash.filter((t) => t !== last) })
  toast('已撤销删除：' + (last.project.alias || last.project.name), 'ok')
  return true
}

/** 把项目拖到另一个项目前面（beforePid 为空 = 放到最后） */
export function moveProjectBefore(pid, beforePid) {
  if (!pid || pid === beforePid) return
  const list = store.projects.slice()
  const from = list.findIndex((p) => p.id === pid)
  if (from < 0) return
  const [item] = list.splice(from, 1)
  const at = beforePid ? list.findIndex((p) => p.id === beforePid) : list.length
  list.splice(at < 0 ? list.length : at, 0, item)
  persistProjects(list.map((p, i) => ({ ...p, order: i })))
}

/** 把项目拖进某个分组（folder 为空 = 拖回未分组） */
export function setProjectFolder(pid, folder) {
  const p = projectOf(pid)
  if (!p) return
  const next = String(folder || '')
  if ((p.folder || '') === next) return
  updateProject(pid, { folder: next })
  toast(next ? '已归入分组「' + next + '」' : '已移出分组', 'ok')
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

/**
 * 会话标题能不能直接当项目名（排除空、等于 id、形如 session-xxx）。
 *
 * `session.titled === false` 是宿主明确说的「这条会话还没有自己的名字」，
 * 此时 `title` 只是工作目录名兜底 —— 默认工作区恰好叫 `default-workspace`，
 * 以前就把它当会话名了，项目跟着叫 `default-workspace`。这时候不给名字，
 * 让项目落到「未命名项目」，等宿主把标题折叠出来再补（enrichProjectName）；
 * 除非会话就在自己的项目目录里跑，那目录名本身还是有意义的名字。
 */
function sessionTitleOf(session) {
  const sid = String(session?.id || '')
  const raw = String(session?.title || '').trim()
  const dir = baseName(session?.cwd || '')
  if (session?.titled === false) {
    const wsDir = baseName(store?.defaults?.workspace || '') || 'default-workspace'
    return dir && dir !== wsDir ? dir : ''
  }
  if (raw && raw !== sid && !/^session-[\w-]+$/i.test(raw)) return raw
  return dir || ''
}

/**
 * 用一条会话建项目。
 *
 * 取名顺序：会话标题 → 工作目录名 → 「未命名项目」（并弹编辑窗）。
 *
 * 关键：宿主侧边栏的会话行拖过来的载荷**只有会话 id**（`text/plain = node.id`），
 * 标题和 cwd 都没有。所以先拿 id 回查本地会话快照；快照里没有（刚启动 / 轮询失败 /
 * 会话是新建的）就先落项目，再异步拉一次快照按标题补名 —— 以前没有这一步，
 * 从宿主拖进来必然停在「未命名项目」，这就是「拖进来没有自动命名」。
 *
 * 保持同步返回：调用处（onDrop）要立即拿到 pid 决定是否 stopPropagation。
 */
export function createFromSession(session) {
  const given = session && typeof session === 'object' ? session : {}
  let sid = String(given.id || '').trim()
  const row = sid ? lookupSession(sid) : null
  /* 用快照里的规范 id（大小写 / 前缀可能和拖过来的写法不同），绑定才对得上 */
  if (row && row.id) sid = String(row.id)
  const info = row || given

  if (sid) {
    const existing = store.projects.find((p) => p.sessions.includes(sid))
    if (existing) {
      toast('该对话已有项目：' + (existing.alias || existing.name), 'info')
      enterProject(existing.id)
      return existing.id
    }
  }

  const title = sessionTitleOf(info)
  if (!sid && !title) return ''
  const pid = addProject({ name: title || '未命名项目', path: info.cwd || '', sessionId: sid })
  if (!pid) return ''
  if (!title) {
    /* 先按老行为弹编辑窗（用户随时能自己填）；有 id 的话同时去补快照，
       查到就自动改名并关掉编辑窗 —— 但从宿主拖进来的绝大多数是这一种。 */
    openModal('edit', pid)
    toast('这条对话还没有名字，先给它起一个', 'info')
    if (sid) enrichProjectName(pid, sid)
    return pid
  }
  enterProject(pid)
  return pid
}

/**
 * 项目已经用「未命名项目」落下时，异步补一次会话快照再取名。
 * 只在名字还是占位名时覆盖，用户在编辑窗里已经改过就不动他。
 */
async function enrichProjectName(pid, sid) {
  try {
    await loadSessions()
  } catch { return }
  const row = lookupSession(sid)
  const p = projectOf(pid)
  if (!row || !p) return
  const title = sessionTitleOf(row)
  if (!title) return
  const patch = {}
  if (!p.name || p.name === '未命名项目' || p.name === sid) { patch.name = title; patch.alias = title }
  if (!p.path && row.cwd) patch.path = row.cwd
  if (!Object.keys(patch).length) return
  updateProject(pid, patch)
  if (store.modal && store.modal.kind === 'edit' && store.modal.pid === pid) closeModal()
  toast('已按会话命名：' + title, 'ok')
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

/* ============================ 并排项目 ============================ */

function normalizeSide(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const split = Number(s.split)
  return {
    pid: typeof s.pid === 'string' ? s.pid : '',
    split: Number.isFinite(split) && split >= 20 && split <= 80 ? Math.round(split) : 50,
  }
}

/** 在右侧再放一个项目（传空 = 关掉并排） */
export function setSideProject(pid) {
  const key = String(pid || '')
  if (key && !projectOf(key)) {
    toast('找不到这个项目', 'warn')
    return false
  }
  if (key && key === store.activeId) {
    toast('它就是当前项目，换一个', 'warn')
    return false
  }
  const side = { ...(store.side || { split: 50 }), pid: key }
  emit({ side })
  writeLS(LS.side, side)
  return true
}

export function setSideSplit(pct) {
  const n = Number(pct)
  const split = Number.isFinite(n) && n > 0 ? Math.max(20, Math.min(80, Math.round(n))) : 50
  const side = { ...(store.side || {}), split }
  emit({ side })
  writeLS(LS.side, side)
  return split
}

/** 当前应该并排显示的项目（被删/等于当前项目时自动不显示） */
export function sideProjectOf(activeId) {
  const pid = store.side && store.side.pid
  if (!pid || pid === activeId) return null
  return projectOf(pid) || null
}

/* ============================ 运行配置 ============================ */

export function setRunConfig(pid, patch) {
  const project = projectOf(pid)
  if (!project) return false
  const run = {
    ...(project.run || { cmd: '', port: 0, cwd: '' }),
    ...(patch || {}),
  }
  const next = {
    cmd: String(run.cmd || ''),
    port: Number(run.port) || 0,
    cwd: String(run.cwd || ''),
  }
  updateProject(pid, { run: next })
  return true
}

/**
 * 跑项目：打开终端标签页 → 把命令喂给终端（cwd = 项目目录）。
 * 不会自动打开浏览器；端口配了就给一个「打开」入口（不探测，避免误报）。
 */
export function runProject(pid) {
  const project = projectOf(pid)
  if (!project) return { ok: false, error: '项目不存在' }
  const cmd = String((project.run && project.run.cmd) || '').trim()
  if (!cmd) {
    toast('还没配运行命令：右击项目 → 编辑 → 运行命令', 'warn')
    return { ok: false, error: 'no-run-config' }
  }
  openTab(pid, 'term')
  emit({ run: { pid, state: 'running', cmd, at: Date.now(), error: '' } })
  /* 有交互式终端就把命令打进去（看得见输出）；没有才退回命令模式 */
  termRun(pid, cmd)
  const port = Number((project.run && project.run.port) || 0)
  if (port) toast('已启动：' + cmd + '（端口 ' + port + '）', 'ok')
  else toast('已启动：' + cmd, 'ok')
  return { ok: true, cmd }
}

export function stopProject(pid) {
  const project = projectOf(pid)
  if (!project) return false
  termCtrlC(pid)
  emit({ run: { pid, state: 'idle', cmd: '', at: Date.now(), error: '' } })
  toast('已请求停止', 'info')
  return true
}

/** 项目配了端口就给个跳转入口 */
export function openRunPort(pid) {
  const project = projectOf(pid)
  const port = Number((project && project.run && project.run.port) || 0)
  if (!port) return false
  if (project) webSync(project)
  openTab(pid, 'web')
  webGotoSmart('http://localhost:' + port)
  return true
}


/* ============================ 拖到对话（文件 / 网页） ============================ */

export const FILE_DRAG = 'application/x-wt-file'
export const URL_DRAG = 'application/x-wt-url'

/** Windows 路径 → file:/// URL（拖给外部程序/浏览器用） */
export function fileUrlOf(path) {
  const s = String(path || '').trim()
  if (!s) return ''
  const norm = s.replace(/\\/g, '/')
  return /^[A-Za-z]:/.test(norm) ? 'file:///' + encodeURI(norm) : 'file://' + encodeURI(norm)
}

export function chatTextForFile(path) {
  const p = String(path || '').trim()
  if (!p) return ''
  const name = p.split(/[\\/]/).pop() || p
  return '【文件】' + name + '\n' + p
}

export function chatTextForUrl(url, title) {
  const u = String(url || '').trim()
  if (!u) return ''
  const t = String(title || '').trim()
  return t ? '【网页】' + t + '\n' + u : '【网页】' + u
}

/** 拖一个文件：写自定义类型 + text/plain + text/uri-list（外部程序也能接） */
export function dragFilePayload(e, path) {
  const p = String(path || '').trim()
  if (!e || !e.dataTransfer || !p) return false
  try {
    e.dataTransfer.setData(FILE_DRAG, p)
    e.dataTransfer.setData('text/plain', p)
    const fu = fileUrlOf(p)
    if (fu) e.dataTransfer.setData('text/uri-list', fu)
    e.dataTransfer.effectAllowed = 'copy'
    return true
  } catch { return false }
}

/** 拖一个网页：自定义类型带标题 + text/uri-list */
export function dragUrlPayload(e, url, title) {
  const u = String(url || '').trim()
  if (!u) return false
  try {
    e.dataTransfer.setData(URL_DRAG, JSON.stringify({ url: u, title: String(title || '') }))
    e.dataTransfer.setData('text/uri-list', u)
    e.dataTransfer.setData('text/plain', u)
    e.dataTransfer.effectAllowed = 'copy'
    return true
  } catch { return false }
}

/** 从 dataTransfer 解析「要发给对话」的东西（自定义类型 → File.path → uri-list → text） */
export function readChatDrop(e) {
  const dt = e && e.dataTransfer
  if (!dt) return null
  try {
    /* 拖的是会话，不是文件/网页 —— 不能把 session-xxx 当成附件塞进对话 */
    let own = ''
    try { own = String(dt.getData(DRAG_SESSION) || '') } catch { own = '' }
    if (own) return null
    const f = dt.getData(FILE_DRAG)
    if (f) return { kind: 'file', value: f }
    const raw = dt.getData(URL_DRAG)
    if (raw) {
      const o = JSON.parse(raw)
      return o && o.url ? { kind: 'url', value: o.url, title: o.title || '' } : null
    }
    /* 真实文件对象：新版 Electron 拿不到 File.path（被 webUtils 取代），
       但文件本身在 —— 把 file 一并带出去，调用方可以读内容兜底 */
    let file = null
    try {
      if (dt.files && dt.files.length) file = dt.files[0]
      if (!file && dt.items && dt.items.length) {
        for (let i = 0; i < dt.items.length; i += 1) {
          const it = dt.items[i]
          if (it && it.kind === 'file' && typeof it.getAsFile === 'function') {
            file = it.getAsFile()
            if (file) break
          }
        }
      }
    } catch { file = null }
    if (file) {
      const p = typeof file.path === 'string' ? file.path : ''
      return { kind: 'file', value: p, name: String(file.name || ''), file }
    }
    const uris = String(dt.getData('text/uri-list') || '').split(/\r?\n/).filter((x) => x && !x.startsWith('#'))
    const first = uris[0] || String(dt.getData('text/plain') || '').trim()
    if (!first) return null
    /* 宿主侧边栏的会话行只写 text/plain = 会话 id，别把它当文件路径 */
    if (/^(session[-_:])?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first)) return null
    if (/^session[-_:]\S+$/i.test(first)) return null
    if (/^https?:\/\//i.test(first)) return { kind: 'url', value: first }
    if (/^file:\/\//i.test(first)) {
      const p = decodeURI(first.replace(/^file:\/\/+/i, '')).replace(/\//g, '\\')
      return { kind: 'file', value: p, name: String(p).split(/[\\\\/]/).pop() || '' }
    }
    return { kind: 'file', value: first, name: String(first).split(/[\\\\/]/).pop() || '' }
  } catch { return null }
}

/* ---------- 宿主那层拖放遮罩 ----------
 * 宿主 ComposerAttachments（@deepseek-ai/dsh-client-ui-attachment/drop-events）在
 * document 上挂了 dragenter / dragover / dragleave / drop 四个**冒泡**监听，只认
 * `dataTransfer.types` 里的 `Files`；一旦命中就 setDragActive(true)，往 body 里
 * portal 一层整窗遮罩 —— 就是「文件或图片拖动到此处即可添加」那块灰底。
 *
 * 那层遮罩 `pointer-events: none`，纯装饰：**点不掉、Esc 也不管**，只有宿主自己的
 * drop 或者 window 的 dragend 才会把它 reset（dragDepth 归零 + setDragActive(false)）。
 * 我们没有 window 级 dragend 可指望（从资源管理器拖进来时 dragend 不派发到页面），
 * 而我们的窗格一旦 stopPropagation 吃掉 drop，宿主的 onDrop 就跑不到 ——
 * dragActive 永远停在 true，遮罩死死盖住工作台。0.10.7 用户报的「弹窗无法关闭」
 * 正是这个：不是弹窗，是一层关不掉的遮罩。
 *
 * 两头都堵：
 *   ① 在 document **捕获**阶段掐掉「落在工作台上的文件 dragenter」，宿主压根进不了
 *      dragActive，遮罩不出现（捕获早于宿主的冒泡监听，也早于 React 根容器）；
 *   ② 万一已经亮了（拖拽先落在宿主自己的区域再移进来），就地补一发合成 dragleave
 *      把它的 dragDepth 清零 —— 它跑 reset() 只关遮罩，不会加任何文件。
 */
const FILE_DRAG_TYPES = ['Files', 'text/uri-list']

/** 这次拖的是不是系统文件（不是我们自己的标签页 / 会话行） */
export function isFileDragEvent(e) {
  const dt = e && e.dataTransfer
  if (!dt) return false
  let types = []
  try { types = dt.types ? Array.prototype.slice.call(dt.types) : [] } catch { types = [] }
  if (types.indexOf(FILE_DRAG) >= 0) return true
  for (let i = 0; i < FILE_DRAG_TYPES.length; i += 1) {
    if (types.indexOf(FILE_DRAG_TYPES[i]) >= 0) return true
  }
  return !types.length && !!dt.files && dt.files.length > 0
}

/** 指针底下是不是我们工作台自己的界面（遮罩是 pointer-events:none，elementFromPoint 会跳过它） */
export function pointsIntoWorkbench(e) {
  const doc = typeof document !== 'undefined' ? document : null
  if (!doc || !e || typeof doc.elementFromPoint !== 'function') return false
  let hit = null
  try { hit = doc.elementFromPoint(Number(e.clientX) || 0, Number(e.clientY) || 0) } catch { hit = null }
  return !!(hit && typeof hit.closest === 'function' && hit.closest('.wt-scope'))
}

/** 强制关掉宿主的拖放遮罩（合成一发 cancel 用的 dragleave，不会加任何文件） */
export function resetHostDropMask() {
  const doc = typeof document !== 'undefined' ? document : null
  if (!doc || typeof doc.dispatchEvent !== 'function' || !doc.documentElement) return false
  if (typeof doc.documentElement.dispatchEvent !== 'function') return false
  try {
    const ev = new Event('dragleave', { bubbles: true })
    /* 宿主只认 types 里带 Files 的 dataTransfer；files 给空数组，它就不会往对话里塞东西 */
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['Files'], files: [], items: [], getData: () => '' } })
    /* clientX/-Y 给负数：宿主判「指针离开视口」的分支会连 dragDepth 一起清零 */
    Object.defineProperty(ev, 'clientX', { value: -1 })
    Object.defineProperty(ev, 'clientY', { value: -1 })
    doc.documentElement.dispatchEvent(ev)
    return true
  } catch { return false }
}

/** 挂一次：工作台上方不许出现宿主那层拖放遮罩 */
export function installDropMaskGuard() {
  const doc = typeof document !== 'undefined' ? document : null
  if (!doc || typeof doc.addEventListener !== 'function') return () => {}
  const onEnter = (e) => {
    if (!isFileDragEvent(e)) return
    if (!pointsIntoWorkbench(e)) return
    /* 捕获阶段掐断 → 宿主的 document 冒泡监听收不到，dragActive 不会亮 */
    if (typeof e.stopPropagation === 'function') e.stopPropagation()
    /* 已经亮着（从宿主区域挪进来的）就顺手关掉 */
    resetHostDropMask()
  }
  doc.addEventListener('dragenter', onEnter, true)
  return () => {
    if (typeof doc.removeEventListener === 'function') doc.removeEventListener('dragenter', onEnter, true)
  }
}

/** 统一出口：把文件/网页塞进宿主输入框（不自动发送） */
export function sendToChat(payload) {
  if (!payload || !payload.value) return false
  const text = payload.kind === 'url'
    ? chatTextForUrl(payload.value, payload.title)
    : chatTextForFile(payload.value)
  const ok = fillHostInput(text)
  toast(ok ? '已填到对话输入框，回车发送' : '没找到宿主输入框，文本已就绪', ok ? 'ok' : 'warn')
  return !!ok
}

/** 读拖进来的文件内容（路径拿不到时的兜底；html 自定义窗口用） */
export async function fileToText(file) {
  if (!file) return ''
  try {
    if (typeof file.text === 'function') return String(await file.text())
    if (typeof FileReader === 'function') {
      return await new Promise((resolve, reject) => {
        const fr = new FileReader()
        fr.onload = () => resolve(String(fr.result || ''))
        fr.onerror = () => reject(fr.error || new Error('读取失败'))
        fr.readAsText(file)
      })
    }
  } catch { /* 读不了就返回空串 */ }
  return ''
}

/** 诊断用：把这次拖放看到的东西摊平（拖不进来时点一下「看看它收到了什么」） */
export function dropSummary(e) {
  const dt = e && e.dataTransfer
  if (!dt) return '没有 dataTransfer'
  const types = dt.types ? Array.prototype.slice.call(dt.types) : []
  const names = dt.files && dt.files.length ? Array.prototype.map.call(dt.files, (f) => String((f && f.name) || '')) : []
  const paths = dt.files && dt.files.length ? Array.prototype.map.call(dt.files, (f) => String((f && f.path) || '')) : []
  return 'types=[' + types.join(',') + '] files=[' + names.join(',') + '] paths=[' + paths.join(',') + ']'
}

export function sendPathToChat(path) { return sendToChat({ kind: 'file', value: path }) }
export function sendUrlToChat(url, title) { return sendToChat({ kind: 'url', value: url, title }) }

export function setChatDropHover(on) {
  if (store.chatDropHover === !!on) return
  emit({ chatDropHover: !!on })
}

/** 拖放落到「对话」区域时调用 */
export function dropToChat(e) {
  const payload = readChatDrop(e)
  setChatDropHover(false)
  if (!payload) return false
  /* 文件对象有、但宿主没给磁盘路径：说清楚，别静默失败 */
  if (payload.kind === 'file' && !payload.value) {
    toast('拿到文件「' + (payload.name || '未知') + '」但没有磁盘路径（宿主没暴露），请从工作台的文件管理器里拖', 'warn')
    return false
  }
  return sendToChat(payload)
}

/* ============================ 快捷键 ============================ */

export const HOTKEYS = [
  { keys: 'Ctrl/⌘ + K', label: '全局搜索（项目 / 对话）' },
  { keys: 'Ctrl/⌘ + N', label: '新建项目' },
  { keys: 'Ctrl/⌘ + G', label: '打开总览' },
  { keys: 'Ctrl/⌘ + 1…9', label: '切到第 N 个标签页' },
  { keys: 'Ctrl/⌘ + W', label: '关闭当前标签页' },
  { keys: 'Alt + ↑ / ↓', label: '上一个 / 下一个项目' },
  { keys: 'Alt + Shift + ↓', label: '并排：把并排项目设为主项目（互换）' },
  { keys: 'Alt + Shift + ↑', label: '并排：关闭并排' },
  { keys: 'Esc', label: '关菜单 → 关弹窗 → 关工作台' },
]

/** 焦点在输入控件里时不抢键（Ctrl+K 例外：哪里都能搜） */
function typingInField(e) {
  const t = e && e.target
  if (!t) return false
  if (t.isContentEditable === true) return true
  const tag = String(t.tagName || '').toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** 可见项目（按 order 排好的）——项目间上下切换用 */
function visibleProjects() {
  return store.projects.filter((p) => !p.hidden).slice().sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
}

/**
 * 统一的快捷键入口：命中就处理并返回 true。
 * 单独抽出来是为了能在自测里直接喂事件对象，不用挂真实监听。
 */
export function handleHotkey(e) {
  if (!e || typeof e.key !== 'string') return false
  const key = e.key
  const lower = key.toLowerCase()
  const mod = !!(e.ctrlKey || e.metaKey)

  /* 搜索：输入框里也生效 */
  if (mod && lower === 'k') {
    e.preventDefault()
    openSearch()
    return true
  }
  if (typingInField(e)) return false

  if (mod && lower === 'n') {
    e.preventDefault()
    openModal('add')
    return true
  }
  if (mod && lower === 'g') {
    e.preventDefault()
    openGrid()
    return true
  }
  if (mod && lower === 'w') {
    const pid = store.activeId
    if (!store.open || store.view !== 'project' || !pid) return false
    const ui = uiOf(pid)
    const key2 = ui.activeTab || (ui.tabs[0] ? ui.tabs[0].key : '')
    if (!key2) return false
    e.preventDefault()
    closeTab(pid, key2)
    return true
  }
  if (mod && /^[1-9]$/.test(key)) {
    const pid = store.activeId
    if (!store.open || store.view !== 'project' || !pid) return false
    const ui = uiOf(pid)
    const tab = ui.tabs[Number(key) - 1]
    if (!tab) return false
    e.preventDefault()
    setActiveTab(pid, tab.key)
    return true
  }
  /* 并排：Alt+Shift+↓ 互换，Alt+Shift+↑ 关闭 */
  if (e.altKey && e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const side = sideProjectOf(store.activeId || '')
    if (!side) return false
    e.preventDefault()
    if (key === 'ArrowUp') { setSideProject(''); return true }
    const main = store.activeId
    setSideProject('')
    enterProject(side.id)
    if (main) setTimeout(() => setSideProject(main), 0)
    return true
  }
  if (e.altKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    const list = visibleProjects()
    if (list.length < 2) return false
    const at = list.findIndex((p) => p.id === store.activeId)
    const step = key === 'ArrowDown' ? 1 : -1
    const next = at < 0 ? (step > 0 ? 0 : list.length - 1) : (at + step + list.length) % list.length
    e.preventDefault()
    enterProject(list[next].id)
    return true
  }
  return false
}

/* ============================ 总览：排序 / 筛选 ============================ */

export const OVERVIEW_SORTS = [
  { id: 'recent', label: '最近活动' },
  { id: 'status', label: '状态优先' },
  { id: 'name', label: '名称' },
  { id: 'order', label: '自定义顺序' },
]

export const OVERVIEW_FILTERS = [
  { id: 'all', label: '全部' },
  { id: 'bound', label: '有对话' },
  { id: 'unbound', label: '未绑定' },
  { id: 'busy', label: '在跑/待处理' },
]

export function setOverview(patch) {
  const raw = { ...store.overview, ...(patch || {}) }
  const overview = {
    q: typeof raw.q === 'string' ? raw.q : '',
    sort: OVERVIEW_SORTS.some((s) => s.id === raw.sort) ? raw.sort : 'recent',
    filter: OVERVIEW_FILTERS.some((f) => f.id === raw.filter) ? raw.filter : 'all',
  }
  emit({ overview })
  writeLS(LS.overview, overview)
  return overview
}

/** 项目的最“近”时间：取它绑定的会话里最新的 updatedAt，没有就用记录的 updated 字符串 */
function projectRecency(project) {
  let best = 0
  for (const s of sessionsOf(project)) {
    const v = Number(s.updatedAt || 0)
    if (v > best) best = v
  }
  if (best) return best
  const t = Date.parse(String(project.updated || ''))
  return Number.isFinite(t) ? t : 0
}

const STATE_RANK = { working: 0, 'needs-you': 1, idle: 2, done: 3 }

/** 总览列表：先筛选再排序（纯函数，测试直接调） */
export function overviewProjects(list) {
  const all = Array.isArray(list) ? list : store.projects.filter((p) => !p.hidden)
  const ov = store.overview || { q: '', sort: 'recent', filter: 'all' }
  const needle = String(ov.q || '').trim().toLowerCase()
  const filtered = all.filter((p) => {
    if (needle) {
      const hay = [p.alias, p.name, p.path, p.folder, p.note].map((x) => String(x || '')).join(' ').toLowerCase()
      if (!hay.includes(needle)) return false
    }
    const bound = sessionsOf(p)
    if (ov.filter === 'bound') return bound.length > 0
    if (ov.filter === 'unbound') return bound.length === 0
    if (ov.filter === 'busy') {
      const st = stateOf(p.id)
      return st === 'working' || st === 'needs-you'
    }
    return true
  })
  const sorted = filtered.slice()
  if (ov.sort === 'name') sorted.sort((a, b) => String(a.alias || a.name).localeCompare(String(b.alias || b.name), 'zh'))
  else if (ov.sort === 'status') sorted.sort((a, b) => (STATE_RANK[stateOf(a.id)] ?? 9) - (STATE_RANK[stateOf(b.id)] ?? 9))
  else if (ov.sort === 'order') sorted.sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
  else sorted.sort((a, b) => projectRecency(b) - projectRecency(a))
  return sorted
}

/* ============================ 入驻项目（别的插件注册） ============================ */

function normPathKey(v) {
  return String(v || '').replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase()
}

/**
 * 供其他插件调用：window.__WT_REGISTER_PROJECT__({ name, path?, icon?, note?, id?, source? })
 * 只往侧边栏的「入驻」分组里加一行；点它时才真正落成工作台项目（adopt），
 * 所以注册是轻量的，插件每次启动重注册即可。
 */
export function registerExternalProject(spec) {
  const raw = spec && typeof spec === 'object' ? spec : {}
  const name = String(raw.name || raw.title || '').trim()
  if (!name) return ''
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-').replace(/^-+|-+$/g, '')
  const id = String(raw.id || 'ext-' + (slug || 'item')).slice(0, 60)
  const item = {
    id,
    name,
    icon: String(raw.icon || '🧩'),
    path: String(raw.path || '').trim(),
    note: String(raw.note || ''),
    source: String(raw.source || ''),
    at: Date.now(),
  }
  const list = (store.external || []).filter((x) => x.id !== id).concat([item]).slice(0, 30)
  emit({ external: list })
  return id
}

export function unregisterExternalProject(id) {
  const key = String(id || '')
  if (!key) return false
  const list = (store.external || []).filter((x) => x.id !== key)
  emit({ external: list })
  return list.length !== (store.external || []).length
}

export function clearExternalProjects() {
  emit({ external: [] })
}

/** 点入驻项：同目录已有项目就直接进，否则按它的名字/目录落成一个真项目 */
export function openExternalProject(id) {
  const item = (store.external || []).find((x) => x.id === id)
  if (!item) return false
  if (item.path) {
    const key = normPathKey(item.path)
    const exist = store.projects.find((p) => p.path && normPathKey(p.path) === key)
    if (exist) { enterProject(exist.id); return true }
  }
  const pid = addProject({ name: item.name, path: item.path, emoji: item.icon, note: item.note })
  if (!pid) return false
  enterProject(pid)
  return true
}

/* ============================ 项目模板 ============================ */

/**
 * 模板 = 预置的「标签页组合 + 布局」，让不同场景一进项目就顺手。
 * 不写磁盘、不加依赖，只调 openTab / patchUi。
 */
export const PROJECT_TEMPLATES = [
  { id: 'blank', label: '空项目', icon: '◻', hint: '什么都不预置', tabs: [], layout: 'single' },
  { id: 'frontend', label: '前端', icon: '◈', hint: '终端 + 浏览器(5173)，左右分栏', tabs: ['term', 'web'], layout: 'vsplit', web: 'http://localhost:5173' },
  { id: 'script', label: '脚本 / 工具', icon: '›_', hint: '终端 + 文件管理器', tabs: ['term', 'files'], layout: 'single' },
  { id: 'writing', label: '写作', icon: '✎', hint: '笔记 + 浏览器，左右分栏', tabs: ['notes', 'web'], layout: 'vsplit' },
  { id: 'research', label: '研究', icon: '◔', hint: '浏览器 + 笔记 + 终端', tabs: ['web', 'notes', 'term'], layout: 'vsplit' },
]

export function templateOf(id) {
  return PROJECT_TEMPLATES.find((t) => t.id === id) || PROJECT_TEMPLATES[0]
}

/** 把模板套到项目上：开标签页 → 定布局 → （前端模板）顺手把浏览器指到 5173 */
export function applyTemplate(pid, tplId) {
  const tpl = templateOf(tplId)
  if (!pid || !tpl.tabs.length) return tpl.id
  for (const kind of tpl.tabs) openTab(pid, kind)
  const ui = uiOf(pid)
  const first = (ui.tabs[0] || {}).key || ''
  const second = (ui.tabs[1] || {}).key || ''
  patchUi(pid, {
    activeTab: first,
    secondTab: tpl.layout === 'single' ? '' : second,
    layout: tpl.layout,
  })
  if (tpl.web) {
    const project = projectOf(pid)
    if (project) { webSync(project); webGotoSmart(tpl.web) }
  }
  return tpl.id
}

/* ============================ 导出 / 导入 ============================ */

export const SNAPSHOT_VERSION = 1

/** 只导「可迁移」的东西：项目、每个项目的布局、主题；会话 id 保留但不保证换机能连上 */
export function exportSnapshot() {
  return {
    version: SNAPSHOT_VERSION,
    at: Date.now(),
    projects: store.projects.map((p) => ({ ...p })),
    ui: Object.fromEntries(Object.entries(store.ui || {}).map(([k, v]) => [k, { ...(v || {}) }])),
    theme: { ...store.theme },
  }
}

export function exportSnapshotText() {
  return JSON.stringify(exportSnapshot(), null, 2)
}

/**
 * 合并导入：按 id（其次 path+name）判重——重复的更新、新的追加。
 * @param raw 文本或已解析对象
 */
export function importSnapshot(raw) {
  let data = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { toast('不是合法的 JSON', 'warn'); return { ok: false, added: 0, updated: 0, total: store.projects.length } }
  }
  if (!data || !Array.isArray(data.projects)) {
    toast('这份数据里没有项目列表', 'warn')
    return { ok: false, added: 0, updated: 0, total: store.projects.length }
  }
  const list = store.projects.slice()
  let added = 0
  let updated = 0
  for (const rawProject of data.projects.slice(0, 500)) {
    if (!rawProject || typeof rawProject !== 'object') continue
    const rec = normalizeProject(rawProject)
    if (!rec.name) continue
    const at = list.findIndex((x) => x.id === rec.id || (!!rec.path && x.path === rec.path && x.name === rec.name))
    if (at >= 0) {
      const prev = list[at]
      const sessions = Array.from(new Set([...(prev.sessions || []), ...(rec.sessions || [])]))
      list[at] = { ...prev, ...rec, id: prev.id, sessions }
      updated += 1
    } else {
      list.push({ ...rec, id: 'p-' + Math.random().toString(36).slice(2, 9) })
      added += 1
    }
  }
  persistProjects(list.map((p, i) => ({ ...p, order: i })))
  /* 布局/主题：只补缺，不覆盖用户当前选择 */
  if (data.ui && typeof data.ui === 'object') {
    const ui = { ...store.ui }
    for (const [pid, slice] of Object.entries(data.ui)) {
      if (ui[pid] === undefined && slice && typeof slice === 'object') ui[pid] = { ...slice }
    }
    emit({ ui })
    writeLS(LS.ui, ui)
  }
  const result = { ok: true, added, updated, total: list.length }
  toast('导入完成：新增 ' + added + ' · 更新 ' + updated, 'ok')
  return result
}

/* ============================ 产物回挂（.wt/artifact.json） ============================ */

/** 约定：项目目录下这个文件列出「产物」，打开项目时自动挂进对应窗格 */
export const ARTIFACT_FILE = '.wt/artifact.json'

function artifactFileOf(project) {
  const dir = project ? workspaceDirOf(project) : ''
  return dir ? joinPath(dir, ARTIFACT_FILE) : ''
}

function normalizeArtifact(raw, dir, i) {
  if (!raw || typeof raw !== 'object') return null
  const title = String(raw.title || raw.name || '').trim() || ('产物 ' + (i + 1))
  const url = String(raw.url || '').trim()
  const rel = String(raw.path || '').trim()
  const path = rel ? joinPath(dir, rel) : ''
  let kind = String(raw.kind || '').trim()
  if (!kind) kind = url ? 'url' : 'file'
  if (kind === 'url' && !/^https?:\/\//i.test(url)) return null
  if (kind !== 'url' && !path) return null
  return { title, kind, url, path, note: String(raw.note || '') }
}

/** 读并解析项目的产物清单；文件不存在算「没有产物」，不算错误 */
export async function loadArtifacts(pid) {
  const project = projectOf(pid)
  if (!project) return { ok: false, items: [], error: '项目不存在' }
  const dir = workspaceDirOf(project)
  if (!dir) {
    emit({ artifacts: { pid, dir: '', file: '', items: [], error: '', at: Date.now() } })
    return { ok: false, items: [], error: '' }
  }
  const file = joinPath(dir, ARTIFACT_FILE)
  emit({ artifacts: { pid, dir, file, items: store.artifacts.items, error: '', at: Date.now() } })
  try {
    const data = await apiPost('/fs/read', { path: file, mode: 'full' }, { timeout: 8000 })
    const text = String((data && data.text) || '')
    const parsed = JSON.parse(text || '{}')
    const list = Array.isArray(parsed) ? parsed : (Array.isArray(parsed.artifacts) ? parsed.artifacts : [])
    const items = list.slice(0, 20).map((it, i) => normalizeArtifact(it, dir, i)).filter(Boolean)
    emit({ artifacts: { pid, dir, file, items, error: '', at: Date.now() } })
    return { ok: true, items }
  } catch (err) {
    const msg = String((err && err.message) || err || '')
    /* 没有这个文件是常态：安静地当成「还没有产物」 */
    const missing = /ENOENT|不存在|no such file|not found|404/i.test(msg)
    emit({ artifacts: { pid, dir, file, items: [], error: missing ? '' : msg, at: Date.now() } })
    return { ok: false, items: [], error: missing ? '' : msg }
  }
}

/** 打开一个产物：网址进浏览器、文件按类型交给媒体窗 / 自定义窗口 / 系统程序 */
export function openArtifact(item) {
  const pid = store.activeId || (store.projects[0] && store.projects[0].id) || ''
  if (!item || !pid) return
  const project = projectOf(pid)
  if (item.kind === 'url') {
    if (project) webSync(project)
    openTab(pid, 'web')
    webGotoSmart(item.url)
    return
  }
  /* 剩下的按类型分流：媒体 → 媒体窗、网页 → 自定义窗口、其它 → 系统程序 */
  openFile(item.path, pid)
}

/** 把某个产物做成一条可发送的说明，塞进宿主输入框（不自动发送） */
export function sendArtifactToChat(item) {
  if (!item) return false
  const target = item.kind === 'url' ? item.url : item.path
  const text = '【产物】' + item.title + '\n' + target + (item.note ? '\n说明：' + item.note : '')
  const ok = fillHostInput(text)
  toast(ok ? '已填到对话输入框，回车发送' : '没找到宿主输入框，手动复制吧', ok ? 'ok' : 'warn')
  return !!ok
}

/** 媒体窗「浏览项目」用：列某个目录（返回 { path, parent, entries }） */
export async function listMediaDir(dir) {
  const target = String(dir || '').trim()
  if (!target) throw new Error('还没有可浏览的目录')
  const data = await apiPost('/fs/list', { path: target }, { timeout: 8000 })
  return data || { path: target, entries: [] }
}

/** 让媒体窗预览某个文件（也会把标签页切过去） */
export function openMedia(pid, path) {
  emit({ media: { pid: String(pid || ''), path: String(path || '') } })
  if (pid) openTab(pid, 'media')
}

/* ============================ 布局预设 ============================ */

/** 一个工作区能同时铺几个窗格（panes = 格子数） */
export const LAYOUTS = [
  { id: 'single', icon: '▭', label: '单窗格', hint: '一次只显示一个窗口（默认）', panes: 1 },
  { id: 'vsplit', icon: '◫', label: '左右两栏', hint: '左栏 + 右栏，中间可拖动；两栏各看一个窗口', panes: 2 },
  { id: 'hsplit', icon: '⬓', label: '上下两栏', hint: '上排 + 下排，中间可拖动；两栏各看一个窗口', panes: 2 },
  { id: 't3', icon: '▤', label: '上一下二', hint: '顶行通栏 + 下面并排两栏（三格）', panes: 3 },
  { id: 'cols3', icon: '▥', label: '三列', hint: '三栏并排，两条分割线都能拖', panes: 3 },
  { id: 'grid4', icon: '▦', label: '四格', hint: '2×2 四格，行列各一条分割线', panes: 4 },
]

/** 这个布局要铺几个窗格 */
export function paneCountOf(layout) {
  const hit = LAYOUTS.find((l) => l.id === layout)
  return hit ? hit.panes : 1
}

/** 第 slot 格现在显示哪个标签页（0 = 主窗格，1 = 次窗格，2/3 存 ui.cells） */
export function cellKeyOf(ui, slot) {
  if (slot <= 0) return ui.activeTab || ''
  if (slot === 1) return ui.secondTab || ''
  return (ui.cells && ui.cells[slot]) || ''
}

/** 某一格空着时，挑一个没被别格占用的标签页顶上 */
function freeTabFor(ui, slot, extraSkip) {
  const used = new Set(extraSkip ? [extraSkip] : [])
  for (let i = 0; i < 4; i++) {
    if (i === slot) continue
    const k = cellKeyOf(ui, i)
    if (k) used.add(k)
  }
  return (ui.tabs.find((t) => !used.has(t.key)) || {}).key || ''
}

/** 往 patch 里写「某一格显示 key」——两个老字段（activeTab / secondTab）保持原语义 */
function withCell(ui, patch, slot, key) {
  if (slot <= 0) patch.activeTab = key
  else if (slot === 1) patch.secondTab = key
  else {
    const cells = (patch.cells || ui.cells || []).concat(['', '', '', '']).slice(0, 4)
    cells[slot] = key
    patch.cells = cells
  }
  return patch
}

export function setLayout(pid, layout) {
  const id = LAYOUTS.some((l) => l.id === layout) ? layout : 'single'
  const ui = uiOf(pid)
  const patch = { layout: id }
  /* 多窗格：把空着的格子填上「还没被占用的标签页」，切过去立刻有内容 */
  const draft = { ...ui, cells: (ui.cells || []).slice() }
  for (let slot = 1; slot < paneCountOf(id); slot++) {
    if (cellKeyOf(draft, slot)) continue
    const key = freeTabFor(draft, slot)
    withCell(draft, patch, slot, key)
    if (slot === 1) draft.secondTab = key
    else draft.cells[slot] = key
  }
  patchUi(pid, patch)
}

export function setSecondTab(pid, key) {
  patchUi(pid, { secondTab: typeof key === 'string' ? key : '' })
}

/** 往第 slot 格放一个标签页（0 主 / 1 次 / 2、3 由 cells 承担） */
export function setCellTab(pid, slot, key) {
  const ui = uiOf(pid)
  const to = Math.max(0, Math.min(3, Number(slot) || 0))
  if (!key || typeof key !== 'string') return
  patchUi(pid, withCell(ui, {}, to, key))
}

/** 拖标签到另一格：两格互换（目标格原来那个标签页回到源格） */
export function moveTabToCell(pid, key, slot) {
  const ui = uiOf(pid)
  const to = Math.max(0, Math.min(3, Number(slot) || 0))
  if (to >= paneCountOf(ui.layout)) return false
  let from = -1
  for (let i = 0; i < 4; i++) if (cellKeyOf(ui, i) === key) { from = i; break }
  if (from < 0 || from === to) return false
  const target = cellKeyOf(ui, to)
  const patch = {}
  const draft = { ...ui, cells: (ui.cells || []).slice() }
  /* 源格不能空着：优先换过来，实在没有别的标签页就挑一个空闲的 */
  const back = target || freeTabFor(draft, from, key)
  withCell(draft, patch, from, back)
  if (from === 1) draft.secondTab = back
  else if (from > 1) draft.cells[from] = back
  else draft.activeTab = back
  withCell(draft, patch, to, key)
  patchUi(pid, patch)
  return true
}

/** 第二条分割线（三列 / 四格）：pct = 20–80；传 0 复位 50/50 */
export function setSplitB(pid, pct) {
  const n = Number(pct)
  patchUi(pid, { splitB: Number.isFinite(n) && n > 0 ? Math.max(20, Math.min(80, Math.round(n))) : 0 })
}

/** pct = 第一窗格占比（20–80）；传 0 复位 50/50 */
export function setSplit(pid, pct) {
  const n = Number(pct)
  patchUi(pid, { split: Number.isFinite(n) && n > 0 ? Math.max(20, Math.min(80, Math.round(n))) : 0 })
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

/**
 * 关掉某个窗格时把它的状态复位成「刚打开」的样子：
 * 编辑器清空、终端清屏、浏览器回默认页、文件管理器清筛选、媒体清路径、自定义回需求页。
 * 不碰已保存的数据（笔记 / 自定义库 / 终端历史都留着）。
 */
export function resetPaneState(pid, kind) {
  const k = String(kind || '')
  if (k === 'editor') { closeEditor(true); return }
  if (k === 'term') { termPatch(pid, { lines: [], busy: false }); return }
  if (k === 'web') {
    /* 直接复位到项目默认站点页：webSync() 在同项目+同默认地址时会早退，不能靠它 */
    const p = projectOf(pid)
    const def = p ? siteUrlOf(p) : ''
    emit({
      web: {
        ...store.web,
        pid: String(pid || ''),
        defaultUrl: def,
        url: def,
        state: 'idle',
        error: '',
        ms: 0,
        startedAt: 0,
        history: def ? [def] : [],
        index: def ? 0 : -1,
        more: false,
        home: false,
        viewport: 'auto',
        engine: store.web.engine || 'bing',
        probe: { ...(store.web.probe || {}), state: 'idle', url: def, ok: false, status: 0, ms: 0, title: '', frameable: true, reason: '', error: '', at: 0 },
      },
    })
    return
  }
  if (k === 'files') {
    emit({ fs: { ...store.fs, query: '', sel: '', menu: null } })
    return
  }
  if (k === 'media') { emit({ media: { pid: '', path: '' } }); return }
  if (k === 'custom') {
    emit({ custom: { ...store.custom, active: '', item: null, draft: null, view: 'prompt', busy: '', error: '', file: '', prompt: '', requirement: '' } })
    return
  }
  if (k === 'scm') {
    emit({ scm: { ...store.scm, sel: '', msg: '' } })
  }
}

export function closeTab(pid, key) {
  const ui = uiOf(pid)
  const idx = ui.tabs.findIndex((t) => t.key === key)
  if (idx < 0) return
  const closing = ui.tabs.find((t) => t.key === key) || null
  const tabs = ui.tabs.filter((t) => t.key !== key)
  const activeTab = ui.activeTab === key ? (tabs[Math.max(0, idx - 1)]?.key || '') : ui.activeTab
  const secondTab = ui.secondTab === key ? (tabs.find((t) => t.key !== activeTab)?.key || '') : ui.secondTab
  /* 三/四格布局：被关掉的那一格换一个没人用的标签页，别留半块空白 */
  const cells = (ui.cells || []).slice()
  for (let i = 2; i < 4; i++) {
    if (cells[i] === key) cells[i] = ''
    if (!cells[i]) {
      const used = new Set([activeTab, secondTab].concat(cells.filter(Boolean)))
      const alt = tabs.find((t) => !used.has(t.key))
      cells[i] = alt ? alt.key : ''
    }
  }
  patchUi(pid, { tabs, activeTab, secondTab, cells })
  /* 关掉哪个窗格就把它的状态复位（不留上次的屏 / 筛选 / 路径） */
  if (closing) resetPaneState(pid, closing.kind)
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

/* ============================ 打开文件（0.10.6 起没有内置编辑器） ============================ */

/** 媒体文件的原始字节地址（<img src> / <iframe src> 只能 GET，走不了 apiPost） */
export function rawUrl(p) {
  return API + '/fs/raw?path=' + encodeURIComponent(String(p || ''))
}

/** UTF-8 → base64url（btoa 只吃 latin1，先转成字节再编） */
export function b64url(text) {
  const bytes = new TextEncoder().encode(String(text ?? ''))
  let bin = ''
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i])
  const b64 = typeof btoa === 'function' ? btoa(bin) : ''
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * 本地网页的托管地址（iframe 的 src）。
 * 目录编成 /asset/<base64url(dir)>，文件名跟在后面 —— 这样页面里
 * <link href="style.css">、<img src="logo.png"> 这些相对路径会自然落到同一目录，
 * 不会被解析到 API 根上（srcDoc 做不到这一点，那正是「放不进 html 文件」的原因）。
 */
export function htmlUrl(p) {
  const target = String(p || '')
  const tie = Math.max(target.lastIndexOf('\\'), target.lastIndexOf('/'))
  let dir = tie > 0 ? target.slice(0, tie) : target
  const name = tie >= 0 ? target.slice(tie + 1) : target
  /* 盘符根（C:）要补一个分隔符，否则 Node 的 resolve 会当成「当前盘的工作目录」 */
  if (/^[a-zA-Z]:$/.test(dir)) dir += '\\'
  return API + '/asset/' + b64url(dir) + '/' + encodeURIComponent(name)
}

const HTML_FILE_RE = /\.(html?|xhtml)$/i

/** 是不是一个网页文件 */
export function isHtmlFile(p) {
  return HTML_FILE_RE.test(String(p || ''))
}

/** 把本地 html 放进「自定义窗口」预览（草稿状态，点「保存」才留下） */
export function openHtmlWindow(path, pid) {
  const target = String(path || '').trim()
  if (!target) return ''
  const name = baseName(target).replace(HTML_FILE_RE, '') || '本地网页'
  newCustomDraft('file', 'preview')
  editCustom({ name, body: target })
  if (pid) openTab(pid, 'custom')
  toast('已放进自定义窗口；要留着就点「保存」', 'ok')
  return target
}

/**
 * 打开一个文件（没有内置编辑器之后的统一入口）：
 *   图片 / PDF / 音视频 → 媒体窗内嵌预览
 *   .html / .htm        → 自定义窗口（走 /fs/html，相对资源能一起加载）
 *   其它（文本 / 代码）  → 系统默认程序
 */
export function openFile(path, pid) {
  const target = String(path || '')
  if (!target) return
  if (isMediaKind(viewKindOf(baseName(target)))) { openMedia(pid, target); return }
  if (isHtmlFile(target)) { openHtmlWindow(target, pid); return }
  /* 文本 / 代码 / Markdown：开「编辑器」标签页（0.10.9 回归，和上游一致） */
  if (pid) openTab(pid, 'editor')
  openTextFile(pid, target)
  return true
}


/* ============================ 内联编辑器（文件管理器右侧/下方，不是独立窗格） ============================ */

const EMPTY_EDITOR = { pid: '', path: '', name: '', text: '', saved: '', size: 0, truncated: false, state: 'idle', view: 'edit', error: '' }

function editorPatch(patch) {
  emit({ editor: { ...(store.editor || EMPTY_EDITOR), ...patch } })
}

/** 打开一个文本文件到内联编辑器（.md / 代码 / 文本都走这里） */
export async function openTextFile(pid, path) {
  const target = String(path || '').trim()
  if (!target) return false
  const name = target.split(/[\\/]/).pop() || target
  emit({ editor: { ...EMPTY_EDITOR, pid: String(pid || ''), path: target, name, state: 'loading' } })
  try {
    const data = await apiPost('/fs/read', { path: target, mode: 'auto' }, { timeout: 12000 })
    const text = String((data && data.text) || '')
    emit({
      editor: {
        ...EMPTY_EDITOR,
        pid: String(pid || ''),
        path: target,
        name: (data && data.name) || name,
        text,
        saved: text,
        size: Number((data && data.size) || 0),
        truncated: !!(data && (data.truncated || data.partial)),
        state: 'ok',
        view: 'edit',
        error: '',
      },
    })
    return true
  } catch (err) {
    editorPatch({ state: 'error', error: String((err && err.message) || err || '读取失败') })
    return false
  }
}

export function editText(text) {
  const ed = store.editor
  if (!ed || ed.state !== 'ok') return
  editorPatch({ text: String(text == null ? '' : text) })
}

export function editorDirty() {
  const ed = store.editor
  return !!ed && ed.state === 'ok' && ed.text !== ed.saved
}

export function setEditorView(view) {
  editorPatch({ view: view === 'preview' ? 'preview' : 'edit' })
}

export async function saveEditor() {
  const ed = store.editor
  if (!ed || ed.state !== 'ok' || !ed.path) return false
  if (!editorDirty()) { toast('没有改动', 'info'); return true }
  try {
    await apiPost('/fs/write', { path: ed.path, text: ed.text }, { timeout: 12000 })
    editorPatch({ saved: ed.text, size: String(ed.text).length, truncated: false })
    toast('已保存：' + (ed.name || ed.path), 'ok')
    return true
  } catch (err) {
    toast('保存失败：' + String((err && err.message) || err), 'warn')
    return false
  }
}

/** 关掉内联编辑器（有未保存改动时问一句） */
export function closeEditor(force) {
  if (!store.editor || store.editor.state === 'idle') return true
  if (!force && editorDirty() && typeof window !== 'undefined' && typeof window.confirm === 'function') {
    if (!window.confirm('这个文件还有未保存的改动，关掉就丢了。确定？')) return false
  }
  emit({ editor: { ...EMPTY_EDITOR } })
  return true
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

/**
 * 把一条命令「打进」当前终端。
 * 有真 PTY 会话（wt-pty-<pid>）就直接写进去，命令出现在交互式 shell 里、输出看得见；
 * 没有就退回命令模式（一条命令一个进程）。返回 true = 走了 PTY。
 */
export async function termRun(pid, cmdRaw) {
  const cmd = String(cmdRaw || '').trim()
  if (!cmd) return false
  try {
    const res = await fetch(API + '/term/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'wt-pty-' + pid, data: cmd + '\r' }),
    })
    if (res.ok) {
      pushHistory(pid, cmd)
      termPatch(pid, { cwd: (projectOf(pid) || {}).path || '' })
      return true
    }
  } catch { /* 没 PTY / 宿主异常：下面兜底 */ }
  termExec(pid, cmd)
  return false
}

/** Ctrl+C：PTY 里发 \x03（只打断前台命令，不杀 shell）；命令模式杀进程树 */
export async function termCtrlC(pid) {
  try {
    const res = await fetch(API + '/term/input', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'wt-pty-' + pid, data: '\u0003' }),
    })
    if (res.ok) return true
  } catch { /* 没有 PTY */ }
  termKill(pid)
  return false
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

/* ============================ git / GitHub ============================ */

const EMPTY_SCM = {
  pid: '', state: 'idle', repo: false, error: '',
  branch: '', detached: false, unborn: false, head: '', ahead: 0, behind: 0, upstream: '', remote: '',
  changes: [], counts: null, log: [], branches: [], remoteBranches: [], tags: [], remotes: [],
  sel: '', selStaged: false, diff: { state: 'idle', file: '', text: '', error: '', binary: false, truncated: false },
  msg: '', busy: '', view: 'changes', note: '',
}

const EMPTY_GH = {
  state: 'idle', loggedIn: false, login: '', name: '', avatar: '', scopes: '', source: '', profile: '',
  error: '', repos: [], reposState: 'idle', reposError: '', q: '', page: 1, hasMore: false,
}

export function scmOf(pid) {
  if (store.scm && store.scm.pid === pid) return store.scm
  return { ...EMPTY_SCM, pid }
}

function scmPatch(pid, patch) {
  emit({ scm: { ...scmOf(pid), ...patch, pid } })
}

function emptyDiff() {
  return { state: 'idle', file: '', text: '', error: '', binary: false, truncated: false }
}

/** 一次拿全 status + 历史 + 分支 + 标签（host 的 status 已经把后三个带上了） */
export async function loadScm(pid, { quiet = false } = {}) {
  const project = projectOf(pid)
  if (!project?.path) {
    scmPatch(pid, { ...EMPTY_SCM, pid, state: 'ok', error: '这个项目还没设置目录' })
    return
  }
  if (!quiet) scmPatch(pid, { state: 'loading', error: '' })
  try {
    const st = await apiPost('/git', { path: project.path, op: 'status' }, { timeout: 25_000 })
    if (!st?.repo) {
      scmPatch(pid, {
        ...EMPTY_SCM, pid, state: 'ok', repo: false,
        error: String(st?.error || ''),
      })
      /* 项目信息窗也要跟着显示「不是仓库」 */
      emit({ git: { state: 'ok', repo: false, branch: '', changes: [], counts: null, error: '', log: [], branches: [] } })
      return
    }
    const changes = Array.isArray(st.changes) ? st.changes : []
    const keepSel = store.scm?.pid === pid ? store.scm.sel : ''
    const selStillExists = keepSel && changes.some((c) => c.file === keepSel)
    scmPatch(pid, {
      state: 'ok',
      repo: true,
      error: '',
      branch: String(st.branch || ''),
      detached: !!st.detached,
      unborn: !!st.unborn,
      head: String(st.head || ''),
      ahead: Number(st.ahead) || 0,
      behind: Number(st.behind) || 0,
      upstream: String(st.upstream || ''),
      remote: String(st.remote || ''),
      changes,
      counts: st.counts || { staged: 0, unstaged: 0, untracked: 0, total: 0 },
      log: Array.isArray(st.log) ? st.log : [],
      branches: Array.isArray(st.branches) ? st.branches : [],
      remoteBranches: Array.isArray(st.remoteBranches) ? st.remoteBranches : [],
      tags: Array.isArray(st.tags) ? st.tags : [],
      remotes: Array.isArray(st.remotes) ? st.remotes : [],
      sel: selStillExists ? keepSel : '',
      diff: selStillExists ? (store.scm?.diff || emptyDiff()) : emptyDiff(),
    })
    emit({
      git: {
        state: 'ok',
        repo: true,
        branch: String(st.branch || ''),
        changes,
        counts: st.counts || { staged: 0, unstaged: 0, untracked: 0, total: 0 },
        error: '',
        log: (Array.isArray(st.log) ? st.log : []).slice(0, 15),
        branches: (Array.isArray(st.branches) ? st.branches : []).map((b) => b.name),
      },
    })
  } catch (err) {
    const text = String(err?.message ?? err)
    scmPatch(pid, { state: 'error', error: text })
    emit({ git: { state: 'error', repo: false, branch: '', changes: [], counts: null, error: text, log: [], branches: [] } })
  }
}

/** 兼容旧入口：项目信息窗里的「刷新 Git」 */
export async function loadGit(pid) {
  return loadScm(pid)
}

/** 跑一个写操作：统一置忙、失败 toast、成功后重读状态 */
async function scmAct(pid, op, body = {}, { label = '', reload = true, timeout = 60_000 } = {}) {
  const project = projectOf(pid)
  if (!project?.path) return null
  scmPatch(pid, { busy: op, note: '' })
  try {
    const payload = { path: project.path, op, ...body }
    /* 网络操作带上用户的「跳过证书校验」选择（默认 false） */
    if (op === 'push' || op === 'pull' || op === 'fetch') payload.insecure = store.scm.insecure === true
    const out = await apiPost('/git', payload, { timeout })
    if (out?.ok === false && out?.error) throw new Error(out.error)
    if (reload) {
      await loadScm(pid, { quiet: true })
      scmPatch(pid, { busy: '' })
    } else scmPatch(pid, { busy: '' })
    if (label) toast(label, 'ok')
    return out
  } catch (err) {
    const text = String(err?.message ?? err)
    toast((op === 'push' || op === 'pull' || op === 'fetch' ? '网络操作失败：' : '') + text, 'bad')
    scmPatch(pid, { busy: '' })
    if (reload) loadScm(pid, { quiet: true })
    return null
  }
}

export function scmStage(pid, files) {
  return scmAct(pid, 'stage', { files: files || [] })
}

export function scmUnstage(pid, files) {
  return scmAct(pid, 'unstage', { files: files || [] })
}

export async function scmDiscard(pid, files) {
  const list = Array.isArray(files) ? files : [files]
  if (!list.length) return null
  return scmAct(pid, 'discard', { files: list }, { label: '已丢弃 ' + list.length + ' 个文件的改动' })
}

export function scmSetMessage(pid, text) {
  scmPatch(pid, { msg: String(text ?? '') })
}

/** 提交；push=true 时紧接着推一次，适合「改完就想同步」的场景 */
export async function scmCommit(pid, { all = false, amend = false, push = false, message = '' } = {}) {
  const scm = scmOf(pid)
  const text = String(message || scm.msg || '').trim()
  if (!text && !amend) { toast('先写提交说明', 'warn'); return null }
  const out = await scmAct(pid, 'commit', { message: text, all, amend })
  if (!out) return null
  scmPatch(pid, { msg: '' })
  toast('已提交', 'ok')
  if (push) await scmPush(pid)
  return out
}

export function scmFetch(pid) {
  return scmAct(pid, 'fetch', {}, { timeout: 130_000 })
}

export function scmPull(pid) {
  return scmAct(pid, 'pull', { remote: 'origin' }, { label: '已拉取', timeout: 130_000 })
}

export function scmPush(pid) {
  return scmAct(pid, 'push', { remote: 'origin' }, { label: '已推送', timeout: 130_000 })
}

export function scmCheckout(pid, target, { create = false } = {}) {
  return scmAct(pid, 'checkout', { target, create }, { label: '已切换：' + target })
}

export function scmBranchOp(pid, action, name, extra = {}) {
  return scmAct(pid, 'branch', { action, name, ...extra }, { label: action === 'delete' ? '分支已删除' : '分支操作完成' })
}

export function scmTagOp(pid, action, name, extra = {}) {
  return scmAct(pid, 'tag', { action, name, ...extra }, { label: action === 'delete' ? '标签已删除' : '标签已创建' })
}

export async function scmReset(pid, commit, mode = 'soft') {
  return scmAct(pid, 'reset', { commit, mode }, { label: '已回退到 ' + commit })
}

export function scmInit(pid) {
  return scmAct(pid, 'init', {}, { label: '已初始化仓库' })
}

/** 取消初始化：删掉 .git，工作区文件保留。必须二次确认后调用 */
export function scmUninit(pid) {
  return scmAct(pid, 'uninit', { confirm: true }, { label: '已取消初始化，文件都还在' })
}

export async function scmDiff(pid, file, { staged = false } = {}) {
  const project = projectOf(pid)
  if (!project?.path || !file) return
  scmPatch(pid, { sel: file, selStaged: staged, diff: { ...emptyDiff(), state: 'loading', file } })
  try {
    const out = await apiPost('/git', { path: project.path, op: 'diff', file, staged }, { timeout: 25_000 })
    scmPatch(pid, {
      diff: {
        state: 'ok', file,
        text: String(out?.diff || ''),
        error: String(out?.error || ''),
        binary: !!out?.binary,
        truncated: !!out?.truncated,
      },
    })
  } catch (err) {
    scmPatch(pid, { diff: { ...emptyDiff(), state: 'error', file, error: String(err?.message ?? err) } })
  }
}

export async function scmShowCommit(pid, hash) {
  const project = projectOf(pid)
  if (!project?.path || !hash) return
  scmPatch(pid, { sel: 'commit:' + hash, diff: { ...emptyDiff(), state: 'loading', file: hash } })
  try {
    const out = await apiPost('/git', { path: project.path, op: 'diff', commit: hash }, { timeout: 25_000 })
    scmPatch(pid, {
      diff: {
        state: 'ok', file: hash, text: String(out?.diff || ''),
        error: String(out?.error || ''), binary: false, truncated: !!out?.truncated,
      },
    })
  } catch (err) {
    scmPatch(pid, { diff: { ...emptyDiff(), state: 'error', file: hash, error: String(err?.message ?? err) } })
  }
}

export function scmClearDiff(pid) {
  scmPatch(pid, { sel: '', diff: emptyDiff() })
}

export function scmSetView(pid, view) {
  scmPatch(pid, { view })
}

/** 「跳过证书校验」开关（写 localStorage，只在本机的推送/拉取/克隆生效） */
export function setScmInsecure(on) {
  const v = !!on
  writeLS(LS.gitInsecure, v)
  emit({ scm: { ...store.scm, insecure: v } })
  return v
}

/* ---------- GitHub 账号 ---------- */

function ghPatch(patch) {
  emit({ gh: { ...EMPTY_GH, ...store.gh, ...patch } })
}

export async function loadGh({ quiet = false } = {}) {
  if (!quiet) ghPatch({ state: 'loading', error: '' })
  try {
    const st = await apiGet('/gh/status', { timeout: 20_000 })
    ghPatch({
      state: 'ok',
      loggedIn: !!st?.loggedIn,
      login: String(st?.login || ''),
      name: String(st?.name || ''),
      avatar: String(st?.avatar || ''),
      scopes: String(st?.scopes || ''),
      source: String(st?.source || ''),
      profile: String(st?.profile || ''),
      error: String(st?.error || ''),
    })
    return st
  } catch (err) {
    ghPatch({ state: 'error', error: String(err?.message ?? err) })
    return null
  }
}

export async function ghLogin(token, { remember = true, writeCredential = false } = {}) {
  ghPatch({ state: 'loading', error: '' })
  try {
    const out = await apiPost('/gh/login', { token, remember, writeCredential }, { timeout: 25_000 })
    await loadGh({ quiet: true })
    toast('已登录 GitHub：' + (out?.login || ''), 'ok')
    return out
  } catch (err) {
    const text = String(err?.message ?? err)
    ghPatch({ state: 'ok', error: text })
    toast('登录失败：' + text, 'bad')
    return null
  }
}

export async function ghLogout() {
  try { await apiPost('/gh/logout', {}, { timeout: 15_000 }) } catch { /* 忽略 */ }
  ghPatch({ ...EMPTY_GH, state: 'ok' })
  toast('已退出 GitHub（本机 git 里的凭据未动）', 'ok')
}

export async function loadGhRepos({ q = '', page = 1 } = {}) {
  ghPatch({ reposState: 'loading', reposError: '', q })
  try {
    const out = await apiGet('/gh/repos?q=' + encodeURIComponent(q) + '&page=' + page, { timeout: 25_000 })
    ghPatch({ reposState: 'ok', repos: Array.isArray(out?.repos) ? out.repos : [], hasMore: !!out?.hasMore, page })
    return out
  } catch (err) {
    ghPatch({ reposState: 'error', reposError: String(err?.message ?? err), repos: [] })
    return null
  }
}

/**
 * 上传当前项目到 GitHub：建仓 + 首推。
 * @returns {Promise<{ok:boolean, remote?:string, repo?:any, error?:string}|null>}
 */
export async function ghUploadRepo(pid, { name = '', private: isPrivate = true, description = '', branch = '' } = {}) {
  const project = projectOf(pid)
  if (!project?.path) { toast('这个项目还没设置目录', 'warn'); return null }
  scmPatch(pid, { busy: 'upload' })
  try {
    const out = await apiPost('/gh/upload', {
      path: project.path, name: name || project.name, private: isPrivate, description, branch,
      insecure: store.scm.insecure === true,
    }, { timeout: 180_000 })
    await loadScm(pid, { quiet: true })
    scmPatch(pid, { busy: '' })
    toast('已上传到 GitHub：' + (out?.repo?.fullName || out?.remote || ''), 'ok')
    return out
  } catch (err) {
    scmPatch(pid, { busy: '' })
    toast('上传失败：' + String(err?.message ?? err), 'bad')
    return null
  }
}

/** 克隆：NDJSON 进度流，onLine 回调给界面刷日志 */
export async function cloneRepo({ url, dest, depth = 0, branch = '', insecure = null }, onLine) {
  const res = await fetch(API + '/git/clone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/x-ndjson' },
    body: JSON.stringify({
      url, dest, depth, branch,
      insecure: insecure === null ? store.scm.insecure === true : !!insecure,
    }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new Error((data && data.error) || ('HTTP ' + res.status))
  }
  const reader = res.body?.getReader?.()
  if (!reader) {
    const text = await res.text()
    return parseCloneTail(text)
  }
  const decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null
  let buffer = ''
  let end = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder ? decoder.decode(value, { stream: true }) : String(value)
    let at
    while ((at = buffer.indexOf('\n')) !== -1) {
      const row = buffer.slice(0, at)
      buffer = buffer.slice(at + 1)
      if (!row.trim()) continue
      let ev = null
      try { ev = JSON.parse(row) } catch { continue }
      if (ev.t === 'out' && ev.line) onLine && onLine(ev.line)
      if (ev.t === 'end') end = ev
    }
  }
  if (!end) throw new Error('克隆连接中断')
  if (!end.ok) throw new Error(end.error || '克隆失败')
  return end
}

function parseCloneTail(text) {
  let end = null
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue
    try {
      const ev = JSON.parse(line)
      if (ev.t === 'end') end = ev
    } catch { /* 非 JSON 行 */ }
  }
  if (!end) throw new Error('克隆失败')
  if (!end.ok) throw new Error(end.error || '克隆失败')
  return end
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


/** 浏览器「首页」：搜索面板盖住页面，但不清空当前地址（点「返回页面」就回去） */
export function webHome() {
  emit({ web: { ...store.web, home: true } })
}

/** 关掉首页面板，回到当前页面 */
export function webCloseHome() {
  emit({ web: { ...store.web, home: false } })
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
      home: false,
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

/* ============================ 浏览器搜索 ============================ */

/** 首页搜索框可选的搜索引擎（搜索页多半拒绝被嵌入，界面里给了「系统浏览器」兜底） */
export const SEARCH_ENGINES = [
  { id: 'bing', label: 'Bing', url: 'https://www.bing.com/search?q=' },
  { id: 'baidu', label: '百度', url: 'https://www.baidu.com/s?wd=' },
  { id: 'ddg', label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
]

export function searchUrl(query, engine) {
  const q = String(query || '').trim()
  if (!q) return ''
  const hit = SEARCH_ENGINES.find((e) => e.id === engine) || SEARCH_ENGINES[0]
  return hit.url + encodeURIComponent(q)
}

/** 改搜索引擎（记住到 localStorage） */
export function webSetEngine(id) {
  const hit = SEARCH_ENGINES.find((e) => e.id === id)
  if (!hit) return
  emit({ web: { ...store.web, engine: hit.id } })
  try { writeLS(LS.search, hit.id) } catch { /* 隐私模式 */ }
}

/** 用当前引擎搜一条：成功返回 true */
export function webSearch(query, engine) {
  const url = searchUrl(query, engine || store.web.engine)
  if (!url) { toast('先输入要搜索的内容', 'warn'); return false }
  return webGoto(url)
}

/**
 * 地址栏 / 首页搜索框统一入口：
 * 像地址就按地址开（端口 / localhost / 域名 / http(s)），
 * 不像地址（带空格、中文、没有点）就交给搜索引擎。
 */
export function webGotoSmart(raw) {
  const text = String(raw || '').trim()
  if (!text) return false
  const asUrl = normalizeWebUrl(text)
  if (asUrl) return webGoto(asUrl)
  return webSearch(text)
}

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
      home: false,
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
    /* 正在编辑一份还没保存的新草稿时别抢：例如「双击 html 直接开窗」刚建好草稿，
       这时候列表回来再 openCustom 会把草稿冲掉 */
    const pending = store.custom.draft
    const keepDraft = !!pending && !pending.id && (String(pending.body || '').trim() !== '' || String(pending.name || '').trim() !== '')
    if (active && !keepDraft && (!store.custom.item || store.custom.item.id !== active)) await openCustom(active, { quiet: opts.quiet })
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

/**
 * 新建一份草稿（还没落盘，保存时才由宿主发号）。
 * kind：html＝手写 / 贴一段 HTML；url＝嵌一个网址；file＝指向本地一个 .html 文件。
 */
export function newCustomDraft(kind = 'html', view = '') {
  const k = kind === 'url' ? 'url' : (kind === 'file' ? 'file' : 'html')
  emit({
    custom: {
      ...store.custom,
      active: '',
      item: null,
      view: view || (k === 'url' || k === 'file' ? 'edit' : 'prompt'),
      busy: '',
      error: '',
      prompt: '',
      draft: {
        id: '',
        name: '',
        kind: k,
        body: k === 'html' ? CUSTOM_PRESET : '',
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
  /* 本地网页：必须是绝对路径的 .html / .htm —— 相对路径在宿主那边没法解析 */
  if (draft.kind === 'file') {
    const p = body.trim()
    if (!/^([a-zA-Z]:[\\/]|[\\/]{2}|[\\/])/.test(p)) {
      toast('先选一个本地网页文件（绝对路径）', 'warn')
      return null
    }
    if (!isHtmlFile(p)) {
      toast('只支持 .html / .htm / .xhtml 文件', 'warn')
      return null
    }
  }
  /* 没起名字就用文件名顶上，省得落成「未命名窗口」 */
  const name = String(draft.name || '').trim() || (draft.kind === 'file' ? baseName(body).replace(HTML_FILE_RE, '') : '')
  emit({ custom: { ...store.custom, busy: 'saving', error: '' } })
  try {
    const data = await apiPost('/custom/save', {
      id: draft.id || undefined,
      name: name || undefined,
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
