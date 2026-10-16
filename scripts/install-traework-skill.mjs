#!/usr/bin/env node
// 把 TraeWork 工作台安装成「项目技能」：<项目>/.trae/skills/traework-worktable/
// 目录约定见 https://docs.trae.cn/ide_skills —— 项目技能必须在 .trae/skills/ 下才会被扫描到。
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const SOURCE = join(REPO, "traework");
const SKILL_NAME = "traework-worktable";
// 技能目录自持：这三样就够跑，不再回头依赖仓库根的 src/。
const PARTS = ["SKILL.md", "scripts", "lib"];

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      i++;
    } else {
      flags[body] = true;
    }
  }
  return flags;
}

const flags = parseArgs(process.argv.slice(2));
const project = resolve(typeof flags.project === "string" ? flags.project : REPO);
const target = join(project, ".trae", "skills", SKILL_NAME);

for (const part of PARTS) {
  const from = join(SOURCE, part);
  if (!existsSync(from)) {
    console.error(`缺少 ${from}；lib/ 是构建产物，请先在仓库根目录运行 npm run build`);
    process.exit(1);
  }
}

mkdirSync(target, { recursive: true });
for (const part of PARTS) {
  cpSync(join(SOURCE, part), join(target, part), { recursive: true });
}

console.log(`已安装 TraeWork 工作台技能：${target}`);
console.log(`数据文件默认落点：${join(project, ".worktable", "worktable.json")}`);
console.log(`注意：.trae/ 在本仓库被 .gitignore 忽略，装好的技能不会进版本库。`);
