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
 *   4. 工作区不再自绘对话栏：进项目时把宿主中心列 marginLeft 右推（hostdock.js），
 *      工作台只占左边那块，右侧是 DSH 自己的对话 —— 真能打字，不是预览。
 *   5. 右击菜单 / 小窗 / toast 挂在主区根的直系层 —— 容器不能有 backdrop-filter /
 *      overflow:hidden，否则 fixed 后代被裁剪（真机踩过）。
 */
import { Component } from 'react'
import CSS from './theme.css'
import {
  store, useStore, hydrate, setHost, setWorkspace, loadSessions, loadDefaults,
  closeMenu, closeModal, closeOverlay, startTicker, VERSION, openFile, createSessionInDir, switchHostSession, openSearch,
  searchUrl, webGotoSmart, setTheme, resetTheme, themeStyle, themeAttrs, webHome,
  moveProjectBefore, setProjectFolder,
  LAYOUTS, setLayout, setSecondTab, setSplit, uiOf,
  openTab, closeTab,
  updateProject, projectOf,
  loadArtifacts, openArtifact, sendArtifactToChat, openMedia, ARTIFACT_FILE,
  PROJECT_TEMPLATES, applyTemplate, exportSnapshot, exportSnapshotText, importSnapshot,
  openModal,
  registerExternalProject, unregisterExternalProject, openExternalProject, clearExternalProjects,
  removeProject, undoRemoveProject, toastUndo,
  overviewProjects, setOverview, OVERVIEW_SORTS, OVERVIEW_FILTERS, setGridTab,
  handleHotkey, HOTKEYS,
  setRunConfig, runProject, stopProject, openRunPort,
  termExec,
  setSideProject, setSideSplit, sideProjectOf,
  enterProject,
  listMediaDir,
} from './core.js'
import { el } from './ui.js'
import { WorktableSidebar } from './sidebar.js'
import { MainView, PaneBoundary } from './overlay.js'
import { kindOfMediaPath, mediaRowsOf } from './panes.js'

const PANEL_ID = 'trae-usage-worktable'
const OVERLAY_ID = PANEL_ID + '-main'

export const inject = ['slots']
export { VERSION }
/* 让位接口出口（离线自测用）：宽度换算 + 施加/还原，不参与运行时调用 */
export { computeDock, attachHost, applyDock, releaseDock, dockAspect } from './hostdock.js'
/* 离线自测出口：暴露编辑器状态与 openFile，便于断言「未保存改动不被覆盖」守卫 */
export { store, openFile, createSessionInDir, switchHostSession, searchUrl, webGotoSmart, setTheme, resetTheme, themeStyle, themeAttrs, webHome, openSearch, moveProjectBefore, setProjectFolder,
  LAYOUTS, setLayout, setSecondTab, setSplit, uiOf, openTab, closeTab, updateProject,
  loadArtifacts, openArtifact, sendArtifactToChat, openMedia,
  PROJECT_TEMPLATES, applyTemplate, exportSnapshot, exportSnapshotText, importSnapshot, openModal, closeModal,
  registerExternalProject, unregisterExternalProject, openExternalProject,
  removeProject, undoRemoveProject, toastUndo, PaneBoundary,
  overviewProjects, setOverview, setGridTab,
  handleHotkey, HOTKEYS,
  setRunConfig, runProject, stopProject, openRunPort, hydrate, termExec,
  setSideProject, setSideSplit, sideProjectOf, enterProject, kindOfMediaPath, mediaRowsOf, listMediaDir }

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
      return el('div', { className: 'wt-scope wt-root' },
        el('div', { className: 'wt-dock is-full' },
          el('header', { className: 'dock-head' },
            el('div', { className: 'dh-main' },
              el('span', { className: 'dh-ico', 'aria-hidden': 'true' }, '🧰'),
              el('b', { className: 'dh-name' }, '工作台'),
              el('span', { className: 'dh-dot', 'aria-hidden': 'true' }, '·'),
              el('span', { className: 'dh-sub mono' }, '渲染失败'),
            ),
            el('div', { className: 'dh-tools' },
              el('button', { type: 'button', className: 'mini-btn', onClick: closeOverlay }, '关闭'),
            ),
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
      /* 统一入口：搜索 / 新建 / 总览 / 切标签 / 关标签 / 切项目 */
      if (handleHotkey(e)) return
      if (e.key !== 'Escape') return
      if (store.menu) { closeMenu(); return }
      if (store.modal) { closeModal(); return }
      if (store.open) closeOverlay()
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, 'trae-usage-worktable: esc')

  /* 对外注册表：其他插件把项目塞进工作台（只挂函数，dispose 时摘掉） */
  ctx.effect(() => {
    if (typeof window === 'undefined') return () => {}
    window.__WT_REGISTER_PROJECT__ = registerExternalProject
    window.__WT_UNREGISTER_PROJECT__ = unregisterExternalProject
    window.__WT_OPEN_PROJECT__ = openExternalProject
    return () => {
      try {
        delete window.__WT_REGISTER_PROJECT__
        delete window.__WT_UNREGISTER_PROJECT__
        delete window.__WT_OPEN_PROJECT__
      } catch { /* 只读环境 */ }
      clearExternalProjects()
    }
  }, 'trae-usage-worktable: external api')

  /* 心跳：控制室计时 */
  ctx.effect(() => startTicker(), 'trae-usage-worktable: ticker')

  /* 会话快照轮询：只读宿主内存，不调模型。4s 一次，状态灯才跟得上对话 */
  /* 会话快照轮询：可见时 4s；窗口隐藏时每 8 拍（32s）才拉一次，省电也少打扰宿主 */
  ctx.effect(() => {
    let ticks = 0
    const timer = setInterval(() => {
      ticks += 1
      const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden'
      if (hidden && ticks % 8 !== 0) return
      loadSessions()
    }, 4_000)
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

  /* 宿主会话的「打开某个对话」入口（右侧对话要跟着项目走） */
  try {
    ctx.inject(['uiWorkspace'], (c) => { setWorkspace(c && c.uiWorkspace) })
  } catch { /* 未提供该服务：退到 sessions.open */ }

  loadSessions()
  loadDefaults()
}
