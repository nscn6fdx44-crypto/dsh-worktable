export type PaneRegion = "left" | "top" | "main";

export interface LayoutPreset {
  id: string;
  label: string;
  leftCount: number;
  topCount: number;
  contentCount: number;
  chatFull: boolean;
  topHeightDefault: number;
  topHeightRatio: number;
}

export interface PaneSlotInfo {
  windowNo: number;
  region: PaneRegion;
}

/**
 * 布局预设表。约定（与上游一致）：
 * 1. 新预设只追加到末尾，数组顺序即 UI 中的显示顺序；
 * 2. 字段名保持稳定，不重命名、不删旧字段；
 * 3. 聊天窗恒在最右侧，不参与 contentCount 计数。
 */
export const PRESET_DEFS: LayoutPreset[] = [
  {
    id: "full",
    label: "单窗",
    leftCount: 0,
    topCount: 0,
    contentCount: 1,
    chatFull: true,
    topHeightDefault: 0,
    topHeightRatio: 0.3
  },
  {
    id: "l2",
    label: "左右分栏",
    leftCount: 1,
    topCount: 0,
    contentCount: 2,
    chatFull: true,
    topHeightDefault: 0,
    topHeightRatio: 0.3
  },
  {
    id: "g4",
    label: "田字格",
    leftCount: 0,
    topCount: 2,
    contentCount: 4,
    chatFull: true,
    topHeightDefault: 260,
    topHeightRatio: 0.4
  },
  {
    id: "l13",
    label: "顶部大窗",
    leftCount: 0,
    topCount: 1,
    contentCount: 4,
    chatFull: true,
    topHeightDefault: 340,
    topHeightRatio: 0.45
  }
];

export const DEFAULT_PRESET_ID = "l2";

export function presetById(id: string): LayoutPreset {
  return PRESET_DEFS.find((p) => p.id === id) ?? PRESET_DEFS[0];
}

export function mainRowCount(preset: LayoutPreset): number {
  return preset.contentCount - preset.topCount - preset.leftCount;
}

/** 窗口编号顺序：左栏 → 顶行 → 主行。返回数组下标即窗口序号减一。 */
export function paneSlots(preset: LayoutPreset): PaneSlotInfo[] {
  const out: PaneSlotInfo[] = [];
  let windowNo = 1;
  for (let i = 0; i < preset.leftCount; i++) out.push({ windowNo: windowNo++, region: "left" });
  for (let i = 0; i < preset.topCount; i++) out.push({ windowNo: windowNo++, region: "top" });
  for (let i = 0; i < mainRowCount(preset); i++) out.push({ windowNo: windowNo++, region: "main" });
  return out;
}
