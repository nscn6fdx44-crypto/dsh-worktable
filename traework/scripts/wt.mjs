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
          [--status ${core.STATUS_ORDER.join("|")}] [--duration <文本>] [--desc <文本>]
  meta    (--id <id> | --name <名>) [--status <状态>] [--duration <文本>] [--desc <文本>]
  slot    (--id <id> | --name <名>) [--preset <预设>] --window <序号>
          [--kind ${core.PANE_KIND_ORDER.join("|")}] [--title <标题>]
          [--content <文本> | --content-file <路径>] [--status <状态>]
  rename  (--id <id> | --name <名>) --to <新名>
  icon    (--id <id> | --name <名>) --icon <图标>
  move    (--id <id> | --name <名>) (--up | --down)
  hide    (--id <id> | --name <名>)
  show    (--id <id> | --name <名>)
  remove  (--id <id> | --name <名>)
  active  (--id <id> | --name <名> | --none)
  preset  (--id <id> | --name <名>) --preset <${core.presetIds().join(" | ")}>
  theme   [--mode system|dark|light] [--accent #rrggbb] [--opacity 0.3-1] [--background aurora|coast|grid|none]
  render  [--out <html 路径>]
  serve   [--port <端口>] [--host <地址>]   启动本地服务（仓库 / 网页模块需要它常驻）

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

/** 从命令行取项目级字段补丁；只有显式给了文本参数才进补丁。 */
function projectMetaPatchFromFlags(flags) {
  const patch = {};
  if (typeof flags.status === "string") patch.status = flags.status;
  if (typeof flags.duration === "string") patch.duration = flags.duration;
  if (typeof flags.desc === "string") patch.description = flags.desc;
  return patch;
}

/** 校验项目级补丁；有问题直接失败，绝不写盘。 */
function assertProjectMeta(patch) {
  const issues = core.projectMetaIssues(patch);
  if (issues.length > 0) fail(`项目信息非法，未改动：\n  ${issues.join("\n  ")}`);
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
        status: p.status,
        duration: p.duration,
        description: p.description,
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

async function run() {
  const state = load();

  switch (command) {
    case "list": {
      const s = summary(state);
      const lines = [`数据文件：${s.file}`, `当前项目：${s.activeProjectId ?? "（无）"}`, "项目："];
      if (s.projects.length === 0) lines.push("  （空）");
      for (const p of s.projects) {
        const duration = p.duration ? ` · ${p.duration}` : "";
        lines.push(
          `  ${p.hidden ? "○" : "●"} ${p.name}  [${p.preset} · ${p.status}${duration}]  ${p.folder}  id=${p.id}`
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
      const patch = projectMetaPatchFromFlags(flags);
      assertProjectMeta(patch);
      let next = core.addProject(state, folder, name, icon);
      const created = next.projects[next.projects.length - 1];
      if (Object.keys(patch).length > 0) next = core.setProjectMeta(next, created.id, patch);
      const saved = save(next);
      const stored = saved.projects.find((p) => p.id === created.id);
      emit(stored, `已添加：${created.name}  id=${created.id}`);
      return;
    }

    case "meta": {
      const project = pickProject(state);
      const patch = projectMetaPatchFromFlags(flags);
      if (Object.keys(patch).length === 0) {
        fail("meta 至少需要一个 --status / --duration / --desc");
      }
      assertProjectMeta(patch);
      const saved = save(core.setProjectMeta(state, project.id, patch));
      emit(saved.projects.find((p) => p.id === project.id), `已更新项目信息：${project.name}`);
      return;
    }

    case "slot": {
      const project = pickProject(state);
      const presetId =
        typeof flags.preset === "string" ? flags.preset : core.presetForProject(state, project.id);
      if (!core.presetIds().includes(presetId)) fail(`未知预设：${presetId}`);

      if (flags.window === undefined || flags.window === true) fail("slot 需要 --window <序号>");
      const windowNo = Number(flags.window);
      if (!Number.isInteger(windowNo) || windowNo < 1) {
        fail(`--window 需要是 ≥1 的整数，收到：${String(flags.window)}`);
      }

      const key = core.layoutKey(project.id, presetId);
      const layout = core.ensureLayout(state, project.id, presetId);
      const slotCount = layout.slots.length;
      if (windowNo > slotCount) {
        fail(`--window 越界：${presetId} 只有 ${slotCount} 个窗口（合法范围 1–${slotCount}）`);
      }

      let content;
      if (typeof flags.content === "string") content = flags.content;
      if (typeof flags["content-file"] === "string") {
        const source = resolve(flags["content-file"]);
        if (!existsSync(source)) fail(`--content-file 不存在：${source}`);
        content = readFileSync(source, "utf8");
      }

      const hasPayload =
        typeof flags.kind === "string" ||
        typeof flags.title === "string" ||
        typeof flags.status === "string" ||
        content !== undefined;
      if (!hasPayload) {
        fail("slot 至少需要一个 --kind / --title / --content / --content-file / --status");
      }

      if (typeof flags.kind === "string" && !core.PANE_KIND_ORDER.includes(flags.kind)) {
        fail(`--kind 只接受 ${core.PANE_KIND_ORDER.join(" | ")}，收到：${flags.kind}`);
      }
      if (typeof flags.status === "string") assertProjectMeta({ status: flags.status });

      const slot = layout.slots[windowNo - 1];
      const tab = slot.tabs.find((t) => t.id === slot.activeTabId) ?? slot.tabs[0];
      if (typeof flags.kind === "string") {
        tab.kind = flags.kind;
        tab.title = typeof flags.title === "string" ? flags.title : core.defaultTabTitle(flags.kind);
      } else if (typeof flags.title === "string") {
        tab.title = flags.title;
      }
      if (content !== undefined) tab.content = content;
      if (typeof flags.status === "string") slot.status = flags.status;

      const saved = save({ ...state, layouts: { ...state.layouts, [key]: layout } });
      emit(
        saved.layouts[key].slots[windowNo - 1],
        `已写入 ${project.name} 窗口 ${windowNo}（${presetId}）`
      );
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
      if (flags.none === true) {
        if (typeof flags.id === "string" || typeof flags.name === "string") {
          fail("--none 与 --id / --name 只能给一个");
        }
        const saved = save(core.setActiveProject(state, null));
        emit(summary(saved), "当前项目已清空（回到全部项目视图）");
        return;
      }
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
      // themeFromConfig 会把非法值静默回落成默认值，所以这里必须先按域校验，
      // 否则一个拼错的字段会把用户原有的合法设置悄悄改掉。
      const issues = core.themeIssues(patch);
      if (issues.length > 0) fail(`主题参数非法，未改动：\n  ${issues.join("\n  ")}`);
      const theme = core.themeFromConfig({ ...state.theme, ...patch });
      save({ ...state, theme });
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

    case "serve": {
      const port = flags.port === undefined ? 7331 : Number(flags.port);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        fail(`--port 需要是 0–65535 的整数，收到：${String(flags.port)}`);
      }
      const host = typeof flags.host === "string" ? flags.host : "127.0.0.1";
      const { startServer } = await import("./serve.mjs");
      const started = await startServer({ filePath, port, host });
      console.log(`工作台已就绪：${started.url}`);
      console.log(`数据文件：${filePath}`);
      console.log("仓库 / 网页模块靠这个进程提供读写与反代；Ctrl+C 结束。");
      return;
    }

    default:
      fail(`未知命令：${command}\n\n${USAGE}`);
  }
}

await run();
