import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAEWORK = resolve(HERE, "..");
const REPO = resolve(TRAEWORK, "..");

// lib/ 是提交进仓库的构建产物（TraeWork Skill 需开箱可用，不能要求用户先构建）。
// 本用例把 lib/ 与源码的当前构建结果逐字节比对，防止改了 src/ 却忘了重新构建。
const TARGETS = [
  {
    label: "traework/lib/core.mjs",
    entry: join(REPO, "src", "shared", "state-core.ts"),
    out: join(TRAEWORK, "lib", "core.mjs"),
    options: { platform: "node", format: "esm", minify: false }
  },
  {
    label: "traework/lib/app.js",
    entry: join(TRAEWORK, "src", "main.ts"),
    out: join(TRAEWORK, "lib", "app.js"),
    options: { platform: "browser", format: "iife", minify: true }
  }
];

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("traework-sync");

for (const target of TARGETS) {
  const result = await build({
    bundle: true,
    sourcemap: false,
    target: "es2022",
    logLevel: "silent",
    write: false,
    entryPoints: [target.entry],
    ...target.options
  });
  const fresh = result.outputFiles[0].text;

  test(`${target.label} 与源码构建结果逐字节一致`, () => {
    assert.equal(
      readFileSync(target.out, "utf8"),
      fresh,
      `${target.label} 已过期：请先在仓库根目录运行 npm run build，再把 lib/ 一起提交`
    );
  });
}

console.log(`traework-sync: ${passed} passed`);
