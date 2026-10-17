/**
 * trae-usage-worktable 构建：
 *   - lib/index.js    host 侧 ESM（cordis 插件，健康路由）
 *   - lib/client.js   客户端单文件 CJS（window.__ModuleLoader__.load 握手；
 *                     react / @deepseek-ai/* 由宿主模块系统提供，保持 external）
 *
 * 上游 dsh-worktable 同款双 bundle 结构（01_content/build.mjs）。
 * 版本号由 package.json 统一注入（__WT_VERSION__），发版前两处版本号自动一致。
 */
import { build } from 'esbuild'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
mkdirSync(join(here, 'lib'), { recursive: true })

const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const pluginManifest = JSON.parse(readFileSync(join(here, 'dsh.plugin.json'), 'utf8'))
if (pluginManifest.version !== pkg.version) {
  throw new Error(
    'trae-usage-worktable build: package.json version (' + pkg.version +
    ') != dsh.plugin.json version (' + pluginManifest.version + ') — 先统一两处版本号')
}

/* 客户端握手外壳：宿主 require 工厂，CJS 语义（module/exports 由 banner 提供） */
const clientBanner = {
  js: 'window.__ModuleLoader__.load({ id: \'trae-usage-worktable\', factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
}
const clientFooter = { js: 'return module.exports; } });' }

await build({
  entryPoints: [join(here, 'src/index.js')],
  outfile: join(here, 'lib/index.js'),
  bundle: true,
  sourcemap: 'external',
  logLevel: 'info',
  platform: 'node',
  format: 'esm',
  target: ['node22'],
  external: ['@deepseek-ai/*', 'node:*', 'ws', 'node-pty'],
  define: { __WT_VERSION__: JSON.stringify(pkg.version) },
})

await build({
  entryPoints: [join(here, 'src/client/index.js')],
  outfile: join(here, 'lib/client.js'),
  bundle: true,
  sourcemap: 'external',
  logLevel: 'info',
  platform: 'browser',
  format: 'cjs',
  target: ['es2022'],
  external: ['@deepseek-ai/*', 'react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'scheduler'],
  loader: { '.css': 'text' },
  banner: clientBanner,
  footer: clientFooter,
  define: { __WT_VERSION__: JSON.stringify(pkg.version) },
})

console.log('[trae-usage-worktable build] done: lib/index.js, lib/client.js')
