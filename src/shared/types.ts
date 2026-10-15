export type ThemeMode = "system" | "dark" | "light";

export type BackgroundId = "aurora" | "coast" | "grid" | "none";

export type PaneKind = "note" | "todo" | "link" | "placeholder";

export type PaneStatus = "idle" | "working" | "needs-you" | "done";

export interface Project {
  id: string;
  name: string;
  icon: string;
  folder: string;
  hidden: boolean;
  order: number;
}

export interface TabState {
  id: string;
  title: string;
  kind: PaneKind;
  content: string;
}

export interface PaneSlotState {
  tabs: TabState[];
  activeTabId: string | null;
  status: PaneStatus;
}

export interface LayoutState {
  presetId: string;
  leftWidth: number;
  topHeight: number;
  chatWidth: number;
  slots: PaneSlotState[];
}

export interface ThemeState {
  mode: ThemeMode;
  accent: string;
  opacity: number;
  background: BackgroundId;
}

export interface WorktableState {
  version: 1;
  projects: Project[];
  activeProjectId: string | null;
  presetByProject: Record<string, string>;
  layouts: Record<string, LayoutState>;
  theme: ThemeState;
}
