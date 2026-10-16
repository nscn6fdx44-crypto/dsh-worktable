import type { HostToWebview, WebviewToHost } from "../shared/protocol";
import type { BackgroundId, ThemeMode, WorktableState } from "../shared/types";
import { PRESET_DEFS } from "../shared/presets";
import { BACKGROUND_LABEL, applyTheme, toFullHex } from "./theme";
import { renderSplit } from "./split";
import { clear, el } from "./dom";
import type { ProjectViewCallbacks } from "./projects";
import { nextProjectStatus, renderEmpty, renderProjectGrid, renderSidebar } from "./projects";

declare function acquireVsCodeApi(): {
  postMessage(message: WebviewToHost): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();
const root = document.getElementById("root") as HTMLElement;

let state: WorktableState | null = null;
let themeKind: "dark" | "light" = "dark";
let persistTimer: number | undefined;

let appearanceRefs: {
  modeButtons: Map<ThemeMode, HTMLButtonElement>;
  backgroundButtons: Map<BackgroundId, HTMLButtonElement>;
  opacityValue: HTMLElement;
} | null = null;

function post(message: WebviewToHost): void {
  vscode.postMessage(message);
}

function activeLayoutKey(s: WorktableState): string | null {
  if (!s.activeProjectId) return null;
  const presetId = s.presetByProject[s.activeProjectId] ?? PRESET_DEFS[0].id;
  return `${s.activeProjectId}::${presetId}`;
}

function persistNow(): void {
  if (!state) return;
  post({ type: "setLayouts", layouts: state.layouts });
}

function persistDebounced(): void {
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    persistNow();
  }, 250);
}

function rerender(): void {
  persistDebounced();
  render();
}

/** 除主题外的一切结构是否相同 —— 相同则跳过重绘，避免抢走输入焦点。 */
function sameStructureExceptTheme(a: WorktableState, b: WorktableState): boolean {
  if (a.activeProjectId !== b.activeProjectId) return false;
  if (a.projects.length !== b.projects.length) return false;
  for (let i = 0; i < a.projects.length; i++) {
    const x = a.projects[i];
    const y = b.projects[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.icon !== y.icon ||
      x.hidden !== y.hidden ||
      x.order !== y.order ||
      x.status !== y.status ||
      x.duration !== y.duration ||
      x.description !== y.description
    ) {
      return false;
    }
  }
  const presetKeys = Object.keys(a.presetByProject).sort();
  const presetKeysB = Object.keys(b.presetByProject).sort();
  if (presetKeys.length !== presetKeysB.length) return false;
  for (let i = 0; i < presetKeys.length; i++) {
    const key = presetKeys[i];
    if (key !== presetKeysB[i] || a.presetByProject[key] !== b.presetByProject[key]) return false;
  }
  const keysA = Object.keys(a.layouts).sort();
  const keysB = Object.keys(b.layouts).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i++) {
    if (keysA[i] !== keysB[i]) return false;
  }
  for (const key of keysA) {
    const x = a.layouts[key];
    const y = b.layouts[key];
    if (x.presetId !== y.presetId) return false;
    if (x.leftWidth !== y.leftWidth || x.topHeight !== y.topHeight || x.chatWidth !== y.chatWidth) return false;
    if (x.slots.length !== y.slots.length) return false;
    for (let i = 0; i < x.slots.length; i++) {
      const sx = x.slots[i];
      const sy = y.slots[i];
      if (sx.status !== sy.status || sx.activeTabId !== sy.activeTabId) return false;
      if (sx.tabs.length !== sy.tabs.length) return false;
      for (let j = 0; j < sx.tabs.length; j++) {
        const tx = sx.tabs[j];
        const ty = sy.tabs[j];
        if (tx.id !== ty.id || tx.kind !== ty.kind || tx.title !== ty.title) return false;
      }
    }
  }
  return true;
}

function syncAppearance(): void {
  if (!appearanceRefs || !state) return;
  for (const [mode, button] of appearanceRefs.modeButtons) {
    button.classList.toggle("is-active", state.theme.mode === mode);
  }
  for (const [background, button] of appearanceRefs.backgroundButtons) {
    button.classList.toggle("is-active", state.theme.background === background);
  }
  appearanceRefs.opacityValue.textContent = `${Math.round(state.theme.opacity * 100)}%`;
}

function renderTopbar(s: WorktableState): HTMLElement {
  const bar = el("header", "wt-topbar");

  if (s.activeProjectId) {
    const back = el("button", "wt-chip wt-chip-ghost", "← 全部项目");
    back.title = "退出当前项目，回到全部项目视图";
    back.addEventListener("click", () => post({ type: "setActiveProject", projectId: null }));
    bar.appendChild(back);
  }

  const layouts = el("div", "wt-chip-group");
  if (s.activeProjectId) {
    const currentPresetId = s.presetByProject[s.activeProjectId] ?? PRESET_DEFS[0].id;
    for (const preset of PRESET_DEFS) {
      const chip = el(
        "button",
        `wt-chip wt-chip-ghost${preset.id === currentPresetId ? " is-active" : ""}`,
        preset.label
      );
      chip.title = `${preset.id} · ${preset.contentCount} 窗`;
      chip.addEventListener("click", () => {
        if (!s.activeProjectId) return;
        post({ type: "setPreset", projectId: s.activeProjectId, presetId: preset.id });
      });
      layouts.appendChild(chip);
    }
  }
  bar.appendChild(layouts);

  const toggle = el("button", "wt-chip wt-chip-ghost", "外观");
  toggle.title = "展开外观设置";
  toggle.addEventListener("click", () => {
    const panel = document.getElementById("wt-appearance");
    if (panel) panel.classList.toggle("is-collapsed");
  });
  bar.appendChild(toggle);

  return bar;
}

function renderAppearance(s: WorktableState): HTMLElement {
  const panel = el("section", "wt-appearance is-collapsed");
  panel.id = "wt-appearance";

  const modeButtons = new Map<ThemeMode, HTMLButtonElement>();
  const modeField = el("div", "wt-field");
  modeField.appendChild(el("span", "wt-label", "模式"));
  const seg = el("div", "wt-seg");
  const modes: Array<[ThemeMode, string]> = [
    ["system", "跟随系统"],
    ["dark", "深色"],
    ["light", "浅色"]
  ];
  for (const [value, label] of modes) {
    const button = el("button", `wt-seg-btn${s.theme.mode === value ? " is-active" : ""}`, label);
    button.addEventListener("click", () => {
      post({ type: "setThemeConfig", theme: { mode: value } });
    });
    modeButtons.set(value, button);
    seg.appendChild(button);
  }
  modeField.appendChild(seg);
  panel.appendChild(modeField);

  const accentField = el("div", "wt-field");
  accentField.appendChild(el("span", "wt-label", "强调色"));
  const color = el("input", "wt-color");
  color.type = "color";
  color.value = toFullHex(s.theme.accent);
  color.addEventListener("input", () => {
    post({ type: "setThemeConfig", theme: { accent: color.value } });
  });
  accentField.appendChild(color);
  panel.appendChild(accentField);

  const opacityField = el("div", "wt-field");
  opacityField.appendChild(el("span", "wt-label", "不透明度"));
  const range = el("input", "wt-range");
  range.type = "range";
  range.min = "30";
  range.max = "100";
  range.value = String(Math.round(s.theme.opacity * 100));
  const opacityValue = el("span", "wt-value", `${Math.round(s.theme.opacity * 100)}%`);
  range.addEventListener("input", () => {
    const value = Number(range.value) / 100;
    document.documentElement.style.setProperty("--wt-opacity", String(value));
    opacityValue.textContent = `${Math.round(value * 100)}%`;
    post({ type: "setThemeConfig", theme: { opacity: value } });
  });
  opacityField.appendChild(range);
  opacityField.appendChild(opacityValue);
  panel.appendChild(opacityField);

  const backgroundButtons = new Map<BackgroundId, HTMLButtonElement>();
  const backgroundField = el("div", "wt-field");
  backgroundField.appendChild(el("span", "wt-label", "背景"));
  const backgrounds = el("div", "wt-seg");
  for (const id of Object.keys(BACKGROUND_LABEL) as BackgroundId[]) {
    const button = el(
      "button",
      `wt-seg-btn${s.theme.background === id ? " is-active" : ""}`,
      BACKGROUND_LABEL[id]
    );
    button.addEventListener("click", () => {
      post({ type: "setThemeConfig", theme: { background: id } });
    });
    backgroundButtons.set(id, button);
    backgrounds.appendChild(button);
  }
  backgroundField.appendChild(backgrounds);
  panel.appendChild(backgroundField);

  appearanceRefs = { modeButtons, backgroundButtons, opacityValue };
  return panel;
}

function render(): void {
  const current = state;
  if (!current) return;
  applyTheme(document.documentElement, current.theme, themeKind);
  clear(root);

  root.appendChild(renderTopbar(current));
  root.appendChild(renderAppearance(current));
  syncAppearance();

  const callbacks: ProjectViewCallbacks = {
    onActivate: (projectId) => post({ type: "setActiveProject", projectId }),
    onDeactivate: () => post({ type: "setActiveProject", projectId: null }),
    onAdd: () => post({ type: "addProject" }),
    onCycleStatus: (projectId) => {
      const project = current.projects.find((p) => p.id === projectId);
      if (!project) return;
      post({
        type: "setProjectMeta",
        projectId,
        patch: { status: nextProjectStatus(project.status) }
      });
    }
  };

  const shell = el("div", "wt-shell");
  shell.appendChild(renderSidebar(current, callbacks));

  const content = el("div", "wt-content");
  const active = current.projects.find((p) => p.id === current.activeProjectId && !p.hidden);
  const key = active ? activeLayoutKey(current) : null;
  if (!active) {
    content.appendChild(renderProjectGrid(current, callbacks));
  } else if (!key || !current.layouts[key]) {
    content.appendChild(renderEmpty("正在初始化布局…"));
  } else {
    content.appendChild(
      renderSplit({
        state: current,
        layoutKey: key,
        onPersist: persistDebounced,
        onRerender: rerender,
        onOpenExternal: (url) => post({ type: "openExternal", url })
      })
    );
  }
  shell.appendChild(content);
  root.appendChild(shell);
}

window.addEventListener("message", (event: MessageEvent<HostToWebview>) => {
  const message = event.data;
  if (message.type === "state") {
    const previous = state;
    state = message.state;
    applyTheme(document.documentElement, state.theme, themeKind);
    if (!previous || !sameStructureExceptTheme(previous, state)) {
      render();
    } else {
      syncAppearance();
    }
  } else if (message.type === "themeKind") {
    themeKind = message.kind;
    if (state) applyTheme(document.documentElement, state.theme, themeKind);
  }
});

post({ type: "ready" });
