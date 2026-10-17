/**
 * trae-usage-worktable · host 侧 Cordis 插件（P0 骨架）
 *
 * 运行在 DSH 宿主进程内，有完整 Node 权限（fs / child_process / 进程环境）。
 * 当前仅注册健康路由，证明 host 半侧加载成功；后续 P2 起在此挂
 * 文件浏览 / 终端 WebSocket / git 状态等路由（沿用 serve.mjs 的安全边界设计）。
 *
 * 注册链路：package.json(dsh.bundle.patch) -> cordis.patch.yml(insert)
 *   -> 本文件被 Cordis 加载 -> apply(ctx) 内 webServer.register(...)
 */
export const name = 'trae-usage-worktable'
export const inject = ['webServer']

/** 构建期由 esbuild define 注入；未构建时兜底 dev */
const PLUGIN_VERSION = typeof __WT_VERSION__ === 'undefined' ? 'dev' : __WT_VERSION__

export const HEALTH_PATH = '/api/worktable/health'

export function apply(ctx) {
  const webServer = ctx.webServer
  if (!webServer) {
    // headless profile（无 web 服务）时静默降级，不影响宿主其他插件
    ctx.logger?.warn?.('[worktable] ctx.webServer 不可用，跳过服务端路由注册')
    return
  }

  webServer.register({
    kind: 'exact',
    path: HEALTH_PATH,
    handler: (_req, res) => {
      json(res, 200, {
        plugin: 'trae-usage-worktable',
        version: PLUGIN_VERSION,
        ok: true,
        node: process.version,
        platform: process.platform,
      })
    },
  })

  ctx.logger?.info?.('[worktable] host 插件已加载，health: ' + HEALTH_PATH)
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}
