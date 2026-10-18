/**
 * 主区：顶栏 + 控制室 + 卡片网格 + 项目工作区（可拖拽分栏）。
 * 分栏由布局预设的 parts 决定，宽度存 ui.split，拖一次立刻生效、松手才落 localStorage。
 */
import { el, Icon, Light, Splitter, ContextMenu, Toasts } from './ui.js'
import { ModalHost } from './modals.js'
import {
  store, useStore, STATES, normState, LAYOUTS, layoutDef, PANE_TABS, fmtDuration, relTime,
  shortPath, projEmoji, openGrid, enterProject, closeOverlay, openModal, openMenu,
  removeProject, setLayout, setSplit, setLeftTab, openTab, closeTab, setActiveTab,
  loadSessions, loadTranscript, loadTree, loadGit, stateOf, sessionsOf, primarySession,
  uiOf, projectOf, setWebUrl, siteUrlOf, updateProject, flushUi,
} from './core.js'
import { InfoPane, FilesPane, EditorPane, TermPane, WebPane, CustomPane, ChatPane } from './panes.js'

const EMPTY_TRANSCRIPT = { sid: '', state: 'idle', messages: [], title: '', error: '', truncated: false }

export function MainView() {
  useStore()
  const open = store.open

  if (!open) return null
  const active = store.projects.find((p) => p.id === store.activeId) || null

  return el('div', { className: 'wt-scope wt-overlay', 'data-ns': 'worktable', role: 'dialog', 'aria-label': '工作台' },
    el('div', { className: 'wt-bg', 'aria-hidden': 'true' },
      el('i', { className: 'wt-blob wt-b1' }),
      el('i', { className: 'wt-blob wt-b2' }),
      el('i', { className: 'wt-blob wt-b3' }),
      el('i', { className: 'wt-blob wt-b4' }),
    ),
    el('div', { className: 'wt-shell' },
      el(Topbar, { active }),
      active ? el(ProjectView, { key: active.id, project: active }) : el(GridView),
    ),
    el(ContextMenu),
    el(ModalHost),
    el(Toasts),
  )
}

/* ============================ 顶栏 ============================ */

function Topbar({ active }) {
  const counts = store.sessions.counts || {}
  const sub = active
    ? ((active.path || '未设置目录') + ' · ' + layoutDef(uiOf(active.id).layout).label + ' · ' + (active.sessions || []).length + ' 个对话')
    : ('项目 ' + store.projects.length + ' 个 · 宿主会话 ' + (counts.total || 0) + ' 个 · 快照 ' + (store.sessions.at ? relTime(store.sessions.at) : '—'))

  return el('header', { className: 'topbar' },
    el('div', null,
      el('div', { className: 'tb-title' },
        el('h1', null, active ? (active.alias || active.name) : '控制室'),
        el('span', { className: 'eyebrow' }, active ? 'Workspace' : 'Control'),
      ),
      el('p', { className: 'tb-sub', title: sub }, sub),
    ),
    el('div', { className: 'tb-actions' },
      active ? el('button', { type: 'button', className: 'btn', onClick: openGrid }, '← 全部项目') : null,
      el('button', { type: 'button', className: 'btn', onClick: () => { loadSessions(); } }, '刷新'),
      el('button', { type: 'button', className: 'btn primary', onClick: () => openModal('add') }, '＋ 新建项目'),
      el('button', { type: 'button', className: 'btn ico', title: '关闭 (Esc)', onClick: closeOverlay }, '✕'),
    ),
  )
}

/* ============================ 控制室 + 卡片网格 ============================ */

function GridView() {
  useStore()
  const projects = store.projects.filter((p) => !p.hidden)
  const counts = store.sessions.counts || { running: 0, waiting: 0, done: 0, idle: 0, total: 0 }
  const running = store.sessions.rows.filter((s) => normState(s.state) === 'working')

  return el('section', { className: 'view active' },

    /* 控制室：宿主真实状态，不调模型 */
    el('div', { className: 'control' },
      el('div', { className: 'control-head' },
        el('span', { className: 'cc-badge' }, '控制室'),
        el('span', { className: 'mono' }, store.sessions.state === 'ok'
          ? '快照 ' + relTime(store.sessions.at) + ' · 来源 ' + (store.sessions.source || 'live')
          : (store.sessions.state === 'pending' ? '读取中…' : ('不可用：' + (store.sessions.error || '未知')))),
      ),
      el('div', { className: 'cc-grid' },
        statCell('进行中', counts.running || 0, 'working'),
        statCell('待处理', counts.waiting || 0, 'needs'),
        statCell('已完成', counts.done || 0, 'done'),
        statCell('项目', projects.length, 'gold'),
      ),
      running.length
        ? el('div', { className: 'cc-running' },
          running.slice(0, 6).map((s) => el('div', { key: s.id, className: 'cc-run' },
            el('span', { className: 'light working', 'aria-hidden': 'true' }),
            el('span', { className: 'cc-run-title' }, s.title || s.id),
            el('span', { className: 'cc-run-time mono' }, fmtDuration(Date.now() - (Number(s.updatedAt) || Date.now()))),
          )),
        )
        : null,
    ),

    el('div', { className: 'grid' },
      projects.map((p) => el(ProjectCard, { key: p.id, project: p })),
      el(AddCard),
      projects.length ? null : el('div', { className: 'empty' }, '还没有项目，点「新建项目」开始'),
    ),
    el('p', { className: 'grid-note' }, '右击项目或卡片：布局 · 编辑 · 绑定 · 删除 · 隐藏'),
  )
}

function statCell(label, value, tone) {
  return el('div', { className: 'cc-cell' },
    el('div', { className: 'k' }, label),
    el('div', { className: 'v ' + (tone || '') }, String(value)),
  )
}

function ProjectCard({ project }) {
  const st = stateOf(project.id)
  const bound = sessionsOf(project)
  const cls = 'card project-card' +
    (st === 'working' ? ' busy' : '') +
    (st === 'done' ? ' glow-done' : '') +
    (st === 'needs-you' ? ' glow-needs' : '')

  return el('article', {
    className: cls,
    tabIndex: 0,
    title: (project.path || '未设置目录') + ' · 点击进入',
    onClick: () => enterProject(project.id),
    onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(project.id, e.clientX, e.clientY) },
  },
    st === 'working' ? el('span', { className: 'wt-sweep', 'aria-hidden': 'true' }) : null,
    el('div', { className: 'c-head' },
      el('span', { className: 'c-ico', 'aria-hidden': 'true' }, projEmoji(project)),
      el('span', { className: 'c-name' }, project.alias || project.name),
      el(Light, { pid: project.id }),
    ),
    el('div', { className: 'c-div' }),
    el('div', { className: 'c-srow' },
      el('span', { className: 'c-status ' + st }, STATES[st].label),
      bound.length ? el('span', { className: 'c-meta', title: bound[0].title }, String(bound[0].title || '').slice(0, 18)) : null,
    ),
    el('div', { className: 'c-preview' }, project.note || shortPath(project.path || '未设置目录', 46)),
    el('div', { className: 'c-actions' },
      el('span', { className: 'c-layout' }, layoutDef(uiOf(project.id).layout).label),
      el('button', {
        type: 'button', className: 'mini-btn' + (bound.length ? ' on' : ''),
        title: '管理对话绑定',
        onClick: (e) => { e.stopPropagation(); openModal('bind', project.id) },
      }, bound.length ? (bound.length + ' 个对话') : '绑定对话'),
    ),
  )
}

function AddCard() {
  return el('article', {
    className: 'card add-card', role: 'button', tabIndex: 0, title: '新建项目',
    onClick: () => openModal('add'),
  },
    el('span', { className: 'add-plus', 'aria-hidden': 'true' }, '＋'),
    el('span', { className: 'add-label' }, '新建项目'),
  )
}

/* ============================ 项目工作区 ============================ */

function ProjectView({ project }) {
  useStore()
  const ui = uiOf(project.id)
  const def = layoutDef(ui.layout)
  const parts = def.parts
  const hasLeft = parts.includes('left')
  const hasChat = parts.includes('chat')

  const leftW = ui.split.left || def.split.left || 250
  const chatW = ui.split.chat || def.split.chat || 380

  const onLeft = (next, persist) => {
    if (next === 0) { setSplit(project.id, 'left', def.split.left || 250, true); return }
    if (next == null) { flushUi(); return }
    setSplit(project.id, 'left', next, persist)
  }
  const onChat = (next, persist) => {
    if (next === 0) { setSplit(project.id, 'chat', def.split.chat || 380, true); return }
    if (next == null) { flushUi(); return }
    setSplit(project.id, 'chat', next, persist)
  }

  const children = []
  if (hasLeft) {
    children.push(el(LeftPane, { key: 'left', project, width: leftW, tab: ui.leftTab }))
    children.push(el(Splitter, { key: 's1', pid: project.id, side: 'left', width: leftW, min: 180, max: 460, onResize: onLeft }))
  }
  children.push(el(MainPane, { key: 'main', project, ui }))
  if (hasChat) {
    children.push(el(Splitter, { key: 's2', pid: project.id, side: 'right', width: chatW, min: 260, max: 900, onResize: onChat }))
    children.push(el(ChatColumn, { key: 'chat', project, width: chatW }))
  }

  return el('section', { className: 'view active view-workspace' },
    el('div', { className: 'detail-bar' },
      el('div', { className: 'detail-crumb' },
        el('span', { className: 'c-ico', 'aria-hidden': 'true', style: { fontSize: '17px' } }, projEmoji(project)),
        el('b', null, project.alias || project.name),
        el('span', { className: 'p mono', title: project.path }, shortPath(project.path || '未设置目录', 44)),
        el('span', { className: 'tag gold' }, STATES[stateOf(project.id)].label),
      ),
      el('div', { className: 'seg', title: '界面布局（也可右击项目切换）' },
        LAYOUTS.map((l) => el('button', {
          key: l.id, type: 'button', className: l.id === ui.layout ? 'on' : '', title: l.hint,
          onClick: () => setLayout(project.id, l.id),
        }, l.label)),
      ),
    ),
    el('div', { className: 'ws', 'data-layout': ui.layout }, children),
  )
}

function LeftPane({ project, width, tab }) {
  const ui = useStore()
  return el('aside', { className: 'pane pane-left', style: { flex: '0 0 ' + width + 'px' } },
    el('div', { className: 'pane-head' },
      el('div', { className: 'subtabs' },
        el('button', { type: 'button', className: tab === 'info' ? 'on' : '', onClick: () => setLeftTab(project.id, 'info') }, '项目'),
        el('button', { type: 'button', className: tab === 'files' ? 'on' : '', onClick: () => setLeftTab(project.id, 'files') }, '文件'),
      ),
      el(Light, { pid: project.id }),
    ),
    tab === 'files' ? el(FilesPane, { project }) : el(InfoPane, { project }),
  )
}

function MainPane({ project, ui }) {
  const tabs = ui.tabs
  const activeKey = ui.activeTab || (tabs[0] ? tabs[0].key : '')
  const active = tabs.find((t) => t.key === activeKey) || null

  const titleOf = (t) => (t.kind === 'editor' ? (store.editor.name || '编辑器') : t.title)

  return el('main', { className: 'pane pane-main' },
    el('div', { className: 'pane-head tabhead' },
      el('div', { className: 'tabs' },
        tabs.length
          ? tabs.map((t) => el('div', {
            key: t.key,
            className: 'tab' + (t.key === activeKey ? ' on' : ''),
            role: 'button',
            onClick: () => setActiveTab(project.id, t.key),
          },
            el('span', { className: 'tab-title' }, titleOf(t)),
            el('button', {
              type: 'button', className: 'tab-x', title: '关闭',
              onClick: (e) => { e.stopPropagation(); closeTab(project.id, t.key) },
            }, '✕'),
          ))
          : el('span', { className: 'tab-empty' }, '工作区'),
      ),
      el('div', { className: 'tab-add' },
        PANE_TABS.map((t) => el('button', {
          key: t.id, type: 'button', className: 'mini-btn', title: '打开' + t.label,
          onClick: () => openTab(project.id, t.id),
        }, t.icon + ' ' + t.label)),
      ),
    ),

    active
      ? renderPane(active.kind, project)
      : el('div', { className: 'pane-body' },
        el('div', { className: 'pane-empty' },
          el('span', { className: 'pe-ico' }, '◫'),
          el('p', null, '工作区还没有打开任何窗口'),
          el('p', { className: 'hint' }, '用右上角的按钮打开编辑器 / 终端 / 浏览器 / 自定义窗口；在左侧「文件」里点文件会自动开编辑器。'),
          el('div', { className: 'pe-actions' },
            PANE_TABS.map((t) => el('button', {
              key: t.id, type: 'button', className: 'btn small',
              onClick: () => openTab(project.id, t.id),
            }, t.icon + ' ' + t.label)),
          ),
        ),
      ),
  )
}

function renderPane(kind, project) {
  if (kind === 'term') return el(TermPane, { project })
  if (kind === 'web') return el(WebPane, { project })
  if (kind === 'custom') return el(CustomPane, { project })
  return el(EditorPane, { project })
}

function ChatColumn({ project, width }) {
  const t = store.transcript
  const primary = primarySession(project)
  return el('aside', { className: 'pane pane-chat', style: { flex: '0 0 ' + width + 'px' } },
    el('div', { className: 'pane-head' },
      el('span', { className: 'kind-chip' }, el('i', null, '✦'), '对话'),
      el('span', { className: 'pane-title-text', title: primary ? (primary.title || primary.id) : '' },
        primary ? (primary.title || String(primary.id).slice(0, 16)) : '未绑定'),
      t.state === 'loading' ? el('span', { className: 'pane-hint' }, '读取中') : null,
    ),
    el(ChatPane, { project }),
  )
}
