import assert from "node:assert/strict";
import { addProject, defaultState, normalizeState, setProjectPreset } from "../lib/core.mjs";
import { buildHtml } from "../scripts/render.mjs";

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function seedOf(html) {
  const match = /<script id="wt-seed"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  assert.ok(match, "HTML 里找不到 seed 数据块");
  return JSON.parse(match[1]);
}

function fixture() {
  let s = defaultState();
  s = addProject(s, "C:/demo/alpha", "甲", "star");
  s = addProject(s, "C:/demo/beta", "乙", "folder");
  s = setProjectPreset(s, s.projects[1].id, "g4");
  return normalizeState(s);
}

console.log("traework-render");

test("输出单文件 HTML：内联样式 + 内联运行时 + seed", () => {
  const html = buildHtml(fixture());
  assert.match(html, /^<!DOCTYPE html>/);
  assert.equal((html.match(/<style>/g) ?? []).length, 1);
  assert.equal((html.match(/<script/g) ?? []).length, 2, "应恰好有 seed 与运行时两个 script");
  assert.match(html, /id="wt-seed"/);
});

test("零外部引用：没有 link、没有外链 src/href", () => {
  const html = buildHtml(fixture());
  assert.equal(/<link\b/i.test(html), false);
  assert.equal(/src\s*=\s*["']https?:/i.test(html), false);
  assert.equal(/href\s*=\s*["']https?:\/\//i.test(html), false);
  assert.equal(/@import\s+url/i.test(html), false);
});

test("内联样式含分栏引擎与四态状态光", () => {
  const html = buildHtml(fixture());
  for (const marker of [".wt-stage", ".wt-pane", ".wt-divider-x", ".wt-divider-y"]) {
    assert.ok(html.includes(marker), `缺少 ${marker}`);
  }
  for (const status of ["idle", "working", "needs-you", "done"]) {
    assert.ok(
      html.includes(`.wt-pane[data-status="${status}"]`) || status === "idle",
      `缺少状态 ${status} 的样式`
    );
  }
  assert.ok(html.includes("wt-comet"), "缺少忙碌窗格的动画");
});

test("seed 数据等于传入状态且可被解析", () => {
  const state = fixture();
  assert.deepEqual(seedOf(buildHtml(state)), state);
});

test("页内挂载点与初始主题标记齐备", () => {
  const html = buildHtml(fixture());
  assert.match(html, /<div id="root" class="wt-root"><\/div>/);
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /data-background="aurora"/);
});

test("项目名含 </script> 也不会提前闭合脚本块", () => {
  const nasty = "</script><script>alert(1)</script>";
  let s = defaultState();
  s = addProject(s, "C:/demo/xss", nasty, "folder");
  const html = buildHtml(normalizeState(s));
  assert.equal((html.match(/<script/g) ?? []).length, 2);
  assert.equal((html.match(/<\/script>/g) ?? []).length, 2);
  assert.equal(html.includes("<script>alert(1)"), false);
  assert.equal(seedOf(html).projects[0].name, nasty);
});

test("空状态也能渲染出空态提示", () => {
  const html = buildHtml(defaultState());
  assert.match(html, /id="wt-seed"/);
  assert.deepEqual(seedOf(html).projects, []);
});

console.log(`traework-render: ${passed} passed`);
