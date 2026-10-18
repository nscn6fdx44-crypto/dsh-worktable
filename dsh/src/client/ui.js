/**
 * ui：共享基元（el / 图标 / 状态灯 / toast / 右击菜单 / 弹窗外壳 / 分栏拖拽）。
 *
 * 只依赖 core 的状态与动作；不依赖任何具体窗格。
 */
import { createElement, useEffect, useRef } from 'react'
import {
  STATES, stateOf, stateSource, cycleStatus, store, useStore,
  closeMenu, MODES, setMode, openModal, removeProject, uiOf, closeModal,
} from './core.js'

/** createElement 包装：过滤 null/false、扁平化数组 */
export function el(tag, props, ...children) {
  const kids = []
  const push = (c) => {
    if (c == null || c === false || c === true) return
    if (Array.isArray(c)) { c.forEach(push); return }
    kids.push(c)
  }
  children.forEach(push)
  /* 展开成多个 child 而不是传数组：数组 child 会让 React 当成 list 要求 key */
  return kids.length ? createElement(tag, props, ...kids) : createElement(tag, props)
}

/* ============================ 图标 ============================ */

export function Icon({ name, size = 14, className }) {
  const paths = {
    refresh: ['M20.4 12a8.4 8.4 0 1 1-2.46-5.94', 'M20.6 4.2v4.6h-4.6'],
    plus: ['M12 5v14M5 12h14'],
    close: ['M6 6l12 12M18 6L6 18'],
    chevron: ['m9 6 6 6-6 6'],
    file: ['M14 3v5h5', 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z'],
    folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
    save: ['M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z', 'M17 21v-8H7v8', 'M7 3v5h8'],
    up: ['M12 19V5', 'm5 12 7-7 7 7'],
    play: ['M6 4l14 8-14 8z'],
    stop: ['M6 6h12v12H6z'],
    git: ['M12 3v12', 'M12 9a3 3 0 1 0 0 .01', 'M7 19a3 3 0 1 0 0 .01'],
  }
  const d = paths[name] || paths.file
  return el('svg', {
    className, viewBox: '0 0 24 24', width: size, height: size, fill: 'none',
    stroke: 'currentColor', strokeWidth: '2', strokeLinecap: 'round', strokeLinejoin: 'round',
    'aria-hidden': 'true',
  }, d.map((p, i) => el('path', { key: i, d: p })))
}

/* ============================ 状态灯 ============================ */

export function Light({ pid, label }) {
  const s = stateOf(pid)
  const src = stateSource(pid)
  const hint = src === 'bound' ? '（跟随绑定对话）' : (src === 'manual' ? '（手工设置）' : '')
  return el('button', {
    type: 'button',
    className: 'light ' + s,
    title: (label || STATES[s].label) + hint + ' · 点击切换',
    'aria-label': '状态：' + STATES[s].label,
    onClick: (e) => { e.stopPropagation(); cycleStatus(pid) },
  })
}

/* ============================ 分栏拖拽 ============================ */

/**
 * 竖向分割条：拖动改变相邻窗格宽度。
 * side='left' 时向右拖变宽；side='right' 时向左拖变宽（对话栏在右侧）。
 */
export function Splitter({ pid, side, width, min = 160, max = 900, onResize }) {
  const drag = useRef(null)

  const down = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = width
    drag.current = { startX, startW }
    const move = (ev) => {
      if (!drag.current) return
      const delta = side === 'left' ? ev.clientX - drag.current.startX : drag.current.startX - ev.clientX
      const next = Math.max(min, Math.min(max, drag.current.startW + delta))
      onResize(next, false)
    }
    const up = () => {
      const inst = drag.current
      drag.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (inst) onResize(null, true)
      document.body.classList.remove('wt-dragging')
    }
    document.body.classList.add('wt-dragging')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return el('div', {
    className: 'split-handle',
    role: 'separator',
    'aria-orientation': 'vertical',
    title: '拖动调整宽度（双击复位）',
    onPointerDown: down,
    onDoubleClick: () => onResize(0, true),
  }, el('i', null))
}

/* ============================ toast ============================ */

export function Toasts() {
  useStore()
  if (!store.toasts.length) return null
  return el('div', { className: 'toasts' },
    store.toasts.map((t) => el('div', { key: t.id, className: 'toast ' + (t.kind || '') }, t.text)),
  )
}

/* ============================ 右击菜单 ============================ */

export function ContextMenu() {
  useStore()
  const menu = store.menu

  useEffect(() => {
    if (!menu) return undefined
    const onDown = (e) => {
      const t = e && e.target
      if (t && typeof t.closest === 'function' && t.closest('.ctx-menu')) return
      closeMenu()
    }
    document.addEventListener('mousedown', onDown, true)
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [menu])

  if (!menu) return null
  const project = store.projects.find((p) => p.id === menu.pid)
  if (!project) return null

  const win = typeof window !== 'undefined' ? window : { innerWidth: 1200, innerHeight: 800 }
  const x = Math.max(8, Math.min(menu.x, win.innerWidth - 250))
  const y = Math.max(8, Math.min(menu.y, win.innerHeight - 360))
  const ui = uiOf(menu.pid)
  const bound = Array.isArray(project.sessions) ? project.sessions.length : 0

  const node = el('div', {
    className: 'ctx-menu',
    role: 'menu',
    style: { left: x + 'px', top: y + 'px' },
    onClick: (e) => e.stopPropagation(),
    onContextMenu: (e) => e.preventDefault(),
  },
    el('div', { className: 'ctx-head', title: project.path }, project.alias || project.name),
    el('div', { className: 'ctx-label' }, '工作区模式'),
    MODES.map((m) => el('button', {
      key: m.id,
      type: 'button',
      className: 'ctx-item' + (m.id === ui.mode ? ' on' : ''),
      onClick: () => setMode(menu.pid, m.id),
    },
      el('span', { className: 'ctx-name' }, m.icon + ' ' + m.label),
      el('small', null, m.hint),
      m.id === ui.mode ? el('b', { className: 'ctx-check' }, '✓') : null,
    )),
    el('div', { className: 'ctx-sep' }),
    el('button', { type: 'button', className: 'ctx-item', onClick: () => openModal('edit', menu.pid) }, '编辑项目信息'),
    el('button', {
      type: 'button', className: 'ctx-item',
      onClick: () => openModal('bind', menu.pid),
    },
      el('span', { className: 'ctx-name' }, '绑定对话'),
      el('small', null, bound ? bound + ' 个' : '未绑定'),
    ),
    el('div', { className: 'ctx-sep' }),
    el('button', {
      type: 'button', className: 'ctx-item danger',
      onClick: () => {
        const ask = typeof window !== 'undefined' && typeof window.confirm === 'function'
        if (ask && !window.confirm('从工作台移除「' + (project.alias || project.name) + '」？磁盘文件不会动。')) return
        removeProject(menu.pid)
      },
    }, '删除项目'),
  )

  return node
}

/* ============================ 弹窗外壳 ============================ */

export function Modal({ title, subtitle, wide, children, foot }) {
  return el('div', {
    className: 'scrim',
    onClick: (e) => { if (e.target === e.currentTarget) closeModal() },
  },
    el('div', { className: 'modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' },
      el('h3', null, title),
      subtitle ? el('p', null, subtitle) : null,
      children,
      foot ? el('div', { className: 'modal-foot' }, foot) : null,
    ),
  )
}

/* ============================ 模式草图 ============================ */

/** 两种模式共用「左栏 / 中间 / 对话」三格，只有中间那一格的形态不同 */
export function ModeSketch({ mode }) {
  return el('span', { className: 'sketch', 'data-mode': mode, 'aria-hidden': 'true' },
    el('i', { 'data-part': 'left' }),
    el('i', { 'data-part': 'main' }, mode === 'float' ? el('b', { className: 'sk-win' }) : null),
    el('i', { 'data-part': 'chat' }),
  )
}
