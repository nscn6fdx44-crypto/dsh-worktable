#!/usr/bin/env node
// 工作台数据层 CLI：以 .worktable/worktable.json 为单一事实来源。
// 纯 Node、零依赖；核心逻辑复用 src/shared/state-core.ts 的构建产物，不另起一套。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import * as core from "../lib/core.mjs";
import { buildHtml } from "./render.mjs";

const USAGE = `工作台数据层

用法：node traework/scripts/wt.mjs <命令> [选项]

命令：
  list                              列出项目、当前预设与主题
  add     --folder <路径> [--name <名>] [--icon <图标>]
  rename  (--id <id> | --name <名>) --to <新名>
  icon    (--id <id> | --name <名>) --icon <图标>
  move    (--id <id> | --name <名>) (--up | --down)
  hide    (--id <id> | --name <名>)
  show    (--id <id> | --name <名>)
  remove  (--id <id> | --name <名>)
  active  (--id <id> | --name <名>)
  preset  (--id <id> | --name <名>) --preset <${core.presetIds().join(" | ")}>
  theme   [--mode system|dark|light] [--accent #rrggbb] [--opacity 0.3-1] [--background aurora|coast|grid|none]
  render  [--out <html 路径>]

通用选项：
  --file <路径>   数据文件，默认 <当前目录>/.worktable/worktable.json
  --json          以 JSON 输出结果`;

function fail(message) {
  console.error(`wt: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }
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
  return { flags, positional };
}

const { flags, positional } = parseArgs(process.argv.slice(2));
const command = positional[0];

if (!command || flags.help === true) {
  console.log(USAGE);
  process.exit(command ? 0 : 1);
}

const filePath = resolve(
  typeof flags.file === "string" ? flags.file : join(process.cwd(), ".worktable", "worktable.json")
);

function load() {
  if (!existsSync(filePath)) return core.defaultState();
  const text = readFileSync(filePath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    fail(`${filePath} 不是合法 JSON（${error.message}）；已停止，未改动文件`);
  }
  return core.normalizeState(parsed);
}

/** 让数据文件始终是完整状态：每个项目在其预设下都有对应布局。 */
function materialize(state) {
  const layouts = { ...state.layouts };
  for (const project of state.projects) {
    const presetId = core.presetForProject(state, project.id);
    layouts[core.layoutKey(project.id, presetId)] = core.ensureLayout(state, project.id, presetId);
  }
  return { ...state, layouts };
}

function save(state) {
  const next = materialize(state);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function pickProject(state) {
  const id = typeof flags.id === "string" ? flags.id : null;
  const name = typeof flags.name === "string" ? flags.name : null;
  if (id && name) fail("--id 与 --name 只能给一个");
  if (id) {
    const found = state.projects.find((p) => p.id === id);
    if (!found) fail(`找不到项目 id=${id}`);
    return found;
  }
  if (name) {
    const needle = name.toLowerCase();
    const matches = state.projects.filter((p) => p.name.toLowerCase() === needle);
    if (matches.length === 0) fail(`找不到项目 name=${name}`);
    if (matches.length > 1) {
      fail(`项目名 ${name} 不唯一，请改用 --id：${matches.map((p) => p.id).join(", ")}`);
    }
    return matches[0];
  }
  fail("需要用 --id 或 --name 指定项目");
}

function summary(state) {
  return {
    file: filePath,
    activeProjectId: state.activeProjectId,
    projects: state.projects
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        folder: p.folder,
        hidden: p.hidden,
        order: p.order,
        preset: core.presetForProject(state, p.id)
      })),
    theme: state.theme
  };
}

function emit(payload, text) {
  if (flags.json === true) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(text);
  }
}

function run() {
  const state = load();

  switch (command) {
    case "list": {
      const s = summary(state);
      const lines = [`数据文件：${s.file}`, `当前项目：${s.activeProjectId ?? "（无）"}`, "项目："];
      if (s.projects.length === 0) lines.push("  （空）");
      for (const p of s.projects) {
        lines.push(
          `  ${p.hidden ? "○" : "●"} ${p.name}  [${p.preset}]  ${p.folder}  id=${p.id}`
        );
      }
      lines.push(`主题：${s.theme.mode} / ${s.theme.background} / ${s.theme.accent} / ${s.theme.opacity}`);
      emit(s, lines.join("\n"));
      return;
    }

    case "add": {
      if (typeof flags.folder !== "string" || !flags.folder.trim()) fail("add 需要 --folder <路径>");
      const folder = flags.folder.trim();
      const name = typeof flags.name === "string" ? flags.name.trim() : "";
      const icon = typeof flags.icon === "string" ? flags.icon.trim() : "";
      const saved = save(core.addProject(state, folder, name, icon));
      const created = saved.projects[saved.projects.length - 1];
      emit(created, `已添加：${created.name}  id=${created.id}`);
      return;
    }

    case "rename": {
      if (typeof flags.to !== "string" || !flags.to.trim()) fail("rename 需要 --to <新名>");
      const project = pickProject(state);
      const next = core.renameProject(state, project.id, flags.to);
      if (next === state) fail("新名称为空，未改动");
      const saved = save(next);
      emit(saved.projects.find((p) => p.id === project.id), `已重命名：${project.name} → ${flags.to.trim()}`);
      return;
    }

    case "icon": {
      if (typeof flags.icon !== "string" || !flags.icon.trim()) fail("icon 需要 --icon <图标>");
      const project = pickProject(state);
      const saved = save(core.setProjectIcon(state, project.id, flags.icon.trim()));
      emit(saved.projects.find((p) => p.id === project.id), `已更换图标：${project.name} → ${flags.icon.trim()}`);
      return;
    }

    case "move": {
      const up = flags.up === true;
      const down = flags.down === true;
      if (up === down) fail("move 需要且只需要 --up 或 --down 之一");
      const project = pickProject(state);
      const next = core.moveProject(state, project.id, up ? -1 : 1);
      if (next === state) fail("已在边界，未改动");
      const saved = save(next);
      emit(summary(saved), `已${up ? "上移" : "下移"}：${project.name}`);
      return;
    }

    case "hide":
    case "show": {
      const project = pickProject(state);
      const saved = save(core.setProjectHidden(state, project.id, command === "hide"));
      emit(summary(saved), `已${command === "hide" ? "隐藏" : "取消隐藏"}：${project.name}`);
      return;
    }

    case "remove": {
      const project = pickProject(state);
      const saved = save(core.removeProject(state, project.id));
      emit(summary(saved), `已移除：${project.name}`);
      return;
    }

    case "active": {
      const project = pickProject(state);
      if (project.hidden) fail(`${project.name} 处于隐藏状态，无法设为当前项目`);
      const saved = save(core.setActiveProject(state, project.id));
      emit(summary(saved), `当前项目已设为：${project.name}`);
      return;
    }

    case "preset": {
      if (typeof flags.preset !== "string") fail(`preset 需要 --preset <${core.presetIds().join(" | ")}>`);
      const project = pickProject(state);
      const presetId = flags.preset;
      const next = core.setProjectPreset(state, project.id, presetId);
      if (next === state) fail(`未知预设：${presetId}`);
      const saved = save(next);
      emit(summary(saved), `已设定布局：${project.name} → ${presetId}`);
      return;
    }

    case "theme": {
      const patch = {};
      if (typeof flags.mode === "string") patch.mode = flags.mode;
      if (typeof flags.accent === "string") patch.accent = flags.accent;
      if (typeof flags.background === "string") patch.background = flags.background;
      if (flags.opacity !== undefined) {
        const value = Number(flags.opacity);
        if (!Number.isFinite(value)) fail(`--opacity 不是数字：${flags.opacity}`);
        patch.opacity = value;
      }
      if (Object.keys(patch).length === 0) fail("theme 至少需要一个 --mode / --accent / --opacity / --background");
      const theme = core.themeFromConfig({ ...state.theme, ...patch });
      if (JSON.stringify(theme) === JSON.stringify(state.theme)) {
        fail(`主题参数无效，未改动（当前：${JSON.stringify(state.theme)}）`);
      }
      const next = { ...state, theme };
      save(next);
      emit(theme, `主题已更新：${theme.mode} / ${theme.background} / ${theme.accent} / ${theme.opacity}`);
      return;
    }

    case "render": {
      const outPath = resolve(
        typeof flags.out === "string" ? flags.out : join(dirname(filePath), "worktable.html")
      );
      const html = buildHtml(state);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, html, "utf8");
      emit({ out: outPath, bytes: Buffer.byteLength(html, "utf8") }, `已渲染：${outPath}`);
      return;
    }

    default:
      fail(`未知命令：${command}\n\n${USAGE}`);
  }
}

run();
