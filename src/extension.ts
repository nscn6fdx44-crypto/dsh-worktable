import * as vscode from "vscode";
import { WorktableStore } from "./host/state";
import { ProjectsProvider } from "./host/drawer/projectsProvider";
import { registerDrawerCommands } from "./host/drawer/commands";
import { checkForUpdates } from "./host/updateCheck";

export function activate(ctx: vscode.ExtensionContext): void {
  const store = new WorktableStore(ctx);
  const visible = new ProjectsProvider(store, "visible");
  const hidden = new ProjectsProvider(store, "hidden");

  ctx.subscriptions.push(
    store,
    vscode.window.registerTreeDataProvider("traeWorktable.projects", visible),
    vscode.window.registerTreeDataProvider("traeWorktable.hidden", hidden),
    store.onDidChange(() => {
      visible.refresh();
      hidden.refresh();
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("traeWorktable.theme")) void store.syncThemeFromConfig();
    }),
    ...registerDrawerCommands(ctx, store)
  );

  void store.syncThemeFromConfig();

  const updateCheckEnabled = vscode.workspace
    .getConfiguration("traeWorktable.updateCheck")
    .get<boolean>("enabled", true);
  if (updateCheckEnabled) void checkForUpdates(ctx, true);
}

export function deactivate(): void {
  // 所有资源都挂在 context.subscriptions 上，无需额外清理
}
