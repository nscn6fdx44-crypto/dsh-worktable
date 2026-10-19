# Trae Worktable —— DSH 插件

DeepSeek Harness（DSH）侧边栏**工作台**插件：把你的项目收纳成侧边栏应用抽屉，提供可停靠的分栏工作区——文件浏览、编辑器、终端、内置浏览器、媒体查看、笔记、自定义窗口与只读 git——全部在 DSH 内完成。

> 英文说明见 [README.md](README.md) · 当前版本 **0.8.52**

需要 **DSH `0.2.0-rc.2` 或 `0.2.1-rc.2`**（Windows 桌面端）。

## 安装（从 Release，推荐）

无需构建。**先完整退出 DSH**（右键托盘图标 → 退出）——否则 CLI 会报错 `profile "desktop" is managed exclusively by the Electron application`。

CLI 在「你的 DSH 安装目录」下的 `resources\runtime\cli\bin\dsh.cmd`——下面命令里的路径**换成你自己的**（装在 D 盘是 `D:\dsh\...`，默认位置是 `C:\Program Files\DeepSeek Harness\...`）。

**方式 A —— 直接按网址装**（DSH 自己去 GitHub 下载附件）：

```powershell
& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/download/v0.8.52/trae-usage-worktable-0.8.52.tgz"
```

**方式 B —— 下载后装本地文件**（GitHub 慢或被墙时用）：

1. 从 [v0.8.52 Release](https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/tag/v0.8.52) 把 `trae-usage-worktable-0.8.52.tgz` 下载到**你想放的任意目录**
   （128.1 KB，sha256 `d263ec9e917d764e3dd0eef0657ad61671d8a1bbe405648459644954f831da66`）
2. 在 PowerShell 执行——路径换成**你自己**存放的位置：
   ```powershell
   & "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<你下载的完整路径>\trae-usage-worktable-0.8.52.tgz"
   ```

重开 DSH —— 侧边栏即出现「工作台」面板。用 `/api/trae-worktable/health` 核对：`"version": "0.8.52"`。

## 功能

- **项目抽屉**——从侧边栏扫描、固定、排序、管理本机项目；卡片大小按宿主实际给的空间自适应
- **可停靠分栏工作区**——窗格贴在对话左侧，右侧留给**真能打字的** DSH 对话；比例可拖、按项目记忆
- **布局预设**——单栏 / 左右 / 上下，外加自由拖拽分栏
- **文件浏览与编辑**——带沙箱，拦截凭证目录（`.ssh` / `.aws` / `.env*` 等）与越界路径
- **终端**——在项目里跑命令，带历史面板
- **运行配置**——一键 ▶ 把命令喂进终端（cwd = 项目目录），■ 停止，端口直接开窗格
- **内置浏览器**——在停靠窗格里打开内部工具与网页（先探测可达性与能否 iframe）
- **媒体窗**——图片 / PDF / SVG / 音视频，支持「选择文件」与「浏览项目」
- **笔记窗**——按项目的随手笔记，Ctrl+S / 失焦保存
- **自定义窗口**——生成并保存小型 HTML 工具，窗格内预览
- **产物回挂**——项目里的 `.wt/artifact.json` 会把产物自动挂进窗格
- **总览**——所有项目与宿主会话一屏尽览，支持搜索、排序、筛选、拖到侧边栏固定
- **只读 git**——不离开 DSH 就能看仓库状态 / 日志 / 分支
- **快捷键体系**、项目模板、配置 JSON 导入导出

## 本版变更（0.8.48 → 0.8.52）

这五个版本修的都是同一族问题——侧边栏尺寸与让位几何：

- **0.8.48** 卡片改为测量宿主**实际**给的空间（`sideModeOf`），不再固定 `46vh / 330px`
- **0.8.49** 卡片不再压住宿主会话列表。真因是**溢出而非层级**：卡片禁止收缩（`flex: 0 0 auto`）导致溢出到列表上
- **0.8.50** 宿主开文件预览等重排时不再铺满整窗（`pickDock` 沿用上次几何并标 `stale`，随后重测）
- **0.8.51** 锚点彻底找不到时，降级盒子不再是 `inset: 0`，改为有界的 `is-undocked`
- **0.8.52** 侧边栏展开时不再吃掉宿主的关闭/收起键（降级盒子不再从 `x = 0` 起算）

离线自测：host **131** + client **481** 条断言全通过。

## 安全

- **防 CSRF**——仅本机 DSH（localhost）可调用插件路由，跨域请求一律 403
- **沙箱**——**写**操作限定在已注册的项目根目录，`..` 与绝对路径被拒
- **凭证保护**——`.ssh` / `.aws` / `.gnupg` / `.kube` / `.dsh` / `.netrc` / `.env*` / `.npmrc` / `.gitconfig` / `.pki` / `.azure` 均被拦截
- **SSRF 防护**——网页探测功能拒绝链路本地与云元数据地址（`169.254.*`、`fe80::`）
- **读**操作按设计**不**限于项目根（完整披露见 [dsh/README.md](dsh/README.md)）

## 从源码构建 / 开发者安装

```sh
cd dsh
npm install
npm run build      # 产出 lib/index.js + lib/client.js
npm test           # 离线自测（host 131 + client 481 条断言）
```

开发者 `link` 安装（需先完整退出 DSH）：

```powershell
& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<仓库根目录>\dsh"
```

插件源码位于 [`dsh/`](dsh) 目录。完整文档（路由、契约、踩坑、验收清单）见 [`dsh/README.md`](dsh/README.md)；交接说明见 [`dsh/HANDOFF.md`](dsh/HANDOFF.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
