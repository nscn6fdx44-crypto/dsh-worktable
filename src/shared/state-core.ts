import type {
  BackgroundId,
  LayoutState,
  PaneKind,
  PaneSlotState,
  PaneStatus,
  Project,
  TabState,
  ThemeMode,
  ThemeState,
  WorktableState
} from "./types";
import { DEFAULT_PRESET_ID, PRESET_DEFS, paneSlots, presetById } from "./presets";

export const STATE_KEY = "traeWorktable.state.v1";

const THEME_MODES: ThemeMode[] = ["system", "dark", "light"];
const BACKGROUNDS: BackgroundId[] = ["aurora", "coast", "grid", "none"];
const ACCENT_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const OPACITY_MIN = 0.3;
const OPACITY_MAX = 1;
const PANE_KINDS: PaneKind[] = ["note", "todo", "link", "placeholder", "repo", "web"];
const PANE_STATUSES: PaneStatus[] = ["idle", "working", "needs-you", "done"];

/** 四态顺序即「点一下循环」的顺序，窗格与项目卡片共用。 */
export const STATUS_ORDER: PaneStatus[] = [...PANE_STATUSES];

export const STATUS_LABEL: Record<PaneStatus, string> = {
  idle: "空闲",
  working: "进行中",
  "needs-you": "待你处理",
  done: "完成"
};

/** 标签页类型顺序，窗格类型切换条与 CLI 校验共用同一份。 */
export const PANE_KIND_ORDER: PaneKind[] = [...PANE_KINDS];

let seq = 0;

export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function defaultTabTitle(kind: PaneKind): string {
  switch (kind) {
    case "todo":
      return "待办";
    case "link":
      return "链接";
    case "placeholder":
      return "占位";
    case "repo":
      return "仓库";
    case "web":
      return "网页";
    default:
      return "笔记";
  }
}

export function newTab(kind: PaneKind = "note"): TabState {
  return { id: uid("tab"), title: defaultTabTitle(kind), kind, content: "" };
}

export function emptySlot(): PaneSlotState {
  const tab = newTab();
  return { tabs: [tab], activeTabId: tab.id, status: "idle" };
}

export function defaultTheme(): ThemeState {
  return { mode: "system", accent: "#4f9cf9", opacity: 0.86, background: "aurora" };
}

export function defaultState(): WorktableState {
  return {
    version: 1,
    projects: [],
    activeProjectId: null,
    presetByProject: {},
    layouts: {},
    theme: defaultTheme()
  };
}

export function presetForProject(state: WorktableState, projectId: string): string {
  const id = state.presetByProject[projectId];
  return id && PRESET_DEFS.some((p) => p.id === id) ? id : DEFAULT_PRESET_ID;
}

export function setProjectPreset(
  state: WorktableState,
  projectId: string,
  presetId: string
): WorktableState {
  if (!PRESET_DEFS.some((p) => p.id === presetId)) return state;
  return { ...state, presetByProject: { ...state.presetByProject, [projectId]: presetId } };
}

export function layoutKey(projectId: string, presetId: string): string {
  return `${projectId}::${presetId}`;
}

export function ensureLayout(
  state: WorktableState,
  projectId: string,
  presetId: string
): LayoutState {
  const key = layoutKey(projectId, presetId);
  const existing = state.layouts[key];
  const preset = presetById(presetId);
  const slots = paneSlots(preset).map(() => emptySlot());
  if (!existing) {
    return {
      presetId: preset.id,
      leftWidth: 320,
      topHeight: preset.topHeightDefault,
      chatWidth: 420,
      slots
    };
  }
  const merged = slots.map((fallback, i) => existing.slots[i] ?? fallback);
  return { ...existing, presetId: preset.id, slots: merged };
}

export function themeFromConfig(raw: Partial<ThemeState>): ThemeState {
  const d = defaultTheme();
  const accent = typeof raw.accent === "string" && ACCENT_PATTERN.test(raw.accent) ? raw.accent : d.accent;
  const opacity =
    typeof raw.opacity === "number" && raw.opacity >= OPACITY_MIN && raw.opacity <= OPACITY_MAX
      ? raw.opacity
      : d.opacity;
  return {
    mode: THEME_MODES.includes(raw.mode as ThemeMode) ? (raw.mode as ThemeMode) : d.mode,
    accent,
    opacity,
    background: BACKGROUNDS.includes(raw.background as BackgroundId)
      ? (raw.background as BackgroundId)
      : d.background
  };
}

/**
 * 校验主题补丁的每个字段是否落在合法域内，返回人类可读的问题；空数组表示全部合法。
 * themeFromConfig 会把非法值静默回落成默认值，写入方（如 CLI）必须先过这道校验，
 * 否则一个拼错的字段会把用户原有的合法设置悄悄改掉。
 */
export function themeIssues(patch: Partial<ThemeState>): string[] {
  const issues: string[] = [];
  if (patch.mode !== undefined && !THEME_MODES.includes(patch.mode)) {
    issues.push(`mode 只接受 ${THEME_MODES.join(" | ")}，收到：${String(patch.mode)}`);
  }
  if (patch.accent !== undefined && !ACCENT_PATTERN.test(patch.accent)) {
    issues.push(`accent 需要 #rgb 或 #rrggbb，收到：${String(patch.accent)}`);
  }
  if (patch.background !== undefined && !BACKGROUNDS.includes(patch.background)) {
    issues.push(`background 只接受 ${BACKGROUNDS.join(" | ")}，收到：${String(patch.background)}`);
  }
  if (
    patch.opacity !== undefined &&
    !(typeof patch.opacity === "number" && patch.opacity >= OPACITY_MIN && patch.opacity <= OPACITY_MAX)
  ) {
    issues.push(`opacity 需要是 ${OPACITY_MIN}–${OPACITY_MAX} 之间的数字，收到：${String(patch.opacity)}`);
  }
  return issues;
}

function normalizeProject(raw: unknown, index: number): Project | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.folder !== "string" || !o.folder) return null;
  return {
    id: typeof o.id === "string" && o.id ? o.id : uid("proj"),
    name: typeof o.name === "string" && o.name ? o.name : o.folder,
    icon: typeof o.icon === "string" && o.icon ? o.icon : "folder",
    folder: o.folder,
    hidden: o.hidden === true,
    order: typeof o.order === "number" ? o.order : index,
    status: PANE_STATUSES.includes(o.status as PaneStatus) ? (o.status as PaneStatus) : "idle",
    duration: typeof o.duration === "string" ? o.duration : "",
    description: typeof o.description === "string" ? o.description : ""
  };
}

function normalizeTab(raw: unknown): TabState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const kind = PANE_KINDS.includes(o.kind as PaneKind) ? (o.kind as PaneKind) : "note";
  return {
    id: typeof o.id === "string" && o.id ? o.id : uid("tab"),
    title: typeof o.title === "string" && o.title ? o.title : defaultTabTitle(kind),
    kind,
    content: typeof o.content === "string" ? o.content : ""
  };
}

function normalizeSlot(raw: unknown): PaneSlotState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const tabsRaw = Array.isArray(o.tabs) ? o.tabs : [];
  const tabs = tabsRaw.map(normalizeTab).filter((t): t is TabState => t !== null);
  if (tabs.length === 0) return emptySlot();
  const activeTabId =
    typeof o.activeTabId === "string" && tabs.some((t) => t.id === o.activeTabId)
      ? o.activeTabId
      : tabs[0].id;
  const status = PANE_STATUSES.includes(o.status as PaneStatus) ? (o.status as PaneStatus) : "idle";
  return { tabs, activeTabId, status };
}

function normalizeLayout(raw: unknown): LayoutState | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const preset = presetById(typeof o.presetId === "string" ? o.presetId : DEFAULT_PRESET_ID);
  const slotsRaw = Array.isArray(o.slots) ? o.slots : [];
  const expected = paneSlots(preset).length;
  const slots = slotsRaw.map(normalizeSlot).filter((s): s is PaneSlotState => s !== null);
  while (slots.length < expected) slots.push(emptySlot());
  return {
    presetId: preset.id,
    leftWidth: typeof o.leftWidth === "number" ? o.leftWidth : 320,
    topHeight: typeof o.topHeight === "number" ? o.topHeight : preset.topHeightDefault,
    chatWidth: typeof o.chatWidth === "number" ? o.chatWidth : 420,
    slots: slots.slice(0, expected)
  };
}

/** 把任意持久化数据归一化成合法状态；任何字段缺失或类型错误都回落到默认值。 */
export function normalizeState(raw: unknown): WorktableState {
  const d = defaultState();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;

  const projectsRaw = Array.isArray(o.projects) ? o.projects : [];
  const projects = projectsRaw
    .map(normalizeProject)
    .filter((p): p is Project => p !== null)
    .sort((a, b) => a.order - b.order)
    .map((p, i) => ({ ...p, order: i }));

  const layoutsRaw = o.layouts && typeof o.layouts === "object" ? (o.layouts as Record<string, unknown>) : {};
  const layouts: Record<string, LayoutState> = {};
  for (const [key, value] of Object.entries(layoutsRaw)) {
    const separator = key.indexOf("::");
    const projectId = separator >= 0 ? key.slice(0, separator) : "";
    if (!projects.some((p) => p.id === projectId)) continue;
    const layout = normalizeLayout(value);
    if (layout) layouts[key] = layout;
  }

  const themeRaw = o.theme && typeof o.theme === "object" ? (o.theme as Partial<ThemeState>) : {};

  const presetRaw =
    o.presetByProject && typeof o.presetByProject === "object"
      ? (o.presetByProject as Record<string, unknown>)
      : {};
  const presetByProject: Record<string, string> = {};
  for (const [projectId, presetId] of Object.entries(presetRaw)) {
    if (!projects.some((p) => p.id === projectId)) continue;
    if (typeof presetId === "string" && PRESET_DEFS.some((p) => p.id === presetId)) {
      presetByProject[projectId] = presetId;
    }
  }

  // 显式 null 表示「用户退出了当前项目」，必须原样保留，否则卡片视图存不下来；
  // 字段缺失或指向已删项目时，才回落到首个可见项目。
  const activeRaw = o.activeProjectId;
  const activeProjectId =
    activeRaw === null
      ? null
      : typeof activeRaw === "string" && projects.some((p) => p.id === activeRaw)
        ? activeRaw
        : projects.find((p) => !p.hidden)?.id ?? null;

  return {
    version: 1,
    projects,
    activeProjectId,
    presetByProject,
    layouts,
    theme: themeFromConfig(themeRaw)
  };
}

export function visibleProjects(state: WorktableState): Project[] {
  return state.projects.filter((p) => !p.hidden).sort((a, b) => a.order - b.order);
}

export function hiddenProjects(state: WorktableState): Project[] {
  return state.projects.filter((p) => p.hidden).sort((a, b) => a.order - b.order);
}

export function addProject(state: WorktableState, folder: string, name: string, icon: string): WorktableState {
  const project: Project = {
    id: uid("proj"),
    name: name || folder,
    icon: icon || "folder",
    folder,
    hidden: false,
    order: state.projects.length,
    status: "idle",
    duration: "",
    description: ""
  };
  // 只在「此前一个项目都没有」时自动选中，避免用户停在卡片视图时新增被拽走。
  return {
    ...state,
    projects: [...state.projects, project],
    activeProjectId: state.activeProjectId ?? (state.projects.length === 0 ? project.id : null)
  };
}

export function renameProject(state: WorktableState, id: string, name: string): WorktableState {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
  };
}

export function setProjectIcon(state: WorktableState, id: string, icon: string): WorktableState {
  if (!icon) return state;
  return {
    ...state,
    projects: state.projects.map((p) => (p.id === id ? { ...p, icon } : p))
  };
}

export type ProjectMetaPatch = Partial<Pick<Project, "status" | "duration" | "description">>;

/**
 * 只改传入的项目级字段；未传字段保持原样，patch 为空或无变化时返回原状态对象。
 */
export function setProjectMeta(
  state: WorktableState,
  id: string,
  patch: ProjectMetaPatch
): WorktableState {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return state;
  const next: Project = { ...project };
  let changed = false;
  if (patch.status !== undefined && patch.status !== project.status) {
    next.status = patch.status;
    changed = true;
  }
  if (patch.duration !== undefined && patch.duration !== project.duration) {
    next.duration = patch.duration;
    changed = true;
  }
  if (patch.description !== undefined && patch.description !== project.description) {
    next.description = patch.description;
    changed = true;
  }
  if (!changed) return state;
  return { ...state, projects: state.projects.map((p) => (p.id === id ? next : p)) };
}

/**
 * 按域显式校验项目级字段，返回人类可读的问题列表；空数组表示全部合法。
 * normalizeProject 会把非法值静默回落成默认值，写入方（如 CLI）必须先过这道校验。
 */
export function projectMetaIssues(patch: ProjectMetaPatch): string[] {
  const issues: string[] = [];
  if (patch.status !== undefined && !PANE_STATUSES.includes(patch.status)) {
    issues.push(`status 只接受 ${PANE_STATUSES.join(" | ")}，收到：${String(patch.status)}`);
  }
  if (patch.duration !== undefined && typeof patch.duration !== "string") {
    issues.push(`duration 需要是文本，收到：${String(patch.duration)}`);
  }
  if (patch.description !== undefined && typeof patch.description !== "string") {
    issues.push(`description 需要是文本，收到：${String(patch.description)}`);
  }
  return issues;
}

export interface ProjectStats {
  total: number;
  idle: number;
  working: number;
  needsYou: number;
  done: number;
}

/**
 * 按项目当前预设统计各窗格状态。布局尚未建立时全部记为空闲，
 * total 恒等于该预设的窗口数，因此卡片上的分母始终有意义。
 */
export function projectStats(state: WorktableState, projectId: string): ProjectStats {
  const presetId = presetForProject(state, projectId);
  const total = presetById(presetId).contentCount;
  const slots = state.layouts[layoutKey(projectId, presetId)]?.slots ?? [];
  const stats: ProjectStats = { total, idle: 0, working: 0, needsYou: 0, done: 0 };
  for (let i = 0; i < total; i++) {
    switch (slots[i]?.status) {
      case "working":
        stats.working += 1;
        break;
      case "needs-you":
        stats.needsYou += 1;
        break;
      case "done":
        stats.done += 1;
        break;
      default:
        stats.idle += 1;
    }
  }
  return stats;
}

export function setProjectHidden(state: WorktableState, id: string, hidden: boolean): WorktableState {
  const projects = state.projects.map((p) => (p.id === id ? { ...p, hidden } : p));
  const activeStillVisible = projects.some((p) => p.id === state.activeProjectId && !p.hidden);
  return {
    ...state,
    projects,
    activeProjectId: activeStillVisible ? state.activeProjectId : visibleProjects({ ...state, projects })[0]?.id ?? null
  };
}

export function removeProject(state: WorktableState, id: string): WorktableState {
  const projects = state.projects.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i }));
  const layouts: Record<string, LayoutState> = {};
  for (const [key, value] of Object.entries(state.layouts)) {
    if (!key.startsWith(`${id}::`)) layouts[key] = value;
  }
  const presetByProject = { ...state.presetByProject };
  delete presetByProject[id];
  return {
    ...state,
    projects,
    layouts,
    presetByProject,
    activeProjectId:
      state.activeProjectId === id ? visibleProjects({ ...state, projects })[0]?.id ?? null : state.activeProjectId
  };
}

export function moveProject(state: WorktableState, id: string, delta: number): WorktableState {
  const ordered = [...state.projects].sort((a, b) => a.order - b.order);
  const i = ordered.findIndex((p) => p.id === id);
  if (i < 0) return state;
  const j = i + delta;
  if (j < 0 || j >= ordered.length) return state;
  const a = ordered[i];
  ordered[i] = ordered[j];
  ordered[j] = a;
  return { ...state, projects: ordered.map((p, index) => ({ ...p, order: index })) };
}

export function setActiveProject(state: WorktableState, projectId: string | null): WorktableState {
  return { ...state, activeProjectId: projectId };
}

export function presetIds(): string[] {
  return PRESET_DEFS.map((p) => p.id);
}
