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
const MIN_CHAT = 380
/** 首次进入项目时，工作台占中间轨道的大致比例（偏大，工作区才够用） */
const AUTO_RATIO = 0.64
/** 再窄就不像工作台了 */
const MIN_DOCK = 420

const host = { layer: null, frame: null, center: null, saved: '', ready: false }
let applied = 0
let geo = { ready: false, left: 0, top: 0, width: 0, height: 0, track: 0, max: 0 }

/**
 * 纯函数：算出工作台该占多宽。
 * preferred <= 0 表示「自动」，按轨道的 AUTO_RATIO 取，并给对话留够 MIN_CHAT。
 */
export function computeDock({ track, preferred }) {
  const t = Math.max(0, Math.round(Number(track) || 0))
  if (!t) return { width: 0, max: 0 }
  const max = Math.max(0, t - MIN_CHAT)
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
    geo = {
      ready: true,
      left,
      top,
      track,
      height: Math.max(0, Math.round(f.height - top)),
      width: applied,
      max: Math.max(0, track - MIN_CHAT),
    }
  } catch {
    geo = { ...geo, ready: false }
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

    if (!attachHost(rootRef && rootRef.current)) {
      /* 宿主改版导致锚点找不到：不硬挤，降级成整块覆盖（功能不受影响，只是看不到对话） */
      last.current.ready = false
      setSnap({ ...geo, ready: false, width: 0 })
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

    return () => {
      if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('resize', onWin)
      if (ro) ro.disconnect()
      releaseDock()
      last.current.ready = false
    }
  }, [active, preferred, rootRef])

  return snap
}
