import * as vscode from "vscode";

export async function showChangelog(ctx: vscode.ExtensionContext): Promise<void> {
  const uri = vscode.Uri.joinPath(ctx.extensionUri, "CHANGELOG.md");
  try {
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });
  } catch {
    void vscode.window.showWarningMessage("工作台：未找到 CHANGELOG.md。");
  }
}
