# trae-usage-worktable（DSH 插件 · P0 骨架）

> DeepSeek Harness 侧边栏的 agent 级项目容器。本目录是 `nscn6fdx44-crypto/trae-usage`
> 对上游 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) 的复刻，
> 采用同款 Cordis 插件协议（host 半侧 + client 半侧双 bundle）。

## 当前进度：P0 骨架 ✅ 已安装验证（2026-10-17，DSH 0.2.0-rc.2 桌面端真机）

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

### Windows 官方桌面端（当前唯一验证平台，DSH 0.2.0-rc.2 实测通过）

> 以下流程在 2026-10-17 真机验证。CLI 的 `plugin add` 只写依赖声明，**还有两步要手动做**（见步骤 3、5）——这是本机 pnpm 11.7 + DSH 0.2.0-rc.2 的实际行为，不是可选优化。

1. **完整退出** DeepSeek Harness（从菜单/托盘退出，只关窗口不够——否则 pnpm 写 profile 会被占用）；
2. 注册依赖（写入 `~/.dsh/profiles/desktop/package.json` + lockfile）：

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<本仓库绝对路径>\dsh"
```

3. **确认链接落盘**：`~/.dsh/profiles/desktop/node_modules/trae-usage-worktable` 必须是指向本仓库 `dsh/` 的链接。本机 pnpm 对 `link:` 依赖只更新 lockfile、**不创建链接**（状态文件假报 "Already up to date"）。若缺失，手动建 junction：

```powershell
node -e "require('fs').symlinkSync('<本仓库绝对路径>\dsh','C:\Users\<用户>\.dsh\profiles\desktop\node_modules\trae-usage-worktable','junction')"
```

4. 重跑步骤 2 的命令——这次 reconcile（bundle 解析）会通过，无报错即注册完成；
5. **把插件加进 bundles 列表**：编辑 `~/.dsh/profiles/desktop/package.json`，在 `dsh.profile.bundles` 数组末尾加一行 `"trae-usage-worktable"`（CLI 不会自动写这一项，不加应用启动时不加载插件）；
6. 手动重新打开 DeepSeek Harness。

### 网页端（未验证，语法同上游）

```sh
dsh plugin --profile web add "link:<本仓库绝对路径>/dsh"
```

## 验证

1. 侧边栏底部出现「工作台」区块（带 P0 徽标）；
2. 点开区域显示 `host 半侧健康路由已注册`，并拉到 host 健康 JSON；
3. **命令行复核**（应用启动时会在 stdout 打印 `dsh web: http://127.0.0.1:19387/?token=<令牌>`）：

```bash
# 用令牌换 auth cookie（303 重定向自动 set-cookie）
curl -s -L -c jar.txt "http://127.0.0.1:19387/?token=<令牌>"
# 带 cookie 打健康路由，应返回：
# {"plugin":"trae-usage-worktable","version":"0.1.0","ok":true,"node":"v24.x","platform":"win32"}
curl -s -b jar.txt "http://127.0.0.1:19387/api/worktable/health"
# 客户端包应在 boot map 里（页面 HTML 含 plugins/??trae-usage-worktable/client.js）
```

4. 失败排查：浏览器 DevTools Console 搜 `trae-usage-worktable`；host 侧看应用启动输出里 `[worktable] host 插件已加载`。

> **启动方式注意**：Electron 应用在带 `ELECTRON_RUN_AS_NODE=1` 的环境里启动会退化成纯 Node 进程（不起窗口、不开端口、表现为"卡住"）。从终端脚本启动时先 `env -u ELECTRON_RUN_AS_NODE`；日常请直接用桌面快捷方式。

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
