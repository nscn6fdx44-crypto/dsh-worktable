import type { Project, ProjectStatus, WorktableState } from "../shared/types";
import {
  STATUS_LABEL,
  STATUS_ORDER,
  presetForProject,
  projectStats,
  visibleProjects
} from "../shared/state-core";
import { presetById } from "../shared/presets";
import { el } from "./dom";

export interface ProjectViewCallbacks {
  /** 点击非当前项目 / 卡片本体。 */
  onActivate(projectId: string): void;
  /** 点击左侧当前项目或顶栏「全部项目」。 */
  onDeactivate(): void;
  /** 仅 VS Code 侧提供：宿主弹目录选择器。 */
  onAdd?(): void;
  /** 点击卡片上的状态胶囊，循环四态。 */
  onCycleStatus(projectId: string): void;
}

export function nextProjectStatus(current: ProjectStatus): ProjectStatus {
  const index = STATUS_ORDER.indexOf(current);
  return STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
}

/** project.icon 是 VS Code ThemeIcon 名，纯 HTML 产物渲染不出来，改用名称首字符。 */
function badgeText(project: Project): string {
  const source = project.name.trim() || project.folder;
  return source.slice(0, 1).toUpperCase();
}

export function renderEmpty(text: string): HTMLElement {
  const box = el("div", "wt-empty");
  box.appendChild(el("p", "wt-empty-text", text));
  return box;
}

export function renderSidebar(state: WorktableState, cb: ProjectViewCallbacks): HTMLElement {
  const side = el("aside", "wt-sidebar");

  const visible = visibleProjects(state);
  const head = el("div", "wt-sidebar-head");
  head.appendChild(el("span", "wt-sidebar-title", "项目"));
  head.appendChild(el("span", "wt-sidebar-count", String(visible.length)));
  if (cb.onAdd) {
    const add = el("button", "wt-icon-btn", "+");
    add.title = "添加项目";
    add.addEventListener("click", () => cb.onAdd?.());
    head.appendChild(add);
  }
  side.appendChild(head);

  const list = el("div", "wt-project-list");
  if (visible.length === 0) {
    list.appendChild(el("p", "wt-hint", "还没有项目"));
  }
  for (const project of visible) {
    const isActive = project.id === state.activeProjectId;
    const item = el("button", `wt-project-item${isActive ? " is-active" : ""}`);
    item.title = `${project.name}\n${project.folder}\n图标：${project.icon}`;

    item.appendChild(el("span", "wt-project-badge", badgeText(project)));

    const text = el("span", "wt-project-text");
    text.appendChild(el("span", "wt-project-name", project.name));
    text.appendChild(el("span", "wt-project-folder", project.folder));
    item.appendChild(text);

    const dot = el("span", "wt-dot");
    dot.dataset.status = project.status;
    dot.title = STATUS_LABEL[project.status];
    item.appendChild(dot);

    item.addEventListener("click", () => {
      if (isActive) cb.onDeactivate();
      else cb.onActivate(project.id);
    });
    list.appendChild(item);
  }
  side.appendChild(list);

  return side;
}

function renderCard(state: WorktableState, project: Project, cb: ProjectViewCallbacks): HTMLElement {
  const card = el("div", `wt-card${project.id === state.activeProjectId ? " is-active" : ""}`);
  card.dataset.status = project.status;
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.title = `${project.name}\n${project.folder}`;
  card.addEventListener("click", () => cb.onActivate(project.id));
  card.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    cb.onActivate(project.id);
  });

  const head = el("div", "wt-card-head");
  head.appendChild(el("span", "wt-project-badge", badgeText(project)));
  head.appendChild(el("span", "wt-card-name", project.name));

  const pill = el("button", "wt-status-pill", STATUS_LABEL[project.status]);
  pill.dataset.status = project.status;
  pill.title = "切换项目状态";
  pill.addEventListener("click", (event) => {
    event.stopPropagation();
    cb.onCycleStatus(project.id);
  });
  head.appendChild(pill);
  card.appendChild(head);

  card.appendChild(
    el("p", `wt-card-desc${project.description ? "" : " is-muted"}`, project.description || "暂无描述")
  );

  const meta = el("div", "wt-card-meta");
  meta.appendChild(el("span", "wt-card-folder", project.folder));
  meta.appendChild(el("span", "wt-card-tag", presetById(presetForProject(state, project.id)).label));
  if (project.duration) meta.appendChild(el("span", "wt-card-tag", project.duration));
  card.appendChild(meta);

  const stats = projectStats(state, project.id);
  const statsLine = el("div", "wt-card-stats");
  statsLine.appendChild(el("span", "wt-stat", `进行中 ${stats.working}`));
  statsLine.appendChild(el("span", "wt-stat", `待你处理 ${stats.needsYou}`));
  statsLine.appendChild(el("span", "wt-stat", `完成 ${stats.done}`));
  statsLine.appendChild(el("span", "wt-stat wt-stat-total", `共 ${stats.total} 窗`));
  card.appendChild(statsLine);

  return card;
}

export function renderProjectGrid(
  state: WorktableState,
  cb: ProjectViewCallbacks,
  emptyText = "还没有项目。点左栏「+」添加第一个项目。"
): HTMLElement {
  const visible = visibleProjects(state);
  if (visible.length === 0) {
    return renderEmpty(state.projects.length === 0 ? emptyText : "所有项目都已隐藏。");
  }

  const grid = el("div", "wt-grid");
  for (const project of visible) grid.appendChild(renderCard(state, project, cb));
  return grid;
}
