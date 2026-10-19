# trae-usage-worktable（DSH 插件 · 0.10.5）

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
访问 `/api/trae-worktable/health`，返回里的 `version` 应等于 `package.json` 的版本（当前 `0.10.5`）。

分发 / 升级 / 卸载 / 排查见下方「安装」一节。

## 能力（0.10.5）

| 半侧 | 文件 | 内容 |
|---|---|---|
| host | `src/index.js` + `src/git.js` + `src/pty.js` → `lib/index.js` | 会话快照 / 文件读写 / 命令执行 / 真 PTY / git 读写 + GitHub / 项目静态托管 |
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
6. **拖放添加项目**（0.8.12，0.10.4 修好拖拽，0.10.5 修好取名）：宿主侧边栏 / 总览「◉ 宿主会话」里的会话行都能**拖到左侧工作台**，
   松手即用该会话新建项目并绑定；落点是**某个项目**时改成**绑到那个项目**（不再凭空多一个）。
   项目名就是**会话在宿主侧边栏上的那个名字**（宿主只给会话 id 时先落占位名，补拉一次 `/sessions` 后自动改名）；
   同一条会话重复拖只会进已有项目。也认拖进来的目录路径（Windows 绝对路径 / `file://`）→ 按目录建项目。

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
  - **终端**：**真 PTY**（0.9.0 起，借宿主自带的 node-pty）——`vim` / `top` / `ssh` / 交互式提示符都能跑，
    `Ctrl+C` 真的进前台进程；拿不到原生模块时自动降级成「一条命令一个进程 + NDJSON 流」，
    降级会说明原因并可一键重试（详见下文「真 PTY 终端」）；
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

### 拖到会话（0.8.53）

把「文件在哪 / 网页是哪个」变成一句话填进对话，不用来回复制路径：

- **文件 → 对话**：文件管理器每一行可拖，拖到工作台**顶栏**松手 → 绝对路径填进右侧对话输入框；
  工具条「→ 对话」按钮发送当前选中项（没选中时发当前目录）；
- **网页 → 对话**：浏览器地址栏可拖，拖到顶栏 → 当前网址 + 页面标题填进对话；工具条「💬」一键发送；
- **顶栏即放置区**：项目工作区与总览的标题栏整条都是投放目标，拖动经过时高亮并提示「松手 → 填进对话输入框」；
- **落文格式**（只填输入框，**不自动发送**——发不发由你决定）：
  ```
  【文件】arch.png
  C:\projects\demo\docs\arch.png

  【网页】示例站
  https://example.com/x
  ```
- 拖出去也认：同时写入 `application/x-wt-file`、`text/plain`、`text/uri-list`（`file://`），
  拖给资源管理器 / 浏览器等外部程序可用；接收端四级回退解析
  （自定义类型 → `File.path` → `text/uri-list` → `text/plain`）。

### 真 PTY 终端（0.9.0）

之前是「一条命令起一个进程 + 管道」：`cd`、单条命令、流式回显都对，但**跑不了交互式程序**，
`Ctrl+C` 也进不到前台进程里。0.9.0 换成真 PTY。

| 项 | 做法 |
|---|---|
| 原生模块从哪来 | **借宿主自带的那份 node-pty**（DSH 桌面端自己的终端就用它）：JS 在 `app.asar/dsh/node_modules/node-pty`，`.node` 在 `app.asar.unpacked` 下，Electron 的 fs 补丁会自动落到解包目录 |
| 为什么不自己装 | node-pty 是原生模块，npm 装上还得现场编译，用户机器多半没有 MSVC；借现成的最稳，且 ABI 与宿主进程完全一致 |
| 拿不到怎么办 | `/term/mode` 报 `ok:false` + 原因，`/term/open` 返回 `mode:'exec'`，界面**退回命令模式**、写明原因并给「再试一次 PTY」按钮。不白屏，也不假装能用 |
| 渲染 | `@xterm/xterm` + `@xterm/addon-fit` 打进 client bundle（无运行时依赖），配色跟随琥珀金主题 |
| 传输 | 不用 WebSocket：输出用 `fetch` 读 NDJSON 长连接（先回放 backlog 再接实时流），输入攒 10ms 批量 POST，尺寸变化 140ms 防抖后报 `cols/rows` |
| 会话生命周期 | 会话 id 固定为 `wt-pty-<项目id>`：**切标签页只是卸载 xterm，shell 留在宿主里**；切回来重挂并回放最近 240KB 输出；点「重启」才 kill + 重开 |
| 运行配置 ▶ | 有 PTY 时命令直接**打进交互式 shell**（输出看得见），没有才走命令模式；■ 发 `Ctrl+C`，不再无条件杀进程树 |

已知边界：Windows 上走 ConPTY，个别旧版本可能丢输出（`useConpty` 已默认打开）；
`backlog` 只留输出、不保留滚动语义，切回来看到的是「最近 240KB 重放」，不是逐像素复原的屏幕。

### 拖拽建项目 / 绑定（0.10.4，0.10.5 修好取名）

宿主侧边栏的会话行可以直接拖到工作台：

| 落点 | 行为 |
|---|---|
| 侧边栏空白处 | 用这条会话**新建项目**并进入 |
| 侧边栏某个项目行 | **绑到那个项目**（不新建）；项目没有工作目录时顺手用会话 cwd 补上 |
| 总览的项目卡片 | 同上 |
| 会话已在别的项目上 | 拒绝并说明在哪个项目，不会一话两绑 |
| 拖的是目录 | 按目录建项目 / 给空目录项目补工作目录（已有值不覆盖） |

取名：**会话名照抄宿主侧边栏**（0.10.5 起）→ 「未命名项目」+ 编辑窗。宿主行只带
`session-<uuid>` 时，先落占位名，**补拉一次 `/sessions` 后自动改名并关掉编辑窗**；
真查不到（会话已删）才留着让人手填。

会话名不是 header 上的字段，而是宿主把整条事件日志折叠出来的（最后一个 `session/title`，
通常就在 seq 14 附近）。所以 `/sessions` 现在直接调 `sessionQuery.readTitleSnapshots(ids)` 批量问，
不再自己扫尾部 400 条事件 —— 那样长会话永远取不到标题，会掉到兜底的工作目录名，
默认工作区就叫 `default-workspace`。行上的 `titled: false` 表示「这只是目录名」，
界面据此显示「未命名会话」，项目也不会拿它当名字。

拖拽细节见「已知坑」第 9 条：宿主的 `effectAllowed` 是 `move`，我们的 `dropEffect` 必须兼容，
否则浏览器不派发 `drop` —— 这是以前「拖过去没反应」的根因。

### 源代码管理 / GitHub（0.10.0 起）

工作区多了 **⑂ 源代码管理** 标签页（和文件管理器平级，不是上游那种左栏）。一件事走完：
看改动 → 暂存 → 写说明 → 提交 → 推。

| 区 | 能做什么 |
|---|---|
| 头部 | 当前分支（点击进分支视图）、`↑ahead ↓behind`、取回 / 拉取 / 推送 / 刷新 |
| GitHub 条 | 已登录显示账号 + 「上传仓库」「克隆」；未登录显示「登录 GitHub」 |
| 提交区 | 说明 + 「提交」「提交并推送」「全部暂存」；暂存为空时按钮置灰 |
| 三段改动 | 暂存的改动 / 未暂存的改动 / 未跟踪的文件；行内 `＋` 暂存、`－` 取消暂存、`↺` 丢弃（**两步确认**） |
| diff | 点任一行在底部展开，`+` 绿 `-` 红；截断到 3000 行，二进制只报标记 |
| 历史 | 最近 20 条 + 「回退」（`reset --soft`，改动回到工作区，两步确认） |
| 分支 / 标签 / 远程 | 切换、新建并切换、删除、检出远程分支、打标签、看 origin 地址 |

**GitHub 登录**有两种落法：

1. **本机已有凭据就不用登录** —— 打开窗格时按「界面保存的令牌 → 环境变量 `GH_TOKEN` / `GITHUB_TOKEN` →
   `gh auth token` → `git credential fill`」依次探测，探测到就直接显示账号
   （本机实测走的就是最后一条：Git Credential Manager 里那份 `gho_` 令牌）。
2. **粘令牌** —— `ghp_` / `github_pat_` 都行，存到 `~/.dsh/worktable-github.json`（0600）。
   可选「同时写进系统凭据管理器」，让内置终端里的 `git push` 也免密。

**上传仓库**按四步走，每步失败都会把 git 的原话回显：`git init`（已是仓库则跳过）→ 没有提交就「初始提交」→
在 GitHub 建同名仓库并设 origin（已有 origin 则沿用，不重复建）→ `push -u origin <当前分支>`。

**克隆**在总览顶栏「⑂ 克隆」或新建项目窗里，支持 `owner/repo` 简写、私有仓库（自动带令牌）、
`--depth 1`、只取某个分支；进度是 NDJSON 实时刷的，克隆完自动建成项目并打开。

**选目录**（0.10.3）：克隆窗「克隆到」右边多了「浏览…」，点开是内嵌的目录树 —— 只列子目录，
点一行进一级，`↑` 回上级，`↻` 重列，底部「用这个目录」回填。默认从当前的「克隆到」路径开始，
没有就退回工作目录。仍然可以直接粘路径。
> 为什么不用系统选择框：浏览器里 `<input type=file webkitdirectory>` 只给文件名、不给绝对路径，
> 拿不到能落盘的目录。
>
> 浏览时会把 `/fs/list` 返回的 `writable` 一起判断：**读目录不设白名单**（能一路翻到盘符），
> 但**写（克隆）要求落在白名单内**（进程 cwd、用户 home、DSH_HOME、已注册项目根）。所以选到
> 白名单外的目录会当场亮红并禁用「用这个目录」，而不是点了「克隆」才吃 400。

> **证书问题**：Windows 上 schannel 的吊销检查连不上（`CRYPT_E_NO_REVOCATION_CHECK`）会让整条命令失败。
> 退让顺序是「原样 → 只关吊销检查 → 用户勾选时关证书校验」，默认**不会**偷偷关掉校验；
> 勾选开关在克隆窗和「分支 → 远程」里，勾一次会记住，推送 / 拉取一起生效。

**取消初始化**（0.10.1）：等价于在仓库根执行 `rm -rf .git` —— 只删 `.git` 目录，项目文件一个都不动，
提交历史 / 分支 / 标签一起没掉；已经推到 GitHub 的那份不受影响。入口在「分支」视图底部的危险区，
按钮要点两次（第一次变成「再点一次确认删除 .git」，4 秒后自动复原）。
服务端另有三条硬约束，不只靠 UI 拦：① 请求必须带 `confirm: true`；② 必须在仓库根
（在子目录调用会拒绝，否则会把上层仓库端掉）；③ `.git` 必须是目录 —— 是文件说明这是
worktree / 子模块，删了会连带毁掉主仓库，直接拒绝并提示手动处理。

### 编辑器行号栏的改动标记（0.10.2）

打开文件切到「编辑」视图时，左边多一列行号，行号左侧的竖条就是 git 改动：

| 竖条 | 含义 | 跟 VS Code 的对应 |
|---|---|---|
| 绿色整条 | 新增行 | Gutter added |
| 琥珀整条 | 修改行 | Gutter modified |
| 红色短条（贴行顶） | 在这里删过内容（锚点是「原本的下一行」） | Gutter deleted |
| 无 | 跟 HEAD 一致 | — |

标题栏同时给一个 `+n ~n −n` 的统计。判定基准是 **HEAD**，所以「已暂存」和「还没暂存」的改动
一起算 —— 想看暂存区和工作区的区别，去「源代码管理」的 diff 面板；行号栏只回答
「这个文件相对上次提交改在哪儿」。

实现上的取舍：

1. **只算行号，不传 diff**。host 侧 `op: 'linemap'` 用 `git diff -U0 --no-color HEAD -- <file>`
   只解析 `@@` hunk 头，把「新文件的行区间」翻成 `add` / `mod` / `del`。
   几千行的文件也只是几百字节的响应，前端不用解析 patch。
2. **`-U0` 是最小 hunk**，所以它比「整块标黄」更准：在中间插两行，只会标那两行，
   不会把上下文一起染色。
3. **行高必须锁死**。行号栏和 `<textarea>` 共用 `line-height: 18px`，
   用 `1.65` 这种相对值会因像素取整逐行错位，滚到几百行就开始偏。
4. **超长文件不画行号栏**（> 8000 行）：几万个 DOM 节点比没有标记更糟。
5. 文件不在仓库里 / 在仓库外：`markState` 回到 `idle`，行号栏不染色，也不报错。

保存后会自动重算一次（刚写的行可能从「新增」变成「已修改」，也可能整体归零）。

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
| GET | `/sessions` | `{ ok, at, source, counts:{running,waiting,done,idle,total}, sessions:[{id,title,titled,cwd,state,live,agent,updatedAt,turns}] }` |
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
| POST | `/term/exec` | `{ id, cmd, cwd }` → `application/x-ndjson` 流：`{t:'out'|'err'|'sys'|'cwd'|'clear'|'end'}`（**降级模式**） |
| GET | `/term/mode` | `{ ok, from, error, shell, sessions[] }`：PTY 可不可用、用的是哪份 node-pty、当前有几个会话 |
| POST | `/term/open` | `{ id, cwd, cols?, rows? }` → `{ ok, mode:'pty', shell, cwd, cols, rows }`；拿不到 node-pty 时返回 **200 + `{ok:false, mode:'exec', error}`**（客户端据此降级，不报错） |
| POST | `/term/stream` | `{ id }` → NDJSON 长连接：先回放 backlog（240KB 上限）再推实时 `{t:'out'}`，退出推 `{t:'exit',code}` |
| POST | `/term/input` | `{ id, data }` → 写进 PTY（键盘输入，单次 ≤64KB）；会话不在 → 409 |
| POST | `/term/resize` | `{ id, cols, rows }` → `pty.resize()`；cols 20–400 / rows 6–200 |
| POST | `/term/kill` | `{ id }` → 终止当前命令；有 PTY 会话时连同 shell 一起收掉 |
| POST | `/git` | `{ path, op }` → 一个入口跑全部 git 操作，op 见下表 |
| POST | `/git/clone` | `{ url, dest, depth?, branch?, insecure? }` → **NDJSON 进度流**（clone 走 stderr，逐行推 `{t:'out',line}`，结束推 `{t:'end',ok,path}`） |
| GET | `/gh/status` | `{ loggedIn, source, login, name, avatar, scopes, repoScope }` —— **不回传令牌**；来源按「界面登录 → 环境变量 → gh CLI → 系统凭据」顺序探测 |
| POST | `/gh/login` | `{ token, remember?, writeCredential? }` → 校验令牌（`GET /user`）后存到 `~/.dsh/worktable-github.json`（0600） |
| POST | `/gh/logout` | 清掉本插件保存的令牌（不动系统凭据管理器） |
| GET | `/gh/repos?q=&page=` | `{ ok, repos:[{name,fullName,private,cloneUrl,description,branch,updatedAt}] }` |
| POST | `/gh/create` | `{ name, private?, description?, org? }` → 建远程仓库 |
| POST | `/gh/upload` | `{ path, name, private?, description?, branch? }` → init（无仓库时）→ 首次提交（无提交时）→ 建远程仓库 → push -u；返回 `{ steps[], remote, branch, repo }` |
| POST | `/project/register` | `{ id, root }` → 登记项目根，供静态托管与路径白名单使用 |
| GET | `/site/<项目id>/<相对路径>` | 前缀路由，托管项目目录；目录回退 `index.html`，拦截路径穿越；404/403 返回**中文 HTML 说明页**（不是 JSON，iframe 里才看得懂） |
| POST | `/web/probe` | `{ url }` 或 `{ urls:[…] }`（≤8）→ `{ results:[{ok,status,ms,title,contentType,frameable,frameReason,error}] }`；只收 http/https，3.5s 超时，自签证书放行 |
| POST | `/web/open` | `{ url }` → 交给系统默认浏览器（`explorer.exe <url>` / `open` / `xdg-open`） |
| POST | `/custom/list` | `{}` → `{ file, items:[{id,name,kind,pid,created,updated,size}] }`（列表不带正文） |
| POST | `/custom/get` | `{ id }` → `{ item }`，没有则 404 |
| POST | `/custom/save` | `{ id?, name?, kind:'html'\|'url', body, pid? }` → 新建时由**宿主发号**，同 id 覆盖；`url` 型会归一成 `http(s)://` 并挡掉 `javascript:`；正文上限 512KB |
| POST | `/custom/delete` | `{ id }` → `{ ok }` |

`/git` 支持的 `op`（除 `status` 外都要求目录落在可写白名单内）：

| op | 参数 | 作用 |
|---|---|---|
| `status` | — | 分支 / 改动 / 计数 / 领先落后 + 顺带带 **log / branches / tags / remotes**（一次往返拿全） |
| `log` | `limit, ref?` | 提交历史（短 hash / 日期 / 标题 / 作者 / 父提交数） |
| `branches` `tags` `remotes` | — | 本地+远程分支 / 标签 / 远程地址 |
| `diff` | `file?, staged?, commit?` | 工作区、暂存区或某个提交的 diff（未跟踪文件按「全新增」合成；二进制只报标记） |
| `stage` `unstage` `discard` | `files[]`（空数组 = 全部） | 暂存 / 取消暂存 / 丢弃（未跟踪走 `git clean`，界面必须二次确认） |
| `commit` | `message, all?, amend?` | 提交；空说明直接拒 |
| `fetch` `pull` `push` | `remote?, branch?, rebase?, tags?, insecure?` | 网络操作，120s 超时；`push` 没上游时自动 `-u` |
| `checkout` | `target, create?, startPoint?` | 切分支 / 建分支；`origin/x` 建同名跟踪分支，不会落到 detached HEAD |
| `branch` | `action:'list'\|'delete'\|'rename', name, force?, renameTo?` | 分支管理 |
| `tag` | `action:'create'\|'delete', name, message?, target?` | 标签管理（带说明用 `-a`） |
| `reset` | `commit, mode:'soft'\|'mixed'\|'hard'` | 回退；界面只暴露 soft（改动回到工作区） |
| `init` `remote` | `branch?` / `name, url` | 初始化仓库 / 设置远程 |
| `uninit` | `confirm:true` | **取消初始化**：删 `.git`，工作区文件不动（0.10.1）。三条硬约束见下 |
| `linemap` | `file` | 行级改动地图：返回 `{marks:[{line,kind}],adds,mods,dels}`（0.10.2，编辑器行号栏用） |

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

### 多窗格布局（0.8.34 起，0.9.0 扩到六种）

顶栏左侧六个按钮切换布局预设，**每个项目各自记忆**（存在 `wt.ui.v2` 的 `layout/secondTab/cells/split/splitB` 里）：

| 预设 | 格子 | 形态 |
|---|---|---|
| ▭ 单窗格 | 1 | 一次一个窗口（默认） |
| ◫ 左右两栏 | 2 | 左栏 + 右栏，中间拖动条 20%–80%，双击回 50/50 |
| ⬓ 上下两栏 | 2 | 上排 + 下排，同上 |
| ▤ 上一下二 | 3 | 顶行通栏 + 下面并排两栏；横向、纵向各一条拖动条 |
| ▥ 三列 | 3 | 三栏并排，两条分割线可拖（末列保底 15%，不会挤成缝） |
| ▦ 四格 | 4 | 2×2：一条行分割 + 两行列分割共用同一个比例 |

- 第一次切到多格会自动给空格子挑「还没被别格占用」的标签页，不用手动配；
- 每格的标签页互不干扰：点哪一格的标签，就只改那一格（`activeTab` / `secondTab` / `cells[2..3]`）；
- 关闭标签页时，如果它正被某一格用着，那一格会自动换一个顶上；
- **标签页可以跨格拖**（0.9.0）：把标签拖到另一格，两格互换内容，标签页总数不变；
  拖动时落点那一格会亮一圈内描边；
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

项目元数据只在浏览器里，删项目不动磁盘。磁盘写入只有三类：编辑器保存、`mkdir/rename`、git 操作本身。

另外两个**不在项目目录里**的文件：

| 文件 | 内容 |
|---|---|
| `~/.dsh/worktable-custom.json` | 自定义窗口库（HTML / 网址条目） |
| `~/.dsh/worktable-github.json` | GitHub 令牌（0600，只存令牌与账号名；退出登录会清空） |

## 安全边界（与上游有意不同）

1. 所有路径必须落在白名单根内：进程 cwd、用户 home、`DSH_HOME`、已登记的项目根；
2. 先 `realpath` 解析符号链接再判根（逐级回退到第一个存在的祖先），挡 `../` 与 symlink 逃逸；
3. `.ssh` / `.aws` / `.gnupg` / `.kube` / `.password-store` 一律拒绝；
4. 不再把任意请求体写进插件目录（上游 `/ping` 就这么干过，本版已删除该路由）；
5. 命令用 `spawn(file, args)` 而非 `exec`，不拼 shell 字符串；`git` 用 `execFile`，
   子命令走**白名单分发**（客户端只传 `op`，不拼命令行），文件路径一律放在 `--` 之后；
   改仓库的 `op` 要求目录落在可写白名单内。
6. **GitHub 令牌不进 argv**：只通过环境变量 `WT_GH_TOKEN` + 一次性的 `credential.helper` 交给 git，
   进程表里看不到；`/gh/status` 只回账号信息、从不回令牌；
   `gh/logout` 只清本插件的文件，不动系统凭据管理器。

已知取舍：终端默认走**真 PTY**（见上文）；只有宿主里借不到 node-pty 时才降级成
「每条命令一个进程 + host 记 cwd」——降级模式下 `cd` 仍生效、环境变量继承、单条命令可中断，
但不支持 `top`/`vim` 这类全屏交互程序。

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
4. 拖窗格分隔条能改比例，切布局预设（单栏 / 左右 / 上下 / 上一下二 / 三列 / 四格）后
   比例与预设按项目记忆，刷新后还在；三格四格时每个格子都有内容，不是半块空白；
4b. **跨格拖标签**：把一格的标签拖到另一格 → 两格内容互换、标签数不变、落点格亮一圈描边；
5. 「🗂 文件」标签页 → 列目录 → 点 `package.json` → 自动开编辑器 → 改一行 → `Ctrl+S` → 磁盘内容确实变了；
6. 打开「终端」→ 工具条上 `PTY` 徽标是亮的（不是灰的「连接中」）→ `git status` 有输出 →
   `cd ..` 后再 `pwd` 路径确实变了；再试 `dir` / `ls`，能滚轮翻历史；
6b. **交互式程序**：终端里敲 `python`（或 `node`）进入 REPL → 能一行行交互 →
   `Ctrl+C` 退出 REPL 但 **shell 还在**（提示符回来）；再敲 `vim`（装了的话）能全屏编辑、`:q` 退出；
6c. **切走再切回**：切到别的标签页再切回终端 → 之前的输出还在（240KB 内），
   敲命令照常响应（说明 shell 没被重开）；点「重启」才换一个新 shell；
7. 「浏览器」默认打开项目静态页；顶栏「ⓘ 项目信息」把状态 / 绑定 / git 开成标签页；
8. 侧边栏里只有项目，不再有单独的「宿主会话」列表；右击只有一个「绑定对话」入口；
9. 总览「◉ 宿主会话」里把一行**拖到左侧工作台** → 侧边栏出现一个已绑定该对话的新项目并进入；
   新建项目时选「＋ 新建对话」→ 宿主侧边栏**真的多出一条新会话**，并且已绑定到该项目；
10. 点一个已绑定对话的项目 → 宿主中央的对话**切到该项目的主对话**（右侧看到的不是别人的会话）；
11. **展开宿主会话侧边栏**（点宿主左上角的展开键）：工作台卡片跟着变窄/变矮、自己滚，
    不再压住会话列表；侧边栏的关闭/收起键**点得动**（0.8.48 – 0.8.52 的验收点）；
12. **在宿主里打开一个文件预览**（触发重排）：工作台贴回原来的区域，不铺满整窗、
    也不从 `x=0` 盖住侧边栏；dock 头部出现「布局变了 · 重测」时点一下能贴回去。
13. **源代码管理**：点「⑂ 源代码管理」→ 顶部出现分支名与 `↑↓` → 改一个文件后刷新，
    改动出现在「未暂存的改动」→ 行内 `＋` 把它挪到「暂存的改动」→ 写说明点「提交」→ 历史里出现这条；
14. **GitHub**：打开同一窗格，GitHub 条应自动认出本机账号（如本机 git 登录过）；
    没有就点「登录 GitHub」粘一个 `ghp_` 令牌 → 回来应显示账号名；点「克隆」能列出仓库；
15. **推送**：`推送` 按钮在有改动时能推到远端（第一次会自动建上游），失败会把 git 原话弹出来；
16. **上传仓库**：点「上传仓库」→ 填名字选私有 → 建仓并上传 → 弹窗里逐步列出 init / 提交 / 建仓 / 推送；
17. **克隆**：总览点「⑂ 克隆」→ 填 `owner/repo` → 选目录 → 进度实时刷 → 完成后自动打开成项目。

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
9. **宿主的会话行是能拖的，但只给一个 id**：`ui-sidebar` 里会话行是
   `draggable` + `onDragStart → dataTransfer.setData('text/plain', node.id)`，
   并且声明 `effectAllowed = 'move'`。两个后果：
   ① 我们这边 `dragover` 的 `dropEffect` 必须是 `move`（或至少兼容），写死 `copy` 会让浏览器
   **根本不派发 drop**；② 载荷里没有标题和 cwd，必须拿 id 回查 `/sessions` 才有名字（0.10.4 修）。
   而 `/sessions` 的标题又必须问 `sessionQuery.readTitleSnapshots`（0.10.5 修）：
   `session/title` 事件写在日志开头，只扫尾部 400 条的长会话永远取不到，会掉到目录名兜底。
   工作台自己的行仍然写 `application/x-dsh-session`（带标题 + cwd），两条来源都要认。
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

| 项 | 上游 0.4.0 | 本插件 0.9.0 |
|---|---|---|
| 右侧对话 | 宿主会话视图让位（margin + CSS 变量），可真实输入 | 给宿主中心列写 `marginLeft` 让位，右侧就是原生会话（真能输入） |
| 终端 | node-pty + WebSocket，真 PTY | 同样真 PTY，但**借宿主的 node-pty + HTTP NDJSON 双通道**（不用自己装原生模块、不注册 WS upgrade）；借不到时降级为每命令一进程 |
| 版本控制 | 只读（status / log / branches） | **读写齐全**：暂存 / 提交 / 推送 / 拉取 / 分支 / 标签 / 回退 / diff + GitHub 登录 / 建仓上传 / 克隆 |
| GitHub 账号 | 不管 | 自动识别本机已有凭据（gh CLI / 凭据管理器）+ 粘令牌登录；令牌 0600 落盘、不进 argv |
| 文件安全 | 任意绝对路径 | 根白名单 + realpath + 凭证目录拒绝 |
| 文件管理 | 单栏递归树，无删除 / 重命名 / 元信息 | 目录一屏 + 面包屑 + 排序 + 搜索 + 回收站删除 + 系统窗口 |
| 文件预览 | markdown-it + highlight.js + pdf/img（1.4 MB bundle） | 自写零依赖渲染器（十几 KB）：md / 高亮 / pdf / 图片 / 音视频，语义近似 |
| 浏览器窗格 | 一个输入框 + iframe，不判成败 | 历史前进后退 + 探测（能否嵌入提前说）+ 视口预设 + 加载超时兜底 + 系统浏览器出口 |
| 自定义窗口 | 表单把需求丢给宿主建会话 → AI 生成 widget manifest | 同款「一句话需求」入口，但提示词填进**当前对话**（不抢宿主建会话接口），产出 HTML 直接存本地库、可编辑可预览 |
| 窗口模型 | 8 种「左栏 + 顶行 + 主行」三带预设、窗格内多标签、跨格拖拽、自由浮动层 | 6 种预设（含上一下二 / 三列 / 四格）、跨格拖标签已补齐；仍是单工作区多标签 + 固定铺满让位区（无浮动窗口），对话栏用宿主原生会话区 |
| 路由前缀 | `/api/worktable` | `/api/trae-worktable`（不抢注） |

## License

MIT（与上游一致）。
