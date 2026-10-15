import * as vscode from "vscode";
import type { Project } from "../../shared/types";
import { hiddenProjects, visibleProjects } from "../../shared/state-core";
import type { WorktableStore } from "../state";

export class ProjectsProvider implements vscode.TreeDataProvider<Project> {
  private readonly emitter = new vscode.EventEmitter<Project | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Project | undefined> = this.emitter.event;

  constructor(
    private readonly store: WorktableStore,
    private readonly mode: "visible" | "hidden"
  ) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(project: Project): vscode.TreeItem {
    const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.None);
    item.id = project.id;
    item.description = project.folder;
    item.tooltip = `${project.name}\n${project.folder}`;
    item.iconPath = new vscode.ThemeIcon(project.icon);
    item.contextValue =
      this.mode === "hidden" ? "traeWorktable.hiddenProject" : "traeWorktable.project";
    item.command = {
      command: "traeWorktable.openWorktable",
      title: "打开工作台",
      arguments: [project]
    };
    return item;
  }

  getChildren(): Project[] {
    const state = this.store.snapshot;
    return this.mode === "hidden" ? hiddenProjects(state) : visibleProjects(state);
  }
}
