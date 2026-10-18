/**
 * 主区：控制室 / 卡片网格 / 项目工作区。
 *
 * 两态：
 *   grid    整块覆盖（控制室 + 项目卡片）
 *   project 只占对话左侧那块：宿主会话区被右推，右侧始终是 DSH 自己的对话（真能打字）
 *           工作台内部只有主区（标签页：文件 / 编辑器 / 终端 / 浏览器 / 自定义 / 项目信息），
 *           不再有左栏 —— 文件与项目信息都是标签页，对话栏不由我们渲染。
 *
 * 让位几何全部来自 hostdock.js，组件只消费 geo，不直接碰宿主 DOM。
 */
import { useRef } from 'react'
import { el, Light, Splitter, ContextMenu, Toasts } from './ui.js'
import { ModalHost } from './modals.js'
import { useHostDock } from './hostdock.js'
import {
  store, useStore, STATES, normState, MODES, modeDef, PANE_TABS, INFO_TAB,
  fmtDuration, relTime, shortPath, projEmoji, openGrid, enterProject, closeOverlay,
  openModal, openMenu, setMode, setDockPx, openTab, closeTab, setActiveTab,
  loadSessions, stateOf, sessionsOf, primarySession, uiOf, flushUi, setWinRect, resetWinRect,
} from './core.js'
import { InfoPane, FilesPane, EditorPane, TermPane, WebPane, CustomPane } from './panes.js'

export function MainView() {
  useStore()
  const rootRef = useRef(null)

  const open = store.open
  const active = open ? (store.projects.find((p) => p.id === store.activeId) || null) : null
  const docked = !!(active && store.view === 'project')
  const ui = active ? uiOf(active.id) : null

  /* 让位：只有进项目才挤对话；退出/卸载自动还原 */
  const geo = useHostDock(rootRef, docked, ui ? ui.dock : 0)
  const dockedFit = docked && geo.ready && geo.width > 0

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
      docked
        ? el(Workspace, { key: active.id, project: active, ui, geo })
        : [el(Topbar, { key: 'top' }), el(GridView, { key: 'grid' })],
    ),
    /* 菜单 / 小窗 / toast 挂在让位区之外：fixed 定位不受 dock 裁剪 */
    el(ContextMenu),
    el(ModalHost),
    el(Toasts),
  )
}

/* ============================ 顶栏（控制室） ============================ */

function Topbar() {
  const counts = store.sessions.counts || {}
  const sub = '项目 ' + store.projects.length + ' 个 · 宿主会话 ' + (counts.total || 0) + ' 个 · 快照 '
    + (store.sessions.at ? relTime(store.sessions.at) : '—')

  return el('header', { className: 'topbar' },
    el('div', null,
      el('div', { className: 'tb-title' },
        el('h1', null, '控制室'),
        el('span', { className: 'eyebrow' }, 'Control'),
      ),
      el('p', { className: 'tb-sub', title: sub }, sub),
    ),
    el('div', { className: 'tb-actions' },
      el('button', { type: 'button', className: 'btn', onClick: () => { loadSessions() } }, '刷新'),
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
    el('p', { className: 'grid-note' }, '右击项目或卡片：模式 · 编辑 · 绑定 · 删除 · 隐藏'),
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
        ? el(FloatWindow, { key: 'main', project, ui })
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
 * 与全屏模式共用同一个 MainPane，所以标签页 / 终端 / 浏览器等功能完全一致。
 */
function FloatWindow({ project, ui }) {
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
      if (d.kind === 'move') setWinRect(project.id, { ...d.rect, x: d.rect.x + dx, y: d.rect.y + dy })
      else setWinRect(project.id, { ...d.rect, w: d.rect.w + dx * 2, h: d.rect.h + dy * 2 })
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
        onDoubleClick: () => resetWinRect(project.id),
      },
        el('span', { className: 'fb-dots', 'aria-hidden': 'true' }, el('i'), el('i'), el('i')),
        el('span', { className: 'fb-title' }, project.alias || project.name),
        el('span', { className: 'fb-sub mono' }, (ui.tabs || []).length + ' 个窗口'),
        el('span', { className: 'fb-tools' },
          el('button', { type: 'button', title: '回到默认位置与大小', onClick: () => resetWinRect(project.id) }, '复位'),
          el('button', { type: 'button', title: '切换为全屏模式', onClick: () => setMode(project.id, 'dock') }, '全屏'),
        ),
      ),
      el('div', { className: 'float-body' }, el(MainPane, { project, ui, nest: true })),
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
