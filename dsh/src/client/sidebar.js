/**
 * 侧边栏：整条工作台常驻（状态栏 / 项目列表）。
 * 宿主会话不再单列一节 —— 项目列表已经承载了同样的信息，点项目即进工作区。
 * 主区没开时，右击菜单 / 小窗 / toast 暂挂在这里；主区一开就交给它，避免重复挂载。
 */
import { useEffect, useRef, useState } from 'react'
import { el, Icon, Light, ContextMenu, Toasts } from './ui.js'
import {
  store, useStore, relTime, projEmoji,
  loadSessions, loadDefaults, openGrid, enterProject, openMenu, openModal,
  stateOf, sessionsOf, statusCounts, toggleHidden,
  canDropOnWorktable, setDragOver, clearDragOver, dropOnWorktable, themeStyle, themeAttrs,
  moveProjectBefore, setProjectFolder, openExternalProject, toast,
} from './core.js'
import { ModalHost } from './modals.js'

/* 四个工作状态：按**项目**统计（项目和它的状态灯同一条口径） */
/** 这次拖的是不是工作台项目（区分「会话拖进来建项目」） */
const DRAG_PROJECT = 'application/x-wt-project'
function dragPid(e) {
  try { return Array.from(e.dataTransfer.types || []).includes(DRAG_PROJECT) } catch { return false }
}
function readDragPid(e) {
  try { return String(e.dataTransfer.getData(DRAG_PROJECT) || '') } catch { return '' }
}

/**
 * 宿主侧边栏给的可用空间 → 工作台该怎么摆。
 * 展开会话列表时高度会被压得很矮（这是最常见的「显示有问题」），折叠成图标栏时宽度会变窄。
 */
export function sideModeOf(width, height) {
  const w = Number(width) || 0
  const h = Number(height) || 0
  return {
    narrow: w > 0 && w < 200,
    short: h > 0 && h < 340,
    /* 卡片最大高度：留 10px 呼吸，最少给 150px（再矮就整块滚动） */
    maxHeight: h > 0 ? Math.max(150, Math.round(h - 10)) : 0,
  }
}

const STAT_CELLS = [
  { id: 'working', label: '进行中', tone: 'working' },
  { id: 'needs-you', label: '待处理', tone: 'needs' },
  { id: 'done', label: '已完成', tone: 'done' },
  { id: 'idle', label: '待命', tone: 'idle' },
]

export function WorktableSidebar() {
  useStore()
  const rootRef = useRef(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  /* 宿主侧边栏（展开会话列表 / 折叠成图标栏）随时会变尺寸：量一次父容器，跟着设上限 */
  useEffect(() => {
    if (typeof document === 'undefined') return () => {}
    const node = rootRef.current
    const parent = node && node.parentElement
    if (!parent) return () => {}
    let raf = 0
    const measure = () => {
      const rect = parent.getBoundingClientRect ? parent.getBoundingClientRect() : null
      if (!rect) return
      setBox({ w: Math.round(rect.width), h: Math.round(rect.height) })
    }
    const schedule = () => {
      if (raf) return
      raf = typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => { raf = 0; measure() })
        : setTimeout(() => { raf = 0; measure() }, 80)
    }
    measure()
    let ro = null
    try {
      if (typeof ResizeObserver === 'function') {
        ro = new ResizeObserver(schedule)
        ro.observe(parent)
      }
    } catch { /* 老环境 */ }
    window.addEventListener('resize', schedule)
    return () => {
      window.removeEventListener('resize', schedule)
      if (ro) ro.disconnect()
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf)
    }
  }, [])
  const all = store.projects
  const visible = all.filter((p) => !p.hidden)
  /* 这里必须自己算：host 的 counts 只认宿主会话，手工改的状态不会进去 */
  const counts = statusCounts(visible)
  /* 首帧还没有会话快照：先摆「…」，别让人把 0 当成结论 */
  const firstLoad = store.sessions.state === 'pending'

  const groups = new Map()
  const external = store.external || []
  for (const p of visible) {
    const key = p.folder || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  const sideMode = sideModeOf(box.w, box.h)

  /* 整块侧边栏都是拖放区：把「宿主会话」页签里的行（或带路径的文件）拖进来就建项目 */
  return el('div', {
    className: 'wt-scope wt-side' + (store.dragOver ? ' drag-over' : ''),
    'data-ns': 'worktable',
    'data-wide': '1',
    ref: rootRef,
    'data-narrow': sideMode.narrow ? '1' : '0',
    'data-short': sideMode.short ? '1' : '0',
    style: {
      ...themeStyle(),
      ...(sideMode.maxHeight ? { maxHeight: sideMode.maxHeight + 'px' } : null),
    },
    ...themeAttrs(),
    onDragEnter: (e) => { if (canDropOnWorktable(e)) { e.preventDefault(); setDragOver(true) } },
    onDragOver: (e) => {
      if (!canDropOnWorktable(e)) return
      e.preventDefault()
      try { e.dataTransfer.dropEffect = 'copy' } catch { /* 老浏览器 */ }
      setDragOver(true)
    },
    onDragLeave: (e) => {
      const to = e.relatedTarget
      if (!to || !e.currentTarget.contains(to)) clearDragOver()
    },
    onDrop: (e) => { e.preventDefault(); e.stopPropagation(); dropOnWorktable(e) },
  },
    el('div', { className: 'brand' },
      el('div', { className: 'brand-mark', 'aria-hidden': 'true' }, '🧰'),
      el('div', null,
        el('div', { className: 'brand-name' }, '工作台'),
        el('div', { className: 'brand-sub' }, 'Worktable'),
      ),
      el('div', { className: 'brand-tools' },
        el('button', { type: 'button', title: '导出 / 导入项目数据', 'aria-label': '项目数据', onClick: () => openModal('data') }, '⤓'),
        el('button', { type: 'button', title: '搜索（Ctrl+K）', 'aria-label': '搜索', onClick: () => openModal('search') }, '🔍'),
        el('button', { type: 'button', title: '主题与背景', 'aria-label': '主题与背景', onClick: () => openModal('theme') }, '⚙'),
        el('button', { type: 'button', title: '刷新宿主会话状态', 'aria-label': '刷新宿主会话状态', onClick: () => loadSessions() }, el(Icon, { name: 'refresh' })),
        el('button', { type: 'button', title: '新建项目', 'aria-label': '新建项目', onClick: () => openModal('add') }, el(Icon, { name: 'plus' })),
      ),
    ),

    /* 状态框只记四个工作状态，2×2 紧凑排布（项目数挪到下面的列表标题上） */
    el('div', { className: 'stat-box', title: '按项目统计：每个项目算它最需要关注的那个对话' },
      STAT_CELLS.map((c) => el('div', {
        key: c.id, className: 'fb-cell', 'data-state': c.id, 'data-count': String(counts[c.id] || 0),
      },
        el('span', { className: 'fb-k' }, c.label),
        el('b', { className: 'fb-v ' + c.tone }, firstLoad ? '…' : String(counts[c.id] || 0)),
      )),
    ),

    el('div', { className: 'side-projects' },
      el('div', { className: 'nav-label' },
        el('span', null, '项目', el('span', { className: 'mono', style: { marginLeft: '6px' } }, String(visible.length))),
        el('span', { className: 'nl-tools' },
          el('button', { type: 'button', className: 'nl-btn', title: '打开卡片网格', onClick: openGrid }, '总览'),
          el('button', { type: 'button', className: 'nl-btn', onClick: () => openModal('add') }, '添加'),
        ),
      ),
      el('div', { className: 'plist' },
        visible.length
          ? [...groups.entries()].map(([folder, items]) => el('div', { key: folder || '__root', className: 'pgroup' },
            el('div', {
              className: 'pgroup-title' + (folder ? '' : ' plain'),
              title: folder ? '拖项目到这里归入「' + folder + '」' : '拖到这里移出分组',
              onDragOver: (e) => { if (dragPid(e)) { e.preventDefault() } },
              onDrop: (e) => {
                const pid = readDragPid(e)
                if (!pid) return
                e.preventDefault()
                setProjectFolder(pid, folder)
              },
            }, folder || '未分组'),
            items.map((p) => {
              const bound = sessionsOf(p)
              return el('div', {
                key: p.id,
                className: 'pitem' + (store.activeId === p.id && store.open ? ' active' : ''),
                title: (p.path || '（未设置路径）') + '\n' + (bound.length ? '对话：' + bound.map((s) => s.title).join('、') : '未绑定 DSH 对话'),
                role: 'button',
                tabIndex: 0,
                onClick: () => enterProject(p.id),
                onContextMenu: (e) => { e.preventDefault(); e.stopPropagation(); openMenu(p.id, e.clientX, e.clientY) },
              },
                el('span', { className: 'pi-ico', 'aria-hidden': 'true' }, projEmoji(p)),
                el('span', { className: 'pi-name' }, p.alias || p.name),
                bound.length ? el('span', { className: 'pi-bind', title: '已绑定 ' + bound.length + ' 个对话' }, '🔗') : null,
                el(Light, { pid: p.id }),
                el(Icon, { name: 'chevron', size: 12, className: 'pi-arrow' }),
              )
            }),
          ))
          : el('p', { className: 'wt-mute' }, store.sessions.state === 'pending' ? '正在读取会话…' : '还没有项目，点「添加」开始'),
        external.length
          ? el('div', { className: 'pgroup' },
            el('div', { className: 'pgroup-title' }, '入驻'),
            external.map((x) => el('div', {
              key: x.id,
              className: 'pitem ext',
              title: (x.path || '未提供目录') + (x.source ? '\n来自：' + x.source : '') + '\n点击接入工作台',
              role: 'button',
              tabIndex: 0,
              onClick: () => openExternalProject(x.id),
            },
              el('span', { className: 'pi-ico', 'aria-hidden': 'true' }, x.icon),
              el('span', { className: 'pi-name' }, x.name),
              el('span', { className: 'pi-bind', title: '点一下接入（会在工作台落成项目）' }, '＋'),
            )),
          )
          : null,
        all.length > visible.length
          ? el('button', { type: 'button', className: 'show-hidden', onClick: () => all.filter((p) => p.hidden).forEach((p) => toggleHidden(p.id)) }, '显示 ' + String(all.length - visible.length) + ' 个已隐藏项目')
          : null,
      ),
    ),

    store.dragOver
      ? el('div', { className: 'drop-hint' }, '松手 → 用这条会话新建项目')
      : el('p', { className: 'side-tip' }, '右击项目：编辑 · 对话绑定 · 删除'),

    /* 主区没开时由侧边栏承载菜单/小窗/toast；主区一开就交给它，避免重复挂载 */
    store.open ? null : el('div', { className: 'wt-hosts' }, el(ContextMenu), el(ModalHost), el(Toasts)),
  )
}
