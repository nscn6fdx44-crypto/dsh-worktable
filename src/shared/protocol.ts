import type { LayoutState, Project, ThemeState, WorktableState } from "./types";

export type HostToWebview =
  | { type: "state"; state: WorktableState }
  | { type: "themeKind"; kind: "dark" | "light" };

export type WebviewToHost =
  | { type: "ready" }
  | { type: "setLayouts"; layouts: Record<string, LayoutState> }
  | { type: "addProject" }
  | { type: "setActiveProject"; projectId: string | null }
  | {
      type: "setProjectMeta";
      projectId: string;
      patch: Partial<Pick<Project, "status" | "duration" | "description">>;
    }
  | { type: "setPreset"; projectId: string; presetId: string }
  | { type: "setThemeConfig"; theme: Partial<ThemeState> }
  | { type: "openExternal"; url: string };
