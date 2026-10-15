import * as vscode from "vscode";
import type { BackgroundId, LayoutState, ThemeMode, WorktableState } from "../shared/types";
import * as core from "../shared/state-core";

export class WorktableStore implements vscode.Disposable {
  private state: WorktableState;
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this.emitter.event;

  constructor(private readonly ctx: vscode.ExtensionContext) {
    this.state = core.normalizeState(ctx.globalState.get(core.STATE_KEY));
  }

  get snapshot(): WorktableState {
    return this.state;
  }

  async update(fn: (state: WorktableState) => WorktableState): Promise<void> {
    const next = fn(this.state);
    if (next === this.state) return;
    this.state = next;
    await this.ctx.globalState.update(core.STATE_KEY, next);
    this.emitter.fire();
  }

  /** 主题真值来自 VS Code 配置，每次变更后同步进状态并广播。 */
  async syncThemeFromConfig(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration("traeWorktable.theme");
    const theme = core.themeFromConfig({
      mode: cfg.get<ThemeMode>("mode"),
      accent: cfg.get<string>("accent"),
      opacity: cfg.get<number>("opacity"),
      background: cfg.get<BackgroundId>("background")
    });
    await this.update((s) => ({ ...s, theme }));
  }

  /** 取某项目在某预设下的布局状态，缺失时按预设创建。 */
  async layoutFor(projectId: string, presetId: string): Promise<LayoutState> {
    const key = core.layoutKey(projectId, presetId);
    const existing = this.state.layouts[key];
    if (existing) return existing;
    const created = core.ensureLayout(this.state, projectId, presetId);
    await this.update((s) => ({ ...s, layouts: { ...s.layouts, [key]: created } }));
    return created;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
