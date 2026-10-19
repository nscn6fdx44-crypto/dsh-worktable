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
import { Component, useRef } from 'react'
import { el, Light, Splitter, ContextMenu, Toasts } from './ui.js'
import { ModalHost } from './modals.js'
import { useHostDock, remeasure, undockedBox, anchorLeft } from './hostdock.js'
import {
  store, useStore, STATES, normState, PANE_TABS, INFO_TAB, GRID_TABS, GRID_PID,
  fmtDuration, relTime, shortPath, projEmoji, openGrid, enterProject, closeOverlay,
  openModal, openMenu, setDockPx, openTab, closeTab, setActiveTab,
  loadSessions, stateOf, sessionsOf, primarySession, projectBySession, createFromSession, startSessionDrag, switchHostSession, emit,
  LAYOUTS, setLayout, setSecondTab, setSplit,
  themeStyle, themeAttrs,
  jumpToSession, setGridTab, uiOf, flushUi,
  overviewProjects, setOverview, OVERVIEW_SORTS, OVERVIEW_FILTERS,
  runProject, stopProject, openRunPort,
  setSideProject, setSideSplit, sideProjectOf, readChatDrop, dropToChat, setChatDropHover,
} from './core.js'
import { InfoPane, FilesPane, EditorPane, TermPane, WebPane, CustomPane, MediaPane, NotesPane } from './panes.js'

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
  /* 有几何就按几何摆；完全没有几何时用「有界盒子」，绝不 inset:0 铺满整窗 */
  const vw = (typeof window !== 'undefined' && window.innerWidth) || 1280
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800
  const style = dockedFit
    ? { left: geo.left + 'px', top: geo.top + 'px', width: geo.width + 'px', height: geo.height + 'px' }
    : undockedBox(vw, vh, anchorLeft())

  return el('div', {
    className: 'wt-scope wt-root',
    'data-ns': 'worktable',
    'data-dock': dockedFit ? '1' : '0',
    ref: rootRef,
    style: themeStyle(),
    ...themeAttrs(),
  },
    el('div', {
      className: 'wt-dock' + (dockedFit ? ' is-docked' : ' is-undocked'),
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
  /* 卡片页用筛选/排序后的列表；页签角标仍显示总数 */
  const shown = overviewProjects(projects)
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

  const board = el(OverviewPane, { tab, projects, shown, rows, running, waiting, badgeOf })

  return el('div', { className: 'dock-wrap' },
    el('header', {
      className: 'dock-head' + (store.chatDropHover ? ' drop-hover' : ''),
      title: '把文件或网页拖到这里 → 填进对话输入框',
      onDragOver: (e) => {
        if (!readChatDrop(e)) return
        e.preventDefault()
        try { e.dataTransfer.dropEffect = 'copy' } catch { /* ignore */ }
        setChatDropHover(true)
      },
      onDragLeave: (e) => {
        const to = e.relatedTarget
        if (!to || !e.currentTarget.contains(to)) setChatDropHover(false)
      },
      onDrop: (e) => { if (readChatDrop(e)) { e.preventDefault(); e.stopPropagation(); dropToChat(e) } },
    },
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
        el('button', { type: 'button', className: 'mini-btn', title: '重新读取宿主会话', onClick: () => { loadSessions() } }, '↻'),
        el('button', { type: 'button', className: 'mini-btn', title: '新建项目', onClick: () => openModal('add') }, '＋ 新建'),
        el('button', { type: 'button', className: 'mini-btn', title: '关闭工作台 (Esc)', onClick: closeOverlay }, '✕'),
      ),
    ),

    el('div', { className: 'ws' },
      board,
      /* 右边缘 = 工作台 / 对话的分界，拖动即改让位宽度 */
      el(Splitter, {
        key: 'edge', pid: GRID_PID, side: 'left', className: 'dock-edge',
        width: geo.width || 0, min: 380, max: Math.max(420, geo.max || 1400), onResize: onDock,
      }),
    ),
  )
}

/** 总览面板本体：一条页签栏 + 页签内容，和 MainPane 同款 */
function OverviewPane({ tab, projects, shown, rows, running, waiting, badgeOf }) {
  return el('div', { className: 'pane pane-main' },
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
        : el(ProjectsTab, { projects: shown, total: projects.length }),
  )
}

function ProjectsTab({ projects, total }) {
  const ov = store.overview || { q: '', sort: 'recent', filter: 'all' }
  return el('div', { className: 'pane-body overview-body' },
    el('div', { className: 'ov-filter' },
      el('input', {
        className: 'ov-search', value: ov.q, spellCheck: false,
        placeholder: '搜项目名 / 目录 / 分组 / 备注…',
        onChange: (e) => setOverview({ q: e.target.value }),
      }),
      el('select', {
        className: 'wt-select ov-sort', value: ov.sort, title: '排序',
        onChange: (e) => setOverview({ sort: e.target.value }),
      }, OVERVIEW_SORTS.map((s) => el('option', { key: s.id, value: s.id }, s.label))),
      el('div', { className: 'ov-chips' },
        OVERVIEW_FILTERS.map((f) => el('button', {
          key: f.id, type: 'button',
          className: 'mini-btn' + (ov.filter === f.id ? ' on' : ''),
          onClick: () => setOverview({ filter: f.id }),
        }, f.label)),
      ),
      total !== undefined && projects.length !== total
        ? el('span', { className: 'ov-count mono' }, projects.length + ' / ' + total)
        : null,
    ),
    el('div', { className: 'grid' },
      projects.map((p) => el(ProjectCard, { key: p.id, project: p })),
      el(AddCard),
      projects.length ? null : el('div', { className: 'empty' }, '还没有项目，点「＋ 新建」开始'),
    ),
    el('p', { className: 'grid-note' }, '右击项目或卡片：编辑 · 绑定 · 删除 · 隐藏；上面可搜索 / 排序 / 筛选'),
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
    el('p', { className: 'grid-note' }, '「建为项目」会以会话标题和它自己的工作目录新建一个项目并立刻进入；也可以把整行拖到左侧工作台'),
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
  return el('div', {
    className: 'ov-row', 'data-state': st,
    draggable: 'true',
    title: '按住拖到左侧工作台，可直接用这条会话新建项目',
    onDragStart: (e) => startSessionDrag(e, session),
  },
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
  const sideProject = sideProjectOf(project.id)
  const sideUi = sideProject ? uiOf(sideProject.id) : null

  /* 工作台右边缘：直接改让位宽度，拖的同时右侧对话跟着变宽变窄 */
  const onDock = (next, persist) => {
    if (next == null) { flushUi(); return }
    if (next === 0) { setDockPx(project.id, 0, true); return }
    setDockPx(project.id, next, persist)
  }

  return el('div', { className: 'dock-wrap' },
    el('header', {
      className: 'dock-head' + (store.chatDropHover ? ' drop-hover' : ''),
      title: '把文件或网页拖到这里 → 填进对话输入框',
      onDragOver: (e) => {
        if (!readChatDrop(e)) return
        e.preventDefault()
        try { e.dataTransfer.dropEffect = 'copy' } catch { /* ignore */ }
        setChatDropHover(true)
      },
      onDragLeave: (e) => {
        const to = e.relatedTarget
        if (!to || !e.currentTarget.contains(to)) setChatDropHover(false)
      },
      onDrop: (e) => { if (readChatDrop(e)) { e.preventDefault(); e.stopPropagation(); dropToChat(e) } },
    },      el('div', { className: 'dh-main' },
        el('span', { className: 'dh-ico', 'aria-hidden': 'true' }, projEmoji(project)),
        geo.stale
          ? el('button', {
            type: 'button', className: 'mini-btn stale-chip',
            title: '宿主布局变了（开了面板 / 预览），工作台仍按上次区域显示；点一下重新测量',
            onClick: () => remeasure(),
          }, '布局变了 · 重测')
          : null,
        el('b', { className: 'dh-name', title: project.path }, project.alias || project.name),
        el(Light, { pid: project.id }),
        el('span', { className: 'dh-dot', 'aria-hidden': 'true' }, '·'),
        el('span', { className: 'dh-sub mono', title: project.path }, shortPath(project.path || '未设置目录', 30)),
        /* 状态灯只留左边那一个（项目聚合状态）；这里别再放灯，两个灯会互相打脸 */
        primary ? el('button', {
          type: 'button',
          className: 'dh-chat',
          title: '把右侧对话切到「' + (primary.title || primary.id) + '」（宿主没切过来时点这里）',
          onClick: () => {
            switchHostSession(primary.id).then((r) => {
              toast(r.ok ? '已切到对话：' + (primary.title || primary.id) : '切对话失败：' + (r.error || '未知原因'), r.ok ? 'ok' : 'warn')
              if (r.ok) loadSessions()
            })
          },
        }, String(primary.title || primary.id).slice(0, 14)) : el('span', { className: 'dh-chat off' }, '未绑定对话'),
      ),
      el('div', { className: 'dh-tools' },
        el('button', {
          type: 'button',
          className: 'mini-btn' + (sideProject ? ' on' : ''),
          title: sideProject ? '取消并排（现在是「' + (sideProject.alias || sideProject.name) + '」）' : '并排放一个项目',
          onClick: () => (sideProject ? setSideProject('') : openModal('side', project.id)),
        }, '⫼'),
        el('button', {
          type: 'button',
          className: 'mini-btn run-btn' + ((store.run.pid === project.id && store.run.state === 'running') ? ' on' : ''),
          title: (project.run && project.run.cmd)
            ? ((store.run.pid === project.id && store.run.state === 'running') ? '停止：' + project.run.cmd : '运行：' + project.run.cmd)
            : '还没配运行命令（编辑项目里填）',
          onClick: () => {
            if (store.run.pid === project.id && store.run.state === 'running') { stopProject(project.id); return }
            const res = runProject(project.id)
            if (!res.ok && res.error === 'no-run-config') openModal('edit', project.id)
          },
        }, (store.run.pid === project.id && store.run.state === 'running') ? '■' : '▶'),
        el('div', { className: 'layout-switch' },
          LAYOUTS.map((L) => el('button', {
            key: L.id, type: 'button',
            className: 'mini-btn' + ((ui.layout || 'single') === L.id ? ' on' : ''),
            title: L.hint,
            onClick: () => setLayout(project.id, L.id),
          }, L.icon)),
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

    el('div', { className: 'ws' },
      sideProject && sideUi
        ? el('div', { className: 'ws-side' },
          el('div', { className: 'ws-cell side-cell', style: { width: ((store.side && store.side.split) || 50) + '%' } },
            el('div', { className: 'side-head' },
              el('span', { className: 'dh-ico', 'aria-hidden': 'true' }, projEmoji(project)),
              el('b', null, project.alias || project.name),
              el('button', {
                type: 'button', className: 'mini-btn', title: '把这一侧设为主项目',
                onClick: () => { const other = sideProject.id; setSideProject(''); enterProject(other) },
              }, '⇄'),
            ),
            el(Panes, { key: 'a', project, ui }),
          ),
          el(PaneSplit, { vertical: true, onPct: (v) => setSideSplit(v) }),
          el('div', { className: 'ws-cell side-cell side-b' },
            el('div', { className: 'side-head' },
              el('span', { className: 'dh-ico', 'aria-hidden': 'true' }, projEmoji(sideProject)),
              el('b', null, sideProject.alias || sideProject.name),
              el('button', {
                type: 'button', className: 'mini-btn', title: '关闭并排',
                onClick: () => setSideProject(''),
              }, '✕'),
            ),
            el(Panes, { key: 'b', project: sideProject, ui: sideUi }),
          ),
        )
        : el(Panes, { key: 'panes', project, ui }),
      /* 右边缘 = 工作台 / 对话的分界，拖动即改让位宽度 */
      el(Splitter, {
        key: 'edge', pid: project.id, side: 'left', className: 'dock-edge',
        width: geo.width || 0, min: 380, max: Math.max(420, geo.max || 1400), onResize: onDock,
      }),
    ),
  )
}

function Panes({ project, ui }) {
  const layout = ui.layout || 'single'
  const tabs = ui.tabs || []
  /* 分栏但没有第二个窗口可用时退回单窗格，避免出现半块空白 */
  if (layout === 'single' || tabs.length < 2) return el(MainPane, { key: 'main', project, ui, slot: 'a' })
  const vertical = layout === 'vsplit'
  const pct = ui.split > 0 ? ui.split : 50
  const box = (which) => (vertical
    ? { width: (which === 'a' ? pct : 100 - pct) + '%' }
    : { height: (which === 'a' ? pct : 100 - pct) + '%' })
  return el('div', { className: 'ws-split ' + (vertical ? 'v' : 'h') },
    el('div', { className: 'ws-cell', style: box('a') }, el(MainPane, { key: 'a', project, ui, slot: 'a' })),
    el(PaneSplit, { vertical, onPct: (v) => setSplit(project.id, v) }),
    el('div', { className: 'ws-cell', style: box('b') }, el(MainPane, { key: 'b', project, ui, slot: 'b' })),
  )
}

/** 两栏之间的拖动条（按父容器尺寸换算百分比，横竖都支持） */
function PaneSplit({ vertical, onPct }) {
  const down = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const parent = e.currentTarget.parentElement
    if (!parent || !parent.getBoundingClientRect) return
    const rect = parent.getBoundingClientRect()
    const move = (ev) => {
      const pct = vertical
        ? ((ev.clientX - rect.left) / Math.max(1, rect.width)) * 100
        : ((ev.clientY - rect.top) / Math.max(1, rect.height)) * 100
      onPct(Math.max(20, Math.min(80, Math.round(pct))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('wt-dragging')
    }
    document.body.classList.add('wt-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return el('div', {
    className: 'pane-split ' + (vertical ? 'v' : 'h'),
    role: 'separator',
    'aria-orientation': vertical ? 'vertical' : 'horizontal',
    title: '拖动调整两栏比例（双击回到 50/50）',
    onPointerDown: down,
    onDoubleClick: () => onPct(0),
  }, el('i', null))
}

function MainPane({ project, ui, nest, slot }) {
  const tabs = ui.tabs
  const isB = slot === 'b'
  /* 第二窗格默认挑一个和第一窗格不同的标签页 */
  const fallbackB = (tabs.find((t) => t.key !== ui.activeTab) || tabs[0] || {}).key || ''
  const activeKey = isB
    ? (ui.secondTab || fallbackB)
    : (ui.activeTab || (tabs[0] ? tabs[0].key : ''))
  const active = tabs.find((t) => t.key === activeKey) || null

  const titleOf = (t) => (t.kind === 'editor' ? (store.editor.name || '编辑器') : t.title)
  const pick = (key) => (isB ? setSecondTab(project.id, key) : setActiveTab(project.id, key))

  return el('div', { className: 'pane pane-main' + (nest ? ' pane-nest' : '') + (isB ? ' pane-b' : '') },
    el('div', { className: 'pane-head tabhead' },
      el('div', { className: 'tabs' },
        tabs.length
          ? tabs.map((t) => el('div', {
            key: t.key,
            className: 'tab' + (t.key === activeKey ? ' on' : ''),
            role: 'button',
            title: isB ? '在这一栏打开：' + titleOf(t) : '打开：' + titleOf(t),
            onClick: () => pick(t.key),
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
        el('button', {
          type: 'button',
          className: 'mini-btn' + (store.tabMenu ? ' on' : ''),
          title: '新建窗口',
          onClick: () => emit({ tabMenu: !store.tabMenu }),
        }, '＋ 窗口'),
        el('div', { className: 'tab-menu' + (store.tabMenu ? ' open' : '') },
          PANE_TABS.map((t) => el('button', {
            key: t.id, type: 'button', className: 'ctx-item',
            onClick: () => { emit({ tabMenu: false }); openTab(project.id, t.id) },
          }, el('span', null, t.icon + ' ' + t.label))),
        ),
      ),
    ),

    active
      ? el(PaneBoundary, { key: active.key }, renderPane(active.kind, project))
      : el('div', { className: 'pane-body' },
        el('div', { className: 'pane-empty' },
          el('span', { className: 'pe-ico' }, '◫'),
          el('p', null, '这一栏还没有内容'),
          el('p', { className: 'hint' }, '点标签页把窗口放到这一栏；顶部 ◫ / ⬓ 可以切成两栏同时看。'),
        ),
      ),
  )
}

/**
 * 窗格级错误边界：某一格渲染崩了只坏这一格，其余（标签页、另一栏、对话）照常。
 * 支持「重试」（重挂子树）。
 */
export class PaneBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { err: null, tries: 0 }
    this.retry = this.retry.bind(this)
  }

  static getDerivedStateFromError(err) {
    return { err }
  }

  componentDidCatch(err) {
    /* 只记录，不往上抛：其它窗格要活着 */
    if (typeof console !== 'undefined' && console.warn) console.warn('[worktable] 窗格渲染失败', err)
  }

  retry() {
    this.setState({ err: null, tries: (this.state.tries || 0) + 1 })
  }

  render() {
    const err = this.state.err
    if (!err) {
      return el('div', { className: 'pane-boundary', 'data-tries': String(this.state.tries || 0) }, this.props.children)
    }
    return el('div', { className: 'pane-body pane-crash' },
      el('div', { className: 'pane-empty' },
        el('span', { className: 'pe-ico' }, '⚠'),
        el('p', null, '这个窗格渲染失败了'),
        el('p', { className: 'hint mono' }, String((err && err.message) || err)),
        el('div', { className: 'pe-actions' },
          el('button', { type: 'button', className: 'btn small primary', onClick: this.retry }, '重新加载此窗格'),
        ),
      ),
    )
  }
}

function renderPane(kind, project) {
  if (kind === 'files') return el(FilesPane, { project })
  if (kind === 'info') return el(InfoPane, { project })
  if (kind === 'term') return el(TermPane, { project })
  if (kind === 'web') return el(WebPane, { project })
  if (kind === 'custom') return el(CustomPane, { project })
  if (kind === 'media') return el(MediaPane, { project })
  if (kind === 'notes') return el(NotesPane, { project })
  return el(EditorPane, { project })
}
