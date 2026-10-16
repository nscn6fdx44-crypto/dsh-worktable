import * as vscode from "vscode";
import type { HostToWebview, WebviewToHost } from "../../shared/protocol";
import type { WorktableStore } from "../state";
import * as core from "../../shared/state-core";

let panelRef: vscode.WebviewPanel | undefined;

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function themeKind(): "dark" | "light" {
  switch (vscode.window.activeColorTheme.kind) {
    case vscode.ColorThemeKind.Light:
    case vscode.ColorThemeKind.HighContrastLight:
      return "light";
    default:
      return "dark";
  }
}

function htmlFor(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = makeNonce();
  const css = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "worktable.css"));
  const js = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media", "worktable.js"));
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data:`,
    `style-src ${webview.cspSource}`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`
  ].join("; ");
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<link rel="stylesheet" href="${css}" />
<title>工作台</title>
</head>
<body>
<div id="root" class="wt-root"></div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

async function openExternal(raw: string): Promise<void> {
  try {
    const uri = vscode.Uri.parse(raw, true);
    if (uri.scheme !== "http" && uri.scheme !== "https") return;
    await vscode.env.openExternal(uri);
  } catch {
    // 非法 URL 直接忽略
  }
}

async function pushState(store: WorktableStore): Promise<void> {
  const panel = panelRef;
  if (!panel) return;
  const activeId = store.snapshot.activeProjectId;
  if (activeId) {
    await store.layoutFor(activeId, core.presetForProject(store.snapshot, activeId));
  }
  const message: HostToWebview = { type: "state", state: store.snapshot };
  await panel.webview.postMessage(message);
}

export function openWorktablePanel(
  ctx: vscode.ExtensionContext,
  store: WorktableStore,
  projectId?: string
): void {
  if (projectId) void store.update((s) => core.setActiveProject(s, projectId));

  if (panelRef) {
    panelRef.reveal();
    void pushState(store);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "traeWorktable.worktable",
    "工作台",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(ctx.extensionUri, "media")]
    }
  );
  panelRef = panel;
  panel.iconPath = vscode.Uri.joinPath(ctx.extensionUri, "media", "icons", "worktable.svg");
  panel.webview.html = htmlFor(panel.webview, ctx.extensionUri);

  panel.webview.onDidReceiveMessage(async (message: WebviewToHost) => {
    switch (message.type) {
      case "ready":
        await pushState(store);
        await panel.webview.postMessage({
          type: "themeKind",
          kind: themeKind()
        } satisfies HostToWebview);
        break;
      case "setLayouts":
        await store.update((s) => ({ ...s, layouts: message.layouts }));
        break;
      case "addProject":
        await vscode.commands.executeCommand("traeWorktable.addProject");
        break;
      case "setActiveProject":
        await store.update((s) => core.setActiveProject(s, message.projectId));
        break;
      case "setProjectMeta":
        await store.update((s) => core.setProjectMeta(s, message.projectId, message.patch));
        break;
      case "setPreset":
        await store.update((s) => core.setProjectPreset(s, message.projectId, message.presetId));
        break;
      case "setThemeConfig": {
        const cfg = vscode.workspace.getConfiguration("traeWorktable.theme");
        for (const [key, value] of Object.entries(message.theme)) {
          if (value !== undefined) await cfg.update(key, value, vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case "openExternal":
        await openExternal(message.url);
        break;
    }
  });

  const disposables: vscode.Disposable[] = [
    store.onDidChange(() => void pushState(store)),
    vscode.window.onDidChangeActiveColorTheme(() => {
      void panel.webview.postMessage({
        type: "themeKind",
        kind: themeKind()
      } satisfies HostToWebview);
    })
  ];

  panel.onDidDispose(
    () => {
      panelRef = undefined;
      while (disposables.length > 0) disposables.pop()?.dispose();
    },
    null,
    ctx.subscriptions
  );
}
