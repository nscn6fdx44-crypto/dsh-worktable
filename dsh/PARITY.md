# 对齐上游 dsh-worktable 0.4.0 · 全量复刻计划

> 状态：**0.6.0 已实施（效果近似路线）**。基线 = 本仓库 `dsh/` v0.4.0 MVP（`4a56e61`）。
> 方向：全量对齐能力边界 / 独立重写 / 保留暖色琥珀金视觉 / **不必逐项 1:1，效果近似即可**。

---

## 0. 实施结果（0.5.0，2026-10-18）

用户改判「没必要和上游一模一样，效果近似就可以了」，因此砍掉了三类高成本低收益项，
其余能力全部落地，130 项离线断言全绿（host 56 + client 74）。

| 期 | 原计划 | 0.5.0 实际 |
|---|---|---|
| P0 地基 | 契约层 / 修状态枚举 / store 迁移 / 预设数据化 / 路由表+沙箱 / CSS 拆分 | ✅ 全做。client 拆成 core / ui / sidebar / overlay / panes / modals + theme.css；路由表带 disposer；路径白名单 + realpath；`normState` 单点换算修掉状态灯全灰 |
| P1 引擎 | 宿主锚点让位 + 5 类拖拽 + 标签页 + 可发送对话 + 资源管理器 | ⚠️ 改判：**不做宿主锚点让位**（对话仍是只读预览 + 一键跳回宿主）；拖拽改为两条竖向分割条（比例按项目持久化）；标签页改为「单工作区多标签」；资源管理器落地（目录浏览 + 路径跳转） |
| P2 窗格 | 终端（官方服务）/ 浏览器 / 自定义 | ✅ 终端改为「每命令一进程 + NDJSON 流 + host 记 cwd」，无原生依赖；浏览器 iframe + 静态托管；自定义 HTML 双栏预览 |
| P3 控制室 | 卡片网格 + 真实计时 + 文件夹/改名/图标/排序/隐藏/多绑定 | ✅ 控制室含四态计数 + 进行中会话实时计时；项目支持分组 / 改名 / 图标 / 备注 / 隐藏 / 多对话绑定 |
| P4 深水区 | git 只读 / 站点托管 / md 编辑保存 / widget 自动挂载 | ✅ git status·log·branches（-z porcelain 解析）；站点托管（前缀路由 + 穿越防护）；编辑器保存（原子写）。❌ widget 产物自动挂载未做（自定义窗口用 srcdoc 代替） |
| P5 收尾 | 更新检查 / 错误边界 / 文档 / 打包 | ✅ 错误边界、README 重写、构建校验；❌ 更新检查（离线场景无意义，未做） |

### 为什么不照抄上游的三处

1. **宿主锚点让位**：依赖宿主 DOM 结构（`[data-phase]` 的子节点顺序），宿主一升级就崩，
   而收益只是「右侧能直接打字」。改为只读预览 + 「在宿主打开」，交互路径短且不脆。
2. **node-pty + WebSocket**：`webServer.registerUpgrade` 只支持 exact 路径且要自己做握手；
   node-pty 是原生模块，装不上就整块功能不可用。改为子进程 + HTTP 流，零依赖、可中断、可超时。
3. **任意绝对路径**：上游 `/file`、`/fs`、`/write`、`/mkdir` 能读 `~/.ssh`。本版加根白名单 +
   realpath + 凭证目录拒绝，因为后面接了写文件与命令执行，「只读」兜不住。

### 0.6.0 交互修订（按使用反馈）

| 反馈 | 处理 |
|---|---|
| 删除宿主会话栏，与项目栏重复 | 侧边栏移除整块 `.side-sessions` 列表与「宿主对话」计数，改为「未绑定」计数；宿主会话只在「绑定对话」小窗里出现 |
| 右击的「管理绑定 / 解除绑定」合成一个交互键 | 右击只剩一条「绑定对话」，打开同一张小窗：点会话即绑定、再点即解绑、`设为主` 换主对话；绑定后小窗不再自动关闭 |
| 新增窗口模式，视窗生成在对话窗旁；全屏比例与窗口模式对应；增大中间视窗 | 三栏固定（左栏 / 中间 / 对话），中间栏新增 `dock`（全屏）与 `float`（窗口，默认）；浮动视窗贴对话栏，标题栏拖动、右下角缩放、双击复位、一键转全屏；两种模式共用 `ui.split` 比例与同一套标签页/窗格；默认左 208 / 对话 318，中间占比明显变大 |

下面第 1–7 节保留原始盘点，作为后续补齐（如真 PTY、widget 自动挂载、跨格拖标签）的规格书。

---

## 0. 一页结论

| 项 | 结论 |
|---|---|
| 要复刻的是什么 | 一个「agent 级项目容器」：侧边栏工作台 + 控制室卡片网格 + 分栏工作区（资源管理器/终端/浏览器/动画/自定义窗格）+ 项目×会话绑定 + widget 产物自动挂载 |
| 最关键的一件事 | **上游的「右侧对话窗」不是它渲染的窗格**，而是宿主会话视图区本身；插件只改 `viewArea` 的 `marginLeft/Right/Top` 与 CSS 变量 `--dsh-chat-user-width` 让位，窗格是 `position:fixed` 层。不做这套，布局永远对不上。 |
| 差距量级 | 上游 client 源码约 8.3k 行（不含 vendor）+ host 约 600 行；本仓库现有 client 1.98k 行 + host 0.62k 行。**净新增约 8–10k 行**，其中窗格/引擎占一半 |
| 分期 | P0 地基 → P1 分栏+资源管理器+可发送对话 → P2 终端/浏览器/自定义 → P3 控制室+项目模型 → P4 git/站点/编辑/自动挂载 → P5 更新检查+打磨发布。**每期独立可验收、可停** |
| 不做什么 | 不逐字复制上游 CSS/文案；不做双语 i18n（只留 `t()` 接口）；不做照片/视频背景与快捷方式（P5 视情况） |

---

## 1. 已核实的上游事实（避免二次考古）

### 1.1 host 半侧：10 条路由，全部无鉴权、无超时

| # | 路径（上游） | 方法/kind | 行为要点 | 上游坑 |
|---|---|---|---|---|
| 1 | `/api/worktable/health` | 任意 / exact | `{plugin,version,ok}` | 客户端从不调用 |
| 2 | `/api/worktable/file` | 任意 / exact | `?path=` 读单文件，MIME 由 `abs.split(".").pop()` 决定，>20MB → 413，**不截断**、无二进制探测 | 错误 404 带 Node 原始错误串（含绝对路径） |
| 3 | `/api/worktable/template/*` | GET / prefix | `/dshell.css` + 任意子路径都回同一份 HTML 模板 | 没有 404 分支 |
| 4 | `/api/worktable/site/<enc(absDir)>/<rel>` | GET / prefix | 把任意绝对目录当静态站；目录→`index.html`；穿越用字符串前缀校验 | **盘符根必 403**（`root+sep` 拼接缺陷）、Windows 大小写误判 |
| 5 | `/api/worktable/fs` | POST / exact | 单层列举：`{path,entries:[{name,path,isDir,hidden}],truncated}`，目录优先 + `localeCompare(sensitivity:'base')`，500 条截断 | 不返回 stat；符号链接目录被当文件；错误体仍带成功骨架 |
| 6 | `/api/worktable/write` | 仅 POST | `{path,content}` 写 UTF-8，200 `{ok:true}` | 非原子写、不建父目录、`content` 非 string 时**静默清空** |
| 7 | `/api/worktable/mkdir` | 仅 POST | 建一级目录；父目录缺失→400；已存在→200 `{ok:true,exists:true}` | 不递归 |
| 8 | `/api/worktable/git` | POST / exact | `rev-parse --abbrev-ref HEAD` + `status --porcelain=v1 -z`，`execFile` 无 shell，永远 200 | `-z` 解析对 rename 产出垃圾条目；无 timeout |
| 9 | `/api/worktable/workspaces` | 任意 / exact | 优先宿主 `workspaceRegistry.list()`，否则读 `$DSH_HOME/storages/workspace.json` 原样透传 | 两分支形状必须同构，否则静默退化成「全部未分组」 |
| 10 | `/api/worktable/term` | WS upgrade | query `sessionId/cwd/cols/rows`；下行裸文本帧，上行裸文本或 `{type:'resize'}` JSON；win32 固定 `powershell.exe -NoLogo -NoProfile` | `cols` 缺省被算成 **2**；spawn 失败只能发一帧提示再 close |

依赖解析：上游自研 `loadPkg` 逐级向上 + 扫 `$DSH_HOME/profiles/*/node_modules` 找 `ws`/`node-pty`，失败只 warn 不抛。

### 1.2 client 半侧：数据模型与引擎

**存储（localStorage，全 `dsh.worktable.*` 前缀）**

| key | 内容 |
|---|---|
| `view.v1` | 控制室外观 + `orderBy` + 搜索态（HSL、背景模式、列数 1–5、模糊/网格/光流参数） |
| `projects.v1` | `{order[],lastUsed{},hidden[],nameOverrides{},iconOverrides{},removed[],views{id:LayoutSpec},shortcuts[],layouts[],bindings{id:sessionId},folders{id:absPath}}` |
| `split.v2` | `{[layoutId]:{chatW,topH,leftW,paneWs[],topWs[],leftWs[]}}`，**px** |
| `widgetBindings.v2` | `{[projectId]:{[paneId]:{projectId,paneId,window,folder,sessionId,bindingId,enabled}}}` |
| `pendingMount.v2` / `mountedWidget.v2` / `notifyAck.v1` | 挂载待办 / 已挂载原文 / 已读标记 |
| `updateCheck.v1` / `lastUpdateCheck.v1` / `skipVersion.v1` | 更新检查开关 / 24h 节流时间戳 / 忽略版本 |

媒体图存 IndexedDB（`dsh-worktable` 库，`photoRecords`，Blob 原样）。

**LayoutSpec（窗口对象）**：`{id,title,icon?,left:Pane|null,top:Pane[]|null,main:Pane[],leftWidth{default,min,max},chatWidth{…},topHeight{…},topHeightRatio,chatSide:"right",chatFullHeight}`
**Pane**：`{id:"p1".."pN",title,min:200,content,tabs:[{id,title,content}],active}`
**content**：`{kind:"builtin",type:"browser"|"anim"|"explorer"|"scm"|"tasks"|"terminal"|"custom"|"console"}` / `{kind:"file",path}` / `{kind:"iframe",url,title?}`

**8 个布局预设**（`PRESET_DEFS`，追加式，聊天窗恒最右）：

| id | left | top | main | chatFull | 备注 |
|---|---|---|---|---|---|
| `2h` | 0 | 0 | 1 | – | 一内容 + 右对话 |
| `3h` | 0 | 0 | 2 | – | 三列 |
| `l2` | 0 | 1 | 1 | ✅ | 顶行不通到对话列 |
| `grid` | 0 | 2 | 1 | – | 顶 2 通栏 |
| `t3` | 0 | 1 | 2 | ✅ | 顶 1 + 主 2 |
| `l13` | 0 | 1 | 3 | ✅ | topHeight 默认 420 / ratio 0.55 |
| `g4` | 0 | 2 | 2 | ✅ | 2×2 |
| `l23` | 0 | 2 | 3 | ✅ | 顶 2 + 主 3 |

**引擎几何**：`GAP=1`、`DIVIDER=4`、`BAR_H=26`、pane `min=200`；`allocate()` 最后一格吃剩余宽度；拖拽 `setPointerCapture` + 像素粒度；**每次 pointermove 都写 localStorage**（上游的卡顿源，我们改 debounce）；无双击复位；Esc 关闭；项目层保活池最多 6 层（`visibility:hidden`），**切标签会卸载旧标签**。

**控制室**：`CONSOLE_ID="wt-console"`、固定首位、不可删、卡片 1–5 列、`aspect-ratio:1/1`、状态 = `pendingAck > completed > running > idle`、计时只用真实 `turnTimings`/job `startedAt`（算不出就留空）、预览取最近 user/assistant 文本（≥8 字、截 220）；6s 防抖扫预览；**只读宿主快照，不调模型**。

**widget 自动挂载**：manifest 路径 `<folder>/.dsh-worktable/project-<enc(projectId)>/pane-<enc(paneId)>-<bindingId>.json`，格式 `{version:2,projectId,paneId,bindingId,window,path,kind:"html"|"url"|"file"}`；打开项目/首次观察到 `completed` 时读；换文件夹/换绑定/换布局即 `revoke`；同内容不重复锁，内容变了重锁（**替换该窗格全部标签**——我们改成"追加挂载标签，保留手工标签"）。

**其它**：更新检查打 `api.github.com/repos/.../releases/latest`，3 次重试 × 8s 超时，24h 节流，`cmpVer` 比对 + `skipVersion`；changelog 是常量整页；i18n 是 `zh/en` 扁平点号 key（有大量僵尸 key）。

### 1.3 宿主能力实测（决定架构的三个结论）

| 结论 | 证据 |
|---|---|
| `webServer.register` 原生支持 `kind:"exact"\|"prefix"`，prefix 边界严格（`===prefix \|\| startsWith(prefix+"/")`）、**最长前缀优先**、重复注册**抛错**、返回 disposer | `app.asar` → `@deepseek-ai/dsh-host-webserver/lib/index.js` L177-197 / L322-331 |
| 宿主自带官方终端服务：`TerminalSessionService`（service 名 **`terminals`**），`spawn(owner, {type, name?, cwd?}, signal?)` | `@deepseek-ai/dsh-terminal/lib/index.js` L48-131 |
| `node-pty` 的 win32 预编译已 unpacked：`D:\dsh\resources\app.asar.unpacked\dsh\node_modules\node-pty\prebuilds\win32-x64\conpty.node`；`ws`、`xterm`、`markdown-it`、`highlight.js` 可取（npmmirror 可达） | asar 列表 + `find *.node` + `npm view xterm` |

→ **终端不做上游那套「蹭宿主 node_modules」**，优先注入 `terminals` 服务，失败再回退自解析 node-pty（走 `app.asar.unpacked` 路径）。

---

## 2. 与上游的显式差异决策

| # | 决策 | 理由 |
|---|---|---|
| 1 | 视觉保留暖色琥珀金；新窗格沿用同一套 token（`--amber`/`--st-*`），不引入上游 `dshell` 皮肤 | 用户拍板；识别度 |
| 2 | 独立重写，不 vendored 上游 bundle | 用户拍板；AGENTS §1 独立实现 |
| 3 | 功能范围对齐 0.4.0（含 6 类窗格、控制室、文件夹、自动挂载、更新检查） | 用户拍板 |
| 4 | **路由前缀保留 `/api/trae-worktable/*`**，字段/状态码/上限逐项对齐 | 上游仍装在 profile 里，`/api/worktable/*` 会被它抢注；前缀不影响行为等价 |
| 5 | **安全修正而非照抄**：`/file`、`/fs`、`/write`、`/mkdir`、`/site` 增加根白名单 + `realpath` + 符号链接策略；`/ping` 诊断路由改为 `WT_DEBUG` 开关 | 上游可读写任意绝对路径；后面要加写文件、git、终端、站点托管，靠「反正只读」兜不住；AGENTS §3.4/§3.5 |
| 6 | 顺手修掉上游 5 个已知缺陷：`cols` 缺省变 2、git rename 解析、`/site` 盘符根 403、`/write` 非 string 静默清空、双份状态枚举 | 这些是 bug 不是设计，复刻无价值 |
| 7 | 自动挂载「追加标签」而非「清空窗格全部标签」 | 上游会吃掉用户手工开的标签 |
| 8 | 布局尺寸存**比例**（px 作为兼容读取），拖动时 debounce 落盘 | 上游存 px 且每次 move 都写，窄屏打开会挤爆 |

---

## 3. 目标架构

```
dsh/
├─ src/
│  ├─ shared/                 # host 与 client 共用，禁止 import 宿主服务
│  │  ├─ contracts.js         # SESSION_STATE / HOST_STATE_ALIAS / PANE_KINDS / PRESET_DEFS
│  │  └─ paths.js             # joinPath / resolveInside / siteUrl / encodeSegment
│  ├─ host/
│  │  ├─ index.js             # 装配：保存 disposer、headless 降级、服务延迟接入
│  │  ├─ router.js            # 路由表（method + kind + bodyLimit + schema + handler）
│  │  ├─ services.js          # sessions / sessionQuery / terminals / workspaceRegistry 形状适配
│  │  ├─ sandbox.js           # 根白名单 + realpath + 符号链接策略
│  │  ├─ pty.js               # 终端桥：terminals 优先，node-pty 回退
│  │  └─ routes/*.js          # health sessions transcript fs file write mkdir git site template term workspaces
│  └─ client/
│     ├─ index.js             # 装配：registerSeat(s) + 服务注入 + 全局样式
│     ├─ store/               # projectStore（持久化）/ uiStore（瞬时）/ selector 订阅 / migrate
│     ├─ api.js               # get/post + AbortController + 超时 + seq 竞态丢弃
│     ├─ actions/             # 项目 / 绑定 / 布局 / 窗格 / 挂载
│     ├─ split/               # geometry（三带+chat 列）/ engine（拖拽/分配）/ tabs / anchor（宿主锚点）
│     ├─ panes/               # explorer terminal browser anim custom console file iframe
│     └─ styles/*.css         # token / base / sidebar / split / panes / modal（esbuild `.css:text` 已就绪）
└─ test/                      # host-routes / client-smoke / split-geometry / contracts / widget-mount
```

**关键数据结构**（字段名与上游一致，便于对照排查）
`Project{id,name,alias,icon,folderId,path,order,hidden,sessions[],primarySessionId,gitRoot}`
`LayoutSpec{id,title,icon,left,top[],main[],leftWidth,topHeight,chatWidth,chatSide,chatFullHeight}`
`Pane{id,title,min,tabs[],active}` / `Tab{id,title,content}`

---

## 4. 分期计划

> 每期结束都要走同一道门禁：`npm run build` → `node --check lib/*.js` → 全部离线测试 → 部署 `lib/` → **重启 DSH** → 真机 6 步清单 → 写 CHANGELOG → 提交。

### P0 · 地基（不改可见功能，1 期）

| 项 | 动作 |
|---|---|
| 契约层 | 新建 `shared/contracts.js`；**修掉现存 bug**：host 出 `running/waiting`、client 只认 `working/needs-you` → 加 `HOST_STATE_ALIAS` 归一；新增契约测试「host 返回值 ⊆ client 枚举」 |
| store 分层 | `projectStore`（projects/bindings/layouts/status，带 `v:2` 与迁移）与 `uiStore`（open/modal/menu/toasts）分离；`useStore(selector)` 订阅；id 改 `crypto.randomUUID()` |
| 布局模型 | `PRESET_DEFS` 8 个预设 + `Pane` 模型落地，渲染改为数据驱动；删掉枚举/条件渲染/CSS grid/草图/响应式五处硬编码 |
| API 层 | 统一 `api.get/post`（超时、`AbortController`、失败归一）；`loadTranscript` 加递增 epoch，晚到响应丢弃 |
| host 路由层 | 路由表 + **保存 disposer**（现在丢了，重载会撞 duplicate throw）+ method 校验 + body schema + 统一错误映射 |
| 路径沙箱 | `sandbox.js`：允许根 = 项目文件夹 ∪ 宿主工作区 ∪ 用户显式登记目录；`realpath` + 大小写归一 + 符号链接策略；`/tree`、`/file` 全部走它 |
| 清理 | 拆 CSS 到 `styles/*.css`，删 74 行重复块与 32 个死类；移除 `/ping`、`/pings`（改 `WT_DEBUG=1` 才注册） |

**验收**：可见 UI 与今天逐像素一致（真机对比清单）；31 + 67 基线全部迁到新结构后仍全绿；新增契约测试 ≥3 项；`grep -c "running"` 在 client 里只剩别名映射一处。

### P1 · 分栏引擎 + 资源管理器 + 可发送对话（第一个垂直切片）

| 模块 | 内容 |
|---|---|
| anchor | 定位宿主会话根（`[data-phase]`），取 header/viewArea；`marginTop = BAR_H + (有顶行 && !chatFull ? topH : 0)`，设 `--dsh-chat-user-width`；关闭时**逐项还原**原始字符串 |
| engine | 三带布局 + chat 列；5 类拖拽（left/chat/top/pane/topPane）；像素→比例持久化（debounce 200ms）；最小宽夹取；双击复位；`ResizeObserver` 重算；`yieldObserver`（宿主改回 margin 即自动关闭） |
| tabs | 窗格内多标签、`sameContent` 去重、关闭归 0、HTML5 拖排、跨窗格搬运、拖标题栏交换窗格；console 标签不可拖不可关 |
| 对话 | 只读预览升级为**可发送**：输入框 + 走宿主 `sessions.send`/`sendSession`，流式刷新用轮询（2s）先落地；保留只读降级 |
| explorer | 懒加载树、↑/↻、目录缓存、文件预览（md/代码/图片/pdf）、未知类型提示；host 新增 `/fs`，`/file` 补 MIME + 二进制探测 |
| 保活 | 最多 6 个项目层 `visibility:hidden` 保活，超限淘汰最旧 |

**验收**（真机）：进入项目 → 拖 4 条分割线 → 关掉再进尺寸保留 → 开 3 个标签并跨格拖 → Esc 退出宿主界面无残留 → 资源管理器能进子目录并打开 md → 对话窗能发一条消息并看到回复。

### P2 · 终端 + 浏览器 + 自定义窗格

| 模块 | 内容 |
|---|---|
| terminal | host `pty.js` 注入 `terminals.spawn(owner,{type,cwd})`，失败回退 node-pty（`app.asar.unpacked`）；WS `/api/trae-worktable/term`；上行裸文本 + `{type:'resize'}` JSON（照上游协议）；下行裸帧 |
| 终端 UI | 打包 `@xterm/xterm`（esbuild）；`fit()` → resize **100ms 防抖**；`onopen` 补首帧尺寸；`\x1b[?7h`；断连写「[连接已关闭]」；不可用给可读降级 |
| 浏览器/动画 | 地址栏 + iframe；**scheme 只允许 http/https**（AGENTS §3.3）；非法输入不导航；动画窗给站点预设磁贴 |
| 自定义窗格 | 选模板 → 生成任务文本 → 走「创建对话/发送到会话」→ 同时写 manifest 占位，等 P4 的挂载收口 |

**验收**：终端能跑 `pwsh`、cwd = 项目文件夹、拖分割线后 `resize` 生效、关窗杀进程；浏览器拦 `file://`/`javascript:`；自定义窗格能建对话并收到任务文本。

### P3 · 控制室 + 项目模型扩展

| 模块 | 内容 |
|---|---|
| 控制室 | `wt-console` 固定首位、不可删；卡片网格 1–5 列 + 方形/圆形；状态四态、真实计时（算不出留空）、预览 220 字；6s 防抖扫预览；已读 ack（key 带 `pendingInteraction` 指纹）；背景外观面板（纯色/光流，先不做照片视频） |
| 项目模型 | `folders`（文件夹树、拖入拖出）、`nameOverrides` 改名、`iconOverrides` 图标、`order` 拖拽排序、`hidden` 显示隐藏、`sessions[]` 多绑定 + 主绑定、删除二次确认（明确「不动磁盘」） |
| 菜单 | 右击菜单改数据驱动（items/children/checked/disabled/danger），补：改名/图标/移动文件夹/隐藏/多绑定/复制路径/在资源管理器打开 |

**验收**：卡片状态与宿主状态一致（跑一个对话看是否变「进行中」）、计时随任务涨、点卡片能 ack 掉红点；项目改名/排序/隐藏/拖进文件夹后刷新仍在；一个项目绑两个对话时能切换主对话。

### P4 · git 只读 + 站点托管 + markdown 编辑 + widget 自动挂载

| 模块 | 内容 |
|---|---|
| git | host `/git`（`execFile`、`maxBuffer 4MB`、**补 timeout**、修 `-z` rename 解析）；scm 窗格显示分支 + XY 标记 + 「不是仓库 / 干净」 |
| site | host `/site/<enc(root)>/…` prefix 路由；**修盘符根 403 与大小写误判**（用 `path.relative` 判包含）；`index.html` 回退；40MB 上限；MIME 表 29 项 |
| 编辑 | `/write` 原子写（tmp+rename）+ mtime 冲突检测 + 非 string 报错（不再静默清空）；md 编辑器（编辑/预览切换、Ctrl+S、脏标记） |
| 挂载 | manifest 读取 → 校验 6 个字段 → 目标窗格**追加**挂载标签；换文件夹/绑定/布局即 revoke；同内容不重锁；失败保留 pending 下次重试；seq 竞态丢弃 |

**验收**：git 面板在真仓库出分支与改动、在非仓库给提示；项目里的 `index.html` 能在浏览器窗格打开；改 md 保存后磁盘内容变化且重开仍在；手工造一个 manifest 文件能被自动挂到指定窗格。

### P5 · 更新检查 + 打磨 + 发布

| 项 | 内容 |
|---|---|
| 更新检查 | host 代理 `api.github.com`（避免浏览器 CORS/限流）+ 24h 节流 + `cmpVer` + `skipVersion`；侧栏徽标 + 设置卡；升级命令按 desktop/web 分平台 |
| 打磨 | 错误边界可恢复（重试按钮 + 详情折叠）；`t()` 接口留好（只做中文）；键盘可达性（Tab 顺序、菜单方向键）；`prefers-reduced-motion` 覆盖新动画 |
| 文档 | README 重写（能力 / 权限披露 / 已知坑 / 验收标准）；本文件标记已落地项 |
| 发布 | `npm pack` → 官方 CLI `plugin --profile desktop add <tgz>` → 冷启动验证 → tag |

**验收**：新版本能检出并给出正确升级命令；冷启动无报错、无 `entry did not activate`；`git bundle` 与 tag 齐全。

---

## 5. 测试与验收策略

| 层 | 手段 | 覆盖 |
|---|---|---|
| host 契约 | 扩 `test/host-routes.mjs`：桩支持 method/header/prefix，按 `(kind,path,method)` 建表 | 每条路由的成功/参数错/IO 错/超限 + 沙箱越界 403 |
| 契约一致性 | 新增 `test/contracts.mjs` | host 返回枚举 ⊆ client 枚举；preset 字段与 `Pane` 形状；manifest 6 字段校验 |
| client 逻辑 | 新增 `test/split-geometry.mjs`（纯函数：`allocate`/夹取/比例换算）、`test/store-migrate.mjs` | 引擎算法不依赖 DOM，可全量断言 |
| client 渲染 | 保留现有 bundle 级 smoke（67 项）；**新增 happy-dom 渲染测试**（真实 effect/事件/输入） | 拖拽、标签切换、菜单、表单 |
| 真机 | 每期固定 6 步 + 该期专项清单 | 见各期验收 |

**真机 6 步（每期必跑）**：① 冷启动无崩溃日志 → ② 侧边栏区块可见且状态栏数字非空 → ③ 进项目看布局 → ④ 该期新功能主链路 → ⑤ Esc/关闭后宿主界面无残留 margin → ⑥ 重启后状态与尺寸还原。

---

## 6. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 宿主会话区结构/`data-phase` 变化（DSH 自动升级） | 分栏让位失效，可能遮挡对话 | 锚点探测失败 → 降级为「窗格内自渲染只读对话」；`yieldObserver` 检测到宿主改回 margin 立即自动关闭并还原 |
| 终端依赖解析 | 终端窗格不可用 | 优先官方 `terminals` 服务；回退 node-pty（unpacked 路径）；两者都失败给可读降级文案，不影响其它窗格 |
| 单文件 1980 行 + 751 行 CSS | 无法并行、改动互相踩 | P0 先拆，后续每期只动对应模块 |
| 全量工作量 | 做不完/半成品 | 每期都是完整可用的垂直切片，任何一期结束都能发布 |
| 上游 bug 复刻 vs 修正 | 行为对不齐 | 已列差异表（§2），修的一律在 CHANGELOG 写明「与上游有意差异」 |
| 写文件/终端/git 的安全面 | 本地任意读写 | P0 就把沙箱立起来，后续路由只能复用 `resolveInside`，不新增裸路径 |
| 重启才能生效 | 反馈慢 | 保持离线测试为主（stub 宿主），真机只做最终验收；部署走 junction + `cp lib/*.js` |

---

## 7. 与上游功能的取舍清单（明确不做）

- 双语 i18n（只留 `t()` 与中文词条，不写 en）
- 照片/视频背景、双 video 交叉渐变、HSL 调色（控制室只做纯色 + 光流）
- 「快捷方式」新增入口、插件市场、`manage.readd`
- 上游的 `changelog` 常量整页（改为读本仓库 `CHANGELOG.md` 摘要）
- 跨插件抢占协议 `dsh:split-claim`（单插件场景不需要）
- 卡片 DOM 注入对齐（上游用 MutationObserver 按下标对齐别人的卡片；我们改成「每个项目卡自带绑定按钮」的正规方案）

---

## 8. 执行顺序建议

1. **P0 全量**（含沙箱与 store 迁移）—— 不做完不动 UI，避免返工两遍
2. **P1**：engine 单独先跑通几何（离线测试）→ 再上 anchor（真机最危险）→ 再接资源管理器
3. **P2 终端优先级最高**（用户最常用，也最容易踩依赖坑），浏览器/自定义随后
4. **P3 → P4 → P5** 按依赖顺序，每期结束发一次 `0.x.0` 版本

---

*本计划基于 2026-10-18 对上游 `dsh-worktable@0.4.0`（`~/.dsh/profiles/desktop/node_modules/dsh-worktable/lib/*`）、本机 DSH `0.2.0-rc.2`（`D:\dsh\resources\app.asar`）与本仓库 `dsh@0.4.0` 的逐行盘点。*
