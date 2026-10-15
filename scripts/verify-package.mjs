import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();

const patterns = readFileSync(join(ROOT, ".vscodeignore"), "utf8")
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

// .vscodeignore 与 .git 目录由打包器自动排除，这里同样视为不进包
const ALWAYS_EXCLUDED = new Set([".vscodeignore", ".gitignore"]);

function isIgnored(path) {
  if (ALWAYS_EXCLUDED.has(path)) return true;
  return patterns.some((pattern) => matches(path, pattern));
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      if (rel === ".git" || rel === "node_modules") continue;
      walk(full, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const packaged = walk(ROOT)
  .filter((path) => !isIgnored(path))
  .sort();

console.log(`打包清单（${packaged.length} 个文件）：`);
for (const path of packaged) console.log(`  ${path}`);

const REQUIRED = [
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

// traework/ 是同一仓库里的另一个产物（TraeWork Skill），不属于 TraeCode 扩展的包内容
const FORBIDDEN_PREFIXES = ["src/", "test/", "scripts/", "traework/", "docs/", "node_modules/", "out/shared/"];
const FORBIDDEN_EXACT = ["tsconfig.json", "esbuild.mjs", "AGENTS.md", "esbuild.mjs"];

const missing = REQUIRED.filter((path) => !packaged.includes(path));
const leaked = packaged.filter(
  (path) =>
    FORBIDDEN_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
    FORBIDDEN_EXACT.includes(path)
);

let failed = false;

if (missing.length > 0) {
  console.error(`\n缺少必需文件：${missing.join(", ")}`);
  failed = true;
}

if (leaked.length > 0) {
  console.error(`\n以下文件不应进包：${leaked.join(", ")}`);
  failed = true;
}

if (failed) process.exit(1);

console.log(`\nverify-package: 结构断言通过（${packaged.length} 个文件）`);
