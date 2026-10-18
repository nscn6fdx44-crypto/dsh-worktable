# AGENTS.md

本文件是本仓库的长期约定，任何后续改动都要遵守。

## 1. 项目身份

- 包名 `trae-worktable`，产物是 **TraeCode IDE 扩展**（VS Code 扩展格式）
- 远端仓库：`https://github.com/nscn6fdx44-crypto/dsh-worktable`
- 上游参考：`https://github.com/Aisland-SJL/dsh-worktable`（MIT）。本项目为**独立实现**，未复制其源代码，只参考了功能设计与工程纪律

## 2. 目录职责

| 路径 | 职责 |
|---|---|
| `src/extension.ts` | 激活入口，只做装配，不写业务逻辑 |
| `src/shared/` | 宿主与 Webview 共用的纯逻辑与类型；**不得 import `vscode`** |
| `src/host/` | 扩展宿主侧：状态、树视图、命令、Webview 宿主、更新检查 |
| `src/webview/` | Webview 侧：分栏引擎、窗格、外观、样式；**不得 import `vscode`** |
| `media/` | 构建产物与静态资源（`worktable.js` / `worktable.css` 由构建生成，不要手改） |
| `test/` | 离线回归测试，全部是 `.mjs`，用 `node:assert` |
| `scripts/` | 发布与验收脚本 |

**样式单一来源**：CSS 只写在 `src/webview/styles.css`，构建时复制到 `media/worktable.css`。

## 3. 硬性约束

1. `src/shared/` 与 `src/webview/` **禁止** import `vscode`；宿主能力只能通过 `src/shared/protocol.ts` 的消息协议获取
2. Webview 的 CSP **不得**放宽到 `'unsafe-inline'`；动态尺寸与主题变量一律走 CSSOM（`el.style.width = ...` / `setProperty`），不要用内联 `style` 属性或内联 `<style>`
3. 任何来自 Webview 的 URL，必须先校验 scheme 只允许 `http` / `https` 才 `openExternal`
4. 不读写 TRAE 的原始数据文件；扩展状态一律存 VS Code `globalState`
5. 密钥 / 凭证永不入库、永不写日志

## 4. 布局预设的演进规则

- 新预设**只追加到 `PRESET_DEFS` 末尾**，数组顺序即 UI 显示顺序
- 字段名保持稳定，不重命名、不删除旧字段
- 聊天窗恒在最右侧，不计入 `contentCount`
- 窗口编号顺序恒为 **左栏 → 顶行 → 主行**
- 改动预设后必须让 `test/presets.test.mjs` 全绿

## 5. 工程纪律（继承自上游）

- **设计先给最小版**：任何 UI / 文案先交「最少元素」版本拍板，确认后再增量；默认克制
- **长任务拆 checkpoint**：每个可验收阶段停下汇报
- **对外动作永远先审**：push、发布、评论等公开操作一律先过目
- **改完必读回**：每次编辑后读回改动处完整行，确认无残留、无断尾
- **验收用最终产物**：「构建成功」「退出码 0」不算验收，必须解包 / 实跑用户路径
- **声明可证伪，不许写满**：验收结论只写已验证范围
- **同 tag 资产不可覆盖**：坏包处理 = 发新版本号 + 旧 Release 标注问题

## 6. 常用命令

```bash
npm run build            # esbuild 双端构建 + 复制样式
npm run check            # node --check 构建产物
npm test                 # 离线回归（会自动先 build）
npm run verify:package   # 离线打包结构断言
npm run pack             # 构建 + 检查 + 测试 + 出 .vsix
npm run typecheck        # tsc --noEmit（需先 npm install）
```

```bash
# 网页版工作台（workbench/），在仓库根目录执行
npm run workbench:build  # 由 workbench.template.html 生成单文件 workbench/index.html
npm run workbench:check  # 静态校验 + 沙箱冒烟 + 服务端路由契约
npm run workbench:e2e    # 真实浏览器：主链路 e2e + 权限矩阵 M1-M12（需本机 Edge/Chrome）
```

验收顺序固定为：先 `workbench:build`，再 `workbench:check`，最后 `workbench:e2e`；
e2e 用的是构建出的 `workbench/index.html`，不是模板。

## 7. 分支与标签

- `main` 只收打过 tag 的提交；`dev` 集成；`feat/<模块>` 开发
- 每阶段一个 tag：`v0.1.0-scaffold` → `v0.2.0-drawer` → `v0.3.0-theme` → `v0.4.0-split` → `v0.5.0-release`
- 上游参考源码若引入，只放 `reference/dsh-worktable/`，独立提交、不参与构建
