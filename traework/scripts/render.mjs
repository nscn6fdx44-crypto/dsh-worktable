#!/usr/bin/env node
// 把 worktable.json 组装成单文件 HTML：样式与运行时全部内联，零外部引用。
// 样式与运行时都取自技能自身的 lib/，因此技能目录可以被复制到任何地方独立运行。
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAEWORK = resolve(HERE, "..");

const APP_JS = join(TRAEWORK, "lib", "app.js");
const STYLES = join(TRAEWORK, "lib", "styles.css");

/** 内联 JSON 时转义 `<` `>` `&`，避免内容提前闭合 script 标签。 */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

function readOrThrow(path, hint) {
  if (!existsSync(path)) throw new Error(`缺少 ${path}；${hint}`);
  return readFileSync(path, "utf8");
}

export function buildHtml(state) {
  const app = readOrThrow(APP_JS, "请先在仓库根目录运行 npm run build").replace(
    /<\/script/gi,
    "<\\/script"
  );
  const css = readOrThrow(STYLES, "请先在仓库根目录运行 npm run build");

  return `<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark" data-background="aurora">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>工作台 · TraeWork</title>
<style>
${css}
</style>
</head>
<body>
<div id="root" class="wt-root"></div>
<script id="wt-seed" type="application/json">${jsonForScript(state)}</script>
<script>
${app}
</script>
</body>
</html>
`;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const { normalizeState, defaultState } = await import("../lib/core.mjs");
  const target = process.argv[2];
  const state = target ? normalizeState(JSON.parse(readFileSync(target, "utf8"))) : defaultState();
  process.stdout.write(buildHtml(state));
}
