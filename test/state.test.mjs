import assert from "node:assert/strict";
import {
  addProject,
  defaultState,
  ensureLayout,
  hiddenProjects,
  layoutKey,
  moveProject,
  normalizeState,
  presetForProject,
  projectMetaIssues,
  projectStats,
  removeProject,
  renameProject,
  setActiveProject,
  setProjectHidden,
  setProjectIcon,
  setProjectMeta,
  setProjectPreset,
  themeFromConfig,
  visibleProjects
} from "../out/shared/state-core.mjs";
import { DEFAULT_PRESET_ID, presetById } from "../out/shared/presets.mjs";

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

console.log("state-core");

test("默认状态形状正确", () => {
  const s = defaultState();
  assert.equal(s.version, 1);
  assert.deepEqual(s.projects, []);
  assert.equal(s.activeProjectId, null);
  assert.deepEqual(s.presetByProject, {});
  assert.deepEqual(s.layouts, {});
  assert.equal(s.theme.mode, "system");
});

test("添加项目后自动成为活动项目", () => {
  const s = addProject(defaultState(), "C:/a", "A", "folder");
  assert.equal(s.projects.length, 1);
  assert.equal(s.projects[0].name, "A");
  assert.equal(s.projects[0].order, 0);
  assert.equal(s.activeProjectId, s.projects[0].id);
});

test("重命名会裁剪空白，空名不生效", () => {
  let s = addProject(defaultState(), "C:/a", "A", "folder");
  const id = s.projects[0].id;
  s = renameProject(s, id, "  B  ");
  assert.equal(s.projects[0].name, "B");
  const same = renameProject(s, id, "   ");
  assert.equal(same, s, "空名应返回原状态对象");
});

test("图标可替换", () => {
  let s = addProject(defaultState(), "C:/a", "A", "folder");
  s = setProjectIcon(s, s.projects[0].id, "rocket");
  assert.equal(s.projects[0].icon, "rocket");
});

test("上移下移在边界处不越界", () => {
  let s = defaultState();
  s = addProject(s, "C:/a", "A", "folder");
  s = addProject(s, "C:/b", "B", "folder");
  s = addProject(s, "C:/c", "C", "folder");
  const first = s.projects.find((p) => p.name === "A").id;
  const moved = moveProject(s, first, -1);
  assert.equal(moved, s, "首位上移应返回原状态对象");
  s = moveProject(s, first, 1);
  assert.deepEqual(
    visibleProjects(s).map((p) => p.name),
    ["B", "A", "C"]
  );
  assert.deepEqual(
    s.projects.map((p) => p.order),
    [0, 1, 2],
    "排序号必须重排为连续整数"
  );
});

test("隐藏活动项目会把活动项切给下一个可见项目", () => {
  let s = defaultState();
  s = addProject(s, "C:/a", "A", "folder");
  s = addProject(s, "C:/b", "B", "folder");
  const a = s.projects.find((p) => p.name === "A").id;
  s = setProjectHidden(s, a, true);
  assert.deepEqual(visibleProjects(s).map((p) => p.name), ["B"]);
  assert.deepEqual(hiddenProjects(s).map((p) => p.name), ["A"]);
  assert.equal(s.activeProjectId, s.projects.find((p) => p.name === "B").id);
});

test("移除项目会同时清理布局与预设记录", () => {
  let s = defaultState();
  s = addProject(s, "C:/a", "A", "folder");
  const id = s.projects[0].id;
  s = setProjectPreset(s, id, "g4");
  const key = layoutKey(id, "g4");
  s = { ...s, layouts: { ...s.layouts, [key]: ensureLayout(s, id, "g4") } };
  assert.ok(s.layouts[key]);
  assert.equal(s.presetByProject[id], "g4");

  s = removeProject(s, id);
  assert.equal(s.projects.length, 0);
  assert.equal(s.layouts[key], undefined);
  assert.equal(s.presetByProject[id], undefined);
  assert.equal(s.activeProjectId, null);
});

test("ensureLayout 的槽位数等于预设窗口数", () => {
  const s = addProject(defaultState(), "C:/a", "A", "folder");
  const id = s.projects[0].id;
  for (const presetId of ["full", "l2", "g4", "l13"]) {
    const layout = ensureLayout(s, id, presetId);
    assert.equal(layout.slots.length, presetById(presetId).contentCount, presetId);
    assert.equal(layout.presetId, presetId);
  }
});

test("未知预设的默认值回落", () => {
  const s = addProject(defaultState(), "C:/a", "A", "folder");
  assert.equal(presetForProject(s, s.projects[0].id), DEFAULT_PRESET_ID);
  assert.equal(setProjectPreset(s, s.projects[0].id, "nope"), s, "非法预设应返回原状态对象");
});

test("normalizeState 对垃圾输入回落默认值", () => {
  assert.deepEqual(normalizeState(undefined), defaultState());
  assert.deepEqual(normalizeState("nope"), defaultState());
  assert.deepEqual(normalizeState(42), defaultState());
});

test("normalizeState 丢弃非法项目并重排 order", () => {
  const raw = {
    projects: [
      { folder: "C:/b", name: "B", order: 5 },
      { name: "缺目录" },
      "垃圾",
      { folder: "C:/a", name: "A", order: 1 }
    ]
  };
  const s = normalizeState(raw);
  assert.deepEqual(s.projects.map((p) => p.name), ["A", "B"]);
  assert.deepEqual(s.projects.map((p) => p.order), [0, 1]);
  assert.equal(s.activeProjectId, s.projects[0].id);
});

test("normalizeState 过滤指向已删项目的布局与预设", () => {
  const raw = {
    projects: [{ id: "p1", folder: "C:/a", name: "A", order: 0 }],
    presetByProject: { p1: "g4", ghost: "l2" },
    layouts: {
      "p1::g4": { presetId: "g4", slots: [] },
      "ghost::l2": { presetId: "l2", slots: [] }
    }
  };
  const s = normalizeState(raw);
  assert.equal(s.presetByProject.p1, "g4");
  assert.equal(s.presetByProject.ghost, undefined);
  assert.ok(s.layouts["p1::g4"]);
  assert.equal(s.layouts["ghost::l2"], undefined);
  assert.equal(s.layouts["p1::g4"].slots.length, presetById("g4").contentCount);
});

test("normalizeState 补齐缺失槽位并修正活动标签页", () => {
  const raw = {
    projects: [{ id: "p1", folder: "C:/a", name: "A", order: 0 }],
    layouts: {
      "p1::g4": {
        presetId: "g4",
        slots: [{ tabs: [{ id: "t1", title: "笔记", kind: "note", content: "" }], activeTabId: "ghost", status: "working" }]
      }
    }
  };
  const s = normalizeState(raw);
  const layout = s.layouts["p1::g4"];
  assert.equal(layout.slots.length, presetById("g4").contentCount);
  assert.equal(layout.slots[0].activeTabId, "t1");
  assert.equal(layout.slots[0].status, "working");
  assert.equal(layout.slots[1].tabs.length, 1, "空槽位应自动补一个标签页");
});

test("主题非法值回落默认", () => {
  const theme = themeFromConfig({ mode: "purple", accent: "red", opacity: 9, background: "vapor" });
  assert.equal(theme.mode, "system");
  assert.equal(theme.accent, "#4f9cf9");
  assert.equal(theme.opacity, 0.86);
  assert.equal(theme.background, "aurora");
});

test("主题合法值保留", () => {
  const theme = themeFromConfig({ mode: "light", accent: "#abc", opacity: 0.5, background: "coast" });
  assert.equal(theme.mode, "light");
  assert.equal(theme.accent, "#abc");
  assert.equal(theme.opacity, 0.5);
  assert.equal(theme.background, "coast");
});

test("新增项目带项目级字段默认值", () => {
  const s = addProject(defaultState(), "C:/a", "A", "folder");
  assert.equal(s.projects[0].status, "idle");
  assert.equal(s.projects[0].duration, "");
  assert.equal(s.projects[0].description, "");
});

test("normalizeProject 回落非法 status 并保留合法文本字段", () => {
  const s = normalizeState({
    projects: [
      { folder: "C:/a", name: "A", status: "紫色", duration: 5, description: "  项目简介  " }
    ]
  });
  assert.equal(s.projects[0].status, "idle");
  assert.equal(s.projects[0].duration, "", "非文本 duration 应回落空串");
  assert.equal(s.projects[0].description, "  项目简介  ", "合法文本原样保留");
});

test("显式 activeProjectId: null 被保留（退出到卡片视图可持久化）", () => {
  const raw = { projects: [{ id: "p1", folder: "C:/a", name: "A", order: 0 }], activeProjectId: null };
  const s = normalizeState(raw);
  assert.equal(s.activeProjectId, null);
});

test("缺失 activeProjectId 时仍自动选中首个可见项目", () => {
  const raw = { projects: [{ id: "p1", folder: "C:/a", name: "A", order: 0 }] };
  const s = normalizeState(raw);
  assert.equal(s.activeProjectId, "p1");
});

test("setActiveProject 可清空当前项目", () => {
  let s = addProject(defaultState(), "C:/a", "A", "folder");
  assert.equal(s.activeProjectId, s.projects[0].id);
  s = setActiveProject(s, null);
  assert.equal(s.activeProjectId, null);
});

test("非空状态里新增项目不会强行抢走当前项目", () => {
  let s = addProject(defaultState(), "C:/a", "A", "folder");
  const first = s.projects[0].id;
  s = setActiveProject(s, null);
  s = addProject(s, "C:/b", "B", "folder");
  assert.equal(s.activeProjectId, null, "停在卡片视图时新增不应被拽走");
  assert.equal(s.projects.length, 2);
  s = setActiveProject(s, first);
  s = addProject(s, "C:/c", "C", "folder");
  assert.equal(s.activeProjectId, first, "已有当前项目时新增不改动它");
});

test("setProjectMeta 只改传入字段，未传字段不动", () => {
  let s = addProject(defaultState(), "C:/a", "A", "folder");
  const id = s.projects[0].id;
  s = setProjectMeta(s, id, { status: "working", duration: "2h", description: "演示" });
  assert.equal(s.projects[0].status, "working");
  assert.equal(s.projects[0].duration, "2h");
  assert.equal(s.projects[0].description, "演示");

  s = setProjectMeta(s, id, { status: "done" });
  assert.equal(s.projects[0].status, "done");
  assert.equal(s.projects[0].duration, "2h", "未传字段必须保持原值");
  assert.equal(s.projects[0].description, "演示");
});

test("setProjectMeta 空 patch 或未知项目返回原状态对象", () => {
  const s = addProject(defaultState(), "C:/a", "A", "folder");
  assert.equal(setProjectMeta(s, s.projects[0].id, {}), s);
  assert.equal(setProjectMeta(s, s.projects[0].id, { status: "idle" }), s, "同值不应产生新对象");
  assert.equal(setProjectMeta(s, "proj-不存在", { status: "done" }), s);
});

test("projectMetaIssues 按域校验", () => {
  assert.deepEqual(projectMetaIssues({}), []);
  assert.deepEqual(projectMetaIssues({ status: "working", duration: "2h", description: "x" }), []);
  assert.equal(projectMetaIssues({ status: "紫色" }).length, 1);
  assert.equal(projectMetaIssues({ duration: 5 }).length, 1);
  assert.equal(projectMetaIssues({ description: null }).length, 1);
});

test("projectStats 无布局时全记空闲，分母等于预设窗口数", () => {
  const s = addProject(defaultState(), "C:/a", "A", "folder");
  const stats = projectStats(s, s.projects[0].id);
  assert.equal(stats.total, presetById(DEFAULT_PRESET_ID).contentCount);
  assert.equal(stats.idle, stats.total);
  assert.equal(stats.working, 0);
  assert.equal(stats.needsYou, 0);
  assert.equal(stats.done, 0);
});

test("projectStats 按槽位状态计数", () => {
  let s = addProject(defaultState(), "C:/a", "A", "folder");
  const id = s.projects[0].id;
  s = setProjectPreset(s, id, "g4");
  const layout = ensureLayout(s, id, "g4");
  layout.slots[0].status = "working";
  layout.slots[1].status = "needs-you";
  layout.slots[2].status = "done";
  s = { ...s, layouts: { ...s.layouts, [layoutKey(id, "g4")]: layout } };

  const stats = projectStats(s, id);
  assert.equal(stats.total, 4);
  assert.equal(stats.working, 1);
  assert.equal(stats.needsYou, 1);
  assert.equal(stats.done, 1);
  assert.equal(stats.idle, 1);
});

console.log(`state-core: ${passed} passed`);
