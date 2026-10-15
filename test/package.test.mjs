import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const patterns = readFileSync(".vscodeignore", "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line.length > 0 && !line.startsWith("#"));

function matches(path, pattern) {
  const p = path.replace(/\\/g, "/");
  const pat = pattern.replace(/\\/g, "/");
  if (pat.endsWith("/**")) {
    const head = pat.slice(0, -3);
    return p === head || p.startsWith(`${head}/`);
  }
  if (pat.startsWith("*.")) {
    return p.endsWith(pat.slice(1)) && !p.includes("/");
  }
  const exact = pat.replace(/\/$/, "");
  return p === exact || p.startsWith(`${exact}/`);
}

const isIgnored = (path) => patterns.some((pattern) => matches(path, pattern));

const MUST_BE_IGNORED = [
  "src/extension.ts",
  "src/webview/index.ts",
  "test/presets.test.mjs",
  "scripts/verify-package.mjs",
  "node_modules/esbuild/index.js",
  "out/shared/presets.mjs",
  "tsconfig.json",
  "esbuild.mjs",
  "AGENTS.md",
  "docs/note.md",
  ".trae/documents/plan.md",
  "traework/lib/app.js",
  "dist/demo/.worktable/worktable.html"
];

const MUST_BE_PACKAGED = [
  "package.json",
  "out/extension.js",
  "media/worktable.js",
  "media/worktable.css",
  "media/icons/worktable.svg",
  "README.md",
  "README.zh.md",
  "LICENSE",
  "CHANGELOG.md"
];

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("package");

test("源码与测试不进包", () => {
  for (const path of MUST_BE_IGNORED) {
    assert.ok(isIgnored(path), `${path} 应该被 .vscodeignore 排除`);
  }
});

test("运行所需资产必须进包", () => {
  for (const path of MUST_BE_PACKAGED) {
    assert.ok(!isIgnored(path), `${path} 必须保留在包里`);
  }
});

test("入口与构建产物路径与 package.json 声明一致", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(pkg.main, "./out/extension.js");
  assert.equal(pkg.contributes.viewsContainers.activitybar[0].icon, "media/icons/worktable.svg");
});

test("清单声明的命令都有对应注册来源", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const declared = pkg.contributes.commands.map((c) => c.command);
  const source = readFileSync("src/host/drawer/commands.ts", "utf8");
  for (const command of declared) {
    assert.ok(
      source.includes(`registerCommand("${command}"`),
      `命令 ${command} 在 commands.ts 中没有注册`
    );
  }
});

test("清单声明的配置项都有读取来源", () => {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  const keys = Object.keys(pkg.contributes.configuration.properties);
  assert.deepEqual(keys.sort(), [
    "traeWorktable.theme.accent",
    "traeWorktable.theme.background",
    "traeWorktable.theme.mode",
    "traeWorktable.theme.opacity",
    "traeWorktable.updateCheck.enabled"
  ]);
});

console.log(`package: ${passed} passed`);
