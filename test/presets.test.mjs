import assert from "node:assert/strict";
import {
  DEFAULT_PRESET_ID,
  PRESET_DEFS,
  mainRowCount,
  paneSlots,
  presetById
} from "../out/shared/presets.mjs";

let passed = 0;

function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok  ${name}`);
}

const REGION_ORDER = { left: 0, top: 1, main: 2 };

console.log("presets");

test("预设表非空且 id 唯一", () => {
  assert.ok(PRESET_DEFS.length >= 4, `expected >= 4 presets, got ${PRESET_DEFS.length}`);
  const ids = PRESET_DEFS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "预设 id 必须唯一");
});

test("默认预设存在", () => {
  assert.ok(PRESET_DEFS.some((p) => p.id === DEFAULT_PRESET_ID));
});

test("窗口总数等于 contentCount", () => {
  for (const preset of PRESET_DEFS) {
    assert.equal(paneSlots(preset).length, preset.contentCount, preset.id);
  }
});

test("主行数量非负", () => {
  for (const preset of PRESET_DEFS) {
    assert.ok(mainRowCount(preset) >= 0, `${preset.id} 主行数量为负`);
  }
});

test("窗口编号从 1 连续递增", () => {
  for (const preset of PRESET_DEFS) {
    paneSlots(preset).forEach((slot, index) => {
      assert.equal(slot.windowNo, index + 1, `${preset.id} 第 ${index} 个窗口编号错位`);
    });
  }
});

test("区域顺序恒为 左栏 → 顶行 → 主行", () => {
  for (const preset of PRESET_DEFS) {
    const regions = paneSlots(preset).map((s) => s.region);
    for (let i = 1; i < regions.length; i++) {
      assert.ok(
        REGION_ORDER[regions[i - 1]] <= REGION_ORDER[regions[i]],
        `${preset.id} 区域顺序错乱：${regions.join(",")}`
      );
    }
  }
});

test("田字格语义：顶行 2 + 主行 2", () => {
  const g4 = presetById("g4");
  assert.equal(g4.topCount, 2);
  assert.equal(mainRowCount(g4), 2);
});

test("顶部大窗语义：顶行 1 + 主行 3", () => {
  const l13 = presetById("l13");
  assert.equal(l13.topCount, 1);
  assert.equal(mainRowCount(l13), 3);
});

test("未知 id 回落到首个预设", () => {
  assert.equal(presetById("does-not-exist").id, PRESET_DEFS[0].id);
});

console.log(`presets: ${passed} passed`);
