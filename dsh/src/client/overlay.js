/**
 * 主区：总览 / 项目工作区。
 *
 * 两种视图 **都只在对话左侧那块**：宿主会话区被右推，右侧始终是 DSH 自己的对话（真能打字）。
 *   grid    总览（项目 / 宿主会话 / 运行中 三个页签）
 *   project 项目工作区（文件 / 编辑器 / 终端 / 浏览器 / 自定义 / 项目信息 标签页）
 * 两者共用同一套外壳：dock-head + ws + pane-main + 右边缘 dock-edge（拖动改宽度）。
 *
 * 让位几何全部来自 hostdock.js，组件只消费 geo，不直接碰宿主 DOM。
 */
import { useRef } from 'react'
import { el, Light, Splitter, ContextMenu, Toasts } from './ui.js'
import { ModalHost } from './modals.js'
import { useHostDock } from './hostdock.js'
import {
  store, useStore, STATES, normState, MODES, modeDef, PANE_TABS, INFO_TAB, GRID_TABS, GRID_PID,
  fmtDuration, relTime, shortPath, projEmoji, openGrid, enterProject, closeOverlay,
  openModal, openMenu, setMode, setDockPx, openTab, closeTab, setActiveTab,
  loadSessions, stateOf, sessionsOf, primarySession, projectBySession, createFromSession,
  jumpToSession, setGridTab, uiOf, flushUi, setWinRect, resetWinRect,
} from './core.js'
import { InfoPane, FilesPane, EditorPane, TermPane, WebPane, CustomPane } from './panes.js'

export function MainView() {
  useStore()
  const rootRef = useRef(null)

  const open = store.open
  const project = open && store.view === 'project'
    ? (store.projects.find((p) => p.id === store.activeId) || null)
    : null
  /* 总览也占让位区：右侧永远留着宿主对话，所以它同样有自己的 dock 宽度与窗口几何 */
  const pid = project ? project.id : GRID_PID
  const ui = uiOf(pid)

  /* 让位：打开工作台就挤对话（总览 / 项目一致）；退出/卸载自动还原 */
  const geo = useHostDock(rootRef, !!open, ui.dock)
  const dockedFit = !!open && geo.ready && geo.width > 0

  if (!open) return null

  /* 锚点没找到（宿主改版）时退回整块覆盖：功能不受影响，只是看不到右侧对话 */
  const style = dockedFit
    ? { left: geo.left + 'px', top: geo.top + 'px', width: geo.width + 'px', height: geo.height + 'px' }
    : null

  return el('div', {
    className: 'wt-scope wt-root',
    'data-ns': 'worktable',
    'data-dock': dockedFit ? '1' : '0',
    ref: rootRef,
  },
    el('div', {
      className: 'wt-dock' + (dockedFit ? ' is-docked' : ' is-full'),
      style,
      role: 'region',
      'aria-label': '工作台',
    },
      el('div', { className: 'wt-bg', 'aria-hidden': 'true' },
        el('i', { className: 'wt-blob wt-b1' }),
        el('i', { className: 'wt-blob wt-b2' }),
        el('i', { className: 'wt-blob wt-b3' }),
        el('i', { className: 'wt-blob wt-b4' }),
      ),
      project
        ? el(Workspace, { key: project.id, project, ui, geo })
        : el(Overview, { key: GRID_PID, ui, geo }),
    ),
    /* 菜单 / 小窗 / toast 挂在让位区之外：fixed 定位不受 dock 裁剪 */
    el(ContextMenu),
    el(ModalHost),
    el(Toasts),
  )
}

/* ============================ 总览：顶栏 + 标签页 ============================ */

/**
 * 总览：和项目工作区一模一样的外壳 —— 占对话左侧那块，右侧留宿主对话，
 * 右边缘一条 dock-edge 拖动改宽度，顶栏还能切「全屏 / 窗口」。
 * 内容只有一块面板，三个页签（项目 / 宿主会话 / 运行中），计数挂在页签徽标上。
 */
function Overview({ ui, geo }) {
  useStore()
  const projects = store.projects.filter((p) => !p.hidden)
  const rows = store.sessions.rows || []
  const running = rows.filter((s) => normState(s.state) === 'working')
  const waiting = rows.filter((s) => normState(s.state) === 'needs-you')
  const tab = store.gridTab

  const snap = store.sessions.state === 'ok'
    ? '快照 ' + relTime(store.sessions.at) + ' · 来源 ' + (store.sessions.source || 'live')
    : (store.sessions.state === 'pending' ? '读取中…' : ('不可用：' + (store.sessions.error || '未知')))

  const badgeOf = (id) => (
    id === 'projects' ? projects.length
      : id === 'sessions' ? rows.length
        : running.length
  )

  /* 右边缘：和项目工作区一样，拖的同时右侧对话跟着变宽变窄 */
  const onDock = (next, persist) => {
    if (next == null) { flushUi(); return }
    if (next === 0) { setDockPx(GRID_PID, 0, true); return }
    setDockPx(GRID_PID, next, persist)
  }

  const board = (nest) => el(OverviewPane, { tab, projects, rows, running, waiting, badgeOf, nest })

  return el('div', { className: 'dock-wrap' },
    el('header', { className: 'dock-head' },
      el('div', { className: 'dh-main' },
        el('span', { className: 'dh-ico', 'aria-hidden': 'true' }, '🧰'),
        el('b', { className: 'dh-name', title: '工作台总览（右侧仍是 DSH 对话）' }, '工作台总览'),
        el('span', { className: 'dh-dot', 'aria-hidden': 'true' }, '·'),
        el('span', { className: 'dh-sub mono', title: snap }, snap),
        running.length
          ? el('span', { className: 'dh-chat', title: running.slice(0, 4).map((s) => s.title || s.id).join(' · ') },
            el('span', { className: 'light working', 'aria-hidden': 'true' }),
            running.length + ' 个在跑',
          )
          : el('span', { className: 'dh-chat off' }, '空闲'),
      ),
      el('div', { className: 'dh-tools' },
        el('div', { className: 'seg tiny', title: '总览模式：全屏 / 窗口' },
          MODES.map((m) => el('button', {
            key: m.id, type: 'button', className: m.id === ui.mode ? 'on' : '', title: m.hint,
            onClick: () => setMode(GRID_PID, m.id),
          }, m.icon + ' ' + m.label)),
        ),
        el('button', { type: 'button', className: 'mini-btn', title: '重新读取宿主会话', onClick: () => { loadSessions() } }, '↻'),
        el('button', { type: 'button', className: 'mini-btn', title: '新建项目', onClick: () => openModal('add') }, '＋ 新建'),
        el('button', { type: 'button', className: 'mini-btn', title: '关闭工作台 (Esc)', onClick: closeOverlay }, '✕'),
      ),
    ),

    el('div', { className: 'ws', 'data-mode': ui.mode },
      ui.mode === 'float'
        ? el(FloatWindow, {
          key: 'main', pid: GRID_PID, ui, title: '工作台总览',
          subtitle: projects.length + ' 个项目 · ' + rows.length + ' 个会话',
          children: board(true),
        })
        : board(false),
      /* 右边缘 = 工作台 / 对话的分界，拖动即改让位宽度 */
      el(Splitter, {
        key: 'edge', pid: GRID_PID, side: 'left', className: 'dock-edge',
        width: geo.width || 0, min: 380, max: Math.max(420, geo.max || 1400), onResize: onDock,
      }),
    ),
  )
}

/** 总览面板本体：一条页签栏 + 页签内容，和 MainPane 同款 */
function OverviewPane({ tab, projects, rows, running, waiting, badgeOf, nest }) {
  return el('div', { className: 'pane pane-main' + (nest ? ' pane-nest' : '') },
    el('div', { className: 'pane-head tabhead' },
      el('div', { className: 'tabs' },
        GRID_TABS.map((t) => el('div', {
          key: t.id,
          className: 'tab' + (t.id === tab ? ' on' : ''),
          role: 'button',
          'data-tab': t.id,
          onClick: () => setGridTab(t.id),
        },
          el('span', { className: 'tab-title' }, t.icon + ' ' + t.label),
          el('span', { className: 'tab-count' }, String(badgeOf(t.id))),
        )),
      ),
    ),
    tab === 'sessions'
      ? el(SessionsTab, { rows })
      : tab === 'running'
        ? el(RunningTab, { running, waiting })
        : el(ProjectsTab, { projects }),
  )
}

function ProjectsTab({ projects }) {
  return el('div', { className: 'pane-body overview-body' },
    el('div', { className: 'grid' },
      projects.map((p) => el(ProjectCard, { key: p.id, project: p })),
      el(AddCard),
      projects.length ? null : el('div', { className: 'empty' }, '还没有项目，点「＋ 新建」开始'),
    ),
    el('p', { className: 'grid-note' }, '右击项目或卡片：模式 · 编辑 · 绑定 · 删除 · 隐藏'),
  )
}

/** 宿主会话：直接列出宿主那边所有会话，可打开对话，也可一键建成项目 */
function SessionsTab({ rows }) {
  if (!rows.length) {
    return el('div', { className: 'pane-body' },
      el('div', { className: 'pane-empty' },
        el('span', { className: 'pe-ico' }, '◉'),
        el('p', null, '没有读到宿主会话'),
        el('p', { className: 'hint' }, store.sessions.state === 'error'
          ? '读取失败：' + (store.sessions.error || '未知')
          : '点顶栏「刷新」重新读取；宿主会话服务不可用时这里会一直是空的。'),
      ),
    )
  }
  return el('div', { className: 'pane-body overview-body' },
    el('div', { className: 'ov-list' }, rows.map((s) => el(SessionRow, { key: s.id, session: s }))),
    el('p', { className: 'grid-note' }, '「建为项目」会以会话标题和它自己的工作目录新建一个项目，并立刻进入'),
  )
}

/** 运行中：只列「进行中」，带实时计时；待处理只提一句，细节在「宿主会话」页签 */
function RunningTab({ running, waiting }) {
  if (!running.length) {
    return el('div', { className: 'pane-body' },
      el('div', { className: 'pane-empty' },
        el('span', { className: 'pe-ico' }, '◐'),
        el('p', null, waiting.length ? '没有在跑的会话，但有 ' + waiting.length + ' 个待处理' : '当前没有在跑的会话'),
        el('p', { className: 'hint' }, waiting.length
          ? '待处理的会话在「宿主会话」页签里，状态灯是橙色的那些。'
          : '会话一跑起来就会出现在这里，计时每秒刷新。'),
      ),
    )
  }
  return el('div', { className: 'pane-body overview-body' },
    el('div', { className: 'ov-list' }, running.map((s) => el(SessionRow, { key: s.id, session: s, timing: true }))),
    waiting.length
      ? el('p', { className: 'grid-note' }, '另有 ' + waiting.length + ' 个待处理会话，在「宿主会话」页签里')
      : null,
  )
}

function SessionRow({ session, timing }) {
  const st = normState(session.state)
  const project = projectBySession(session.id)
  return el('div', { className: 'ov-row', 'data-state': st },
    el('span', { className: 'light ' + st, 'aria-hidden': 'true' }),
    el('div', { className: 'ov-main' },
      el('b', { className: 'ov-title', title: session.id }, session.title || session.id),
      el('span', { className: 'ov-sub mono', title: session.cwd || '' }, shortPath(session.cwd || '未记录工作目录', 52)),
    ),
    timing
      ? el('span', { className: 'ov-time mono' }, fmtDuration(Date.now() - (Number(session.updatedAt) || Date.now())))
      : null,
    el('span', { className: 'ov-state ' + st }, STATES[st].label),
    project ? el('span', { className: 'tag gold', title: '已绑定项目：' + (project.alias || project.name) }, (project.alias || project.name).slice(0, 10)) : null,
    el('div', { className: 'ov-act' },
      el('button', {
        type: 'button', className: 'mini-btn', title: '在宿主里打开这个对话',
        onClick: () => { jumpToSession(session.id); closeOverlay() },
      }, '打开对话'),
      project
        ? el('button', { type: 'button', className: 'mini-btn', title: '进入项目工作区', onClick: () => enterProject(project.id) }, '进入项目')
        : el('button', { type: 'button', className: 'mini-btn', title: '以这个会话新建项目', onClick: () => createFromSession(session) }, '建为项目'),
    ),
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
    title: (project.path || '未设置目录') + ' · 点击进入（右侧就是它的 DSH 对话）',
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
      el('span', { className: 'c-layout' }, modeDef(uiOf(project.id).mode).label),
      el('button', {
        type: 'button', className: 'mini-btn' + (bound.length ? ' on' : ''),
        title: '绑定 / 解绑对话',
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

/* ============================ 项目工作区（让位区） ============================ */

function Workspace({ project, ui, geo }) {
  const primary = primarySession(project)

  /* 工作台右边缘：直接改让位宽度，拖的同时右侧对话跟着变宽变窄 */
  const onDock = (next, persist) => {
    if (next == null) { flushUi(); return }
    if (next === 0) { setDockPx(project.id, 0, true); return }
    setDockPx(project.id, next, persist)
  }

  return el('div', { className: 'dock-wrap' },
    el('header', { className: 'dock-head' },
      el('div', { className: 'dh-main' },
        el('span', { className: 'dh-ico', 'aria-hidden': 'true' }, projEmoji(project)),
        el('b', { className: 'dh-name', title: project.path }, project.alias || project.name),
        el(Light, { pid: project.id }),
        el('span', { className: 'dh-dot', 'aria-hidden': 'true' }, '·'),
        el('span', { className: 'dh-sub mono', title: project.path }, shortPath(project.path || '未设置目录', 30)),
        primary ? el('span', { className: 'dh-chat', title: '右侧对话：' + (primary.title || primary.id) },
          el('span', { className: 'light ' + normState(primary.state), 'aria-hidden': 'true' }),
          String(primary.title || primary.id).slice(0, 14),
        ) : el('span', { className: 'dh-chat off' }, '未绑定对话'),
      ),
      el('div', { className: 'dh-tools' },
        el('div', { className: 'seg tiny', title: '工作区模式（右击项目也能切）' },
          MODES.map((m) => el('button', {
            key: m.id, type: 'button', className: m.id === ui.mode ? 'on' : '', title: m.hint,
            onClick: () => setMode(project.id, m.id),
          }, m.icon + ' ' + m.label)),
        ),
        el('button', {
          type: 'button',
          className: 'mini-btn' + (ui.activeTab === INFO_TAB.id ? ' on' : ''),
          title: '项目信息：状态 / 绑定对话 / git（以标签页打开）',
          onClick: () => openTab(project.id, INFO_TAB.id),
        }, INFO_TAB.icon + ' ' + INFO_TAB.label),
        el('button', { type: 'button', className: 'mini-btn', title: '回到控制室', onClick: openGrid }, '≡ 项目'),
        el('button', { type: 'button', className: 'mini-btn', title: '关闭工作台 (Esc)', onClick: closeOverlay }, '✕'),
      ),
    ),

    el('div', { className: 'ws', 'data-mode': ui.mode },
      ui.mode === 'float'
        ? el(FloatWindow, {
          key: 'main', pid: project.id, ui, title: project.alias || project.name,
          subtitle: (ui.tabs || []).length + ' 个窗口',
          children: el(MainPane, { project, ui, nest: true }),
        })
        : el(MainPane, { key: 'main', project, ui }),
      /* 右边缘 = 工作台 / 对话的分界，拖动即改让位宽度 */
      el(Splitter, {
        key: 'edge', pid: project.id, side: 'left', className: 'dock-edge',
        width: geo.width || 0, min: 380, max: Math.max(420, geo.max || 1400), onResize: onDock,
      }),
    ),
  )
}

/**
 * 窗口模式：小窗浮在让位区里、紧贴对话栏。
 * 几何存 ui.win（比例），拖标题栏移动、右下角缩放，双击标题栏复位；
 * 总览与项目工作区共用这个壳，所以两者的窗口行为完全一致。
 */
function FloatWindow({ pid, ui, title, subtitle, children }) {
  const rect = ui.win
  const box = useRef(null)
  const drag = useRef(null)

  const begin = (kind) => (e) => {
    if (!e || !Number.isFinite(e.clientX)) return
    const hit = e.target && typeof e.target.closest === 'function' ? e.target.closest('button') : null
    if (hit) return
    const holder = box.current && box.current.parentElement
    if (!holder || typeof holder.getBoundingClientRect !== 'function') return
    const view = holder.getBoundingClientRect()
    if (!view.width || !view.height) return
    if (typeof e.preventDefault === 'function') e.preventDefault()
    drag.current = { kind, sx: e.clientX, sy: e.clientY, vw: view.width, vh: view.height, rect, frame: 0, last: null }
    const apply = (pt) => {
      const d = drag.current
      if (!d) return
      const dx = (pt.x - d.sx) / d.vw
      const dy = (pt.y - d.sy) / d.vh
      if (d.kind === 'move') setWinRect(pid, { ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy })
      else setWinRect(pid, { ...d.rect, w: d.rect.w + dx * 2, h: d.rect.h + dy * 2 })
    }
    const move = (ev) => {
      const d = drag.current
      if (!d) return
      d.last = { x: ev.clientX, y: ev.clientY }
      /* 拖动时按帧合并，避免每个 pointermove 都重建整棵树 */
      if (d.frame) return
      const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null
      if (!raf) { apply(d.last); return }
      d.frame = raf(() => {
        const inst = drag.current
        if (!inst) return
        inst.frame = 0
        if (inst.last) apply(inst.last)
      })
    }
    const up = () => {
      const d = drag.current
      if (d && d.frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(d.frame)
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (document.body && document.body.classList) document.body.classList.remove('wt-dragging')
      flushUi()
    }
    if (document.body && document.body.classList) document.body.classList.add('wt-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const style = {
    left: ((rect.x - rect.w / 2) * 100).toFixed(3) + '%',
    top: ((rect.y - rect.h / 2) * 100).toFixed(3) + '%',
    width: (rect.w * 100).toFixed(3) + '%',
    height: (rect.h * 100).toFixed(3) + '%',
  }

  return el('div', { className: 'pane pane-canvas', 'data-mode': 'float' },
    el('div', { className: 'float-win', style, ref: box },
      el('div', {
        className: 'float-bar',
        title: '拖动移动窗口 · 双击复位',
        onPointerDown: begin('move'),
        onDoubleClick: () => resetWinRect(pid),
      },
        el('span', { className: 'fb-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
        el('span', { className: 'fb-title', title }, title),
        el('span', { className: 'fb-sub mono' }, subtitle || ''),
        el('span', { className: 'fb-tools' },
          el('button', { type: 'button', title: '回到默认位置与大小', onClick: () => resetWinRect(pid) }, '复位'),
          el('button', { type: 'button', title: '切换为全屏模式', onClick: () => setMode(pid, 'dock') }, '全屏'),
        ),
      ),
      el('div', { className: 'float-body' }, children),
      el('span', { className: 'float-grip', title: '拖动缩放', onPointerDown: begin('resize') }),
    ),
    el('p', { className: 'canvas-hint' }, '拖动标题栏移动 · 右下角缩放 · 右边缘拖动改工作台宽度'),
  )
}

function MainPane({ project, ui, nest }) {
  const tabs = ui.tabs
  const activeKey = ui.activeTab || (tabs[0] ? tabs[0].key : '')
  const active = tabs.find((t) => t.key === activeKey) || null

  const titleOf = (t) => (t.kind === 'editor' ? (store.editor.name || '编辑器') : t.title)

  return el('div', { className: 'pane pane-main' + (nest ? ' pane-nest' : '') },
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
          el('p', { className: 'hint' }, '用右上角的按钮打开「文件」/ 编辑器 / 终端 / 浏览器 / 自定义窗口；在「文件」里点文件会自动开编辑器。'),
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
  if (kind === 'files') return el(FilesPane, { project })
  if (kind === 'info') return el(InfoPane, { project })
  if (kind === 'term') return el(TermPane, { project })
  if (kind === 'web') return el(WebPane, { project })
  if (kind === 'custom') return el(CustomPane, { project })
  return el(EditorPane, { project })
}
