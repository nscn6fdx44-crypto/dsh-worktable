import * as path from "node:path";
import * as vscode from "vscode";
import type { Project } from "../../shared/types";
import type { WorktableStore } from "../state";
import * as core from "../../shared/state-core";
import { PRESET_DEFS } from "../../shared/presets";
import { openWorktablePanel } from "../worktable/panel";
import { showChangelog } from "../changelog";
import { checkForUpdates, copyUpgradePrompt } from "../updateCheck";

const ICON_CHOICES: string[] = [
  "folder",
  "folder-opened",
  "rocket",
  "beaker",
  "flask",
  "code",
  "terminal",
  "book",
  "star",
  "heart",
  "zap",
  "flame",
  "git-branch",
  "database",
  "server",
  "cloud",
  "package",
  "tools",
  "lightbulb",
  "map",
  "globe",
  "device-desktop"
];

/** 命令参数可能是树节点回传的 Project，也可能为空（命令面板调用）。 */
async function resolveProject(store: WorktableStore, arg: unknown): Promise<Project | undefined> {
  if (arg && typeof arg === "object" && typeof (arg as Project).id === "string") {
    const id = (arg as Project).id;
    const found = store.snapshot.projects.find((p) => p.id === id);
    if (found) return found;
  }
  const items = store.snapshot.projects
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((p) => ({
      label: p.name,
      description: p.hidden ? `${p.folder}（已隐藏）` : p.folder,
      project: p
    }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage("工作台：还没有项目，先执行「添加项目」。");
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(items, { title: "选择项目" });
  return picked?.project;
}

export function registerDrawerCommands(
  ctx: vscode.ExtensionContext,
  store: WorktableStore
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.addProject", async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: "添加为工作台项目"
      });
      const folder = picked?.[0]?.fsPath;
      if (!folder) return;
      const suggested = path.basename(folder);
      const input = await vscode.window.showInputBox({
        title: "项目名称",
        value: suggested,
        prompt: "留空则使用目录名"
      });
      if (input === undefined) return;
      const name = input.trim() || suggested;
      await store.update((s) => core.addProject(s, folder, name, "folder"));
      void vscode.window.showInformationMessage(`工作台：已添加「${name}」。`);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.renameProject", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (!project) return;
      const input = await vscode.window.showInputBox({ title: "重命名项目", value: project.name });
      if (input === undefined) return;
      await store.update((s) => core.renameProject(s, project.id, input));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.changeIcon", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (!project) return;
      const picked = await vscode.window.showQuickPick(
        ICON_CHOICES.map((icon) => ({ label: `$(${icon})  ${icon}`, icon })),
        { title: "选择图标" }
      );
      if (!picked) return;
      await store.update((s) => core.setProjectIcon(s, project.id, picked.icon));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.moveProjectUp", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (project) await store.update((s) => core.moveProject(s, project.id, -1));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.moveProjectDown", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (project) await store.update((s) => core.moveProject(s, project.id, 1));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.hideProject", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (project) await store.update((s) => core.setProjectHidden(s, project.id, true));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.showProject", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (project) await store.update((s) => core.setProjectHidden(s, project.id, false));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.removeProject", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (!project) return;
      const confirmed = await vscode.window.showWarningMessage(
        `从工作台移除「${project.name}」？磁盘上的目录不会被删除。`,
        { modal: true },
        "移除"
      );
      if (confirmed !== "移除") return;
      await store.update((s) => core.removeProject(s, project.id));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.revealProjectFolder", async (arg?: unknown) => {
      const project = await resolveProject(store, arg);
      if (!project) return;
      await vscode.commands.executeCommand("revealFileInOS", vscode.Uri.file(project.folder));
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.openWorktable", async (arg?: unknown) => {
      const project = arg ? await resolveProject(store, arg) : undefined;
      openWorktablePanel(ctx, store, project?.id);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.pickLayout", async (arg?: unknown) => {
      const project = arg ? await resolveProject(store, arg) : undefined;
      const target =
        project ?? store.snapshot.projects.find((p) => p.id === store.snapshot.activeProjectId);
      if (!target) {
        void vscode.window.showInformationMessage("工作台：先添加并选中一个项目。");
        return;
      }
      const picked = await vscode.window.showQuickPick(
        PRESET_DEFS.map((p) => ({
          label: p.label,
          description: `${p.id} · ${p.contentCount} 窗`,
          presetId: p.id
        })),
        { title: "选择布局预设" }
      );
      if (!picked) return;
      await store.update((s) => core.setProjectPreset(s, target.id, picked.presetId));
      openWorktablePanel(ctx, store, target.id);
    })
  );

  disposables.push(
    vscode.commands.registerCommand("traeWorktable.showChangelog", () => showChangelog(ctx))
  );
  disposables.push(
    vscode.commands.registerCommand("traeWorktable.checkUpdates", () => checkForUpdates(ctx, false))
  );
  disposables.push(
    vscode.commands.registerCommand("traeWorktable.copyUpgradePrompt", () => copyUpgradePrompt(ctx))
  );

  return disposables;
}
