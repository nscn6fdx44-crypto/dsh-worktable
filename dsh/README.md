# trae-usage-worktable（DSH 插件 · 0.8.52）

> DeepSeek Harness 侧边栏的完整工作台。本目录是 `nscn6fdx44-crypto/dsh-worktable`
> 对上游 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) 的**独立实现**：
> 同款 Cordis 双 bundle 协议、同款交互模型，代码自己写、路由前缀自带
> （`/api/trae-worktable/*`），不与上游抢路径。

## 快速安装（本机已实测）

> **前置**：从托盘**完整退出 DSH**（`DeepSeek Harness.exe` 进程全部退出），否则 CLI 会报
> `profile "desktop" is managed exclusively by the Electron application`；装完再手动重开。

```powershell
# 开发态：link 本仓库（改代码后 npm run build + 重启即生效）
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\dsh"
```

重开 DSH → 侧边栏出现「工作台」（托盘图标旁的 `🧰` 工作台卡片）→ 打开带 token 的网页端，
访问 `/api/trae-worktable/health`，返回里的 `version` 应等于 `package.json` 的版本（当前 `0.8.52`）。

分发 / 升级 / 卸载 / 排查见下方「安装」一节。

## 能力（0.8.52）

| 半侧 | 文件 | 内容 |
|---|---|---|
| host | `src/index.js` → `lib/index.js` | 会话快照 / 文件读写 / 命令执行 / git 只读 / 项目静态托管 |
| client | `src/client/*` → `lib/client.js` | 侧边栏工作台 + 总览 / 工作区（同一套让位外壳，右侧始终是宿主对话）|

### 侧边栏（`sidebar.footer.action`，常驻）

1. 标题（🧰 工作台）+ 刷新 / 新建；
2. **状态框只记四个工作状态**，2×2 紧凑排布：进行中 · 待处理 · 已完成 · 待命
   （原来的「项目数 / 未绑定数」已删——项目数在下面的列表标题上，未绑定看行上的 🔗）；
   计数**按项目**、和项目灯同一条口径（`statusCounts()`）——手工改过的状态、没绑定对话的项目、
   隐藏的项目都会正确落格；**改完状态当场重算**，不再等下一次 4s 会话轮询
   （0.8.6 起不再用 host `/sessions` 的 `counts`：那份只认宿主会话，本地改的状态根本进不去，
   于是「改了项目状态，状态栏纹丝不动」）；
   **侧边栏尺寸保持原样**：卡片高度跟着内容走（项目少时就是原来的紧凑高度），
   不参与宿主侧边栏的拉伸；项目多时才往上长，封顶 `min(46vh, 330px)`，
   超出部分由列表区域内部上下滚动，整条侧边栏面积不变；
3. **项目列表**：按「分组」归组，点一行进入工作区；每行状态灯跟随绑定对话，也可点击手工覆盖；
4. **不再单列宿主会话**——那份列表与项目列表信息重复，宿主会话统一在「绑定对话」里选；
5. 右击项目：编辑 / 绑定对话 / 删除（模式项随窗口模式一起删了）；
6. **拖放添加项目**（0.8.12）：总览「◉ 宿主会话」页签里的每一行都能**拖到侧边栏上**，松手即用该会话
   新建项目并绑定（落点整块高亮 + 「松手 → 用这条会话新建项目」）；同一条会话重复拖只会进已有项目。
   也认拖进来的目录路径（Windows 绝对路径 / `file://`）→ 按目录建项目。

> 状态来源（0.8.2 起）：**以 DSH 自己的 `agent.status` 为准**——host 通过 `ctx.agents.get(sessionId)`
> 拿到该会话的 Agent，`status` 只有 `running` / `idle` 两档，这是宿主维护的权威状态；
> 只有 Agent 已卸载的老会话才退回扫事件日志（`turn/start` vs `turn/end`）。
> 「待处理」= `agent.status === 'running'` 且日志里最后一次 `approval/asked` 晚于 `approval/decided`。
> 客户端每 **4s** 拉一次 `/sessions`，host 每次请求都重读，状态灯这才跟得上。
>
> 项目灯取**最需要注意**的那个对话：`待处理 > 进行中 > 主对话`（见 `stateOf()`）。
> 进项目后顶栏只留**一盏**灯（左侧那盏 = 项目聚合状态），对话气泡里不再重复放灯。

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
  另有 `ⓘ 项目信息`（状态 / 绑定对话 / git 状态与最近提交）从顶栏按钮打开；首次进项目自动开「项目信息」；
  - **文件管理器 = 面板内自绘列表**（0.8.4 起）：打开标签页直接列**该对话的工作目录**
    （主绑定对话的 cwd，取不到退回项目目录）。工具栏 = `↑ 上一级` + 面包屑 + `⟳ 刷新`
    + `＋ 新建文件夹` + `⧉ 系统窗口`；下面一行是地址栏（填绝对路径回车跳转）和过滤框。
    - 列表：`名称 / 大小 / 修改` 三列，点表头切排序（再点一下反序）；目录永远排前面；
    - 单击选中、双击进目录、双击文件**直接在编辑器标签页里打开**；
    - 右键菜单：进入目录/在编辑器打开 · `🚀 用系统程序打开` · `⧉ 在系统窗口中显示` · `✎ 重命名` · `🗑 移到回收站`；
      菜单打开时会先问一次 host「这个能不能删」，被禁的项直接置灰、原因写在菜单底部；
    - **删除**（0.8.5 修好）：一律进**系统回收站**（Windows `Microsoft.VisualBasic.FileIO`
      的 `SendToRecycleBin`，macOS Finder，Linux `gio trash`），不做硬删。
      成败**以磁盘为准** —— 回收站调用成功也常返回退出码 1、失败也可能返回 0，
      所以先等子进程结束再看目标还在不在；stderr 里的 `#< CLIXML` 进度噪音会被洗掉，
      只留真正的报错。每次删除追加一行到 `~/.dsh/worktable-delete.log`
      （时间 | ok/fail | 耗时 | 退出码 | 路径 | 错误）；
    - **路径权限分三档**（0.8.5 起）：
      - **读**（list / read / stat / reveal）：不设白名单，能一路 `↑` 翻到盘符根，
        只挡凭证目录（`.ssh` / `.aws` / `.gnupg` / `.kube` / `.dsh` / `.netrc` / `.git-credentials`
        / `.npmrc` / `.gitconfig` / `.pki` / `.azure` / `.env*`，0.8.11 起补全）；
      - **写**（write / mkdir / rename）：只允许工作目录 / 用户目录 / DSH_HOME / 已注册项目内；
        在别处浏览时面板会把 `＋ 新建`、`✎ 重命名` 置灰，状态栏标「只读」；
      - **删**：不要求白名单（回收站本身可撤销），但拒绝**磁盘根**、**系统目录**、
        **白名单根本身**、**白名单根的祖先**（删了它等于连工作区一起端掉）；
      - 删软链接时**不跟随最后一段**（用 `lstat` 判定存在），删的是链接本身而非它指向的目标；
      - 对话 cwd 以 `<项目id>~cwd` 单独登记进白名单；
  - **为什么不再把资源管理器嵌进来**：`explorer.exe` 的窗口类 `CabinetWClass` 只能被 Win32
    **HWND** 用 `SetParent` 认领，而工作台面板是 Chromium 画的 HTML 矩形，**没有自己的 HWND**；
    硬挂只能盖在整个窗口上、跟不了面板布局（Win11 的多标签单进程模型还会把窗口收回）。
    所以列表自己画，「`⧉ 系统窗口`」保留原生能力的出口（复制粘贴、拖拽、右键扩展）；
    那条链路本身仍然是可靠的：`${SystemRoot}\explorer.exe` 绝对路径 + `detached + unref`，
    spawn 失败（ENOENT/EACCES）才判失败（退出码 1 是 explorer 的老毛病，算成功），
    每次调用追加一行到 `~/.dsh/worktable-reveal.log`；
  - **编辑器**：读文件、改、`Ctrl+S` 保存回磁盘（原子写：临时文件 + rename）；
    空态可以直接填文件绝对路径打开；在文件管理器里双击文件也会落到这里；
    - **按类型分流渲染**（0.8.8 起，借鉴上游 dsh-worktable 的 `FileViewer`）：
      `.md` 默认渲染成文档（标题 / 列表 / 引用 / 表格 / 围栏代码 / 图片 / 外链），
      代码文件默认语法高亮（js·ts·json / css·scss / html·vue·svg 三套 tokenizer），
      两者顶栏都有 `预览 ↔ 编辑` 切换；图片 / PDF / 音视频直接内嵌（`<img>` / `<iframe>` / `<video>`）；
      纯文本仍然只有编辑态。渲染器是**自己写的零依赖实现**（`src/client/render.js`，
      不引 markdown-it / highlight.js —— 那两个库会让 bundle 涨 1 MB）；
      所有文件内容先 escape 再拼标签，原始 HTML 不会被执行，相对链接降级成纯文本不导航；
    - **新增 `GET /fs/raw`**：媒体文件的原始字节（`<img src>` 之类只能 GET 不能 POST），
      只放行图片 / PDF / 音视频扩展名（其它类型 415 `not-media`），上限 48 MB，
      响应带 `content-disposition: inline` + `nosniff`；读权限与 `/fs/list` 同一档；
    - **大文件不再是一堵墙**（0.8.7 起）：`auto` 模式下 >4 MB 的文件**自动降级成只读预览**
      （默认开头 256 KB，可切「看结尾」），顶栏标 `只读 · 开头/结尾`，底部提示条说明
      「你看到的不是完整文件」，并给三条出路：看开头 / 看结尾 / `🚀 用系统程序打开`；
      **只读片段不进渲染预览**——半截 Markdown 渲染出来只会误导，一律显示原文；
    - **只读预览禁止保存**：`partial / truncated` 状态下 `Ctrl+S` 与保存按钮都拦下来
      ——否则就是把一个片段写回整个文件、把文件毁掉（这是原来真实存在的数据丢失口子）；
    - 显式请求整份（`mode:'full'`）且超限时返回 413 + `code:'too-large'` + `size/limit`，
      界面据此显示「只读预览前 256 KB」「用系统默认程序打开」「在文件管理器中显示」；
    - 二进制（415）同样给系统的出口，不再只说「打不开」；
    - `POST /fs/open` 新增：交给系统默认程序（Windows `explorer.exe <file>`，等同双击；
      macOS `open`，Linux `xdg-open`），文件管理器右键菜单也多了 `🚀 用系统程序打开`；
  - **终端**：把命令交给宿主所在机器执行，NDJSON 流式回显；`cd` 由 host 接管并保持；
    `↑↓` 翻历史、`Ctrl+L` 清屏、可中断、120s 超时、512KB 输出上限；
  - **浏览器**：真窗格，不是一根地址栏（0.8.9 起；0.8.10 收起成单行工具条）
    - **只有一条顶栏**：`← → ⟳ [地址] 打开 ● ⋯`。面板窄了也不会折行、不会把右边按钮挤出去
      （<340px 时先隐藏「打开」，回车仍可导航）；状态改成一个小圆点，悬停看文字；
    - 低频操作全部收进 `⋯` 下拉（绝对定位，开合不改变页面高度）：
      `探测` / `项目页` / `⧉ 复制` / `🚀 系统浏览器` / 端口 `:3000 :5173 :8080 :4173` /
      视口 `自适应 / 平板 768 / 手机 375`；点面板别处自动收起；
    - 导航：`← →` 历史（我们自己记的，iframe 跨域读不到 location）、`⟳` 真重建 iframe、
      地址栏（`localhost:5173` 这种半截地址自动补 `http://`）；
    - **探测**（`POST /web/probe`）：开之前先问清楚「服务在不在、多快、页面叫什么、
      **能不能被 iframe 嵌**」——宿主直连读响应头，`X-Frame-Options: DENY/SAMEORIGIN` 与
      `CSP frame-ancestors` 都会提前摊开，不用先看一屏白框再猜；
    - 加载 8 秒还没 `load` → 判「嵌入被拒绝 / 无响应」，给 `重试 / 探测原因 / 复制地址 /
      🚀 系统浏览器打开` 四个出口；
    - 地址按项目记住（切回来还是上次那页）；空态直接写三条用法，不占常驻高度；
  - **自定义**：仿上游的「一句话需求 → 做成一个窗格」，但产物能落地（0.8.9 起）
    - 左栏是窗口库，条目存在 `~/.dsh/worktable-custom.json`（**不写用户项目目录**）；
    - `✨ 生成`：写需求 → 生成结构化提示词（含沙箱限制、宿主接口、配色）→
      **填进右侧宿主对话的输入框**（不代发，你自己按回车）；AI 给了 HTML 就点
      `⤓ 粘贴结果`（自动剥 ``` 围栏）→ 保存；
    - `编辑`：`HTML` 片段或 `网址` 两种窗口，`Ctrl+S` 保存；
    - `预览`：沙箱 iframe（`allow-scripts allow-forms`，**不给** `allow-same-origin`，
      所以自定义代码拿不到工作台自己的 DOM / 存储）。
- **进项目即切对话**：把宿主切到项目的主绑定对话（`uiWorkspace.openSession`，
  缺席时退到 `sessions.open`），所见即所聊；顶栏左侧一盏状态灯 + 对话气泡里只写标题。
- **绑定只有一个入口**：右击项目（或卡片按钮 / 顶栏气泡）打开的同一张小窗里，
  点会话即绑定、再点即解绑、`设为主` 切换主对话；不再有单独的「解除绑定」菜单项。
- **新建项目时可以直接开一个新对话**：绑定下拉里有「＋ 新建对话（用项目目录）」，
  创建项目后会按项目目录向宿主要一个新会话并绑定（宿主没暴露入口时只建项目，稍后手动绑）。
  同一张弹窗里的「默认工作区」按钮已删除（DSH 并没有那个目录）。

> 让位几何全部来自实测：`left = 中心列 · 侧边栏右边界`、`top = 宿主标题栏 padding`，
> 并避开「侧边栏收起」时浮在左上角的展开按钮。宿主结构一时认不出来（重排 / 换面板）时
> **沿用上次几何并标 `stale`**，彻底找不到锚点才降级成 `is-undocked` 的有界盒子
> （从侧边栏右边界起算、右侧留空），**任何分支都不会铺满整窗**（0.8.50 → 0.8.52 三次踩出来的规矩）。

### 让位与侧边栏稳定性（0.8.48 – 0.8.52）

连续五个版本修的是同一族问题，建议一起验收：

| 版本 | 修了什么 | 根因 |
|---|---|---|
| 0.8.48 | 侧边栏卡片按宿主实际给的空间自适应 | 固定 `max-height: min(46vh, 330px)`，宿主压缩 footArea 后必然溢出 |
| 0.8.49 | 卡片不再压住宿主会话列表 | **溢出而非层级**：`flex: 0 0 auto` 禁止收缩 → 溢出按绘制顺序盖在 `_regionArea` 上 |
| 0.8.50 | 宿主开文件预览等重排时不再铺满整窗 | `measure()` 算不出宽度就退回 `is-full(inset:0)`；改为 `pickDock()` 沿用 `lastGood` + MutationObserver 重锚 |
| 0.8.51 | 锚点彻底找不到时也不铺满整窗 | 0.8.50 只堵了「测出 width=0」，早退分支是另一条路；改为 `undockedBox()`（66% 宽 / 封顶 1180 / 右侧留空） |
| 0.8.52 | 侧边栏展开时不再吃掉宿主关闭键 | 降级盒子返回 `left:0`，`.wt-dock` 的 `pointer-events:auto` 盖住侧边栏按钮；`undockedBox` 增 `left` 入参 + `anchorLeft()` + 重试 8→12 轮 |

> 教训写在这里：**任何「没量到几何」的分支都不能退成铺满整窗**，而且**早退分支必须和主分支一起改**——
> 0.8.50 漏了 `attachHost()` 失败那条路，于是同一个 bug 在 0.8.51 又出现一次。

### 安全加固（0.8.47）

本版补齐六项 P0 级安全 / 健壮性缺口（均有离线自测回归）：

- **① 防 CSRF（跨域调用）**：所有 `/api/trae-worktable` 路由默认只接受「本机 DSH 自己」发起的请求——
  带远程站点 `Origin`（如恶意网页 drive-by `POST`）一律 `403` 挡下，避免它在宿主机器上借 `/term/exec` 执行命令；
  本机 `localhost` / `127.0.0.1` / `::1` 或无 `Origin`（内部 / 同源 / curl）正常放行。
- **② `sendJson` 二次写头守卫**：流式响应（如 `/term/exec` 的 NDJSON）先 `writeHead` 再 `end`，若中途异常又调本函数，
  对已 `headersSent` / `writableEnded` 的响应安全丢弃并告警，不再抛错崩进程。
- **③ 编辑器未保存改动不再被静默覆盖**：用另一个文件覆盖一个有未保存改动的编辑器时，先 `confirm` 问一句，
  用户取消就放弃切换（仅对「不同文件」触发；重开同一文件、关标签页不弹，避免误导）。
- **④ `/site` 软链接逃逸**：静态托管先 `realpath` 跟随软链接，再校验是否仍落在项目目录内，
  指向项目外的链接一律 `403`（路径越界），正常文件不受影响。
- **⑤ 凭证段补全**：`DENY_SEGMENTS` 在原有 `.ssh/.aws/.gnupg/.kube/.dsh/.netrc/.git-credentials` 基础上，
  新增 `.npmrc` / `.gitconfig` / `.pki` / `.azure` / `.env*`（覆盖 `.env.local` 等变体），读操作一律 `403`。
- **⑥ `/web/probe` SSRF 防护**：发起探测前拦截链路本地地址（`169.254.*` / `fe80::`）与云元数据端点
  （`169.254.169.254`），连都不连，杜绝借插件读取云厂商临时凭证。

## host 路由

统一前缀 `/api/trae-worktable`：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 版本 / 平台 / 服务可用性 / 上限常量 |
| GET | `/sessions` | `{ ok, at, source, counts:{running,waiting,done,idle,total}, sessions:[{id,title,cwd,state,live,agent,updatedAt,turns}] }` |
| GET | `/defaults` | `{ workspace, home, platform, shell }`（新建项目的默认目录） |
| POST | `/transcript` | `{ sessionId, limit }` → `{ ok, title, cwd, messages:[{id,role,text,time}], truncated }` |
| POST | `/session/create` | `{ cwd? }` → `{ ok, sessionId, agentPreset? }`：调宿主 `sessionController.create` **真新建一条会话**（与 GUI「新会话」同一条链路） |
| POST | `/fs/list` | `{ path }` → `{ path, name, parent, entries:[{name,dir,link,size,mtime}], total, truncated }` |
| POST | `/fs/read` | `{ path }` → `{ path, name, size, mtime, text, truncated, eol }`，二进制 / 超 4MB 拒绝 |
| POST | `/fs/write` | `{ path, text }` → 原子写（`path.wt-tmp-<pid>` + rename） |
| POST | `/fs/mkdir` | `{ path }` → 递归建目录 |
| POST | `/fs/rename` | `{ from, to }` → 移动 / 改名，目标已存在则 409 |
| POST | `/fs/stat` | `{ path }` → `{ dir, size, mtime }` |
| GET | `/fs/raw?path=` | 媒体原始字节（图片 / PDF / 音视频，上限 48 MB）；其它类型 415 `not-media`，`inline` + `nosniff` |
| POST | `/term/exec` | `{ id, cmd, cwd }` → `application/x-ndjson` 流：`{t:'out'|'err'|'sys'|'cwd'|'clear'|'end'}` |
| POST | `/term/kill` | `{ id }` → 终止当前命令 |
| POST | `/git` | `{ path, op:'status'|'log'|'branches' }` → **只读**，`status` 解析 `-z` porcelain |
| POST | `/project/register` | `{ id, root }` → 登记项目根，供静态托管与路径白名单使用 |
| GET | `/site/<项目id>/<相对路径>` | 前缀路由，托管项目目录；目录回退 `index.html`，拦截路径穿越；404/403 返回**中文 HTML 说明页**（不是 JSON，iframe 里才看得懂） |
| POST | `/web/probe` | `{ url }` 或 `{ urls:[…] }`（≤8）→ `{ results:[{ok,status,ms,title,contentType,frameable,frameReason,error}] }`；只收 http/https，3.5s 超时，自签证书放行 |
| POST | `/web/open` | `{ url }` → 交给系统默认浏览器（`explorer.exe <url>` / `open` / `xdg-open`） |
| POST | `/custom/list` | `{}` → `{ file, items:[{id,name,kind,pid,created,updated,size}] }`（列表不带正文） |
| POST | `/custom/get` | `{ id }` → `{ item }`，没有则 404 |
| POST | `/custom/save` | `{ id?, name?, kind:'html'\|'url', body, pid? }` → 新建时由**宿主发号**，同 id 覆盖；`url` 型会归一成 `http(s)://` 并挡掉 `javascript:`；正文上限 512KB |
| POST | `/custom/delete` | `{ id }` → `{ ok }` |

### 多项目并排（0.8.44）

项目顶栏的 **⫼** 按钮 → 选另一个项目 → 一块让位区里左右铺两个项目：

- **两侧各有自己的标签页组**（`uiOf(pid)` 本来就是每项目独立的），互不影响；
- 中间拖动条调比例（20%–80%，存 `wt.side.split`），双击回 50/50；
- 每侧顶部有一条小标题带项目名：左侧 `⇄` = 把这一侧设为主项目（互换），右侧 `✕` = 关掉并排；
- 并排选择存 `wt.side.pid`，刷新后还在；进入并排位里的那个项目时**自动撤掉并排**，不会出现自己和自己并排；
- 右侧宿主对话仍只有一块（并排的是工作台，不是对话）。
### 页签记忆与终端历史（0.8.43）

- **总览页签记忆**：上次停在「项目 / 宿主会话 / 运行中」哪个页签会被记住（`wt.gridTab`），重载后回到原处；非法值回退到「项目」。
- **终端历史面板**：终端条右侧新增 **⏱ 历史 N**，点开是最近 30 条执行过的命令（去重后倒序），
  点一条就填进输入框（不自动执行）；原来 ↑/↓ 翻历史的用法不变。
  历史本身一直存在 `wt.termHistory` 里，这个面板只是把它摆出来。
### 运行配置 ▶（0.8.42）

右击项目 → **编辑** → 填「运行命令」（如 `npm run dev`）和可选的「端口」，之后：

- 项目顶栏出现 **▶**（配了命令才显示状态色）；点一下 = 打开终端标签页 → 把命令喂给终端，`cwd` = 项目目录；
- 跑起来后按钮变 **■**，点它 = `termKill`（给终端发终止请求）；状态存在 `store.run`（内存，不落盘）；
- 「项目信息」里新增一行「运行」：命令、`▶ 运行` / `■ 停止`、配了端口还有 `:5173 ↗`（用浏览器窗打开 `http://localhost:端口`）；
- **不自动执行任何东西**：命令只是喂给终端；也不自动探端口（避免误报），跳转是你点的时候才发生。

> Windows 下终止是给终端会话发中断请求，`npm run dev` 这类会起子进程的命令，必要时在终端里 Ctrl+C 兜底。
### 快捷键（0.8.41）

| 键 | 作用 |
|---|---|
| `Ctrl/⌘ + K` | 全局搜索（输入框里也生效） |
| `Ctrl/⌘ + N` | 新建项目 |
| `Ctrl/⌘ + G` | 打开总览 |
| `Ctrl/⌘ + 1…9` | 切到第 N 个标签页 |
| `Ctrl/⌘ + W` | 关闭当前标签页 |
| `Alt + ↑ / ↓` | 上一个 / 下一个项目（按 order 循环） |
| `Esc` | 关菜单 → 关弹窗 → 关工作台 |

焦点在输入框 / 文本域 / 下拉 / contenteditable 里时**不抢键**（只有 `Ctrl+K` 例外）。
实现集中在 `core.js` 的 `handleHotkey(e)`（纯函数，可单测），`index.js` 只负责挂监听。
### 总览搜索 / 排序 / 筛选（0.8.40）

「总览 → 项目」页签顶部多了一条工具条（状态存 `wt.overview`，刷新后保持）：

- **搜索**：项目名 / 别名 / 目录 / 分组 / 备注，就地过滤（空查询=全部）；
- **排序**：最近活动（默认，按绑定会话的 `updatedAt`）/ 状态优先（在跑 → 待处理 → 空闲 → 完成）/ 名称 / 自定义顺序；
- **筛选**：全部 / 有对话 / 未绑定 / 在跑·待处理；
- 筛掉一部分时右侧显示 `筛选后 / 总数`；页签角标仍是总数，不会被搜索影响。
### 撤销与窗格错误边界（0.8.39）

- **撤销删除**：移除项目后 toast 上带一个「撤销」按钮（留 9 秒），点了就把项目**放回原来的位置**
  （垃圾桶只在内存里留最近 5 个，不落盘；磁盘文件从来没动过）。
- **窗格级错误边界**：每个窗格的渲染都包在 `PaneBoundary` 里。某一格崩了只坏那一格 ——
  显示「这个窗格渲染失败了 + 具体错误 + 重新加载此窗格」，标签页、另一栏、右侧对话都不受影响；
  重试会重挂该窗格的子树（mounted 次数记在 `data-tries` 上）。
### 入驻项目注册表（0.8.38）

其他插件可以把项目「摆进」工作台侧边栏，不用改我们的代码：

```js
window.__WT_REGISTER_PROJECT__({ name: '备忘录', path: 'C:/projects/memo', icon: '📝', source: 'my-plugin' })
window.__WT_UNREGISTER_PROJECT__('ext-备忘录')
```

- 注册只加一行（侧边栏 **入驻** 分组，虚线卡片），**不落盘**；插件每次启动重注册即可，卸载后自动消失；
- 点这一行才「接入」：同目录已有项目就直接进，否则按名字/目录落成一个真项目（之后和自建项目完全一样：可改名、绑对话、套模板）；
- 按 `id` 去重（同 id 重注册是更新），最多 30 条；`name` 为空直接被忽略；
- `window.__WT_OPEN_PROJECT__(id)` 可在代码里直接触发接入；dispose 时三个钩子会被摘掉。
### 项目模板与数据迁移（0.8.37）

**模板**（新建项目时选，只决定窗格组合与布局，不建文件）：

| 模板 | 预置 | 布局 |
|---|---|---|
| ◻ 空项目 | 什么都不开 | 单窗格 |
| ◈ 前端 | 终端 + 浏览器(自动指向 localhost:5173) | 左右分栏 |
| ›_ 脚本 / 工具 | 终端 + 文件管理器 | 单窗格 |
| ✎ 写作 | 笔记 + 浏览器 | 左右分栏 |
| ◔ 研究 | 浏览器 + 笔记 + 终端 | 左右分栏 |

**导出 / 导入**（侧边栏 ⤓）：一个 JSON 文本框 —— 可直接改、可复制、可下载 `.json`，再点「导入这份数据」。
按 id（其次「目录 + 名称」）判重：重复的**更新**、新的**追加**，绝不清空现有项目；布局与主题只补缺不覆盖。
坏 JSON / 没有 projects 字段一律拒绝并提示。
### 产物回挂（0.8.36）

项目目录下放一个 **`.wt/artifact.json`**，工作台就能把「产物」自动挂进正确的窗格：

```json
{
  "artifacts": [
    { "title": "站点预览", "kind": "url", "url": "http://localhost:5173" },
    { "title": "架构图", "kind": "file", "path": "docs/arch.png" },
    { "title": "报告", "kind": "md", "path": "docs/report.md" }
  ]
}
```

- **进项目时自动读一次**（`enterProject`），「项目信息」标签页里有一块「产物」清单，可手动刷新；
- 每条的 **打开**：`url` → 浏览器窗（自动 `webGotoSmart`）；图片/PDF/视频/音频 → 媒体窗并定位到该文件；文本/Markdown/源码 → 编辑器（带 Markdown 预览）；
- **发到对话**：把 `【产物】标题 + 路径/网址 + 说明` 填进宿主输入框（不自动发送）；
- `path` 一律相对项目目录解析；文件不存在/解析失败只显示提示，不弹错。
### 媒体窗与笔记窗（0.8.35）

「＋ 窗口」里多了两个标签页，不依赖编程场景：

- **🖼 媒体**：三种选法 —— **「选择文件」**（本机选，object URL 预览，不上传不落盘）、**「浏览项目」**（在项目目录里翻，只列目录 + 可预览的媒体，点一下就预览；带「↑ 上级 / ↻ 刷新」）、或直接粘/拖文件；预览走宿主 `/fs/raw`（类型白名单 + 大小上限）。
  不支持内嵌的类型给「用编辑器打开」；预览失败（路径不对/损坏）会在角落提示，「系统打开」交给系统程序。
- **✎ 笔记**：项目级随手记，直接写进项目的 `note` 字段，**跟着项目走**（项目导出/换机都在）；
  Ctrl+S 或失焦自动保存，状态栏显示字数与「已保存 · 刚刚」，带「清空」。

### 多窗格布局（0.8.34）

顶栏左侧三个按钮切换布局预设，**每个项目各自记忆**（存在 `wt.ui.v2` 的 `layout/secondTab/split` 里）：

| 预设 | 形态 |
|---|---|
| ▭ 单窗格 | 一次一个窗口（默认） |
| ◫ 左右两栏 | 左栏 + 右栏各看一个窗口，中间拖动条可调比例（20%–80%，双击回 50/50） |
| ⬓ 上下两栏 | 上排 + 下排，同上 |

- 第一次切到分栏会自动给「第二窗格」挑一个和当前不同的标签页，不用手动配；
- 两栏的标签页互不干扰：在第一栏点标签改 `activeTab`，在第二栏点标签改 `secondTab`；
- 关闭标签页时，如果它正被某一栏用着，会自动换一个顶上；
- **只剩一个标签页时自动退回单窗格**，不会留半边空白。
### 浏览器搜索

浏览器首页（还没打开页面时）带一个搜索框：回车即搜，不像地址（中文 / 带空格）交给搜索引擎，
像地址（localhost:5173 / 域名 / http://…）仍按地址打开；地址栏也走这套分流（`webGotoSmart`）。
可选引擎：Bing（默认）/ 百度 / DuckDuckGo，选择记在 `wt.search`。

> 搜索页几乎都带 `X-Frame-Options`，多半会出「不能嵌入」说明卡 —— 那张卡里的「🚀 系统浏览器」是正路，
> 「探测」会告诉你具体原因。

### 主题与背景（0.8.14）

> 0.8.16：工作区顶栏只保留一排 5 个入口，空态里那排重复按钮删掉了（空态只留一句提示）。

侧边栏标题栏的 **⚙** 打开「主题与背景」小窗：

- **强调色**：琥珀金（默认）/ 深海蓝 / 松石绿 / 夜紫 / 玫瑰红 —— 只换色相，深浅关系不变；
  实现是把强调色拆成 `--amber-rgb` 变量，CSS 里所有 `rgba(var(--amber-rgb), x)` 一起跟着变；
- **背景**：玻璃渐变（默认）/ 蓝图网格 / 纯色 / 自定义图片；
  图片可以**直接把文件拖进小窗**（或点选文件），会先缩到 1920px 内、转 JPEG 再存（localStorage 只有 ~5MB），
  也可以填 http(s) / data:image 地址；
- **背景取景**：图片背景可在小窗里**按住拖动**选显示哪一块（`posX/posY` 存 `wt.theme`，两侧背景共用），带「居中」复位；
- **亮度**：50%–150% 滑块，只作用于背景层（侧边栏底色已挪到 `::before` 单独做 filter），文字对比度不受影响；
- 选择立刻生效，记在 `wt.theme`，重启后保持；「恢复默认」一键回到琥珀金 + 玻璃。

> 主界面占比：让位宽度自动值 **0.72 → 0.80**（0.8.17），最小 500px，右侧对话至少留 300px；
> 项目主界面与里面的浏览器窗格都更宽。浏览器首页搜索框按「搜索引擎首页」尺寸放大（48px 高、680px 宽）。
> 主题小窗的取景框现在**按主区真实宽高比**渲染（`dockAspect()`），拖哪块、主区就显示哪块。

> 浏览器：地址栏左边常驻 **🔍** 键 —— 哪怕默认站点页已经加载，点它也能切到搜索面板（内含搜索框 + 引擎切换 + 「返回页面」）。

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
│       ├── render.js   # 零依赖渲染层：Markdown → HTML、代码高亮、类型判定
│       ├── modals.js   # 新建 / 编辑 / 绑定
│       └── theme.css   # 全套样式（收在 .wt-scope 下）
├── test/
│   ├── host-routes.mjs # 127 项：路由 / 沙箱 / 文件（大文件预览 / tail / fs-raw） / reveal / open / git / 托管 / web 探测 / 自定义库 / 终端 / 四态判定 / 安全加固（CSRF·凭证段·SSRF·软链接逃逸·二次写头守卫）
│   └── client-smoke.mjs# 225 项：座位 / 侧边栏四态 / 菜单 / 让位换算 / 文件管理器 / 大文件只读预览 / 渲染层（md·高亮·媒体）/ 浏览器窗格（单行工具条·下拉·历史·探测·视口）/ 自定义窗口（生成·保存·预览）/ 标签页 / 编辑器未保存改动守卫
└── lib/                # 构建产物（安装前必须 build）
```

## 构建与自测

```sh
cd dsh
npm run build      # 产出 lib/index.js + lib/client.js
npm test           # 离线自测：stub 掉宿主，不需启动 DSH
```

## 权限与外部服务（如实披露）

- **文件读写**：宿主侧路由会读写「你点的那个路径」——文件树、编辑器保存、站点静态托管、`/fs/raw` 预览、
  `.wt/artifact.json` 产物清单。除当次操作外，进项目时会读一次该文件（没有就安静跳过）。
  这不是文件系统沙箱：路径由你在界面里决定。
- **命令执行**：终端窗与「▶ 运行」会把命令交给宿主所在机器执行（Windows 下是 PowerShell），
  cwd 默认是项目目录。终端拿到宿主进程的完整环境变量，命令能读写文件、联网——等同你本人操作。
  我们只负责把命令喂过去，不做任何自动执行（运行配置也要你点 ▶ 才跑）。
- **网络**：插件自身只访问宿主同源接口（`/api/trae-worktable/*`）；浏览器窗加载的是你输入的网址，
  页面自身可能发起任意请求，等同你在浏览器里打开它。搜索页多半带 `X-Frame-Options`，会出「不能嵌入」提示卡。
- **凭据**：不读取、不存储、不上传任何 Key / Token / Cookie。全部状态（项目、布局、主题、历史、并排、数据备份）
  都在本机浏览器 localStorage（`wt.*`），可从「⤓ 项目数据」导出。
- **外部依赖**：无生产依赖；终端能力依赖宿主提供（缺失时只有终端窗降级，其余功能照常）。

## 安装

### 0. 环境确认（本机逐项核实过）

| 项 | 值 |
| --- | --- |
| 宿主 | DeepSeek Harness Desktop `0.2.0-rc.2`（Windows） |
| 声明兼容 | `package.json` → `dsh.compatibility.dsh = "0.2.0-rc.2 \|\| 0.2.1-rc.2"` |
| 桌面端 CLI | `D:\dsh\resources\runtime\cli\bin\dsh.cmd`（存在；`plugin` 子命令透传给 pnpm） |
| profile 目录 | `%USERPROFILE%\.dsh\profiles\desktop`（`package.json` + `node_modules`） |
| 插件入口 | `package.json` → `main: lib/index.js`、`exports["./client"]: ./lib/client.js` |
| 宿主识别文件 | `dsh.plugin.json`（`name` = 包名，`client.platform: web`） |

> ⚠️ 安装/卸载前**必须完整退出 DSH**；装完手动重开。CLI 在 DSH 运行时会把 profile 判为「由应用独占」。

### 1. 开发态：link 本地源码（改代码用它）

```powershell
# 完整退出 DSH 之后：
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\dsh"
```

本机执行后的实际状态（已核实）：

- `%USERPROFILE%\.dsh\profiles\desktop\node_modules\trae-usage-worktable` 是指向本仓库的 **Junction**；
- profile 的 `package.json` 里同时出现两处：`dependencies["trae-usage-worktable"] = "link:...\dsh"`、
  `dsh.profile.bundles` 含 `"trae-usage-worktable"`（**两处都要有，插件才会被加载**）；
- 因为是 Junction，改 `src/` 后只需 `npm run build` + 重启 DSH，不用重新 add。

构建与自测：

```powershell
npm run build    # node build.mjs → lib/index.js + lib/client.js
npm test         # host 131 项 + client 454 项（离线，不需要 DSH 在跑）
```

### 2. 发布态：tgz（发给别人）

```powershell
npm run build
npm pack         # 或： node <pnpm.mjs> pack
```

本机实测产物：`trae-usage-worktable-0.8.47.tgz`，**122.9 KB**，解包后正好是 `package.json` 的 `files` 白名单 7 个文件：

```
package/package.json     package/dsh.plugin.json   package/cordis.patch.yml
package/lib/index.js     package/lib/client.js     package/README.md    package/LICENSE
```

对方拿到 tgz 后（同样先完整退出 DSH）：

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\路径\trae-usage-worktable-0.8.47.tgz"
```

### 3. 验证装好了

1. 重开 DSH → 侧边栏底部出现「工作台」卡片（标题行 🧰 + 状态框 + 项目列表）；
2. 打开带 token 的网页端地址，访问 `/api/trae-worktable/health`：
   ```json
   {"plugin":"trae-usage-worktable","version":"0.8.47","ok":true,"platform":"win32",...}
   ```
   `version` 与 `package.json` 不一致 = 还在跑旧 bundle（重启或重新 build）；
3. 侧边栏点「＋ 添加」能建项目、`Esc` 能关工作台 → 客户端 bundle 也加载成功了。

> 网页端**必须用 `dsh web` 打印的那条带 token 的 URL**。直接访问 `http://127.0.0.1:19387/` 会得到
> `401 dsh web authentication required`（本机实测），容易误判成「插件没装」。

### 4. 升级

- **link 方式**：`git pull`（或改完源码）→ `npm run build` → 完整重启 DSH；不需要重新 add。
- **tgz 方式**：产物版本号变了（`0.8.47` 之后），重新 `plugin ... add "<新 tgz>"` 覆盖安装 → 重启。
- 升级后如果界面没变：先看 `/health` 的 `version`，再怀疑浏览器缓存（client bundle 按 rev 缓存，重启或刷新页面）。

### 5. 卸载 / 回滚

```powershell
# 完整退出 DSH 之后（这条是按 pnpm remove 语义写的，本机未实跑过卸载）
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove trae-usage-worktable
```

之后确认 profile 的 `dsh.profile.bundles` 里已经没有 `trae-usage-worktable`，重启 DSH。
回滚到旧版本 = 用旧的 tgz 重新 add，或把 link 指到旧 checkout。

### 6. 已知注意事项

- **上游 `dsh-worktable` 不要加进 `bundles`**：它注册 `/api/worktable/*`，和本插件同座位/同前缀会抢路由，
  在 `0.2.0-rc.2` 上还会让网页端起不来。本机 profile 的 `dependencies` 里仍残留一条
  `dsh-worktable: file:.../dsh-upstream.tgz`，但 `bundles` 里没有它 —— 即「装了但未启用」，可以忽略或删掉依赖。
- **`link:` 是目录链接，不是拷贝**：删掉本仓库目录，插件立刻失效；要给别人用请走 tgz。
- 装/卸期间不要开着 DSH；CLI 会以「profile 由应用独占」拒绝写入。
- 终端窗依赖宿主提供的 `ws` / `node-pty`；缺失时只有终端窗格降级提示，其余功能照常。

## 验收清单（重启 DSH 后）

1. 侧边栏出现「工作台」，状态栏数字与 DSH 里实际在跑的会话一致；
2. 点项目 → **DSH 自己的对话被挤到右边**（不是盖住），左边是工作台，铺满「让位区」：
   不再有窗口模式 / 浮动小窗（0.8.0 已删除），拖窗格之间的分隔条能改分栏比例；
3. 右侧对话能正常打字、发送 —— 它就是宿主会话，不是预览；
4. 拖窗格分隔条能改比例，切布局预设（单栏 / 左右 / 上下）后比例与预设按项目记忆，刷新后还在；
5. 「🗂 文件」标签页 → 列目录 → 点 `package.json` → 自动开编辑器 → 改一行 → `Ctrl+S` → 磁盘内容确实变了；
6. 打开「终端」→ `git status` 有输出 → `cd ..` 后再 `pwd` 路径确实变了；
7. 「浏览器」默认打开项目静态页；顶栏「ⓘ 项目信息」把状态 / 绑定 / git 开成标签页；
8. 侧边栏里只有项目，不再有单独的「宿主会话」列表；右击只有一个「绑定对话」入口；
9. 总览「◉ 宿主会话」里把一行**拖到左侧工作台** → 侧边栏出现一个已绑定该对话的新项目并进入；
   新建项目时选「＋ 新建对话」→ 宿主侧边栏**真的多出一条新会话**，并且已绑定到该项目；
10. 点一个已绑定对话的项目 → 宿主中央的对话**切到该项目的主对话**（右侧看到的不是别人的会话）；
11. **展开宿主会话侧边栏**（点宿主左上角的展开键）：工作台卡片跟着变窄/变矮、自己滚，
    不再压住会话列表；侧边栏的关闭/收起键**点得动**（0.8.48 – 0.8.52 的验收点）；
12. **在宿主里打开一个文件预览**（触发重排）：工作台贴回原来的区域，不铺满整窗、
    也不从 `x=0` 盖住侧边栏；dock 头部出现「布局变了 · 重测」时点一下能贴回去。

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
8. **`is-full(inset:0)` 是陷阱**：任何「没量到几何」的分支都不能退成铺满整窗（0.8.50 / 0.8.51 连踩两次）。
9. **早退分支必须一起改**：0.8.50 只修了 `measure()` 为 0 的路径，忘了 `attachHost()` 失败的早退路径，
   于是同一个 bug 在 0.8.51 又出现一次。
10. **`flex: 0 0 auto` + `max-height` 的卡片在可压缩容器里必然溢出**：宿主 `_footArea` 默认可被压缩，
    卡片要么允许收缩（`flex:0 1 auto` + `min-height:0` + `overflow-y:auto`），要么就等着它盖住上面的列表。
8. **client bundle 按 rev 缓存**：改完不重启 DSH 不生效。
9. **宿主自己的会话行不可拖**：`ui-sidebar` 里没有任何 drag 实现，所以拖拽源由工作台的
   「宿主会话」页签提供（`ov-row` 带 `draggable` + `application/x-dsh-session` 负载）；
   侧边栏整块是落点，同时兼容 `text/plain` / `text/uri-list` / 拖文件。
10. **「＋ 新建对话」必须走宿主 `sessionController.create`**：客户端服务的 `createSession` /
    `newSession` 都不可靠（0.8.11 及以前靠猜签名，猜不中 → 项目建好了但一条会话都没生成）。
    host 现在有 `/session/create` 兜底，失败也会把宿主原因 toast 出来。

## 关键契约（改代码前必读）

- 四态换算只在 `normState()`；不要在组件里再判 `'running'`。
- 所有 host 调用走 `apiGet/apiPost`（统一超时、错误形状、竞态令牌）。
- **进项目 = 先把宿主切到主对话**：`enterProject()` 里 `jumpToSession(primarySession)`，
  右侧永远是项目绑定的那条会话；宿主没给打开入口时只 toast 提示，不阻塞进入。
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

| 项 | 上游 0.4.0 | 本插件 0.8.11 |
|---|---|---|
| 右侧对话 | 宿主会话视图让位（margin + CSS 变量），可真实输入 | 给宿主中心列写 `marginLeft` 让位，右侧就是原生会话（真能输入） |
| 终端 | node-pty + WebSocket，真 PTY | 每命令一进程 + NDJSON 流，无原生依赖 |
| 文件安全 | 任意绝对路径 | 根白名单 + realpath + 凭证目录拒绝 |
| 文件管理 | 单栏递归树，无删除 / 重命名 / 元信息 | 目录一屏 + 面包屑 + 排序 + 搜索 + 回收站删除 + 系统窗口 |
| 文件预览 | markdown-it + highlight.js + pdf/img（1.4 MB bundle） | 自写零依赖渲染器（十几 KB）：md / 高亮 / pdf / 图片 / 音视频，语义近似 |
| 浏览器窗格 | 一个输入框 + iframe，不判成败 | 历史前进后退 + 探测（能否嵌入提前说）+ 视口预设 + 加载超时兜底 + 系统浏览器出口 |
| 自定义窗口 | 表单把需求丢给宿主建会话 → AI 生成 widget manifest | 同款「一句话需求」入口，但提示词填进**当前对话**（不抢宿主建会话接口），产出 HTML 直接存本地库、可编辑可预览 |
| 窗口模型 | 窗格内多标签、跨格拖拽、自由浮动层 | 单工作区多标签页（无左栏），工作台固定铺满让位区（无浮动窗口）；对话栏用宿主原生会话区 |
| 路由前缀 | `/api/worktable` | `/api/trae-worktable`（不抢注） |

## License

MIT（与上游一致）。
