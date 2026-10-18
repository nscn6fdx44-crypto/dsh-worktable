/**
 * trae-usage-worktable · client 入口
 *
 * 座位：
 *   sidebar.footer.action —— 整条侧边栏工作台（常驻）
 *   shell.overlay         —— 主区：控制室 / 卡片网格 / 项目工作区
 *
 * 关键契约（踩过的坑，勿改）：
 *   1. props.renderSlot 绑定到 entry 自己的 children；空参调用抛 SlotOwnershipError。
 *   2. Register 成功 ≠ 渲染成功：两侧都有错误边界兜底。
 *   3. 会话服务可选，ctx.inject(['sessions']) 延迟接入，缺席不影响渲染。
 *   4. 右击菜单 / 小窗 / toast 挂在侧边栏 —— 容器不能有 backdrop-filter/overflow:hidden，
 *      否则 fixed 后代被裁剪（真机踩过）。
 */
import { Component } from 'react'
import CSS from './theme.css'
import {
  store, useStore, hydrate, setHost, loadSessions, loadDefaults, closeMenu, closeModal,
  closeOverlay, startTicker, VERSION,
} from './core.js'
import { el } from './ui.js'
import { WorktableSidebar } from './sidebar.js'
import { MainView } from './overlay.js'

const PANEL_ID = 'trae-usage-worktable'
const OVERLAY_ID = PANEL_ID + '-main'

export const inject = ['slots']
export { VERSION }

class SidebarBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null } }
  static getDerivedStateFromError(err) { return { err: String(err?.message ?? err) } }
  render() {
    if (this.state.err) {
      return el('div', { className: 'wt-scope wt-side' },
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
      return el('div', { className: 'wt-scope wt-overlay' },
        el('div', { className: 'wt-shell' },
          el('header', { className: 'topbar' },
            el('div', null, el('div', { className: 'tb-title' }, el('h1', null, '工作台'), el('span', { className: 'eyebrow' }, 'ERROR'))),
            el('div', { className: 'tb-actions' }, el('button', { type: 'button', className: 'btn', onClick: closeOverlay }, '关闭')),
          ),
          el('p', { className: 'wt-error wt-pad' }, this.state.err),
        ),
      )
    }
    return el(MainView, this.props)
  }
}

export function apply(ctx) {
  setHost(ctx)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-dsh-plugin', PANEL_ID)
    style.textContent = CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'trae-usage-worktable: styles')

  hydrate()

  /* Esc：先关菜单 → 再关弹窗 → 最后关主区 */
  ctx.effect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (store.menu) { closeMenu(); return }
      if (store.modal) { closeModal(); return }
      if (store.open) closeOverlay()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, 'trae-usage-worktable: esc')

  /* 心跳：控制室计时 */
  ctx.effect(() => startTicker(), 'trae-usage-worktable: ticker')

  /* 会话快照轮询：只读宿主内存，不调模型 */
  ctx.effect(() => {
    const timer = setInterval(() => { loadSessions() }, 20_000)
    return () => clearInterval(timer)
  }, 'trae-usage-worktable: poll')

  try {
    ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
      name: 'sidebar.footer.action', id: PANEL_ID, order: 20,
    }, SidebarBoundary), 'trae-usage-worktable: sidebar')
  } catch (err) {
    console.warn('[worktable] sidebar.footer.action 注入失败', err)
  }

  try {
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({
      name: 'shell.overlay', id: OVERLAY_ID, order: 100,
    }, OverlayBoundary), 'trae-usage-worktable: overlay')
  } catch (err) {
    console.warn('[worktable] shell.overlay 注入失败', err)
  }

  try {
    ctx.inject(['sessions'], () => { loadSessions() })
  } catch { /* 无会话服务的 profile */ }

  loadSessions()
  loadDefaults()
}
