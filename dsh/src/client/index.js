/**
 * trae-usage-worktable · client 侧 Cordis 插件（P0 骨架）
 *
 * 由 DSH 浏览器运行时经 ModuleLoader 握手加载（见 build.mjs 的 banner/footer）。
 * 宿主以普通 require 提供 react / @deepseek-ai/* —— 保持 external，不打包。
 *
 * 注入结构对齐上游 dsh-worktable v0.4.0（01_content/src/client/index.tsx）：
 *   sidebar.footer.action —— 侧边栏底部「工作台」区块，children 声明项目子座位
 *   （P1 起项目行注册进 sidebar.worktable.project；P2 起 shell.overlay 挂分栏工作区）
 */
import { createElement, useState, useEffect } from 'react'

/** 座位 id：与 package.json 的插件名一致（host 按此名serve /plugins/<id>/client.js） */
const PANEL_ID = 'trae-usage-worktable'
const NS = 'worktable'

export const inject = ['slots']

export function apply(ctx) {
  // 样式注入：随插件销毁自动移除（data-dsh-plugin 标记便于调试）
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute('data-dsh-plugin', PANEL_ID)
    style.textContent = CSS
    document.head.appendChild(style)
    return () => { style.remove() }
  }, 'trae-usage-worktable: styles')

  // 侧边栏「工作台」区块（footer.action 座位 + 项目子座位声明）
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: PANEL_ID,
    order: 20,
    children: {
      'sidebar.worktable.project': { kind: 'list', scope: 'root' },
    },
  }, WorktableSection), 'trae-usage-worktable: worktable section')
}

/** 侧边栏区块组件。宿主经 props 注入：wide（宽/窄栏）、renderSlot（渲染子座位）、t（locale） */
function WorktableSection(props) {
  const wide = props.wide !== false
  const renderProjectSlot = typeof props.renderSlot === 'function' ? props.renderSlot : null
  const t = (key, params) => {
    if (typeof props.t === 'function') {
      try { return props.t(key, params) } catch { /* 回退本地词典 */ }
    }
    let s = zh[key] ?? key
    if (params) for (const [k, v] of Object.entries(params)) s = s.replace('{' + k + '}', v)
    return s
  }

  const [health, setHealth] = useState(null)
  useEffect(() => {
    let alive = true
    fetch('/api/worktable/health')
      .then((r) => r.json())
      .then((j) => { if (alive) setHealth(j) })
      .catch(() => {})
    return () => { alive = false }
  }, [])

  return createElement('div', { className: 'wt-section', 'data-ns': NS, 'data-wide': wide ? '1' : '0' },
    createElement('div', { className: 'wt-head' },
      createElement('span', { className: 'wt-title' }, t('title')),
      createElement('span', { className: 'wt-badge', title: 'P0 骨架' }, 'P0'),
    ),
    createElement('div', { className: 'wt-body' },
      renderProjectSlot ? renderProjectSlot() : null,
      createElement('div', { className: 'wt-empty' },
        createElement('p', null, 'P0 骨架：client 半侧已加载，host 健康路由已注册。'),
        createElement('p', { className: 'wt-mute' }, 'P1 起这里会出现项目抽屉（增删 / 改名 / 排序）。'),
        health
          ? createElement('pre', { className: 'wt-health' }, JSON.stringify(health, null, 2))
          : createElement('p', { className: 'wt-mute' }, 'host 健康检查中…'),
      ),
    ),
  )
}

/* 本地词典：宿主 locale 服务缺席时兜底（P1 接入 ctx.locale.register） */
const zh = { title: '工作台' }

/* P0 极简样式：只用继承色，不假设宿主 CSS 变量 */
const CSS = [
  '.wt-section{border-top:1px solid color-mix(in srgb,currentColor 12%,transparent);padding:8px 10px 10px;font:inherit;color:inherit}',
  '.wt-head{display:flex;align-items:center;gap:8px;padding:2px 2px 8px}',
  '.wt-title{font-size:12px;font-weight:600;letter-spacing:.06em;opacity:.85}',
  '.wt-badge{font-size:10px;line-height:1;padding:3px 6px;border-radius:99px;border:1px solid color-mix(in srgb,currentColor 25%,transparent);opacity:.7}',
  '.wt-body{display:flex;flex-direction:column;gap:6px}',
  '.wt-empty{margin:0;font-size:12px;line-height:1.6}',
  '.wt-empty p{margin:0 0 4px}',
  '.wt-mute{opacity:.55;font-size:11px}',
  '.wt-health{margin:4px 0 0;padding:8px;font-size:10.5px;line-height:1.5;border-radius:8px;background:color-mix(in srgb,currentColor 6%,transparent);overflow-x:auto;white-space:pre-wrap;word-break:break-all}',
].join('\n')
