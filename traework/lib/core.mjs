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
var ACCENT_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
var OPACITY_MIN = 0.3;
var OPACITY_MAX = 1;
var PANE_KINDS = ["note", "todo", "link", "placeholder", "repo", "web"];
var PANE_STATUSES = ["idle", "working", "needs-you", "done"];
var STATUS_ORDER = [...PANE_STATUSES];
var STATUS_LABEL = {
  idle: "\u7A7A\u95F2",
  working: "\u8FDB\u884C\u4E2D",
  "needs-you": "\u5F85\u4F60\u5904\u7406",
  done: "\u5B8C\u6210"
};
var PANE_KIND_ORDER = [...PANE_KINDS];
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
    case "repo":
      return "\u4ED3\u5E93";
    case "web":
      return "\u7F51\u9875";
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
  const accent = typeof raw.accent === "string" && ACCENT_PATTERN.test(raw.accent) ? raw.accent : d.accent;
  const opacity = typeof raw.opacity === "number" && raw.opacity >= OPACITY_MIN && raw.opacity <= OPACITY_MAX ? raw.opacity : d.opacity;
  return {
    mode: THEME_MODES.includes(raw.mode) ? raw.mode : d.mode,
    accent,
    opacity,
    background: BACKGROUNDS.includes(raw.background) ? raw.background : d.background
  };
}
function themeIssues(patch) {
  const issues = [];
  if (patch.mode !== void 0 && !THEME_MODES.includes(patch.mode)) {
    issues.push(`mode \u53EA\u63A5\u53D7 ${THEME_MODES.join(" | ")}\uFF0C\u6536\u5230\uFF1A${String(patch.mode)}`);
  }
  if (patch.accent !== void 0 && !ACCENT_PATTERN.test(patch.accent)) {
    issues.push(`accent \u9700\u8981 #rgb \u6216 #rrggbb\uFF0C\u6536\u5230\uFF1A${String(patch.accent)}`);
  }
  if (patch.background !== void 0 && !BACKGROUNDS.includes(patch.background)) {
    issues.push(`background \u53EA\u63A5\u53D7 ${BACKGROUNDS.join(" | ")}\uFF0C\u6536\u5230\uFF1A${String(patch.background)}`);
  }
  if (patch.opacity !== void 0 && !(typeof patch.opacity === "number" && patch.opacity >= OPACITY_MIN && patch.opacity <= OPACITY_MAX)) {
    issues.push(`opacity \u9700\u8981\u662F ${OPACITY_MIN}\u2013${OPACITY_MAX} \u4E4B\u95F4\u7684\u6570\u5B57\uFF0C\u6536\u5230\uFF1A${String(patch.opacity)}`);
  }
  return issues;
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
    order: typeof o.order === "number" ? o.order : index,
    status: PANE_STATUSES.includes(o.status) ? o.status : "idle",
    duration: typeof o.duration === "string" ? o.duration : "",
    description: typeof o.description === "string" ? o.description : ""
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
  const activeRaw = o.activeProjectId;
  const activeProjectId = activeRaw === null ? null : typeof activeRaw === "string" && projects.some((p) => p.id === activeRaw) ? activeRaw : projects.find((p) => !p.hidden)?.id ?? null;
  return {
    version: 1,
    projects,
    activeProjectId,
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
    order: state.projects.length,
    status: "idle",
    duration: "",
    description: ""
  };
  return {
    ...state,
    projects: [...state.projects, project],
    activeProjectId: state.activeProjectId ?? (state.projects.length === 0 ? project.id : null)
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
function setProjectMeta(state, id, patch) {
  const project = state.projects.find((p) => p.id === id);
  if (!project) return state;
  const next = { ...project };
  let changed = false;
  if (patch.status !== void 0 && patch.status !== project.status) {
    next.status = patch.status;
    changed = true;
  }
  if (patch.duration !== void 0 && patch.duration !== project.duration) {
    next.duration = patch.duration;
    changed = true;
  }
  if (patch.description !== void 0 && patch.description !== project.description) {
    next.description = patch.description;
    changed = true;
  }
  if (!changed) return state;
  return { ...state, projects: state.projects.map((p) => p.id === id ? next : p) };
}
function projectMetaIssues(patch) {
  const issues = [];
  if (patch.status !== void 0 && !PANE_STATUSES.includes(patch.status)) {
    issues.push(`status \u53EA\u63A5\u53D7 ${PANE_STATUSES.join(" | ")}\uFF0C\u6536\u5230\uFF1A${String(patch.status)}`);
  }
  if (patch.duration !== void 0 && typeof patch.duration !== "string") {
    issues.push(`duration \u9700\u8981\u662F\u6587\u672C\uFF0C\u6536\u5230\uFF1A${String(patch.duration)}`);
  }
  if (patch.description !== void 0 && typeof patch.description !== "string") {
    issues.push(`description \u9700\u8981\u662F\u6587\u672C\uFF0C\u6536\u5230\uFF1A${String(patch.description)}`);
  }
  return issues;
}
function projectStats(state, projectId) {
  const presetId = presetForProject(state, projectId);
  const total = presetById(presetId).contentCount;
  const slots = state.layouts[layoutKey(projectId, presetId)]?.slots ?? [];
  const stats = { total, idle: 0, working: 0, needsYou: 0, done: 0 };
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
  PANE_KIND_ORDER,
  STATE_KEY,
  STATUS_LABEL,
  STATUS_ORDER,
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
  projectMetaIssues,
  projectStats,
  removeProject,
  renameProject,
  setActiveProject,
  setProjectHidden,
  setProjectIcon,
  setProjectMeta,
  setProjectPreset,
  themeFromConfig,
  themeIssues,
  uid,
  visibleProjects
};
