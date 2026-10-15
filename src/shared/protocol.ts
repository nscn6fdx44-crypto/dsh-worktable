import type { LayoutState, ThemeState, WorktableState } from "./types";

export type HostToWebview =
  | { type: "state"; state: WorktableState }
  | { type: "themeKind"; kind: "dark" | "light" };

export type WebviewToHost =
  | { type: "ready" }
  | { type: "setLayouts"; layouts: Record<string, LayoutState> }
  | { type: "setActiveProject"; projectId: string | null }
  | { type: "setPreset"; projectId: string; presetId: string }
  | { type: "setThemeConfig"; theme: Partial<ThemeState> }
  | { type: "openExternal"; url: string };
