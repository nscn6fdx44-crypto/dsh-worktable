import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TRAEWORK = resolve(HERE, "..");
const CLI = join(TRAEWORK, "scripts", "wt.mjs");

const dir = mkdtempSync(join(tmpdir(), "wt-cli-"));
const file = join(dir, "worktable.json");

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args, "--file", file], { encoding: "utf8" });
}

function wt(...args) {
  const result = run(args);
  assert.equal(result.status, 0, `期望成功，实际退出码 ${result.status}：${result.stderr}`);
  return result.stdout;
}

function wtFail(...args) {
  const result = run(args);
  assert.notEqual(result.status, 0, `期望失败，实际成功了：${result.stdout}`);
  return result.stderr;
}

function read() {
  return JSON.parse(readFileSync(file, "utf8"));
}

console.log("traework-cli");

test("数据文件不存在时 list 返回空状态", () => {
  const out = wt("list", "--json");
  const payload = JSON.parse(out);
  assert.deepEqual(payload.projects, []);
  assert.equal(payload.activeProjectId, null);
});

test("add 追加项目并把首个项目设为当前", () => {
  wt("add", "--folder", "C:/demo/alpha", "--name", "甲");
  wt("add", "--folder", "C:/demo/beta", "--name", "乙");
  const s = read();
  assert.equal(s.projects.length, 2);
  assert.deepEqual(s.projects.map((p) => p.name), ["甲", "乙"]);
  assert.equal(s.activeProjectId, s.projects[0].id);
});

test("add 缺 --folder 时失败", () => {
  wtFail("add", "--name", "无目录");
});

test("rename 用 --name 选中并改名", () => {
  wt("rename", "--name", "乙", "--to", "乙改");
  assert.deepEqual(read().projects.map((p) => p.name), ["甲", "乙改"]);
});

test("rename 空名不生效并失败", () => {
  wtFail("rename", "--name", "甲", "--to", "   ");
  assert.equal(read().projects[0].name, "甲");
});

test("icon 可替换", () => {
  wt("icon", "--name", "甲", "--icon", "star");
  assert.equal(read().projects[0].icon, "star");
});

test("move 在边界处失败且不越界", () => {
  const before = read().projects.map((p) => p.name);
  wtFail("move", "--name", "甲", "--up");
  assert.deepEqual(read().projects.map((p) => p.name), before);
  wt("move", "--name", "甲", "--down");
  assert.deepEqual(read().projects.map((p) => p.name), ["乙改", "甲"]);
});

test("hide 活动项目后当前项切给下一个可见项目", () => {
  const active = read().activeProjectId;
  wt("hide", "--id", active);
  const s = read();
  assert.equal(s.projects.find((p) => p.id === active).hidden, true);
  assert.notEqual(s.activeProjectId, active);
});

test("show 可恢复隐藏项目", () => {
  wt("show", "--name", "乙改");
  assert.equal(read().projects.find((p) => p.name === "乙改").hidden, false);
});

test("active 指向隐藏项目时失败", () => {
  wt("hide", "--name", "乙改");
  wtFail("active", "--name", "乙改");
  wt("show", "--name", "乙改");
});

test("preset 合法值写入、非法值失败", () => {
  wt("preset", "--name", "甲", "--preset", "g4");
  const s = read();
  assert.equal(s.presetByProject[s.projects.find((p) => p.name === "甲").id], "g4");
  wtFail("preset", "--name", "甲", "--preset", "不存在");
});

test("theme 合法值写入、非法值失败且未改动", () => {
  wt("theme", "--accent", "#22c55e", "--background", "coast", "--opacity", "0.7");
  const t = read().theme;
  assert.equal(t.accent, "#22c55e");
  assert.equal(t.background, "coast");
  assert.equal(t.opacity, 0.7);
  wtFail("theme", "--opacity", "abc");
  wtFail("theme", "--mode", "紫色");
  assert.deepEqual(read().theme, t);
});

test("theme 非法值不会把合法值静默覆盖成默认值", () => {
  wt("theme", "--background", "coast");
  const before = read().theme;
  assert.equal(before.background, "coast");
  wtFail("theme", "--background", "neon");
  wtFail("theme", "--opacity", "2");
  wtFail("theme", "--opacity", "0.1");
  wtFail("theme", "--accent", "绿色");
  assert.deepEqual(read().theme, before, "非法值不得改动文件");
});

test("theme 无参数时失败", () => {
  wtFail("theme");
});

test("remove 清理布局与预设记录", () => {
  const s0 = read();
  const target = s0.projects.find((p) => p.name === "甲");
  assert.ok(Object.keys(s0.layouts).some((k) => k.startsWith(`${target.id}::`)));
  wt("remove", "--name", "甲");
  const s1 = read();
  assert.equal(s1.projects.length, s0.projects.length - 1);
  assert.equal(s1.presetByProject[target.id], undefined);
  assert.ok(!Object.keys(s1.layouts).some((k) => k.startsWith(`${target.id}::`)));
});

test("未知项目 id 失败", () => {
  wtFail("remove", "--id", "proj-不存在");
});

test("既不给 --id 也不给 --name 失败", () => {
  wtFail("remove");
});

test("重名不唯一时要求改用 --id", () => {
  wt("add", "--folder", "C:/demo/dup1", "--name", "重名");
  wt("add", "--folder", "C:/demo/dup2", "--name", "重名");
  const stderr = wtFail("remove", "--name", "重名");
  assert.match(stderr, /不唯一/);
});

test("损坏的 JSON 文件直接报错且不覆盖原文件", () => {
  const broken = join(dir, "broken.json");
  writeFileSync(broken, "{ 这不是 JSON", "utf8");
  const result = spawnSync(process.execPath, [CLI, "list", "--file", broken], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /不是合法 JSON/);
  assert.equal(readFileSync(broken, "utf8"), "{ 这不是 JSON");
});

test("垃圾字段被归一化而不是原样写回", () => {
  const messy = join(dir, "messy.json");
  writeFileSync(
    messy,
    JSON.stringify({ projects: [{ folder: "C:/x", order: 5 }, { nope: 1 }], theme: { mode: "紫色" } }),
    "utf8"
  );
  const result = spawnSync(process.execPath, [CLI, "list", "--file", messy, "--json"], {
    encoding: "utf8"
  });
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.projects.length, 1);
  assert.equal(payload.projects[0].name, "C:/x");
  assert.equal(payload.theme.mode, "system");
});

// ---------- 项目级字段 / slot：用独立数据文件，避免与上面的共享状态互相污染 ----------

const metaFile = join(dir, "meta.json");

function runMeta(args) {
  return spawnSync(process.execPath, [CLI, ...args, "--file", metaFile], { encoding: "utf8" });
}

function wtMeta(...args) {
  const result = runMeta(args);
  assert.equal(result.status, 0, `期望成功，实际退出码 ${result.status}：${result.stderr}`);
  return result.stdout;
}

function wtMetaFail(...args) {
  const result = runMeta(args);
  assert.notEqual(result.status, 0, `期望失败，实际成功了：${result.stdout}`);
  return result.stderr;
}

function readMeta() {
  return JSON.parse(readFileSync(metaFile, "utf8"));
}

function rawMeta() {
  return readFileSync(metaFile, "utf8");
}

function activeTabOf(projectName, windowNo) {
  const s = readMeta();
  const id = s.projects.find((p) => p.name === projectName).id;
  const key = Object.keys(s.layouts).find((k) => k.startsWith(`${id}::`));
  const slot = s.layouts[key].slots[windowNo - 1];
  return slot.tabs.find((t) => t.id === slot.activeTabId) ?? slot.tabs[0];
}

test("add 可同时写入项目级字段", () => {
  wtMeta(
    "add",
    "--folder",
    "C:/demo/alpha",
    "--name",
    "甲",
    "--status",
    "working",
    "--duration",
    "2h",
    "--desc",
    "演示项目"
  );
  const s = readMeta();
  assert.equal(s.projects.length, 1);
  assert.equal(s.projects[0].status, "working");
  assert.equal(s.projects[0].duration, "2h");
  assert.equal(s.projects[0].description, "演示项目");
});

test("add 非法 status 失败且不改动文件", () => {
  const before = rawMeta();
  const stderr = wtMetaFail("add", "--folder", "C:/demo/bad", "--name", "坏", "--status", "紫色");
  assert.match(stderr, /status/);
  assert.equal(rawMeta(), before, "非法项目信息不得落盘");
});

test("meta 可设置字段，且只改传入字段", () => {
  wtMeta("add", "--folder", "C:/demo/beta", "--name", "乙");
  wtMeta("meta", "--name", "乙", "--status", "done", "--duration", "3天", "--desc", "第二个");
  let p = readMeta().projects.find((x) => x.name === "乙");
  assert.equal(p.status, "done");
  assert.equal(p.duration, "3天");
  assert.equal(p.description, "第二个");

  wtMeta("meta", "--name", "乙", "--status", "idle");
  p = readMeta().projects.find((x) => x.name === "乙");
  assert.equal(p.status, "idle");
  assert.equal(p.duration, "3天", "未传字段必须保持原值");
  assert.equal(p.description, "第二个");
});

test("meta 无载荷失败、非法值失败且不改动文件", () => {
  wtMetaFail("meta", "--name", "乙");
  const before = rawMeta();
  const stderr = wtMetaFail("meta", "--name", "乙", "--status", "紫色");
  assert.match(stderr, /status/);
  assert.equal(rawMeta(), before, "非法项目信息不得落盘");
});

test("active --none 清空当前项目", () => {
  assert.ok(readMeta().activeProjectId, "前置：应存在当前项目");
  wtMeta("active", "--none");
  assert.equal(readMeta().activeProjectId, null);
});

test("active --none 与 --id/--name 互斥", () => {
  const stderr = wtMetaFail("active", "--none", "--name", "甲");
  assert.match(stderr, /只能给一个/);
});

test("slot 写入窗格内容、类型与状态", () => {
  wtMeta("slot", "--name", "甲", "--window", "1", "--kind", "todo", "--content", "[ ] 甲\n[x] 乙", "--status", "working");
  const s = readMeta();
  const id = s.projects.find((p) => p.name === "甲").id;
  const key = Object.keys(s.layouts).find((k) => k.startsWith(`${id}::`));
  const slot = s.layouts[key].slots[0];
  assert.equal(slot.status, "working");
  const tab = slot.tabs.find((t) => t.id === slot.activeTabId);
  assert.equal(tab.kind, "todo");
  assert.equal(tab.content, "[ ] 甲\n[x] 乙");
  assert.equal(tab.title, "待办", "kind 变更时标题取该类型的默认名");
});

test("slot --window 越界或非法失败", () => {
  const before = rawMeta();
  assert.match(wtMetaFail("slot", "--name", "甲", "--window", "99", "--content", "x"), /越界/);
  wtMetaFail("slot", "--name", "甲", "--window", "0", "--content", "x");
  wtMetaFail("slot", "--name", "甲", "--window", "1.5", "--content", "x");
  assert.equal(rawMeta(), before, "越界写入不得落盘");
});

test("slot 缺 --window 或缺载荷失败", () => {
  wtMetaFail("slot", "--name", "甲", "--content", "x");
  wtMetaFail("slot", "--name", "甲", "--window", "1");
  wtMetaFail("slot", "--name", "甲", "--window", "1", "--kind", "紫色");
});

test("slot --content-file 读入文件，文件不存在则失败", () => {
  const noteFile = join(dir, "note.md");
  writeFileSync(noteFile, "# 标题\n正文", "utf8");
  wtMeta("slot", "--name", "甲", "--window", "2", "--kind", "note", "--content-file", noteFile);
  const tab = activeTabOf("甲", 2);
  assert.equal(tab.kind, "note");
  assert.equal(tab.content, "# 标题\n正文");

  const before = rawMeta();
  assert.match(
    wtMetaFail("slot", "--name", "甲", "--window", "2", "--content-file", join(dir, "nope.md")),
    /不存在/
  );
  assert.equal(rawMeta(), before);
});

test("slot 指定 --preset 时写进该预设的布局", () => {
  wtMeta("slot", "--name", "甲", "--preset", "g4", "--window", "3", "--content", "第三格");
  const s = readMeta();
  const id = s.projects.find((p) => p.name === "甲").id;
  const layout = s.layouts[`${id}::g4`];
  assert.ok(layout, "g4 布局应被建立");
  assert.equal(layout.slots[2].tabs.find((t) => t.id === layout.slots[2].activeTabId).content, "第三格");
});

test("list --json 带出项目级字段与清空后的当前项目", () => {
  const payload = JSON.parse(wtMeta("list", "--json"));
  const jia = payload.projects.find((p) => p.name === "甲");
  assert.equal(jia.status, "working");
  assert.equal(jia.duration, "2h");
  assert.equal(jia.description, "演示项目");
  assert.equal(payload.activeProjectId, null);
});

console.log(`traework-cli: ${passed} passed`);
