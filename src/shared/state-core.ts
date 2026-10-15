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
const PANE_KINDS: PaneKind[] = ["note", "todo", "link", "placeholder"];
const PANE_STATUSES: PaneStatus[] = ["idle", "working", "needs-you", "done"];

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
  const accent = typeof raw.accent === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.accent)
    ? raw.accent
    : d.accent;
  const opacity = typeof raw.opacity === "number" && raw.opacity >= 0.3 && raw.opacity <= 1
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
    order: typeof o.order === "number" ? o.order : index
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

  return {
    version: 1,
    projects,
    activeProjectId:
      typeof o.activeProjectId === "string" && projects.some((p) => p.id === o.activeProjectId)
        ? o.activeProjectId
        : projects.find((p) => !p.hidden)?.id ?? null,
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
    order: state.projects.length
  };
  return {
    ...state,
    projects: [...state.projects, project],
    activeProjectId: state.activeProjectId ?? project.id
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
