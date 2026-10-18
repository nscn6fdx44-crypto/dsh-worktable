/**
 * 侧边栏：整条工作台常驻（状态栏 / 项目列表）。
 * 宿主会话不再单列一节 —— 项目列表已经承载了同样的信息，点项目即进工作区。
 * 主区没开时，右击菜单 / 小窗 / toast 暂挂在这里；主区一开就交给它，避免重复挂载。
 */
import { el, Icon, Light, ContextMenu, Toasts } from './ui.js'
import {
  store, useStore, relTime, projEmoji,
  loadSessions, loadDefaults, openGrid, enterProject, openMenu, openModal,
  stateOf, sessionsOf, toggleHidden,
} from './core.js'
import { ModalHost } from './modals.js'

/* 四个工作状态：宿主四态（running / waiting / done / idle）的展示顺序 */
const STAT_CELLS = [
  { id: 'working', label: '进行中', tone: 'working', key: 'running' },
  { id: 'needs-you', label: '待处理', tone: 'needs', key: 'waiting' },
  { id: 'done', label: '已完成', tone: 'done', key: 'done' },
  { id: 'idle', label: '待命', tone: 'idle', key: 'idle' },
]

export function WorktableSidebar() {
  useStore()
  const all = store.projects
  const visible = all.filter((p) => !p.hidden)
  const counts = store.sessions.counts || { running: 0, waiting: 0, done: 0, idle: 0, total: 0 }

  const groups = new Map()
  for (const p of visible) {
    const key = p.folder || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(p)
  }

  return el('div', { className: 'wt-scope wt-side', 'data-ns': 'worktable', 'data-wide': '1' },
    el('div', { className: 'brand' },
      el('div', { className: 'brand-mark', 'aria-hidden': 'true' }, '🧰'),
      el('div', null,
        el('div', { className: 'brand-name' }, '工作台'),
        el('div', { className: 'brand-sub' }, 'Worktable'),
      ),
      el('div', { className: 'brand-tools' },
        el('button', { type: 'button', title: '刷新宿主会话状态', 'aria-label': '刷新宿主会话状态', onClick: () => loadSessions() }, el(Icon, { name: 'refresh' })),
        el('button', { type: 'button', title: '新建项目', 'aria-label': '新建项目', onClick: () => openModal('add') }, el(Icon, { name: 'plus' })),
      ),
    ),

    /* 状态框只记四个工作状态，2×2 紧凑排布（项目数挪到下面的列表标题上） */
    el('div', { className: 'stat-box' },
      STAT_CELLS.map((c) => el('div', { key: c.id, className: 'fb-cell', 'data-state': c.id },
        el('span', { className: 'fb-k' }, c.label),
        el('b', { className: 'fb-v ' + c.tone },
          store.sessions.state === 'pending' ? '…' : String(counts[c.key] || 0),
        ),
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
            folder ? el('div', { className: 'pgroup-title' }, folder) : null,
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
        all.length > visible.length
          ? el('button', { type: 'button', className: 'show-hidden', onClick: () => all.filter((p) => p.hidden).forEach((p) => toggleHidden(p.id)) }, '显示 ' + String(all.length - visible.length) + ' 个已隐藏项目')
          : null,
      ),
    ),

    el('p', { className: 'side-tip' }, '右击项目：模式 · 编辑 · 对话绑定 · 删除'),

    /* 主区没开时由侧边栏承载菜单/小窗/toast；主区一开就交给它，避免重复挂载 */
    store.open ? null : el('div', { className: 'wt-hosts' }, el(ContextMenu), el(ModalHost), el(Toasts)),
  )
}
