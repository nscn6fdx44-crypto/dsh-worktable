import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";

const shared = {
  bundle: true,
  sourcemap: false,
  minify: false,
  target: "es2022",
  logLevel: "info"
};

await rm("out", { recursive: true, force: true });
await rm("media/worktable.js", { force: true });
await rm("media/worktable.css", { force: true });
await rm("traework/lib", { recursive: true, force: true });

await mkdir("out/shared", { recursive: true });
await mkdir("media", { recursive: true });

// 扩展宿主侧：Node / CommonJS，vscode 由宿主提供
await build({
  ...shared,
  entryPoints: ["src/extension.ts"],
  outfile: "out/extension.js",
  platform: "node",
  format: "cjs",
  external: ["vscode"]
});

// Webview 侧：浏览器 / IIFE
await build({
  ...shared,
  entryPoints: ["src/webview/index.ts"],
  outfile: "media/worktable.js",
  platform: "browser",
  format: "iife"
});

// 纯逻辑模块：供离线回归测试直接 import
await build({
  ...shared,
  entryPoints: ["src/shared/presets.ts"],
  outfile: "out/shared/presets.mjs",
  platform: "node",
  format: "esm"
});

await build({
  ...shared,
  entryPoints: ["src/shared/state-core.ts"],
  outfile: "out/shared/state-core.mjs",
  platform: "node",
  format: "esm"
});

// TraeWork 版：纯逻辑核心（ESM），供 traework 的 CLI 与测试直接 import
await mkdir("traework/lib", { recursive: true });
await build({
  ...shared,
  entryPoints: ["src/shared/state-core.ts"],
  outfile: "traework/lib/core.mjs",
  platform: "node",
  format: "esm"
});

// TraeWork 版：浏览器运行时（IIFE），由 render.mjs 内联进单文件 HTML
await build({
  ...shared,
  minify: true,
  entryPoints: ["traework/src/main.ts"],
  outfile: "traework/lib/app.js",
  platform: "browser",
  format: "iife"
});

// 样式单一来源：源码在 src/webview/styles.css，构建时复制到两处消费方
await copyFile("src/webview/styles.css", "media/worktable.css");
await copyFile("src/webview/styles.css", "traework/lib/styles.css");
