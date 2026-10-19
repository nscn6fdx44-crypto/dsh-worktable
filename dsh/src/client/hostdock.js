/**
 * 宿主让位（host dock）：工作台不自己画对话，而是把 **DSH 自己的会话区** 往右挤，
 * 左边腾出来的那块地方交给工作台。这就是上游「点项目出现小窗、对话框移到右边」的机制。
 *
 * 锚点用结构定位，不认宿主的类名哈希，也不依赖 [data-phase] 这类内部标记：
 *
 *   frame（宿主 shell 的网格容器）
 *     ├─ sidebarCol
 *     ├─ centerCol      ← 会话区就在这一列的 main 座位里，给它的 margin-left 让位
 *     ├─ rightbarCol
 *     └─ overlayLayer   ← 我们的 root 挂在这里（absolute inset:0）
 *
 * 副作用全部可逆：进项目时记下 centerCol 原本的 marginLeft，退出/卸载时原样写回。
 */
import { useLayoutEffect, useRef, useState } from 'react'

/** 右边至少留这么多给对话，否则输入框会挤成一条 */
const MIN_CHAT = 220
/** 首次进入项目时，工作台占中间轨道的大致比例（偏大，工作区才够用） */
const AUTO_RATIO = 0.95
/** 再窄就不像工作台了 */
const MIN_DOCK = 560

const host = { layer: null, frame: null, center: null, saved: '', ready: false }
let applied = 0
let geo = { ready: false, left: 0, top: 0, width: 0, height: 0, track: 0, max: 0 }

/** 最近一次实际让位后的主区尺寸：主题小窗的取景框要跟它同比例 */
let lastSize = { width: 0, height: 0 }

/** 最近一次「算出来的宽度 > 0」的几何：宿主重排 / 预览面板抢走空间时用它顶住，避免铺满整窗 */
let lastGood = { ready: true, left: 0, top: 0, width: 0, height: 0, track: 0, max: 0 }

/**
 * 纯函数：这次测出来的几何能不能用。
 * 规则：能算出宽度就用新的；算不出但以前有过宽度 → 沿用旧的并标记 stale（绝不铺满整窗）。
 */
export function pickDock(prev, next) {
  const p = prev || { width: 0 }
  const n = next || { width: 0 }
  if (n.ready && n.width > 0) return { ...n, stale: false }
  if (p.width > 0) return { ...p, ready: true, stale: true }
  return { ...n, ready: false, stale: false }
}

/**
 * 主区宽高比（取景框按它来，所见即所得）。
 * 还没让位过就按窗口比例 × 0.8 估算；实在拿不到退回 1.6。
 */
export function dockAspect() {
  if (lastSize.width > 0 && lastSize.height > 0) return lastSize.width / lastSize.height
  const w = (typeof window !== 'undefined' && window.innerWidth) || 0
  const h = (typeof window !== 'undefined' && window.innerHeight) || 0
  if (w > 0 && h > 0) {
    /* 用同一套 computeDock 估算：中间轨道 ≈ 窗口宽 - 宿主侧边栏（280），高度就是窗口高 */
    const track = Math.max(0, w - 280)
    const est = computeDock({ track, preferred: 0 }).width || Math.round(track * AUTO_RATIO)
    if (est > 0 && h > 0) return Math.max(0.5, Math.min(3.2, est / h))
  }
  return 1.6
}

/**
 * 纯函数：算出工作台该占多宽。
 * preferred <= 0 表示「自动」，按轨道的 AUTO_RATIO 取，并给对话留够 MIN_CHAT。
 */
export function computeDock({ track, preferred }) {
  const t = Math.max(0, Math.round(Number(track) || 0))
  if (!t) return { width: 0, max: 0 }
  const max = Math.max(0, t - MIN_CHAT)
  /* 轨道窄到连最小工作台都放不下时干脆不让位（返回 0） */
  if (max < 320) return { width: 0, max }
  const want = Number(preferred) > 0 ? Math.round(Number(preferred)) : Math.round(t * AUTO_RATIO)
  const lo = Math.min(MIN_DOCK, max)
  return { width: Math.max(lo, Math.min(want, max)), max }
}

function px(value) {
  const n = parseFloat(String(value || ''))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 宿主给标题栏预留的 padding-top（Windows 自绘标题栏时非 0），让位区域从它下面开始 */
function topInset(frame) {
  try {
    if (typeof getComputedStyle !== 'function') return 0
    return Math.round(px(getComputedStyle(frame).paddingTop))
  } catch {
    return 0
  }
}

function measure() {
  if (!host.ready) return geo
  try {
    const f = host.frame.getBoundingClientRect()
    const c = host.center.getBoundingClientRect()
    /* center 的 rect 含我们施加的 margin，减掉才是网格轨道起点（= 侧边栏右边界） */
    const left = Math.max(0, Math.round(c.left - f.left) - applied)
    const track = Math.round(c.width) + applied
    /* 侧边栏收起时，宿主把「展开侧边栏」按钮浮在左上角；别盖住它 */
    let top = topInset(host.frame)
    const seat = host.frame.querySelector('[data-shell-leading]')
    if (seat) {
      const sr = seat.getBoundingClientRect()
      if (sr.height > 0 && sr.left < left + applied + 8 && sr.bottom > top) top = Math.round(sr.bottom - f.top + 6)
    }
    const measured = {
      ready: true,
      left,
      top,
      track,
      height: Math.max(0, Math.round(f.height - top)),
      width: applied,
      max: Math.max(0, track - MIN_CHAT),
    }
    geo = pickDock(lastGood, measured)
    if (geo.width > 0 && geo.height > 0) {
      lastSize = { width: geo.width, height: geo.height }
      if (!geo.stale) lastGood = { ...geo }
    }
  } catch {
    geo = pickDock(lastGood, { ready: false, width: 0 })
  }
  return geo
}

/**
 * 绑定宿主节点。root 是工作台最外层 DOM（挂载在 shell.overlay 座位里）。
 * 往上找「含有 centerCol 的祖先」当 frame —— 座位渲染器若多包一层 div 也不受影响。
 * 返回 false 表示宿主结构不认识 —— 调用方应降级为「不挤对话、自己铺满」。
 */
export function attachHost(root) {
  if (!root || typeof root !== 'object') return false
  let node = root
  let frame = null
  for (let i = 0; i < 6 && node; i += 1) {
    const parent = node.parentElement
    if (!parent || typeof parent.querySelector !== 'function') break
    if (parent.querySelector('[class*="centerCol"]')) { frame = parent; break }
    node = parent
  }
  if (!frame) return false
  const center = frame.querySelector('[class*="centerCol"]')
  if (!center || !center.style) return false
  if (host.center !== center) {
    host.layer = root.parentElement
    host.frame = frame
    host.center = center
    /* 宿主自己不会给这一列写 inline margin；形如 "742px" 的只可能是上次实例留下的，
       插件热重载没来得及还原时会遇到，直接视为「本来就该是空」 */
    const prev = center.style.marginLeft || ''
    host.saved = /^\d+px$/.test(prev.trim()) ? '' : prev
    applied = 0
  }
  host.ready = true
  return true
}

/** 施加让位宽度：把会话区右推 width 像素 */
export function applyDock(width) {
  if (!host.ready || !host.center) return geo
  const w = Math.max(0, Math.round(Number(width) || 0))
  if (w !== applied) {
    applied = w
    try { host.center.style.marginLeft = w ? w + 'px' : host.saved } catch { /* 只读样式 */ }
  }
  return measure()
}

/** 撤销让位：会话区回到原位 */
export function releaseDock() {
  if (host.ready && host.center && host.center.style) {
    try { host.center.style.marginLeft = host.saved } catch { /* 已卸载 */ }
  }
  applied = 0
  geo = { ...geo, ready: false, width: 0 }
  lastGood = { ready: true, left: 0, top: 0, width: 0, height: 0, track: 0, max: 0 }
}

/**
 * 纯函数：没锚上宿主对话区时，工作台该占多大。
 * 绝不能是 inset:0（会盖住侧边栏和对话）——退成「按比例占左半，留出右边」。
 */
export function undockedBox(vw, vh) {
  const w = Math.max(320, Math.round((Number(vw) || 1280) * 0.66))
  const h = Math.max(240, Math.round(Number(vh) || 800))
  return { left: 0, top: 0, width: Math.min(w, 1180), height: h }
}

/** 让 UI 手动重测（宿主布局变了之后） */
export function remeasure() {
  if (!host.ready) return geo
  try {
    if (host.center && host.center.style) host.center.style.marginLeft = applied ? applied + 'px' : host.saved
  } catch { /* 只读 */ }
  return measure()
}

/**
 * React 侧的让位钩子。
 * @param rootRef 工作台最外层节点
 * @param active  是否处于「项目工作区」（只有这时才挤对话）
 * @param preferred 期望宽度 px；<=0 表示自动
 */
export function useHostDock(rootRef, active, preferred) {
  const [snap, setSnap] = useState(geo)
  const last = useRef({ width: -1, left: -1, top: -1, height: -1, ready: null })

  useLayoutEffect(() => {
    if (!active) {
      if (last.current.ready) {
        releaseDock()
        last.current = { width: -1, left: -1, top: -1, height: -1, ready: false }
        setSnap({ ...geo })
      }
      return undefined
    }

    const update = () => {
      const base = measure()
      const { width } = computeDock({ track: base.track, preferred })
      const next = applyDock(width)
      const prev = last.current
      last.current = { width: next.width, left: next.left, top: next.top, height: next.height, ready: next.ready }
      if (prev.width !== next.width || prev.left !== next.left || prev.top !== next.top || prev.height !== next.height) {
        setSnap({ ...next })
      }
    }

    if (!attachHost(rootRef && rootRef.current)) {
      /* 锚点暂时找不到（宿主开预览 / 换面板 / 侧边栏动画中）：
         1) 有过几何就沿用上次区域，绝不铺满整窗；
         2) 同时后台重试几轮，宿主结构恢复了就自动贴回去。 */
      const fallback = pickDock(lastGood, { ready: false, width: 0 })
      last.current = { width: fallback.width, left: fallback.left, top: fallback.top, height: fallback.height, ready: fallback.ready }
      setSnap({ ...fallback })
      let tries = 0
      let timer = 0
      const retry = () => {
        tries += 1
        if (attachHost(rootRef && rootRef.current)) {
          update()
          return
        }
        if (tries < 8) timer = window.setTimeout(retry, 300)
      }
      timer = window.setTimeout(retry, 300)
      return () => { if (timer) window.clearTimeout(timer) }
    }

    update()

    const onWin = () => update()
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('resize', onWin)

    /* 侧边栏拖动改的是网格轨道，frame 尺寸不变、center 宽度会变 */
    const RO = typeof ResizeObserver === 'function' ? ResizeObserver : null
    const ro = RO ? new RO(() => update()) : null
    if (ro) {
      ro.observe(host.frame)
      ro.observe(host.center)
    }

    /* 宿主重排（开文件预览 / 换面板 / 侧边栏收起）会换掉或隐藏 centerCol：
       只靠 resize 观察不到，这里盯 DOM 变化，节流后重新锚定 + 重测 */
    let mo = null
    let moTimer = 0
    try {
      if (typeof MutationObserver === 'function') {
        mo = new MutationObserver(() => {
          if (moTimer) return
          moTimer = window.setTimeout(() => {
            moTimer = 0
            if (!host.frame || !host.frame.isConnected) {
              /* frame 整个被换掉：重新找锚点 */
              attachHost(rootRef && rootRef.current)
            } else if (host.center && !host.center.isConnected) {
              attachHost(rootRef && rootRef.current)
            }
            update()
          }, 120)
        })
        mo.observe(host.frame, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
      }
    } catch { /* 老环境 */ }

    return () => {
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', onWin)
      if (ro) ro.disconnect()
      if (mo) mo.disconnect()
      if (moTimer && typeof window !== 'undefined') window.clearTimeout(moTimer)
      releaseDock()
      last.current.ready = false
    }
  }, [active, preferred, rootRef])

  return snap
}
