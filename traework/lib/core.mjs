// src/shared/presets.ts
var PRESET_DEFS = [
  {
    id: "full",
    label: "\u5355\u7A97",
    leftCount: 0,
    topCount: 0,
    contentCount: 1,
    chatFull: true,
    topHeightDefault: 0,
    topHeightRatio: 0.3
  },
  {
    id: "l2",
    label: "\u5DE6\u53F3\u5206\u680F",
    leftCount: 1,
    topCount: 0,
    contentCount: 2,
    chatFull: true,
    topHeightDefault: 0,
    topHeightRatio: 0.3
  },
  {
    id: "g4",
    label: "\u7530\u5B57\u683C",
    leftCount: 0,
    topCount: 2,
    contentCount: 4,
    chatFull: true,
    topHeightDefault: 260,
    topHeightRatio: 0.4
  },
  {
    id: "l13",
    label: "\u9876\u90E8\u5927\u7A97",
    leftCount: 0,
    topCount: 1,
    contentCount: 4,
    chatFull: true,
    topHeightDefault: 340,
    topHeightRatio: 0.45
  }
];
var DEFAULT_PRESET_ID = "l2";
function presetById(id) {
  return PRESET_DEFS.find((p) => p.id === id) ?? PRESET_DEFS[0];
}
function mainRowCount(preset) {
  return preset.contentCount - preset.topCount - preset.leftCount;
}
function paneSlots(preset) {
  const out = [];
  let windowNo = 1;
  for (let i = 0; i < preset.leftCount; i++) out.push({ windowNo: windowNo++, region: "left" });
  for (let i = 0; i < preset.topCount; i++) out.push({ windowNo: windowNo++, region: "top" });
  for (let i = 0; i < mainRowCount(preset); i++) out.push({ windowNo: windowNo++, region: "main" });
  return out;
}

// src/shared/state-core.ts
var STATE_KEY = "traeWorktable.state.v1";
var THEME_MODES = ["system", "dark", "light"];
var BACKGROUNDS = ["aurora", "coast", "grid", "none"];
var PANE_KINDS = ["note", "todo", "link", "placeholder"];
var PANE_STATUSES = ["idle", "working", "needs-you", "done"];
var seq = 0;
function uid(prefix = "id") {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}
function defaultTabTitle(kind) {
  switch (kind) {
    case "todo":
      return "\u5F85\u529E";
    case "link":
      return "\u94FE\u63A5";
    case "placeholder":
      return "\u5360\u4F4D";
    default:
      return "\u7B14\u8BB0";
  }
}
function newTab(kind = "note") {
  return { id: uid("tab"), title: defaultTabTitle(kind), kind, content: "" };
}
function emptySlot() {
  const tab = newTab();
  return { tabs: [tab], activeTabId: tab.id, status: "idle" };
}
function defaultTheme() {
  return { mode: "system", accent: "#4f9cf9", opacity: 0.86, background: "aurora" };
}
function defaultState() {
  return {
    version: 1,
    projects: [],
    activeProjectId: null,
    presetByProject: {},
    layouts: {},
    theme: defaultTheme()
  };
}
function presetForProject(state, projectId) {
  const id = state.presetByProject[projectId];
  return id && PRESET_DEFS.some((p) => p.id === id) ? id : DEFAULT_PRESET_ID;
}
function setProjectPreset(state, projectId, presetId) {
  if (!PRESET_DEFS.some((p) => p.id === presetId)) return state;
  return { ...state, presetByProject: { ...state.presetByProject, [projectId]: presetId } };
}
function layoutKey(projectId, presetId) {
  return `${projectId}::${presetId}`;
}
function ensureLayout(state, projectId, presetId) {
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
function themeFromConfig(raw) {
  const d = defaultTheme();
  const accent = typeof raw.accent === "string" && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(raw.accent) ? raw.accent : d.accent;
  const opacity = typeof raw.opacity === "number" && raw.opacity >= 0.3 && raw.opacity <= 1 ? raw.opacity : d.opacity;
  return {
    mode: THEME_MODES.includes(raw.mode) ? raw.mode : d.mode,
    accent,
    opacity,
    background: BACKGROUNDS.includes(raw.background) ? raw.background : d.background
  };
}
function normalizeProject(raw, index) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
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
function normalizeTab(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const kind = PANE_KINDS.includes(o.kind) ? o.kind : "note";
  return {
    id: typeof o.id === "string" && o.id ? o.id : uid("tab"),
    title: typeof o.title === "string" && o.title ? o.title : defaultTabTitle(kind),
    kind,
    content: typeof o.content === "string" ? o.content : ""
  };
}
function normalizeSlot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const tabsRaw = Array.isArray(o.tabs) ? o.tabs : [];
  const tabs = tabsRaw.map(normalizeTab).filter((t) => t !== null);
  if (tabs.length === 0) return emptySlot();
  const activeTabId = typeof o.activeTabId === "string" && tabs.some((t) => t.id === o.activeTabId) ? o.activeTabId : tabs[0].id;
  const status = PANE_STATUSES.includes(o.status) ? o.status : "idle";
  return { tabs, activeTabId, status };
}
function normalizeLayout(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = raw;
  const preset = presetById(typeof o.presetId === "string" ? o.presetId : DEFAULT_PRESET_ID);
  const slotsRaw = Array.isArray(o.slots) ? o.slots : [];
  const expected = paneSlots(preset).length;
  const slots = slotsRaw.map(normalizeSlot).filter((s) => s !== null);
  while (slots.length < expected) slots.push(emptySlot());
  return {
    presetId: preset.id,
    leftWidth: typeof o.leftWidth === "number" ? o.leftWidth : 320,
    topHeight: typeof o.topHeight === "number" ? o.topHeight : preset.topHeightDefault,
    chatWidth: typeof o.chatWidth === "number" ? o.chatWidth : 420,
    slots: slots.slice(0, expected)
  };
}
function normalizeState(raw) {
  const d = defaultState();
  if (!raw || typeof raw !== "object") return d;
  const o = raw;
  const projectsRaw = Array.isArray(o.projects) ? o.projects : [];
  const projects = projectsRaw.map(normalizeProject).filter((p) => p !== null).sort((a, b) => a.order - b.order).map((p, i) => ({ ...p, order: i }));
  const layoutsRaw = o.layouts && typeof o.layouts === "object" ? o.layouts : {};
  const layouts = {};
  for (const [key, value] of Object.entries(layoutsRaw)) {
    const separator = key.indexOf("::");
    const projectId = separator >= 0 ? key.slice(0, separator) : "";
    if (!projects.some((p) => p.id === projectId)) continue;
    const layout = normalizeLayout(value);
    if (layout) layouts[key] = layout;
  }
  const themeRaw = o.theme && typeof o.theme === "object" ? o.theme : {};
  const presetRaw = o.presetByProject && typeof o.presetByProject === "object" ? o.presetByProject : {};
  const presetByProject = {};
  for (const [projectId, presetId] of Object.entries(presetRaw)) {
    if (!projects.some((p) => p.id === projectId)) continue;
    if (typeof presetId === "string" && PRESET_DEFS.some((p) => p.id === presetId)) {
      presetByProject[projectId] = presetId;
    }
  }
  return {
    version: 1,
    projects,
    activeProjectId: typeof o.activeProjectId === "string" && projects.some((p) => p.id === o.activeProjectId) ? o.activeProjectId : projects.find((p) => !p.hidden)?.id ?? null,
    presetByProject,
    layouts,
    theme: themeFromConfig(themeRaw)
  };
}
function visibleProjects(state) {
  return state.projects.filter((p) => !p.hidden).sort((a, b) => a.order - b.order);
}
function hiddenProjects(state) {
  return state.projects.filter((p) => p.hidden).sort((a, b) => a.order - b.order);
}
function addProject(state, folder, name, icon) {
  const project = {
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
function renameProject(state, id, name) {
  const trimmed = name.trim();
  if (!trimmed) return state;
  return {
    ...state,
    projects: state.projects.map((p) => p.id === id ? { ...p, name: trimmed } : p)
  };
}
function setProjectIcon(state, id, icon) {
  if (!icon) return state;
  return {
    ...state,
    projects: state.projects.map((p) => p.id === id ? { ...p, icon } : p)
  };
}
function setProjectHidden(state, id, hidden) {
  const projects = state.projects.map((p) => p.id === id ? { ...p, hidden } : p);
  const activeStillVisible = projects.some((p) => p.id === state.activeProjectId && !p.hidden);
  return {
    ...state,
    projects,
    activeProjectId: activeStillVisible ? state.activeProjectId : visibleProjects({ ...state, projects })[0]?.id ?? null
  };
}
function removeProject(state, id) {
  const projects = state.projects.filter((p) => p.id !== id).map((p, i) => ({ ...p, order: i }));
  const layouts = {};
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
    activeProjectId: state.activeProjectId === id ? visibleProjects({ ...state, projects })[0]?.id ?? null : state.activeProjectId
  };
}
function moveProject(state, id, delta) {
  const ordered = [...state.projects].sort((a2, b) => a2.order - b.order);
  const i = ordered.findIndex((p) => p.id === id);
  if (i < 0) return state;
  const j = i + delta;
  if (j < 0 || j >= ordered.length) return state;
  const a = ordered[i];
  ordered[i] = ordered[j];
  ordered[j] = a;
  return { ...state, projects: ordered.map((p, index) => ({ ...p, order: index })) };
}
function setActiveProject(state, projectId) {
  return { ...state, activeProjectId: projectId };
}
function presetIds() {
  return PRESET_DEFS.map((p) => p.id);
}
export {
  STATE_KEY,
  addProject,
  defaultState,
  defaultTabTitle,
  defaultTheme,
  emptySlot,
  ensureLayout,
  hiddenProjects,
  layoutKey,
  moveProject,
  newTab,
  normalizeState,
  presetForProject,
  presetIds,
  removeProject,
  renameProject,
  setActiveProject,
  setProjectHidden,
  setProjectIcon,
  setProjectPreset,
  themeFromConfig,
  uid,
  visibleProjects
};
