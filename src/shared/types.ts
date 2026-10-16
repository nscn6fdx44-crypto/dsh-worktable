export type ThemeMode = "system" | "dark" | "light";

export type BackgroundId = "aurora" | "coast" | "grid" | "none";

/**
 * 窗格标签页类型。前四种是与项目无关的通用文本容器；
 * repo / web 是「模块」：`content` 分别承载相对项目根的路径与目标 URL，
 * 需要本地服务（`wt.mjs serve`）提供文件读写与网页反代，静态单文件形态下自动降级为提示。
 */
export type PaneKind = "note" | "todo" | "link" | "placeholder" | "repo" | "web";

export type PaneStatus = "idle" | "working" | "needs-you" | "done";

/** 项目级状态复用窗格四态，卡片与窗格共用同一套状态光与色板。 */
export type ProjectStatus = PaneStatus;

export interface Project {
  id: string;
  name: string;
  icon: string;
  folder: string;
  hidden: boolean;
  order: number;
  status: ProjectStatus;
  duration: string;
  description: string;
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
