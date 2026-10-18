# trae-usage-worktable（DSH 插件 · 0.8.0）

> DeepSeek Harness 侧边栏的完整工作台。本目录是 `nscn6fdx44-crypto/trae-usage`
> 对上游 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) 的**独立实现**：
> 同款 Cordis 双 bundle 协议、同款交互模型，代码自己写、路由前缀自带
> （`/api/trae-worktable/*`），不与上游抢路径。

## 能力（0.8.0）

| 半侧 | 文件 | 内容 |
|---|---|---|
| host | `src/index.js` → `lib/index.js` | 会话快照 / 文件读写 / 命令执行 / git 只读 / 项目静态托管 |
| client | `src/client/*` → `lib/client.js` | 侧边栏工作台 + 总览 / 工作区（同一套让位外壳，右侧始终是宿主对话）|

### 侧边栏（`sidebar.footer.action`，常驻）

1. 标题（🧰 工作台）+ 刷新 / 新建；
2. **状态框只记四个工作状态**，2×2 紧凑排布：进行中 · 待处理 · 已完成 · 待命
   （原来的「项目数 / 未绑定数」已删——项目数在下面的列表标题上，未绑定看行上的 🔗）；
   **侧边栏高度固定**（`min(70vh, 640px)`），项目再多也不撑高，列表在自己的区域里上下滚；
3. **项目列表**：按「分组」归组，点一行进入工作区；每行状态灯跟随绑定对话，也可点击手工覆盖；
4. **不再单列宿主会话**——那份列表与项目列表信息重复，宿主会话统一在「绑定对话」里选；
5. 右击项目：编辑 / 绑定对话 / 删除（模式项随窗口模式一起删了）。

> 状态更新：客户端每 **10s** 拉一次 `/sessions`，host 每次请求都重读事件日志；
> 判定活跃会话不再依赖列表行的 `live` 标记（持久化列表常常没有这个字段），
> 只要 `sessions.get(id)` 还能取到日志就按活会话算 —— 这就是之前「状态不动」的原因。

### 总览（`shell.overlay`）：也是一个「贴着对话的窗口」

总览不再整块盖住宿主：和工作区完全一样——把宿主会话区右推，自己只占左边那块，
**右侧照旧是 DSH 原生对话**（能继续打字），右边缘一条 `dock-edge` 拖动条可以左右拉：

- 顶栏：🧰 工作台总览 · 快照来源 · 在跑数 · `↻` · `＋ 新建` · `✕`；
- 形态与工作区完全一致：铺满让位区（窗口模式已删除）；
- 让位宽度单存一份（`wt.ui.v2.__overview.dock`），与任何项目互不影响；
- 面板里三个页签，计数挂在页签徽标上：

| 页签 | 内容 |
|---|---|
| `▦ 项目` | 项目卡片墙 + 新建卡片。卡片 = 图标 / 名称 / 状态 / 主对话标题 / 备注 / 绑定数，状态有霓虹光效（进行中=彗星环，待处理=橙边，已完成=绿边） |
| `◉ 宿主会话` | 宿主全部会话：状态灯 / 标题 / 工作目录 / 状态中文标签；已绑定的给「进入项目」，未绑定的给「建为项目」（以会话标题和它自己的工作目录建项目并进入），右上角还有「打开对话」 |
| `◐ 运行中` | 只列进行中的会话 + 每秒刷新的实时计时；有待处理时只提示一句，明细去「宿主会话」页 |

对比原来：不再有独占一屏的四格统计（与侧边栏状态栏、顶栏副标题重复），
总览和工作区共用同一套 `.dock-wrap / .dock-head / .ws / .pane-main / .dock-edge` 结构，
所以在总览和工作区之间切换时视觉不跳、宽度手感一致。卡片墙改用 `auto-fill` 列，
让位区拉窄拉宽都不会溢出。

### 项目工作区（插在 DSH 对话左侧）

点项目 → 工作台不盖住对话，而是**把宿主自己的会话区往右推**（给中心列加 `marginLeft`），
左边腾出来的那块给工作台。所以右侧始终是 DSH 原生对话：真能打字、真能发消息，
不是只读预览（`hostdock.js`）。侧边栏也在原位不动。

工作台只有一种形态：**铺满让位区**（`0.8.0` 删除了窗口模式与浮动小窗）。
工作台与对话的分界是一条 `dock-edge` 拖动条，拖动即改 `ui.dock`，双击恢复自动
（轨道 64%，且给对话至少留 380px）。

- **没有左栏**（0.7.1 删除）：项目信息与文件浏览都改成标签页，整块让位区都归工作区；
- **标签页**可同时开多个：`🗂 文件管理器` / `◆ 编辑器` / `›_ 终端` / `◍ 浏览器` / `❖ 自定义`，
  另有 `ⓘ 项目信息`（状态 / 绑定对话 / git 状态与最近提交）从顶栏按钮打开；首次进项目自动开文件管理器；
  - **文件管理器**：**默认开在这个项目「对话的工作目录」**（主绑定会话的 `cwd`），
    不是项目目录；顶栏可一键切「💬 对话目录 / 📁 项目目录」，`↑` 上级、`⟳` 刷新、
    路径可复制，也可输入绝对路径跳转；点文件自动开编辑器，点目录进入；
    对话的 cwd 会被单独登记进 host 路径白名单（`<项目id>~cwd`），D 盘目录也能读；
  - **编辑器**：读文件、改、`Ctrl+S` 保存回磁盘（原子写：临时文件 + rename）；
  - **终端**：把命令交给宿主所在机器执行，NDJSON 流式回显；`cd` 由 host 接管并保持；
    `↑↓` 翻历史、`Ctrl+L` 清屏、可中断、120s 超时、512KB 输出上限；
  - **浏览器**：iframe + 地址栏；默认打项目的静态托管地址，也可填 `localhost` 开发服务器；
  - **自定义**：左边写 HTML、右边实时预览（iframe sandbox）。
- **进项目即切对话**：把宿主切到项目的主绑定对话（`uiWorkspace.openSession`，
  缺席时退到 `sessions.open`），所见即所聊；顶栏气泡显示当前主对话与状态灯。
- **绑定只有一个入口**：右击项目（或卡片按钮 / 顶栏气泡）打开的同一张小窗里，
  点会话即绑定、再点即解绑、`设为主` 切换主对话；不再有单独的「解除绑定」菜单项。
- **新建项目时可以直接开一个新对话**：绑定下拉里有「＋ 新建对话（用项目目录）」，
  创建项目后会按项目目录向宿主要一个新会话并绑定（宿主没暴露入口时只建项目，稍后手动绑）。
  同一张弹窗里的「默认工作区」按钮已删除（DSH 并没有那个目录）。

> 让位几何全部来自实测：`left = 中心列 · 侧边栏右边界`、`top = 宿主标题栏 padding`，
> 并避开「侧边栏收起」时浮在左上角的展开按钮。宿主结构认不出来时自动降级成整块覆盖
> （功能不变，只是看不到右侧对话），不会白屏。

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
| `wt.ui.v2` | 每个项目的工作区状态：`{ dock, tabs[], activeTab }`（`mode` / `win` 已废弃，读到时忽略） |
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
│       ├── core.js     # 状态 / 存储迁移 / host API / 让位宽度 / 全部动作
│       ├── ui.js       # el / 图标 / 状态灯 / 分割条 / 右击菜单 / 弹窗外壳
│       ├── sidebar.js  # 侧边栏工作台
│       ├── hostdock.js # 宿主让位：会话区右推 + 让位几何（computeDock 纯函数）
│       ├── overlay.js  # 总览 / 工作区（共用同一套让位外壳）
│       ├── panes.js    # 项目信息 / 文件管理器 / 编辑器 / 终端 / 浏览器 / 自定义
│       ├── modals.js   # 新建 / 编辑 / 绑定
│       └── theme.css   # 全套样式（收在 .wt-scope 下）
├── test/
│   ├── host-routes.mjs # 57 项：路由 / 沙箱 / 文件 / git / 托管 / 终端 / 四态判定
│   └── client-smoke.mjs# 113 项：座位 / 侧边栏四态 / 菜单 / 让位换算 / 文件管理器 / 标签页
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
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<本仓库绝对路径>\dsh\trae-usage-worktable-0.8.0.tgz"
```

## 验收清单（重启 DSH 后）

1. 侧边栏出现「工作台」，状态栏数字与 DSH 里实际在跑的会话一致；
2. 点项目 → **DSH 自己的对话被挤到右边**（不是盖住），左边是工作台，默认「窗口」模式：
   小窗贴着对话，拖标题栏能移动、右下角能缩放；
3. 右侧对话能正常打字、发送 —— 它就是宿主会话，不是预览；
4. 拖工作台右边缘的 `dock-edge` 能改工作台宽度、右侧对话跟着变宽变窄；双击恢复自动；
   切「全屏」后同一份宽度仍然生效，刷新后宽度与模式都还在；
5. 「🗂 文件」标签页 → 列目录 → 点 `package.json` → 自动开编辑器 → 改一行 → `Ctrl+S` → 磁盘内容确实变了；
6. 打开「终端」→ `git status` 有输出 → `cd ..` 后再 `pwd` 路径确实变了；
7. 「浏览器」默认打开项目静态页；顶栏「ⓘ 项目信息」把状态 / 绑定 / git 开成标签页；
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
- 所有 host 调用走 `apiGet/apiPost`（统一超时、错误形状、竞态令牌）。
- **对话栏是宿主的，不是我们渲染的**：进项目时 `hostdock.js` 给宿主中心列加 `marginLeft`，
  `.wt-root` 只铺满但不吃事件（`pointer-events:none`），只有 `.wt-dock` 可交互。
  别再把工作台做成全屏浮层 —— 那样会盖住对话。
- 让位是**可逆副作用**：进项目记下原 `marginLeft`，退出 / 关闭 / 卸载都要还原；
  锚点找不到就降级成整块覆盖，不能白屏。
- 模式只决定工作台内部是 `.pane-main`（全屏）还是 `.pane-canvas + .float-win`（窗口）。
- 窗口几何存比例（`ui.win`），拖动中 `persist=false`、松手 `flushUi()`；分割条同理。
- 分割条：拖动中 `persist=false`（只 emit），松手必须 `flushUi()` 落盘 ——
  不能拿闭包里的旧宽度回写。
- 选择器一律收进 `.wt-scope`，避免污染宿主的 `.card` / `.btn` / `.grid`。

## 与上游的差异（有意为之）

| 项 | 上游 0.4.0 | 本插件 0.8.0 |
|---|---|---|
| 右侧对话 | 宿主会话视图让位（margin + CSS 变量），可真实输入 | 给宿主中心列写 `marginLeft` 让位，右侧就是原生会话（真能输入） |
| 终端 | node-pty + WebSocket，真 PTY | 每命令一进程 + NDJSON 流，无原生依赖 |
| 文件安全 | 任意绝对路径 | 根白名单 + realpath + 凭证目录拒绝 |
| 窗口模型 | 窗格内多标签、跨格拖拽、自由浮动层 | 单工作区多标签页（无左栏），工作台固定铺满让位区（无浮动窗口）；对话栏用宿主原生会话区 |
| 路由前缀 | `/api/worktable` | `/api/trae-worktable`（不抢注） |

## License

MIT（与上游一致）。
