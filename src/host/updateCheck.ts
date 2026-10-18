import * as vscode from "vscode";

export const REPO = "nscn6fdx44-crypto/dsh-worktable";
const RELEASES_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

export function compareSemver(a: string, b: string): number {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

function currentVersion(ctx: vscode.ExtensionContext): string {
  return String(ctx.extension.packageJSON.version ?? "0.0.0");
}

export async function copyUpgradePrompt(
  ctx: vscode.ExtensionContext,
  latest?: string,
  current?: string
): Promise<void> {
  const from = current ?? currentVersion(ctx);
  const to = latest ?? "最新版本";
  const text = [
    `请帮我把 Trae Worktable 升级到 ${to}。`,
    `仓库：https://github.com/${REPO}`,
    `当前版本：v${from}`,
    "要求：先只读核对远端 tag 与资产再执行升级；不要覆盖同名 tag 的资产。"
  ].join("\n");
  await vscode.env.clipboard.writeText(text);
  void vscode.window.showInformationMessage("工作台：升级提示已复制到剪贴板。");
}

export async function checkForUpdates(
  ctx: vscode.ExtensionContext,
  silent: boolean
): Promise<void> {
  const enabled = vscode.workspace
    .getConfiguration("traeWorktable.updateCheck")
    .get<boolean>("enabled", true);
  if (!enabled) {
    if (!silent) void vscode.window.showInformationMessage("工作台：更新检查已在设置中关闭。");
    return;
  }

  const current = currentVersion(ctx);
  let latest: string | undefined;
  try {
    const response = await fetch(RELEASES_LATEST, {
      headers: { "User-Agent": "trae-worktable", Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { tag_name?: string };
    const tag = String(data.tag_name ?? "").replace(/^v/, "");
    latest = tag || undefined;
  } catch {
    if (!silent) {
      void vscode.window.showWarningMessage(
        "工作台：检查更新失败（网络不可用，或仓库还没有 Release）。"
      );
    }
    return;
  }

  if (!latest) {
    if (!silent) void vscode.window.showInformationMessage("工作台：仓库暂无 Release 记录。");
    return;
  }

  if (compareSemver(latest, current) > 0) {
    const picked = await vscode.window.showInformationMessage(
      `工作台：发现新版本 v${latest}（当前 v${current}）。`,
      "复制升级提示",
      "查看变更日志"
    );
    if (picked === "复制升级提示") await copyUpgradePrompt(ctx, latest, current);
    else if (picked === "查看变更日志") {
      await vscode.commands.executeCommand("traeWorktable.showChangelog");
    }
  } else if (!silent) {
    void vscode.window.showInformationMessage(`工作台：已是最新版本（v${current}）。`);
  }
}
