# trae-usage-worktable（DSH 插件 · 0.6.0）

> DeepSeek Harness 侧边栏的完整工作台。本目录是 `nscn6fdx44-crypto/trae-usage`
> 对上游 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) 的**独立实现**：
> 同款 Cordis 双 bundle 协议、同款交互模型，代码自己写、路由前缀自带
> （`/api/trae-worktable/*`），不与上游抢路径。

## 能力（0.6.0）

| 半侧 | 文件 | 内容 |
|---|---|---|
| host | `src/index.js` → `lib/index.js` | 会话快照 / 文件读写 / 命令执行 / git 只读 / 项目静态托管 |
| client | `src/client/*` → `lib/client.js` | 侧边栏工作台 + 控制室 + 卡片网格 + 可拖拽分栏工作区 |

### 侧边栏（`sidebar.footer.action`，常驻）

1. 标题（🧰 工作台）+ 刷新 / 新建；
2. 状态栏：进行中 · 待处理 · 项目数 · 未绑定数；
3. **项目列表**：按「分组」归组，点一行进入工作区；每行状态灯跟随绑定对话，也可点击手工覆盖；
4. **不再单列宿主会话**——那份列表与项目列表信息重复，宿主会话统一在「绑定对话」里选；
5. 右击项目：模式 / 编辑 / 绑定对话 / 删除。

### 控制室 + 卡片网格（`shell.overlay`）

- **控制室**：宿主四态计数、快照时间与来源、前 6 个进行中会话及其实时计时（每秒刷新，纯本地推算）；
- **项目卡片**：图标 / 名称 / 状态 / 主对话标题 / 备注 / 模式标签 / 绑定数；
  状态有霓虹光效（进行中=彗星环，待处理=橙边，已完成=绿边）。

### 项目工作区（左栏 / 中间 / 对话栏恒在）

三栏位置固定：**左栏（项目·文件）· 中间工作区 · 右栏对话**。两侧不会被任何模式隐藏。
中间栏有两种形态（`ui.mode`），共用同一套标签页与窗格：

| 模式 | 形态 |
|---|---|
| `全屏`（dock） | 工作区铺满中间区域，直接拖动分割条调宽 |
| `窗口`（float，默认） | 贴着对话栏的一个浮动视窗：拖标题栏移动、右下角缩放、双击标题栏复位、可一键转全屏 |

- **两种模式共用同一份比例**：分割条调出来的左/中/右宽度对两种模式同时生效（`ui.split`），
  窗口几何另存 `ui.win`（比例值），都按项目持久化；
- **左栏**两个页签：`项目`（信息 / 绑定对话 / git 状态与最近提交）· `文件`（目录浏览 + 路径跳转）；
- **中间是标签页工作区**，可同时开多个：`编辑器` / `终端` / `浏览器` / `自定义`；
  - **编辑器**：读文件、改、`Ctrl+S` 保存回磁盘（原子写：临时文件 + rename）；
  - **终端**：把命令交给宿主所在机器执行，NDJSON 流式回显；`cd` 由 host 接管并保持；
    `↑↓` 翻历史、`Ctrl+L` 清屏、可中断、120s 超时、512KB 输出上限；
  - **浏览器**：iframe + 地址栏；默认打项目的静态托管地址，也可填 `localhost` 开发服务器；
  - **自定义**：左边写 HTML、右边实时预览（iframe sandbox）。
- **右栏对话**：读绑定会话最近消息（只读预览，过滤 reasoning 与工具入参），
  「在宿主打开 / 刷新 / 绑定对话」。
- **绑定只有一个入口**：右击项目（或卡片按钮 / 对话区按钮）打开的同一张小窗里，
  点会话即绑定、再点即解绑、`设为主` 切换主对话；不再有单独的「解除绑定」菜单项。

## host 路由

统一前缀 `/api/trae-worktable`：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 版本 / 平台 / 服务可用性 / 上限常量 |
| GET | `/sessions` | `{ ok, at, source, counts:{running,waiting,done,idle,total}, sessions:[{id,title,cwd,state,live,updatedAt,turns}] }` |
| GET | `/defaults` | `{ workspace, home, platform, shell }`（新建项目的默认目录） |
| POST | `/transcript` | `{ sessionId, limit }` → `{ ok, title, cwd, messages:[{id,role,text,time}], truncated }` |
| POST | `/fs/list` | `{ path }` → `{ path, name, parent, entries:[{name,dir,link,size,mtime}], total, truncated }` |
| POST | `/fs/read` | `{ path }` → `{ path, name, size, mtime, text, truncated, eol }`，二进制 / 超 4MB 拒绝 |
| POST | `/fs/write` | `{ path, text }` → 原子写（`path.wt-tmp-<pid>` + rename） |
| POST | `/fs/mkdir` | `{ path }` → 递归建目录 |
| POST | `/fs/rename` | `{ from, to }` → 移动 / 改名，目标已存在则 409 |
| POST | `/fs/stat` | `{ path }` → `{ dir, size, mtime }` |
| POST | `/term/exec` | `{ id, cmd, cwd }` → `application/x-ndjson` 流：`{t:'out'|'err'|'sys'|'cwd'|'clear'|'end'}` |
| POST | `/term/kill` | `{ id }` → 终止当前命令 |
| POST | `/git` | `{ path, op:'status'|'log'|'branches' }` → **只读**，`status` 解析 `-z` porcelain |
| POST | `/project/register` | `{ id, root }` → 登记项目根，供静态托管与路径白名单使用 |
| GET | `/site/<项目id>/<相对路径>` | 前缀路由，托管项目目录；目录回退 `index.html`，拦截路径穿越 |

### 会话四态判定（只读事件日志，不调模型）

| 状态 | 判定 |
|---|---|
| `running` 进行中 | 在活会话，日志里 `turn/start` 之后没有 `turn/end` |
| `waiting` 待处理 | 同上，且最后一条 `approval/asked` 没有对应的 `approval/decided` |
| `done` 已完成 | 出现过 `turn/end`，当前没有未闭合 turn |
| `idle` 待命 | 还没跑过任何 turn |

> 注意：host 输出的是上游命名（running / waiting），UI 的四态是 working / needs-you。
> 换算只发生在 `core.js` 的 `normState()` 一处 —— 这是 0.4.0 的 bug 根源（状态灯全灰）。

## 数据与存储

localStorage（统一 `wt.` 前缀）：

| key | 内容 |
|---|---|
| `wt.projects` | 项目：`{id,name,alias,icon,path,note,folder,order,hidden,sessions[],created,updated}` |
| `wt.ui.v2` | 每个项目的工作区状态：`{ layout, split:{left,chat}, leftTab, tabs[], activeTab }` |
| `wt.status` | 手工状态覆盖（点了状态灯才写） |
| `wt.view` | `grid` / `project` |
| `wt.termHistory` | 终端命令历史（最近 80 条） |
| `wt.bindings`、`wt.layouts` | 0.4.0 旧格式，**首次加载自动迁移**进 `wt.projects[].sessions` 与 `wt.ui.v2` |

项目元数据只在浏览器里，删项目不动磁盘。**唯一的磁盘写入**是编辑器保存与 `mkdir/rename`。

## 安全边界（与上游有意不同）

1. 所有路径必须落在白名单根内：进程 cwd、用户 home、`DSH_HOME`、已登记的项目根；
2. 先 `realpath` 解析符号链接再判根（逐级回退到第一个存在的祖先），挡 `../` 与 symlink 逃逸；
3. `.ssh` / `.aws` / `.gnupg` / `.kube` / `.password-store` 一律拒绝；
4. 不再把任意请求体写进插件目录（上游 `/ping` 就这么干过，本版已删除该路由）；
5. 命令用 `spawn(file, args)` 而非 `exec`，不拼 shell 字符串；`git` 用 `execFile` 且只暴露只读 op。

已知取舍：终端是「每条命令一个进程 + host 记 cwd」，不是常驻交互式 PTY。
因此 `cd` 生效、环境变量继承、单条命令可中断，但不支持 `top`/`vim` 这类全屏交互程序。

## 目录结构

```
dsh/
├── package.json        # main=host 入口，exports["./client"]=客户端包，dsh 配置块
├── dsh.plugin.json     # 插件元数据（版本须与 package.json 一致，build 会校验）
├── cordis.patch.yml    # insert 挂进 Cordis
├── build.mjs           # esbuild 双 bundle + 版本注入
├── src/
│   ├── index.js        # host：路由表 / 路径沙箱 / 终端 / git / 静态托管
│   └── client/
│       ├── index.js    # 入口：座位注册 + 错误边界 + 心跳/轮询
│       ├── core.js     # 状态 / 存储迁移 / host API / 模式与窗口几何 / 全部动作
│       ├── ui.js       # el / 图标 / 状态灯 / 分割条 / 右击菜单 / 弹窗外壳
│       ├── sidebar.js  # 侧边栏工作台
│       ├── overlay.js  # 顶栏 / 控制室 / 卡片网格 / 三栏工作区 + 浮动视窗
│       ├── panes.js    # 项目 / 文件 / 编辑器 / 终端 / 浏览器 / 自定义 / 对话
│       ├── modals.js   # 新建 / 编辑 / 绑定
│       └── theme.css   # 全套样式（收在 .wt-scope 下）
├── test/
│   ├── host-routes.mjs # 56 项：路由 / 沙箱 / 文件 / git / 托管 / 终端
│   └── client-smoke.mjs# 74 项：座位 / 侧边栏 / 菜单 / 两种模式 / 标签页 / 小窗
└── lib/                # 构建产物（安装前必须 build）
```

## 构建与自测

```sh
cd dsh
npm run build      # 产出 lib/index.js + lib/client.js
npm test           # 离线自测：stub 掉宿主，不需启动 DSH
```

## 安装

### 开发态：link 本地源码

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<本仓库绝对路径>\dsh"
```

本机已 link：`~/.dsh/profiles/desktop/node_modules/trae-usage-worktable` → 本目录。
改完 `src/` 执行 `npm run build` 并**重启 DSH**（client bundle 按 rev 缓存，不重启不生效）。

### 发布态：tgz

```sh
npm run build && npm pack
```

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<本仓库绝对路径>\dsh\trae-usage-worktable-0.5.0.tgz"
```

## 验收清单（重启 DSH 后）

1. 侧边栏出现「工作台」，状态栏数字与 DSH 里实际在跑的会话一致；
2. 点项目 → 主区铺开，默认「窗口」模式：中间是贴着对话栏的浮动视窗，拖标题栏能移动、右下角能缩放；
   切「全屏」后工作区铺满中间，**拖动两条分割条**能改宽，刷新后宽度与模式都还在；
3. 左栏「文件」→ 列目录 → 点 `package.json` → 中栏开编辑器 → 改一行 → `Ctrl+S` → 磁盘内容确实变了；
4. 打开「终端」→ `git status` 有输出 → `cd ..` 后再 `pwd` 路径确实变了；
5. 「浏览器」默认打开项目静态页（256 行 HTML 能渲染）；
6. 右栏显示绑定对话的最近消息，点「在宿主打开」能跳回宿主会话；
7. 右击项目可在两种模式间切换；左栏与对话栏在两种模式下始终可见；
8. 侧边栏里只有项目，不再有单独的「宿主会话」列表；右击只有一个「绑定对话」入口。

## 已知坑（真机踩过，逐条可复现）

1. **路由冲突**：上游 dsh-worktable 占 `/api/worktable/*`，DSH 的 exact 路由先注册者胜出 →
   本插件永久让出该前缀，全部走 `/api/trae-worktable/*`。
2. **侧边栏不能有 `backdrop-filter` / `overflow:hidden`**：会给 `position:fixed` 后代创建
   包含块并裁剪，右击菜单会被切掉。
3. **`ctx.slots.inject` 里 `renderSlot` 必须传自己的座位名**，空参调用抛 `SlotOwnershipError`，
   会被 React 错误边界吞成空白。
4. **Register 成功 ≠ 渲染成功**，两侧都要错误边界。
5. **会话服务可选**，必须 `ctx.inject(['sessions'], cb)` 延迟接入。
6. **`webServer.register` 返回 disposer 且重复注册抛错**，必须接住并在 `ctx.effect` 里释放，
   否则插件重载会撞 duplicate route。
7. **前缀路由**：`kind:'prefix'` 匹配 `path` 或 `path/...`，最长前缀优先。
8. **client bundle 按 rev 缓存**：改完不重启 DSH 不生效。

## 关键契约（改代码前必读）

- 四态换算只在 `normState()`；不要在组件里再判 `'running'`。
- 所有 host 调用走 `apiGet/apiPost`；`loadTranscript` 有竞态令牌，别绕过它直接 fetch。
- 三栏结构写死在 `overlay.js` 的 `ProjectView`：左栏与对话栏**不允许**按模式隐藏；
  模式只决定中间栏是 `.pane-main`（全屏）还是 `.pane-canvas + .float-win`（窗口）。
- 窗口几何存比例（`ui.win`），拖动中 `persist=false`、松手 `flushUi()`；分割条同理。
- 分割条：拖动中 `persist=false`（只 emit），松手必须 `flushUi()` 落盘 ——
  不能拿闭包里的旧宽度回写。
- 选择器一律收进 `.wt-scope`，避免污染宿主的 `.card` / `.btn` / `.grid`。

## 与上游的差异（有意为之）

| 项 | 上游 0.4.0 | 本插件 0.6.0 |
|---|---|---|
| 右侧对话 | 宿主会话视图让位（margin + CSS 变量），可真实输入 | 只读预览 + 一键跳回宿主 |
| 终端 | node-pty + WebSocket，真 PTY | 每命令一进程 + NDJSON 流，无原生依赖 |
| 文件安全 | 任意绝对路径 | 根白名单 + realpath + 凭证目录拒绝 |
| 窗口模型 | 窗格内多标签、跨格拖拽、自由浮动层 | 单工作区多标签页 + 「全屏 / 窗口」两形态的浮动视窗 |
| 路由前缀 | `/api/worktable` | `/api/trae-worktable`（不抢注） |

## License

MIT（与上游一致）。
