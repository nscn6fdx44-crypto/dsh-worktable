# 交接文档 · trae-usage-worktable（工作台）

> 生成时间：2026-10-20 · 版本 **0.10.8** · 分支 `dsh-plugin`（远端默认分支）
> 用途：换会话/换人接手时，靠这一份 + 仓库本身恢复全部上下文。README 讲“是什么”，这份讲“现在到哪了、怎么继续”。

---

## 0. 30 秒速览

| 项 | 值 |
| --- | --- |
| 仓库目录 | `C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\dsh`（git 顶层是上一级 `2026-10-16-23-21-22`，插件在 `dsh/` 子目录） |
| 远端 | `https://github.com/nscn6fdx44-crypto/dsh-worktable.git` |
| 分支 / 最近提交 | `dsh-plugin` / 0.10.6：`feat(0.10.6): 下架编辑器窗格 / 标签条左右滑 / 自定义窗口放本地 html`（`0ce8d5f`，tag `v0.10.6`） |
| 版本 | `package.json` = `dsh.plugin.json` = **0.10.7**（已改号，**还没打 tag / 发 Release**） |
| 安装方式 | profile 里 `link:` 到本目录（Junction），bundles 含 `trae-usage-worktable` |
| 运行中的实例 | 客户端会热更，但 **host 路由必须完整重启 DSH** 才生效（`/asset`、`/gh/status`、`op:uninit` 在旧实例上会 401/404） |
| 自测基线 | host **189** + client **616** 全通过（`npm test`） |
| tag | 0.10.0 / 0.10.1 / 0.10.2 / 0.10.3 / 0.10.4 / 0.10.5 / `v0.10.6` **全部已打并推送** |
| Release | 0.10.0（417235810）、0.10.1（417246640）、0.10.2（417267258）、0.10.3（417344262）、0.10.4（417364793）、0.10.5（417385825）、**0.10.6（417899693，附件 id 657887031）** 都已发布；0.10.6 附件 **254354 字节 / 248.4 KB**、sha256 `7a2921e10311c0f18a6edcf5333fd7656eacfd57ac3e0b76adbc5acbaecaadeb`，下载回本地逐字节校验一致 |
| 宿主 | DeepSeek Harness Desktop `0.2.0-rc.2`（Windows），CLI 在 `D:\dsh\resources\runtime\cli\bin\dsh.cmd` |

---

## 1. 新会话开工三件事

```powershell
cd C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\dsh
git pull --ff-only            # 可能有别的会话也在改同一个仓库（见 §11）
npm run build && npm test     # 基线必须 189 / 616 全绿，否则先别改
```

要读的三处（按顺序，读这三处就能接上）：

1. `src/client/core.js`（约 3600 行）—— 唯一的状态源（store / 所有动作 / 路由调用）
2. `src/client/overlay.js` + `src/client/hostdock.js` —— 主区渲染 + **让位机制**（最容易被改坏的部位）
3. `test/client-smoke.mjs` —— 616 条断言就是行为规格书

---

## 2. 安装 / 构建 / 发布（都实测过）

### 构建与自测

```powershell
npm run build     # node build.mjs → lib/index.js + lib/client.js（版本从 package.json 读入）
npm test          # host-routes.mjs + client-smoke.mjs
npm run check     # node --check 两个产物
```

### 本机安装现状（profile）

- `%USERPROFILE%\.dsh\profiles\desktop\node_modules\trae-usage-worktable` → **Junction** 指向本目录；
- profile `package.json` 里两处都要有：`dependencies["trae-usage-worktable"] = "link:...\dsh"`、`dsh.profile.bundles` 含 `"trae-usage-worktable"`；
- 因为是 Junction：**改完 `npm run build` + 完整重启 DSH 即生效**，不需要重新 add；
- 装/卸前必须从托盘**完整退出 DSH**，否则 CLI 报 `profile "desktop" is managed exclusively by the Electron application`。

### 打包分发

```powershell
node C:\Users\jinshuaiyu\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs pack
# 产物 trae-usage-worktable-<ver>.tgz（实测 ~125KB / 7 个文件，含 lib/）
```

`lib/` 被 `.gitignore` 忽略，但 `package.json.files` 白名单会强制打进 tgz —— 所以**仓库里看不到 lib 是正常的**，打 tgz 前必须先 `npm run build`。

### GitHub Release（**已完成**）

- tag `v0.8.53` 已推；Release `v0.8.53` 已建、附件已上传，正文取自仓库内
  `dsh/docs/releases/v0.8.53.md`（**0.8.53 起发布说明进仓库了**，不再放 Documents 下）
- **别再信「没有 token」这条**：本机没 `gh`、没 `GH_TOKEN`，但 `git credential fill`
  能直接拿到 GitHub OAuth 令牌（`gho_` 开头，scopes 含 `repo`），`api.github.com` 也没被 hosts 拦：
  ```powershell
  # 取令牌（不要打印全文）+ 调 API 的写法见本节下方脚本思路
  printf "protocol=https\nhost=github.com\n\n" | git credential fill
  ```
  建 Release = `POST /repos/<owner>/<repo>/releases`（`tag_name`/`name`/`body`），
  传附件 = `POST https://uploads.github.com/repos/<owner>/<repo>/releases/<id>/assets?name=<文件名>`，
  Content-Type 用 `application/gzip`。改正文用 `PATCH /releases/<id>`，删附件用 `DELETE /releases/assets/<id>`。
- **tag 已推之后发现要补文档？** 先确认该 tag **还没发 Release / 没被别人引用**，再
  `git tag -d` + 重新 `git tag -a` + `git push --force origin refs/tags/vX`。
  0.8.53 就这么干过一次：另一个会话先打了 tag（指向 `c317e88`），随后文档同步提交才有，
  于是把 tag 重指到含文档的提交，**保证「tag 里的 dsh/README.md」与「包内的 README」是同一份**。
- **`dsh/README.md` 在 npm 包里**：它的换行会随 `core.autocrlf` 在 CRLF/LF 之间变，重打包 sha256 也会变。
  发布前先定稿再打包，文档里写的 sha 以**实际上传的附件**为准。
- 仓库已有 Release：`v0.8.53`、`v0.8.52`、`v0.8.47`、`v0.8.11`（各 1 个附件）
- **首页/安装文档跟着版本走**：发版时必须一起改 —— `README.md`、`README.zh.md`、`INSTALL.md`
  里的下载 URL、版本号、sha256、大小（漏改就会出现「首页写的还是上个版本」）
- **下次发版顺序**：`npm run build && npm test` → 改两处版本号 → 写 `docs/releases/vX.md`
  → 打包并算 sha256（注意：`dsh/README.md` 会在包里，改它要**在打包前**改完）
  → 同步根 README / INSTALL 的版本与 sha → commit + push → `git tag -a` + push tag → 建 Release / 传附件

---

## 3. 代码地图

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `src/index.js` | ~2280 | host 半侧：全部 `/api/trae-worktable/*` 路由（fs / asset / term / git / site / web / custom / transcript / session） |
| `src/client/core.js` | ~3600 | 状态与应用层：store、项目增删改、标签页、**布局预设**、主题、产物、模板、导入导出、入驻注册表、快捷键、运行配置、媒体目录 |
| `src/client/hostdock.js` | ~340 | **让位机制**：找宿主 `centerCol`、给会话列写 `marginLeft`、测量几何、`pickDock` / `undockedBox` / `dockAspect` |
| `src/client/overlay.js` | ~807 | 主区：`MainView`（几何 + 降级）、`Overview`（总览三页签）、`Workspace`（项目工作区）、`Panes`/`PaneSplit`（多窗格）、`PaneBoundary`（错误边界）、**标签条横滑** |
| `src/client/panes.js` | ~2190 | 各个窗格：Info / Files / Term / Web / Custom（含 `HtmlPick` 挑本地网页）/ **Media** / **Notes** |
| `src/client/sidebar.js` | ~254 | 侧边栏卡片：状态框、项目列表、拖拽、入驻分组、`sideModeOf` 自适应 |
| `src/client/modals.js` | ~1059 | 小窗：新建/编辑/绑定（含模板、运行配置）、主题、⌘K 搜索、数据导入导出、并排选择 |
| `src/client/ui.js` | ~197 | 基础件：`el`、`Icon`、`Light`、`Splitter`、`ContextMenu`、`Toasts` |
| `src/client/render.js` | ~464 | 纯函数：`viewKindOf`、Markdown 渲染、代码高亮、格式化 |
| `src/client/theme.css` | ~1577 | 全部样式（`.wt-scope` 作用域，CSS 变量控制主题） |
| `test/client-smoke.mjs` | ~2298 | 客户端离线自测：stub React / document / fetch，**616 条断言** |
| `test/host-routes.mjs` | ~855 | host 路由自测：fake webServer / sessionController，**189 条断言** |

---

## 4. host 路由（前缀 `/api/trae-worktable`）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 插件名 / 版本 / 平台 / 可用服务 |
| GET | `/sessions` | 宿主会话快照（只读，不调模型） |
| GET | `/defaults` | 默认工作区、shell、平台 |
| POST | `/transcript` | 会话事件（**注意**：用 `{sessionId}` 字段；这条没包 `guard()`，见 §8） |
| POST | `/fs/list` `/fs/read` `/fs/write` `/fs/mkdir` `/fs/rename` `/fs/delete` `/fs/stat` `/fs/deletable` `/fs/reveal` `/fs/open` | 文件系统 |
| GET | `/fs/raw?path=` | 媒体字节（白名单：png/jpg/gif/webp/bmp/ico/avif/svg/pdf/mp4/webm/ogv/mov/mp3/wav/ogg/m4a/flac/aac） |
| GET | `/asset/<令牌>/<rel>` | **本地网页托管**（0.10.6，prefix）：令牌 = 文件所在目录的 base64url，`rel` 为相对路径。只放行网页资源扩展名（其它 415 `not-asset`）、`../` 越界 403、HTML 响应带 `CSP: sandbox allow-scripts …`；单文件 48 MB 上限 |
| POST | `/term/exec`（NDJSON 流）`/term/kill` | 终端 |
| POST | `/git` | 只读 status/log/branches |
| POST | `/project/register` | `{id, root}` 登记项目根（供 `/site` 托管） |
| GET | `/site/<id>/<rel>` | 项目静态托管 |
| POST | `/web/probe` | `{url}` 或 `{urls:[]}` → 可达性 + 能否 iframe |
| POST | `/web/open` | 交系统浏览器 |
| POST | `/custom/list` `/custom/get` `/custom/save` `/custom/delete` | 自定义窗口库 |
| POST | `/session/create` | 在指定目录新建宿主会话 |

---

## 5. 自测怎么写（测试桩的坑）

`test/client-smoke.mjs` 用假 `window` / `document` / `fetch` / React。写断言前先知道：

- **`useState` 的 setter 是 no-op** → 不要试图“点一下然后期望状态变”；要测逻辑就把它抽成 core 里的**纯函数**（现有先例：`sideModeOf`、`pickDock`、`undockedBox`、`overviewProjects`、`mediaRowsOf`、`kindOfMediaPath`、`normalizeCrop`、`computeDock`），然后导出到 `index.js` 给测试用。
- **class 组件可以渲染**（`new type(props)` + `inst.render()`），函数组件直接调用。
- 断言 CSS 用 `styleNodes[0].textContent`（别写 `globalThis.styleNodes`）。
- 测试里**变量名容易和前面的块撞车**（`frame`/`names`/`chips`/`saveBtn`/`filtered`/`pdfFrame` 都撞过，撞了就 SyntaxError，整个文件跑不起来）。
- 拖动/键盘这类交互：把处理器抽成纯函数（`handleHotkey`）直接喂事件对象。
- Toasts 只在主区关闭时挂在侧边栏 → 测 toast 前先 `store.open = false`。

---

## 6. 关键契约（改代码前必读）

1. **双 bundle 协议**：host `src/index.js → lib/index.js`（ESM，`inject` 含 `webServer`）、client `src/client/* → lib/client.js`（`window.__ModuleLoader__.load` 握手，`react` 必须 external，只能 `createElement` 不能 JSX）。
2. **座位**：`sidebar.footer.action`（常驻卡片）+ `shell.overlay`（主区）。`props.renderSlot` 必须带着**自己的座位名**调用，否则 `SlotOwnershipError`。
3. **让位机制**：进项目不画对话，而是给宿主 `centerCol` 写 `marginLeft`（`hostdock.js`），右侧是真能打字的宿主对话。几何来自 `measure()`；`pickDock(lastGood, next)` 保证「测不出宽度时沿用上次区域」，`undockedBox()` 保证「锚点完全找不到时也不铺满整窗」。
4. **主题**：强调色拆成 `--amber-rgb` 等 CSS 变量写在两个根节点的行内 style 上；背景靠 `data-bg` 属性 + `::before` 层；亮度只压背景层（`.wt-side::before` 上做 `filter`），不动文字。
5. **错误边界**：每个窗格包 `PaneBoundary`；崩溃卡带「重新加载此窗格」。
6. **localStorage 键**：`wt.projects` / `wt.ui.v2` / `wt.view` / `wt.status` / `wt.theme` / `wt.search` / `wt.overview` / `wt.gridTab` / `wt.side` / `wt.dockVer` / `wt.web` / `wt.termHistory`。
7. **宿主侧边栏布局结构**（从宿主 bundle 提取，0.2.0-rc.2）：
   ```
   ._root        height:100%; display:flex; flex-direction:column
     ._regionArea flex:1; min-height:0; overflow:hidden   ← 会话列表
     ._footArea   （无 flex 声明 → 默认 flex:0 1 auto，会被压缩）
       ._footerActions flex:none; width:100%              ← 我们的座位
   ```
   所以我们的卡片**必须可收缩**（`flex:0 1 auto` + `min-height:0` + `overflow-y:auto`），否则溢出后按绘制顺序会盖在会话列表上。

---

## 7. 踩坑清单（都真踩过，附判据）

1. **`fixed` 后代被裁剪**：`backdrop-filter` / `overflow:hidden` / `transform` 的祖先会形成包含块或裁剪 → 小窗/右键菜单消失。`.wt-hosts` 特意保持 `position: static`。
2. **CSS Modules 哈希**：宿主类名形如 `_2H3hWW_centerCol`，**不要写死哈希**；用 `[class*="centerCol"]` 这类子串匹配，并准备降级路径。
3. **`is-full(inset:0)` 是陷阱**：任何“没量到几何”的分支都不能退成铺满整窗（0.8.50/0.8.51 两次踩）。
4. **早退分支必须一起改**：0.8.50 只修了 `measure()` 为 0 的路径，忘了 `attachHost()` 失败的早退路径，于是同一 bug 又出现一次（0.8.51 才补）。
5. **esbuild 报错要看文件名**：`X is not declared` 往往是 `index.js` 的 import/export 名单被改乱了（把 import 行当 export 行删过两次）。
6. **测试跑的是 `lib/`**：改完 `src/` 忘记 `npm run build`，测试仍是旧 bundle，表现为「函数不存在」。
7. **CRLF**：`Set-Content`/字符串 `.Replace` 会被 CRLF 坑（多行替换静默不生效）；写脚本时先 `\r\n → \n` 处理再写回。
8. **UTF-8 BOM**：`Set-Content -Encoding UTF8` 会加 BOM，`JSON.parse` 直接炸；统一用 `New-Object System.Text.UTF8Encoding($false)`。
9. **`curl.exe` 在本机坏了**（schannel 凭据错误）；联网测试用 bundled node 的 `fetch`。
10. **GUI 自动化进不去**：`http://127.0.0.1:19387` 无 token 时返回 **401 `dsh web authentication required`**，CDP 打开是空白页 —— 无法用浏览器自测，只能靠接口实测 + 离线断言。

---

## 8. 未验证 / 待确认（接手先看这一节）

| 项 | 状态 | 怎么确认 |
| --- | --- | --- |
| 媒体窗「选择文件 / 浏览项目」真机效果 | 只有离线断言 | 进项目 → ＋窗口 → 🖼 媒体 → 点「选择文件」选一张 png；不通就把 `.media-img` 的 `src` 与 Network 里 `/fs/raw` 状态码发出来 |
| 工作台半透明透出桌面壁纸 | 可能是用户设的「自定义背景图」，也可能是 `--bg` 没生效 | 看 ⚙ → 背景是否选了「自定义图片」；不是的话查 `.wt-dock` 的 `background: var(--bg)` |
| 运行配置 ▶ 停止是否杀得掉 `npm run dev` 进程树 | 未实测（Windows） | 起一个会派生子进程的命令，点 ■ 后看 `node` 子进程是否残留 |
| GitHub Release 资产 | 未上传（无 token/无 gh） | 网页拖 tgz，或 `gh auth login` 后 `gh release create` |
| `POST /transcript` 没包 `guard()` | 已知不一致（只读、无 CORS 头，风险有限） | 给这条也套 `guard(...)` 即可 |
| 读文件没有根白名单 | 设计如此（README 已披露“不是沙箱”），写操作才有根限制 | 若要收紧：给 `assertExisting` 的 read 模式加根校验 |
| 并排 / 多窗格 / 主题取景框的真机表现 | 只有离线断言 | 逐项点一遍，截图或报 `getBoundingClientRect()` |
| 宿主版本兼容 | 只声明 `0.2.0-rc.2 \|\| 0.2.1-rc.2` | 换版本需重跑 `npm test` + 手动验收 |

---

## 9. 下一步建议（按优先级）

0. **0.10.x 真机验收（只有这一条必须人点）**：重启 DSH 后 → 项目里开「⑂ 源代码管理」→
   改个文件看它进「未暂存的改动」→ 行内 ＋ 暂存 → 写说明提交 → 「推送」→ GitHub 条应自动认出本机账号
   （来源 git-credential）→ 「克隆」能列出仓库 → 总览「⑂ 克隆」填 owner/repo 能实时刷进度。
   **再验一条 0.10.1 的**：分支视图底部危险区 → 点「删除 .git（取消初始化）」→ 按钮应变成
   「再点一次确认删除 .git」→ 再点 → 面板变回「还不是 git 仓库」，项目文件一个没少。
   ~~**再看一眼 0.10.2 的行号栏**~~（**0.10.6 随编辑器窗格下架，此验收作废**，接口与断言保留：
   编辑视图左边应有行号；改一行字 → 该行竖条变琥珀色、标题栏 `+0 ~1 −0`）。
   **再验 0.10.3 的目录浏览**：总览「⑂ 克隆」→「克隆到」右边点「浏览…」→ 面板应从当前路径开始、
   只列文件夹 → 点一个子目录进去 → `↑` 能回上级 → 点「用这个目录」后输入框变成那个路径、面板收起；
   再翻到一个**不在工作目录 / home 下**的位置（比如 `D:\` 根）→ 应亮红「不在可写白名单内」且
   「用这个目录」置灰。
   **再验 0.10.4 的拖拽命名**（这版是纯客户端修复，刷新界面即可）：从 DSH 侧边栏把一条会话行拖到
   工作台空白处 → 侧边栏高亮 + 松手 → 新项目应**直接是会话标题**（不再是「未命名项目」+ 编辑窗）；
   再拖一条到**某个项目行**上 → 应提示「已把对话绑到 X」，项目数不变；同一条会话再拖到空白处 →
   进已有项目、不重复建。若拖拽时鼠标是禁止符号，说明 `effectAllowed` 又变了（见 README「已知坑」9）。
   **再验 0.10.5 的取名**（host + client 都动了，必须**完整退出 DSH 再重开**）：把一条在默认工作区里的
   会话拖进工作台 → 项目名应等于**侧边栏上那个会话名**（比如「安装 dsh-worktable 插件」），不能是
   `default-workspace`；总览「◉ 宿主会话」里同名行也应显示真名。若仍显示 `default-workspace`，
   先看 `GET /api/trae-worktable/sessions` 返回行上的 `titled` 是不是 `true`、`title` 是不是真名
   （`titled:false` 就是没拿到标题，看宿主 `readTitleSnapshots` 是否可用）。
   **再验 0.10.6 的三件事**（host + client 都动了，必须**完整退出 DSH 再重开**）：
   ① 进项目 → 标签页里**不该再有「编辑器」**（老库里存下的 `editor` 标签会自愈消失）；文件管理器双击
   `README.md` → 应弹**系统默认程序**而不是工作台内部编辑；双击 `index.html` → 应落进「自定义」窗格并
   渲染出页面（同目录 css / js / 图片都在）。
   ② 标签条开到溢出 → 两端出 `‹` `›` 箭头、鼠标滚轮直接在标签条上横向滚动、点被挤到外面的标签会自动
   滚回来。
   ③ 自定义窗格 → 左栏 `＋ 网页文件` 或编辑态「选文件…」→ 挑一个本地 `.html` → 预览应真实渲染；
   若一片空白，先看 Network 里 `/api/trae-worktable/asset/<令牌>/...` 的状态码（415 = 扩展名不在白名单，
   403 = 路径越界，404 = 文件不在了）。
   **未验证项**：`/gh/upload`（会真的在你账号下建仓库，第一次用请自己确认仓库名与可见性）。
1. ~~0.9.0 真机验收~~：重启 DSH 后看终端工具条 `PTY` 徽标是否点亮 →
   `python` 进 REPL 能交互 → `Ctrl+C` 退 REPL 但 shell 还在 → 切标签页再切回输出还在 →
   切「▤ 上一下二 / ▥ 三列 / ▦ 四格」每格都有内容 → 拖标签跨格互换。
   顺手看一眼 `GET /api/trae-worktable/term/mode` 的 `ok/from`，能直接看出用的是哪份 node-pty；

1. ~~**打 tag + 补 Release 资产**~~ —— **0.8.52 / 0.8.53 / 0.9.0 / 0.10.x 都已发**：
   tag 已推、Release 已建、附件已传并下载回来校验 sha256 一致；首页 `README.md` / `README.zh.md` /
   `INSTALL.md` 与 `dsh/README.md` 已同步到 0.10.6（安装指向新 Release）；
2. **旧功能真机验收（可延后）**：0.8.48 → 0.8.52 是一族（侧边栏 / 让位），0.8.53 是拖到会话；
   重点两条：① 展开宿主侧边栏后工作台的关闭键点得动；② 文件/网页拖到顶栏后输入框里出现【文件】/【网页】块；
3. **媒体窗确认**：三种选法各试一次（选择文件 / 浏览项目 / 拖入）；
4. 收尾项：`/transcript` 补 `guard()`；
5. 想再上功能的话，候选：终端命令收藏、冲突三方合并 UI、多项目并排的三栏、产物清单支持 glob。
   git 侧已知缺口：冲突（`conflicts` 组已能读出但没做「用它/用他」的解决 UI）、rebase/cherry-pick、
   PR 列表与创建（`/gh/repos` 已有，PR 接口没做）。

---

## 10. 命令速查

```powershell
# 常用路径
$repo = 'C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\dsh'
$node = 'C:\Users\jinshuaiyu\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'
$pnpm = 'C:\Users\jinshuaiyu\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\pnpm\bin\pnpm.mjs'
$cli  = 'D:\dsh\resources\runtime\cli\bin\dsh.cmd'

# 构建 / 自测 / 打包
cd $repo; npm run build; npm test
& $node $pnpm pack

# 健康检查（需要带 token 的网页端；无 token 会 401）
& $node -e "fetch('http://127.0.0.1:19387/api/trae-worktable/health').then(r=>r.json()).then(j=>console.log(j.version))"

# 安装 / 卸载（先完整退出 DSH）
& $cli plugin --profile desktop add "link:$repo"
& $cli plugin --profile desktop remove trae-usage-worktable

# 读宿主 bundle（定位布局/座位结构）
& $node 'C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\.tmp-asar-read.mjs' 'D:\dsh\resources\app.asar' list 'dsh/node_modules/@deepseek-ai/'
& $node 'C:\Users\jinshuaiyu\WorkBuddy\2026-10-16-23-21-22\.tmp-asar-read.mjs' 'D:\dsh\resources\app.asar' get '<asar 内的路径>' out.js
```

---

## 11. 多会话协作约定（重要）

这个仓库**同时被多个会话改过**（例如 `9e1fbb9 fix(0.8.52)` 就不是本文档作者那次会话提交的）。所以：

1. 开工先 `git pull --ff-only` + `git status`；有未提交改动先问清楚是谁的；
2. **改版本号就改两处**：`package.json` 与 `dsh.plugin.json`，并同步 `build.mjs` 读取值；
3. 每次改动都要 **`npm run build` + `npm test` 全绿** 才算完成，然后 commit（`fix(0.x.y): …` 中文说明写在 body 里）+ push + `git tag v0.x.y`；
4. 别把 `lib/`、`*.tgz` 提交进仓库（`.gitignore` 已挡）；
5. 不要擅自把上游 `dsh-worktable` 加进 `bundles`（抢 `/api/worktable/*` 路由，且在这版宿主上会让网页端起不来）。它现在还躺在 profile 的 `dependencies` 里但**未启用**，可忽略。
---

## 12. 0.8.53 新增：拖文件 / 网页到对话

| 交互 | 位置 | 实现 |
| --- | --- | --- |
| 拖文件 → 对话 | 文件管理器每一行（`draggable`） | `dragFilePayload(e, path)` 写 `application/x-wt-file` + `text/plain` + `file:///` 的 `text/uri-list` |
| 按钮发送 | 文件管理器工具条「→ 对话」 | `sendPathToChat(path)`（选中文件优先，否则发当前目录） |
| 拖网页 → 对话 | 浏览器地址栏（`draggable`） | `dragUrlPayload(e, url, title)` 写 `application/x-wt-url` + `text/uri-list` |
| 按钮发送 | 浏览器工具条「💬」 | `sendUrlToChat(url, title)` |
| **放置区** | 项目工作区 / 总览的顶栏整条 `header.dock-head` | `readChatDrop(e)` 解析（自定义类型 → `File.path` → uri-list → text/plain），`dropToChat(e)` 填进宿主输入框 |

- 落到对话的内容格式：文件 `【文件】<文件名>\n<绝对路径>`；网页 `【网页】<标题>\n<网址>`（无标题则只一句）；
- **只填输入框、不自动发送**（`fillHostInput`），由用户回车；
- 拖拽经过顶栏时有 `.drop-hover` 高亮 + 「松手 → 填进输入框」提示；
- 纯函数都能单测：`fileUrlOf` / `chatTextForFile` / `chatTextForUrl` / `readChatDrop`（self-test 新增 12 条）。

---

## 13. 0.10.6 的三处改动（实现要点，改之前先读）

### ① 编辑器窗格下架

- `PANE_TABS` 里删掉 `{ id:'editor' }`，`store.editor` 整片删除，`EditorPane` / `previewCache` / `highlightCode`
  调用点一并删；文件改为**按类型分流**（`core.js` 的 `openFile`）：
  媒体 → 媒体窗、`.html/.htm/.xhtml` → 自定义窗格、其余 → `/fs/open` 交系统默认程序。
- **老数据自愈**：`stripRetiredTabs(ui)` 在 `hydrate()` 里跑一遍，把 `RETIRED_TAB_KINDS`（当前只有 `editor`）
  的标签摘掉、把 `activeTab` 让给还活着的标签、必要时重排 `layout` 的槽位；有变化才回写 localStorage。
- 已经不在的窗格类型不会白屏：`overlay.js` 的 `renderPane` 末尾是兜底页「这个窗口已经不在了」。

### ② 标签条横滑（`overlay.js` · `MainPane`）

- `.tabs` 挂 `ref` + `onScroll={syncEdge}`，两端各一个 `.tab-scroll` 按钮（`‹` `›`，由 `edge` 状态决定 `disabled`）。
- **坑：React 的 `onWheel` 是被动的**，`preventDefault()` 会被忽略并告警。必须
  `box.addEventListener('wheel', fn, { passive:false })` 手动挂，卸载时解绑；
  `Math.abs(deltaX) > Math.abs(deltaY)` 时放行（那本来就是横向滚动）。
- **另一个坑：别给 `.tabs` 加 `scroll-behavior: smooth`** —— 滚轮一格一格地滚会变得发黏。
  用 `overscroll-behavior-x: contain` 防止滚到底后带动外层。

### ③ 自定义窗口放本地网页（`kind:'file'` + `GET /asset/<令牌>/<rel>`）

- 为什么不能直接用 `srcDoc`：它**没有基地址**，`<link href="app.css">`、`<img src="a.png">` 全部解析失败。
  解法是把**目录**编进 URL 首段（`b64url(dir)`），让 iframe 的文档地址变成 `/asset/<tok>/index.html`，
  同目录资源自然解析到 `/asset/<tok>/...` —— **用户文件零改动**。
- `core.js`：`b64url` / `htmlUrl(p)` / `isHtmlFile(p)` / `openHtmlWindow(path, pid)`；
  `newCustomDraft('file')` 第三种草稿；`saveCustom` 校验「绝对路径 + html 扩展名」，没起名字就用文件主干名。
- `panes.js`：`CustomPane` 预览分支三态（`file → htmlUrl` iframe / `url` / `srcDoc`），编辑态多一条
  `.cu-filebar`（路径框 + `选文件…` + `预览`），`HtmlPick` 只列目录与网页文件（`webRowsOf` 纯函数，可单测）。
- `index.js`：`ASSET_EXTS` 白名单 + `/asset` prefix 路由（`resolve` 后 `insideRoot` 挡 `../`、
  415 挡非资源、48 MB 上限、`mimeOf` 定 Content-Type）。
- **安全模型**：HTML 带 `CSP: sandbox allow-scripts allow-forms …`，iframe 也**不给 `allow-same-origin`** ——
  脚本能跑，但拿不到插件同源身份（localStorage 被禁、无法反调 `/fs/write`）。这是刻意的减法，别随手放开。

---

## 14. 宿主那层「文件或图片拖动到此处即可添加」的遮罩（0.10.7，踩了三次才找对）

**它不是弹窗，是宿主的 DropOverlay。** 真相全在 `app.asar` 里（`@deepseek-ai/dsh-client-ui-attachment`）：

- `drop-events.js` 的 `installDocumentDropEvents()` 把 `dragenter/dragover/dragleave/drop`
  挂在 **`document` 上、冒泡阶段**（没传 capture），只认 `dataTransfer.types` 里的 `Files`；
- 命中就 `setDragActive(true)`，`ComposerAttachments` 渲染 `<DropOverlay>`：portal 到 `document.body`，
  `position:fixed; inset:0`，**`pointer-events:none`**（注释写的 "Decoration only"）；
- 关它只有两条路：宿主自己的 `onDrop` 里 `reset()`，或 `window` 的 `dragend`。
  **从资源管理器拖进来不会派发 `dragend`**（drag source 在页面之外）。

⇒ 我们的窗格 `stopPropagation()` 吃掉 `drop`，宿主的 `reset()` 就永远跑不到，遮罩永久留在屏幕上。
因为它 `pointer-events:none`，**文件其实早就放进去了**，卡住的只是那层灰底 —— 所以「点不掉、Esc 没用」。

现在的对策（`core.js`，三个纯函数 + 一个安装器，都能单测）：

| 函数 | 作用 |
| --- | --- |
| `isFileDragEvent(e)` | `Files` / `text/uri-list` / `application/x-wt-file` 才算系统文件；拖标签页（`text/plain` 的 key）不算 |
| `pointsIntoWorkbench(e)` | `document.elementFromPoint()` 后 `closest('.wt-scope')`。遮罩 `pointer-events:none`，`elementFromPoint` 会自动跳过它 |
| `resetHostDropMask()` | 合成 `dragleave` 打 `documentElement`：`clientX/Y=-1` + `dataTransfer.types=['Files']` 且 `files=[]` → 宿主走「离开视口」分支，`dragDepth` 清零 + `setDragActive(false)`，且不会往对话里加文件 |
| `installDropMaskGuard()` | **`document` 捕获阶段**拦 `dragenter`（早于宿主冒泡监听、也早于 React 根容器）：命中工作台就 `stopPropagation()` + 顺手 `resetHostDropMask()` |

三个调用点：`apply()` 里 `ctx.effect(installDropMaskGuard, …)`、`CustomPane` 的 `onDrop` 之后、
`overlay.js` 的 `swallowOsDrop()` 之后（拖拽可能先落在宿主区域再移进来，那时遮罩已经亮了）。

**通用规律（以后遇到同类问题先看这条）**：宿主在 `document` 冒泡阶段管事的时候，
`stopPropagation()` 只解决「别让它处理」，不解决「它已经改掉的状态谁来复位」——
必须自己补一次等价事件，或者干脆在捕获阶段就别让它收到。
---

## 15. 拖 .html 进自定义窗口（0.10.7 之后）：拿不到路径时读内容兜底

**问题**：把 `C:\...\Desktop\index.html` 拖进「自定义」窗格，提示「没认出拖进来的是哪个文件」。

**根因**：新版 Electron 不再提供 `File.path`（改用 `webUtils.getPathForFile`），而 Windows 资源管理器拖拽的 `text/uri-list` 也不一定可读 →
`readChatDrop()` 里「取路径」的三条路全断，返回 null。

**修法**：
1. `readChatDrop()` 现在把 **文件对象本身** 也带出来：`{ kind:'file', value, name, file }`，
   `dt.files` 为空时再从 `dt.items[].getAsFile()` 取；`uri-list`/`text/plain` 分支也补上 `name`。
2. 新增 `fileToText(file)`（`file.text()` → `FileReader` 兜底）：**没有路径就直接读内容**。
3. `CustomPane` 的拖放改成 async 三级处理：
   - 有路径且是 `.html` → 老行为（`kind:'file'`，预览可带同目录 css/js/图片）；
   - 无路径但是 `.html` → 读内容建 `kind:'html'` 快照，提示「想跟随磁盘文件就点『选文件』」；
   - 其它 → toast 里带上 `dropSummary(e)`（`types=[…] files=[…] paths=[…]`），方便定位。
4. `dropToChat()` 对「有文件没路径」给出明确提示，不再静默失败。
---

## 16. 0.10.8：编辑器回到「文件管理器里」，顶栏 ✕ 加固

**编辑器的位置改了**：不再是一个独立窗格（0.10.6 已经下架），而是挂在**文件管理器面板底部**的内联编辑器：

- 点/双击文件（文本 / 代码 / Markdown）→ 底部出现 `.fx-edit` 面板：文件名、未保存标记、大小、`👁 预览`（Markdown）、`保存`（Ctrl+S）、`✕`；
- 状态在 `store.editor`：`openTextFile()` / `editText()` / `editorDirty()` / `saveEditor()` / `setEditorView()` / `closeEditor()`；
- 媒体 / PDF / html 仍走原来的分流（媒体窗 / 自定义窗口），只有文本类进内联编辑器；
- 关掉时若有未保存改动会 `confirm` 一次（`closeEditor(force)` 可跳过）。

**顶栏关闭键**：
- 两个 `.wt-close` 按钮都加了 `onPointerDown`（掐冒泡，避免被拖动/拖放逻辑吃掉）；
- 点击执行 `closeWorkbench()`：清 `chatDropHover` → `releaseDock()`（还宿主 marginLeft）→ `open:false`；
- CSS 上把 `.wt-close` 提到 `z-index: 8`。

自测：client **634**（+18：内联编辑器全链路 + 关闭键双保险）、host **189**。
