# trae-usage-worktable（DSH 插件 · MVP）

> DeepSeek Harness 侧边栏的完整工作台 UI。本目录是 `nscn6fdx44-crypto/trae-usage`
> 对上游 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) 的复刻，
> 采用同款 Cordis 插件协议（host 半侧 + client 半侧双 bundle）。
> 视觉基准 = 仓库根 `workbench/index.html`（单文件网页版），配色/布局/字体 1:1 移植。

## 当前进度：P0 ✅ / P1 ✅ / **MVP ✅（0.4.0，2026-10-17）**

| 半侧 | 文件 | 状态 |
|---|---|---|
| host（Node，跑在 DSH 进程内） | `src/index.js` → `lib/index.js` | **MVP：`/api/worktable/{health,sessions}`** + P1 `{tree,file}` 只读工作区 |
| client（浏览器，ModuleLoader 握手） | `src/client/index.js` → `lib/client.js` | **MVP：侧边栏整条工作台 + 主区两视图** |

### MVP 能力（本期范围）

- **侧边栏**（`sidebar.footer.action`）：**琥珀金底**（暖色渐变压深底），信息顺序对齐 dsh-worktable ——
  1. 顶部标题（🧰 工作台 / Workbench + 刷新 / 新建），交互键带**呼吸灯**（`wtKeyBreathe`）；
  2. **顶部状态栏**：进行中 x/y · 待处理 n · 会话快照时间 · DSH 对话总数；
  3. **临时项目列表**：列表本身就是导航，可上下滚动，点一行进入该项目内部；每行一个小圆点，
     颜色 = 工作状态（**跟随已绑定对话的运行状态**，手工点过则以手工为准）；
  4. **工作区会话**：直接列出宿主会话，点一行就**建成一个已绑定该对话的临时项目**并进入
     （已绑过的会话标 › 并跳到对应项目）；
  5. 底部一行右击提示（控制室已按需求移除）。
- **右击项目框**（`contextmenu`，卡片与侧边栏都支持）：界面布局（三分式 / 两分 / 单栏）·
  绑定 / 改绑 / 解除 DSH 对话 · 删除项目。
- **项目内部 = 分栏工作区**（`shell.overlay` 里承载，不再是全屏单页）：
  - **三分式**（默认）：左「项目信息」+ 中「主界面（留空）」+ 右「绑定对话」；
  - **两分**：主界面 + 右侧对话；**单栏**：只有主界面；
  - 对话区是**只读预览**：`/api/worktable/transcript` 读绑定会话的最近消息（user / assistant 文本气泡，
    过滤 reasoning 与工具入参），并在标题栏给「打开」回宿主对话。
- **新建临时项目 = 小窗**（挂在侧边栏、不强制铺开主区）：
  - 目录默认写好 **DSH 默认工作区**（host 端取最近活跃会话的 cwd），可点「默认工作区」复位；
  - **项目图标**：14 个 emoji + 「自动」（按目录名/分类推），存在 `wt.projects[].icon`；
  - **界面布局**：三张**预览草图**（三分式 / 两分 / 单栏），选完即写入 `wt.layouts`；
  - **绑定 DSH 对话**：下拉直接选一条宿主对话，创建时即建立绑定；
  - 语言标签已按需求移除（卡片/内部只显示图标、路径、状态、布局）。
- **临时项目**：只存在于本机 localStorage（不落盘、不进 git、删了不动磁盘文件），可绑定一个 **DSH 对话**。
- **会话统计**：`/api/worktable/sessions` 读宿主 `sessionQuery` / `sessions` 服务快照，**不调模型**、
  不写宿主数据；取不到服务时 200 降级，不拖挂页面。
- **四态状态光**：待命 / 进行中 / 待处理 / 已完成，卡片同步霓虹光效
  （完成=绿边光晕 / 待处理=橙边光晕 / 进行中=琥珀金彗星环）。

### 明确不做（P2 范围）

主界面里的文件树 / 终端 / 浏览器、可发送的对话窗（当前只读）、拖拽调宽、端口与磁盘扫描。
MVP 只跑通「侧边栏状态栏 + 项目列表导航 + 右击菜单 + 分栏布局 + 只读对话预览 + 小窗新建」。

## 数据与存储

- localStorage（统一 `wt.` 前缀）：`wt.view`（projects / project）/ `wt.projects`（临时项目）/
  `wt.bindings`（项目 → DSH 会话）/ `wt.status`（手工状态覆盖）/ `wt.layouts`（项目 → l3 / l2 / full）
- host 路由：
  - `GET /api/worktable/health` → 版本 + 会话服务可用性
  - `GET /api/worktable/sessions` → `{ ok, at, source, counts:{running,waiting,done,idle,total}, sessions:[{id,title,cwd,state,live,updatedAt}] }`
  - `GET /api/worktable/defaults` → `{ workspace, home, platform }`（新建小窗的默认目录）
  - `POST /api/worktable/transcript` → `{ sessionId, limit }` → `{ ok, title, messages:[{id,role,text,time}], truncated }`
  - P1 只读工作区仍在 `/api/trae-worktable/{tree,file}`（POST，参数走 body）；旧前缀 `{health,sessions}` 保留为别名
### 会话四态判定（只读事件日志）

| 状态 | 判定 |
|---|---|
| `running` 进行中 | 在活会话，日志里 `turn/start` 之后没有 `turn/end` |
| `waiting` 待处理 | 同上，且最后一条 `approval/asked` 没有对应的 `approval/decided` |
| `done` 已完成 | 日志里出现过 `turn/end`，当前没有未闭合 turn |
| `idle` 待命 | 还没有跑过任何 turn 的会话 |

## 目录结构

```
dsh/
├── package.json        # main=host 入口，exports["./client"]=客户端包，dsh 配置块
├── dsh.plugin.json     # 插件元数据（版本须与 package.json 一致）
├── cordis.patch.yml    # insert 挂进 Cordis
├── build.mjs           # esbuild 双 bundle + 版本注入
├── src/
│   ├── index.js        # host 半侧：/api/worktable/* + P1 只读工作区 + 探针
│   └── client/
│       └── index.js    # client 半侧：侧边栏工作台 + 主区两视图 + 弹窗 + 全套 CSS
├── test/
│   ├── host-routes.mjs # 31 项：health / sessions 四态 / defaults / transcript / tree / file
│   └── client-smoke.mjs# 67 项：两座位注册 / 侧边栏 / 右击菜单 / 分栏布局 / 小窗
└── lib/                # 构建产物（安装前必须 build）
```

## 从源码构建

```sh
cd dsh
npm install        # 仅 esbuild 一个 devDependency（仓库根 node_modules 已有时可跳过）
npm run build      # 产出 lib/index.js + lib/client.js
npm test           # 离线自测（stub 掉宿主，不需启动 DSH）
```

## 安装

### 开发态：link 本地源码（改代码即时生效）

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<本仓库绝对路径>\dsh"
```

pnpm 11.7 一般会创建 junction；若没建（README 旧版记录的坑），手工补：

```powershell
node -e "require('fs').symlinkSync('<本仓库绝对路径>\dsh','C:\Users\<用户>\.dsh\profiles\desktop\node_modules\trae-usage-worktable','junction')"
```

改完 `src/` 记得 `npm run build` 并**重启 DSH**（client bundle 按 rev 缓存，不重启不生效）。

### 发布态：tgz 走官方安装流程

```sh
cd dsh && npm install && npm run build && npm pack
```

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<本仓库绝对路径>\dsh\trae-usage-worktable-0.4.0.tgz"
```

两种方式都**必须**确认 `~/.dsh/profiles/desktop/package.json` 的 `dsh.profile.bundles` 里有
`"trae-usage-worktable"` —— `plugin add` 只写 dependencies，写不进 bundles 就完全不加载且无报错。

## 验收标准（重启 DSH 后）

1. 侧边栏出现「工作台」区块：标题 → **顶部状态栏（进行中 / 待处理 / 会话快照 / DSH 对话）** → 临时项目列表
   → 底部右击提示；**没有控制室入口**；
2. 每个项目行右侧有一个小圆点：绑定对话在跑 = 琥珀金（进行中）、等审批 = 橙（待处理）、
   跑完 = 绿（已完成）、否则灰（待命）；
3. 侧边栏「工作区会话」里点一条会话 → 直接出现一个已绑定该对话的临时项目并进入它；
4. 点任意项目行 → 主区进入**三分式**：左项目信息、中「主界面先留空」、右对话（能读到该对话最近消息）；
5. 右击项目行（或卡片）→ 菜单：切换三分式 / 两分 / 单栏，绑定 / 改绑 / 解除对话，删除项目；
   切完立刻生效，布局记在 `wt.layouts`；
6. 「＋ 新建临时项目」→ 弹出小窗（不铺全屏）：路径已填 **DSH 默认工作区**，可选 emoji 图标、
   三张布局草图、直接绑定一条对话；创建后卡片与侧边栏列表同时出现。

命令行复核（`dsh web` 启动日志里有带 token 的 URL）：

```bash
# PowerShell
curl.exe -s "http://127.0.0.1:19387/api/worktable/health"
curl.exe -s "http://127.0.0.1:19387/api/worktable/sessions"
curl.exe -s "http://127.0.0.1:19387/api/trae-worktable/pings"   # 前端执行轨迹探针
```

## 已知坑（真机踩过，逐条可复现）

1. **`dsh plugin add` 只写 dependencies，不写 `dsh.profile.bundles`**；而任何插件安装/升级操作都会重写
   bundles 数组。表现：依赖、node_modules、lib 全在，但页面里没有它、host 路由 404 —— 完全不加载且无报错。
   **每次装完都要复核 bundles**。
2. **上游 `dsh-worktable@0.4.0` 与本机 DSH 0.2.0-rc.2 不兼容**：其 client entry 激活失败 →
   `web boot: 1 entry did not activate` → **整个应用打不开**。而且它占用 `/api/worktable/*`，与本插件正面冲突。
   0.4.0 起本插件接管 `/api/worktable/*`，**不要与上游同时启用**（本机已移除上游包）。
3. P1 的只读工作区路由留在 `/api/trae-worktable/*`，避免与上游/MVP 前缀互撞。
4. **serve 层按请求时的文件内容实时算 rev**：`lib/client.js` 一改，旧 `&rev=` URL 立即 404；必须重启。
5. Electron 应用在带 `ELECTRON_RUN_AS_NODE=1` 的环境里启动会退化成纯 Node 进程（不起窗口、不开端口）。
6. 用 PowerShell `Set-Content -Encoding UTF8` 改 `package.json` 会写入 BOM，导致 `build.mjs` 的
   `JSON.parse` 直接失败 —— 要写就得用 `UTF8Encoding($false)`。
7. **侧边栏容器上别用 `backdrop-filter` 或 `overflow:hidden`**：二者都会给 `position:fixed` 的后代创建
   containing block 并裁剪，右击菜单/小窗会被侧边栏矩形切掉一半。现在 `.wt-side` 两者都不用，列表自带滚动。
8. 右击菜单、两个小窗、toast 都挂在**侧边栏**（常驻挂载），不放主区：主区关着时也得能弹；
   `store.modal` 不再顺带 `open: true`，否则点「新建」会先把整块主区铺开。

## 关键契约（改代码前必读）

- `props.renderSlot` **不是**通用子座位渲染器，而是绑定到本 entry 自身 children 声明的渲染绑定；
  空参调用抛 `SlotOwnershipError`，会被错误边界吞成空白。**注册成功 ≠ 渲染成功**，渲染期异常必须
  由 `SidebarBoundary` / `OverlayBoundary` 兜住并显示可见错误，而不是白屏。
- 会话服务**可选**：`sessions` 走 `ctx.inject(['sessions'], cb)` 延迟接入；写进 `export const inject`
  会让插件在无会话服务的 profile 里永不启动。
- client 侧 react / `@deepseek-ai/*` 全部 external，由宿主模块系统提供；只用 `createElement`（`.js` 无 JSX）。
- 所有 CSS 收在 `.wt-scope` 下：宿主 DSH 自身也用 `.card` / `.btn` / `.grid` 这类通用类名，不隔离必撞。

## 兼容声明（可证伪）

- 仅在 **DSH 0.2.0-rc.2 + Windows** 上验证（`dsh.compatibility.dsh` 只声明这一个版本）；
- 座位：`sidebar.footer.action`（侧边栏区块）+ `shell.overlay`（主区浮层），与上游 v0.4.0 的注入形态一致；
- 会话跳转依赖宿主暴露 `uiWorkspace.openSession` 或 `sessions.open`，都没有时降级为提示文案。

## 与另外三个形态的关系

本仓库同一设计有四个形态，互不替代：

| 形态 | 位置 | 定位 |
|---|---|---|
| DSH 插件（本目录） | `dsh/` | 主力形态，host 有完整 Node 权限 |
| TraeCode 扩展 | `src/` | VS Code / TraeCode 插件（`.vsix`），测试版 |
| 单文件网页 | `workbench/` | 零服务公开页（GitHub Pages），扫本机项目 |
| TraeWork Skill | `traework/` | Skill 宿主适配形态 |

## License

MIT（同仓库根 LICENSE）。
