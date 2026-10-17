# trae-usage-worktable（DSH 插件 · P0 骨架）

> DeepSeek Harness 侧边栏的 agent 级项目容器。本目录是 `nscn6fdx44-crypto/trae-usage`
> 对上游 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) 的复刻，
> 采用同款 Cordis 插件协议（host 半侧 + client 半侧双 bundle）。

## 当前进度：P0 骨架（可安装、可加载、可见入口）

| 半侧 | 文件 | 状态 |
|---|---|---|
| host（Node，跑在 DSH 进程内） | `src/index.js` → `lib/index.js` | 注册 `/api/worktable/health` 健康路由 |
| client（浏览器，ModuleLoader 握手） | `src/client/index.js` → `lib/client.js` | 侧边栏底部「工作台」区块（`sidebar.footer.action` 座位） |

**P0 验收标准**：装上后重启 DSH，侧边栏出现「工作台」入口；点开显示 host 半侧健康 JSON。

后续路线（每期可验收）：P1 项目抽屉（增删/改名/排序/显隐，localStorage）+ 分栏工作区骨架；
P2 host 能力（文件浏览 / 终端 WebSocket / git 状态，沿用 workbench/serve.mjs 的安全边界）；
P3 控制室（订阅宿主会话快照）；P4 发布打包（tgz + GitHub Release）。

## 目录结构

```
dsh/
├── package.json        # 注册三件套之一：main=host 入口，exports["./client"]=客户端包，dsh 配置块
├── dsh.plugin.json     # 注册三件套之二：插件元数据（版本须与 package.json 一致）
├── cordis.patch.yml    # 注册三件套之三：insert 挂进 Cordis
├── build.mjs           # esbuild 双 bundle（lib/index.js + lib/client.js）
├── src/
│   ├── index.js        # host 半侧：webServer.register 健康路由
│   └── client/
│       └── index.js    # client 半侧：slots.inject/register 侧边栏区块
└── lib/                # 构建产物（gitignore，安装前必须 build）
```

## 从源码构建

```sh
cd dsh
npm install        # 仅 esbuild 一个 devDependency
npm run build      # 产出 lib/index.js + lib/client.js
npm run check      # node --check 双 bundle
```

## 安装

### Windows 官方桌面端（当前唯一验证平台）

1. **完整退出** DeepSeek Harness（从菜单/托盘退出，只关窗口不够——否则 pnpm 写 profile 会被占用/不生效）；
2. 用桌面端自带 CLI 执行（路径为本仓库绝对路径，不能含空格）：

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\dsh"
```

3. 手动重新打开 DeepSeek Harness，刷新界面。

### 网页端（未验证，语法同上游）

```sh
dsh plugin --profile web add "link:<本仓库绝对路径>/dsh"
```

## 验证

1. 侧边栏底部出现「工作台」区块（带 P0 徽标）；
2. 点开区域显示 `host 半侧健康路由已注册`，并拉到 `/api/worktable/health` 的 JSON
   （含 `plugin / version / node / platform` 字段——证明 host 半侧活着）；
3. 失败排查：浏览器 DevTools Console 搜 `trae-usage-worktable`；host 侧看 DSH 日志里
   `[worktable] host 插件已加载`。

## 兼容声明（可证伪）

- 仅在 **DSH 0.2.0-rc.2 + Windows** 上验证（`package.json` 的 `dsh.compatibility.dsh` 只声明这一个版本）；
- 注入结构对齐上游 v0.4.0：`sidebar.footer.action` + children `sidebar.worktable.project`；
  `shell.overlay`（分栏浮层）留到 P1；
- 客户端 react / `@deepseek-ai/*` 全部 external，由宿主模块系统提供。

## 与另外三个形态的关系

本仓库同一设计有四个形态，互不替代：

| 形态 | 位置 | 定位 |
|---|---|---|
| DSH 插件（本目录） | `dsh/` | 导师指定的主力形态，host 有完整 Node 权限 |
| TraeCode 扩展 | `src/` | VS Code / TraeCode 插件（`.vsix`），测试版 |
| 单文件网页 | `workbench/` | 零服务公开页（GitHub Pages），扫本机项目 |
| TraeWork Skill | `traework/` | Skill 宿主适配形态 |

视觉体系（玻璃拟态/状态光）、布局预设、控制室卡片、扫描内核四者共享设计，
移植时以本目录为宿主能力最强的落地形态。

## License

MIT（同仓库根 LICENSE）。
