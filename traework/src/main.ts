import type { BackgroundId, ThemeMode, ThemeState, WorktableState } from "../../src/shared/types";
import {
  ensureLayout,
  layoutKey,
  normalizeState,
  presetForProject,
  setActiveProject,
  setProjectMeta,
  setProjectPreset,
  themeFromConfig
} from "../../src/shared/state-core";
import { PRESET_DEFS } from "../../src/shared/presets";
import { BACKGROUND_LABEL, applyTheme, toFullHex } from "../../src/webview/theme";
import { renderSplit } from "../../src/webview/split";
import { clear, el } from "../../src/webview/dom";
import type { ProjectViewCallbacks } from "../../src/webview/projects";
import { nextProjectStatus, renderEmpty, renderProjectGrid, renderSidebar } from "../../src/webview/projects";

const SEED_ELEMENT_ID = "wt-seed";
const STORE_PREFIX = "traework.state.v1";

const root = document.getElementById("root") as HTMLElement;

let state: WorktableState;
let storeKey = "";
let themeKind: "dark" | "light" = "dark";
let persistTimer: number | undefined;

let appearanceRefs: {
  modeButtons: Map<ThemeMode, HTMLButtonElement>;
  backgroundButtons: Map<BackgroundId, HTMLButtonElement>;
  opacityValue: HTMLElement;
} | null = null;

function seedText(): string {
  return document.getElementById(SEED_ELEMENT_ID)?.textContent ?? "null";
}

/** 种子指纹：数据文件一变，页内缓存立即失效，避免旧缓存盖住新数据。 */
function seedFingerprint(raw: string): string {
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i++) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function detectThemeKind(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function withAllLayouts(s: WorktableState): WorktableState {
  const layouts = { ...s.layouts };
  for (const project of s.projects) {
    const presetId = presetForProject(s, project.id);
    layouts[layoutKey(project.id, presetId)] = ensureLayout(s, project.id, presetId);
  }
  return { ...s, layouts };
}

function persistNow(): void {
  try {
    window.localStorage.setItem(storeKey, JSON.stringify(state));
  } catch {
    // 隐私模式或配额用尽：页内交互仍可用，只是不落盘
  }
}

function persistDebounced(): void {
  if (persistTimer !== undefined) window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    persistNow();
  }, 250);
}

function applyThemeNow(): void {
  applyTheme(document.documentElement, state.theme, themeKind);
}

function openExternal(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function exportJson(): void {
  const blob = new Blob([`${JSON.stringify(state, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "worktable.json";
  link.click();
  URL.revokeObjectURL(url);
}

function updateTheme(patch: Partial<ThemeState>): void {
  state = { ...state, theme: themeFromConfig({ ...state.theme, ...patch }) };
  applyThemeNow();
  syncAppearance();
  persistDebounced();
}

function rerender(): void {
  persistDebounced();
  render();
}

function syncAppearance(): void {
  if (!appearanceRefs) return;
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
    back.addEventListener("click", () => {
      state = setActiveProject(state, null);
      rerender();
    });
    bar.appendChild(back);
  }

  const layouts = el("div", "wt-chip-group");
  if (s.activeProjectId) {
    const currentPresetId = presetForProject(s, s.activeProjectId);
    for (const preset of PRESET_DEFS) {
      const chip = el(
        "button",
        `wt-chip wt-chip-ghost${preset.id === currentPresetId ? " is-active" : ""}`,
        preset.label
      );
      chip.title = `${preset.id} · ${preset.contentCount} 窗`;
      chip.addEventListener("click", () => {
        const projectId = state.activeProjectId;
        if (!projectId) return;
        const next = setProjectPreset(state, projectId, preset.id);
        const key = layoutKey(projectId, preset.id);
        state = { ...next, layouts: { ...next.layouts, [key]: ensureLayout(next, projectId, preset.id) } };
        rerender();
      });
      layouts.appendChild(chip);
    }
  }
  bar.appendChild(layouts);

  const toggle = el("button", "wt-chip wt-chip-ghost", "外观");
  toggle.title = "展开外观设置";
  toggle.addEventListener("click", () => {
    document.getElementById("wt-appearance")?.classList.toggle("is-collapsed");
  });
  bar.appendChild(toggle);

  const exportButton = el("button", "wt-chip wt-chip-ghost", "导出 JSON");
  exportButton.title = "导出当前状态为 worktable.json，可回写给数据层";
  exportButton.addEventListener("click", exportJson);
  bar.appendChild(exportButton);

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
    button.addEventListener("click", () => updateTheme({ mode: value }));
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
  color.addEventListener("input", () => updateTheme({ accent: color.value }));
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
  range.addEventListener("input", () => updateTheme({ opacity: Number(range.value) / 100 }));
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
    button.addEventListener("click", () => updateTheme({ background: id }));
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
  applyThemeNow();
  clear(root);

  root.appendChild(renderTopbar(current));
  root.appendChild(renderAppearance(current));
  syncAppearance();

  const callbacks: ProjectViewCallbacks = {
    onActivate: (projectId) => {
      state = setActiveProject(state, projectId);
      rerender();
    },
    onDeactivate: () => {
      state = setActiveProject(state, null);
      rerender();
    },
    onCycleStatus: (projectId) => {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return;
      state = setProjectMeta(state, projectId, { status: nextProjectStatus(project.status) });
      rerender();
    }
  };

  const shell = el("div", "wt-shell");
  shell.appendChild(renderSidebar(current, callbacks));

  const content = el("div", "wt-content");
  const active = current.projects.find((p) => p.id === current.activeProjectId && !p.hidden);
  if (!active) {
    content.appendChild(
      renderProjectGrid(current, callbacks, "还没有项目。用 wt.mjs add 添加第一个项目，再重新渲染。")
    );
  } else {
    const key = layoutKey(active.id, presetForProject(current, active.id));
    if (!current.layouts[key]) {
      content.appendChild(renderEmpty("正在初始化布局…"));
    } else {
      content.appendChild(
        renderSplit({
          state: current,
          layoutKey: key,
          onPersist: persistDebounced,
          onRerender: rerender,
          onOpenExternal: openExternal
        })
      );
    }
  }
  shell.appendChild(content);
  root.appendChild(shell);
}

function boot(): void {
  const raw = seedText();
  storeKey = `${STORE_PREFIX}:${seedFingerprint(raw)}`;

  let restored: unknown = null;
  try {
    const cached = window.localStorage.getItem(storeKey);
    if (cached) restored = JSON.parse(cached);
  } catch {
    restored = null;
  }

  if (restored === null) {
    try {
      restored = JSON.parse(raw);
    } catch {
      restored = null;
    }
  }

  state = withAllLayouts(normalizeState(restored));
  themeKind = detectThemeKind();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    themeKind = detectThemeKind();
    if (state.theme.mode === "system") {
      applyThemeNow();
      render();
    }
  });

  render();
}

boot();
