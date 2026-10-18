# Trae Worktable

把项目收纳成侧边栏应用抽屉，并提供可停靠的分栏工作区与统一外观系统 —— 以多种形式提供。

本仓库是开源项目 [`Aisland-SJL/dsh-worktable`](https://github.com/Aisland-SJL/dsh-worktable)（MIT）的独立复刻实现。功能设计参考上游，代码为独立编写。

**本仓库包含**

- **DSH 插件**（`dsh/`）—— DeepSeek Harness 侧边栏工作台：文件浏览 / 编辑器 / 终端 / 浏览器 / 自定义窗口 / 只读 git。仓库名 `dsh-worktable` 指的就是它。
- **单文件工作台**（`workbench/`）—— 自包含 HTML 单页，扫描你自己机器上的项目，不装扩展、不装依赖、无构建。
- **TraeCode 扩展**（`src/`）—— 同上工作台，作为 TraeCode IDE 扩展。
- **Skill**（`traework/`）—— 工作台功能打包为 Skill + 单文件 HTML（数据走 CLI）。
**在线试用工作台**：<https://nscn6fdx44-crypto.github.io/dsh-worktable/workbench/> —— 纯静态页（GitHub Pages）。

---

# workbench 单文件工作台

三个核心能力：

1. **扫本机项目**——点「选择本机目录」，浏览器端就地扫描，命中 `.git` / `package.json` / `CMakeLists.txt` 等工程标记即认定为项目
2. **读写文件**——授权后 `repo` 窗格可直接查看、编辑已扫描目录里的文件
3. **项目工作台**——卡片网格 / 控制室 / 分栏工作台，项目可改名、可批量管理（改名只改浏览器里的显示名，不碰磁盘文件）

`traework/` 产物功能同源，形态为 Skill + 单文件 HTML（数据走 CLI）；本文档介绍 workbench。

三种打开方式：**在线打开 Pages**（推荐，https 是安全上下文，授权最顺）/ **双击 `index.html`**（`file://` 可用，选择器被拦时用兼容模式）/ **`node serve.mjs`**（完整能力）。

## 使用方法

### 1. 扫描本机项目（零服务，推荐）

1. 用 **Chrome / Edge** 打开 Pages 地址，或双击 `index.html`
2. 进入**控制室** → 「本机目录」区块 → 点 **「选择本机目录」**，选中项目根目录（如 `D:\projects`）
3. 浏览器端就地扫描，结果并入项目栏；目录句柄存在 **IndexedDB**，刷新或下次打开仍在

权限说明：「选择本机目录」**只申请读权限**，扫描与只读浏览都够用，所以 `C:\` 这类位置也能正常扫；只有点「保存」时才临时再要一次写权限，被拒也不影响读取。浏览器把权限降级为「待确认」时，点一次**「续期授权」**即恢复。

### 2. 选不了目录 / 位置不允许写入：兼容模式扫描

「本机目录」区块的「兼容模式扫描」**不依赖目录选择器、不需要任何权限**：用 `<input webkitdirectory>` 拿一份文件清单，页面在内存里重建目录树，再按同一套规则识别项目。

- `C:\` 这类系统位置、`file://` 地址都能扫
- 代价：拿不到目录句柄，**只能只读浏览，不能写盘**，且刷新后要重扫
- ⚠️ **不要选整个盘**：浏览器会先把整盘文件枚举完才交给页面，这一步拦不住、会卡很久。请选靠近项目的父目录，例如 `C:\Users\你\Desktop\code`

### 3. 扫整盘 / 大目录

「本机目录」区块顶部有**打开即见的「整盘扫描」引导框**，未选目录就能看到整盘路径：

1. 选中盘符根（如 `C:`）→ 2. 开**深度扫描** → 3. 系统盘禁止读时改用兼容模式

| | 普通扫描 | 深度扫描 |
|---|---|---|
| 层数 | 4 层 | 8 层 |
| 遍历目录上限 | 2500 | 20000 |
| 遍历耗时上限 | 5 秒 | 40 秒 |

扫描时有**转圈指示 + 进度条**（按已遍历目录数实时算百分比），不会「点了没反应」；中途可点「扫描中…点击取消」中断，已发现的项目保留并如实标注不完整；**扫描失败也不会卡住**——界面保留已选目录，提示换目录重选或走兼容模式，随时能再扫。项目上限 150 个、单项目测量上限 5 秒；`Windows` / `Program Files` / `AppData` / `node_modules` 等 20+ 个系统与缓存目录直接跳过。

### 4. 项目栏管理

| 入口 | 行为 |
|---|---|
| **添加** | 弹窗填名称 / 路径 / 语言标签，写入浏览器 `localStorage`；连了本地服务且填绝对路径时，会登记进登记表，`repo` 窗格随即可读写它 |
| **多选** | 行内出现复选框，工具条提供「全选 / 清空 / 移除」；移除需二次确认，**磁盘文件不会被删除** |
| **重命名** | 每行尾部按钮，修改项目的**显示名**（只改浏览器里的别名，不碰磁盘任何文件），项目栏、窗格标题、卡片名同步更新 |

被移除的扫描项记入 `wt2.removed`，项目栏顶部出现「已移除 N 个扫描项目 · 全部恢复」，一键还原。

### 5. 需要完整能力：本地服务

```bash
node serve.mjs        # 或双击 启动工作台.bat
```

完整能力：文件读写 / 端口探测 / 服务端重扫 / 网页反代 / 自定义项目登记。默认监听 `7331`，被占用自动递增。网页内一键启动可用 `launcher.mjs`（`启动器.bat` / `安装后台启动器.bat`）。让别的电脑连：`WB_HOST=0.0.0.0 WB_TOKEN=你的令牌 node serve.mjs`，同事访问 `http://你的局域网IP:7331/`。

> ⚠️ 关键认知：网页里「选择本机目录」**永远扫描打开网页那台机器**（浏览器安全沙箱，任何网页都绕不过）。同事连上你的服务后，他们扫的是**他们自己的电脑**；服务端「重扫」扫的才是**运行 serve 这台机器**。

## 遇到的问题与解决方案

按「现象 → 原因 → 解法」记录，含使用侧与开发侧：

| 现象 | 原因 | 解法 |
|---|---|---|
| 选目录时被反复要权限、授权状态显示异常 | Chrome 的 FileSystem Access 语义：读权限已授予时，查「读写」权限返回的是 `prompt` 而非 `granted`，状态机被带歪 | 权限分层评估：读 / 写分开判断，平时只申请读权限，点「保存」时才升级要写权限 |
| 点扫描后像卡死一样没反应 | 扫描没有异常兜底，中途一个 `getFile()` 失败就让「扫描中」状态永远为真 | 全程 `try/finally` 兜底恢复界面 + 分层预算 + 可取消，任何失败都提示「换目录重选或兼容模式」 |
| 扫 `C:\` 几秒就返回、项目很少 | 广度遍历预算默认只给 4 层 / 2500 目录 / 5 秒，浅层巨型目录先把预算吃光 | 开「深度扫描」放宽到 8 层 / 20000 目录 / 40 秒；或先用兼容模式选更靠近项目的父目录 |
| 兼容模式选整个盘会卡很久 | `webkitdirectory` 会先把整盘文件枚举完才交给页面，这一步在页面里拦不住 | 引导选靠近项目的父目录（如 `Desktop\code`），别选盘符根 |
| 项目文件一多，体积 / 文件数要等很久 | 逐个 `getFile()` 测量，几千个文件就是几千次调用 | 超过 400 个文件改为**采样外推**，显示带 `~` 前缀的约数，不把外推值当精确值 |
| 项目数显示「已达扫描上限」但结果只有几十个 | 外推值和截断值混在一起，`estimated` 被误标成 `truncated` | 两个状态分离：只有真的触顶才标「已达上限」 |
| 左侧项目栏翻不动，项目一多把整页撑高 | 列表父容器不是 flex，`flex:1` 失效、拿不到约束高度，`overflow-y:auto` 形同虚设 | 父容器改 flex 列 + `min-height:0`，列表在栏内正常滚动 |
| 重扫后「27 个项目 · 扫描于…」还是旧数据 | 扫描完成只重渲染了列表和卡片，漏刷扫描信息栏 | 信息栏渲染并入统一刷新函数，每次扫描完成一起更新 |
| 担心公开页暴露自己机器的信息 | 服务端模式会把「运行服务那台机器」的目录与登记表暴露出去 | 公开页用纯静态零服务：访客扫到的全是他自己机器的内容；`verify.mjs` 断言无用户名 / `C:\Users\` 等标识 |
| git push 失败 `CRYPT_E_NO_REVOCATION_CHECK`（开发侧） | 公司网络拦截了证书吊销检查（CRL/OCSP）端点 | `git -c http.sslVerify=false push` 仅本次临时绕过；长期可换 openssl 后端或走代理 |
| 本地文件与线上差几千字节但内容一样（开发侧） | Windows `core.autocrlf=true` 把 CRLF 存成 LF，行尾差异 | 已知行为，内容零差异，无需处理 |

## 纯网页前端的固有限制

这些不是 bug，是浏览器安全模型决定的边界：

| 限制 | 为什么 | 怎么办 |
|---|---|---|
| 只能扫「打开网页这台机器」 | 浏览器沙箱：任何网页都拿不到别的机器的文件系统 | 每台机器自己打开页面扫；或在那台机器跑 `node serve.mjs`，用服务端重扫扫它的目录 |
| 端口探测只有常见端口 | 浏览器无法枚举本机端口，只能主动连接试 | 零服务版探 27 个常见端口；完整探测用本地服务的 `/api/ports` |
| 写权限会被收回 | 浏览器把权限视为临时授权，刷新 / 换会话后降级为「待确认」 | 目录句柄存 IndexedDB，点「续期授权」恢复；只读浏览不受影响 |
| 系统盘符根可能不允许写 | 浏览器对 `C:\` 这类位置默认只读或拒绝 | 扫描和只读浏览没问题；要写盘就选具体项目目录 |
| `file://` 下目录选择器可能被拦 | 浏览器对本地文件页面的 API 限制更严 | 用 https 的 Pages 或 `http://127.0.0.1` 打开；或用兼容模式 |
| 兼容模式只能只读、刷新要重扫 | 只拿到文件清单，没有目录句柄 | 只读浏览够用；要写盘再点一次「选择本机目录」 |
| 扫描结果有上限，超大盘会截断 | 硬预算保证「几秒内一定有结果」，不会点了没反应 | 深度扫描放宽到 20000 目录 / 8 层 / 40 秒；截断会如实标注 |
| 换浏览器 / 清缓存后数据没了 | 数据只存浏览器 `localStorage` / IndexedDB | 重新扫一次即可；登记表类数据在本地服务端 |
| 需要 Chrome / Edge 86+ | FileSystem Access API 不是所有浏览器都有 | Firefox / Safari 用兼容模式（只读） |
| 服务端重扫 / 网页反代 / 登记表不可用 | 这些需要常驻后端，纯静态页没有 | 在目标机器跑 `node serve.mjs`（零依赖，一个文件） |

## 目录

| 路径 | 职责 |
|---|---|
| `index.html` | **产物**：公开版单文件（无示例数据，打开即空），Pages 入口 |
| `serve.mjs` | 本地服务：零依赖 Node，现读 HTML + 项目文件读写 API + 端口探测 + 网页反代 + 自定义项目登记 |
| `启动工作台.bat` | Windows 双击启动器 |
| `build/workbench.template.html` | 模板：结构 / 样式 / 运行时，`/*__DATA__*/` 为数据占位符 |
| `build/build.mjs` | 注入本机扫描快照生成 `workbench.html`（个人版，不入库） |
| `build/build-public.mjs` | 生成 `index.html`（公开版：不注入任何示例数据，打开即空） |
| `build/verify.mjs` | 静态校验：自包含 / 数据契约 / 视觉回归 / 公开版零本机标识 |
| `build/smoke.mjs` | 运行时冒烟：快照 / 服务 / 零服务 / 单项目根 / 超大根 / 兼容模式六场景 |
| `build/e2e.mjs` | 真实浏览器端到端（Edge/Chrome headless + CDP，`file://` 下真跑授权→扫描→读写） |
| `build/e2e/` | 权限矩阵回归：`cdp.mjs` 零依赖 CDP 客户端、`fs-mock.mjs` 假句柄桩、`run.mjs` 断言矩阵 M1-M15（41 条） |
| `build/serve.test.mjs` | 服务端路由契约 |

## 命令

```bash
node build/build-public.mjs       # 生成 index.html
node build/verify.mjs             # 静态校验（无个人版数据时自动只校验公开版）
node build/smoke.mjs              # 六场景冒烟
node build/e2e.mjs                # 真实浏览器端到端（需本机装有 Edge / Chrome，未装自动跳过）
node build/e2e/run.mjs            # 权限矩阵 M1-M15（同上，需 Edge / Chrome）
node build/serve.test.mjs         # 服务端契约
node launcher.mjs                 # 启动器：网页内一键启动本地服务（默认 127.0.0.1:7339）
```

在仓库根目录也可用 `npm run workbench:build` / `workbench:check` / `workbench:e2e`（后两者含上面除 build 外的全部）。验收固定顺序：先 build，再 check，最后 e2e——e2e 跑的是构建出的 `index.html`，不是模板。

## 安全边界

- `repo` 类读写一律经 `resolveWithin` 钉在已登记项目根内，`..` 与绝对路径拒绝；读取上限 512 KB、写入上限 1 MB、目录列表上限 400 项
- `POST /api/register` 只接受**已存在目录的绝对路径**，且只增不删
- 反代剥掉 `X-Frame-Options` / CSP 等内嵌封锁头，并注入 `<base href>` 修正相对资源
- 探测同时识别 `X-Frame-Options` 与 CSP `frame-ancestors`，站点声明禁止内嵌时直接给兜底提示
- 零服务模式的路径一律以扫描根 + 相对路径钉死，不落盘绝对路径
- 远程共享（`WB_HOST=0.0.0.0`）务必同时设 `WB_TOKEN`，未设令牌时非本机请求会被拒绝

## 隐私

`index.html` **不携带任何示例项目**：`DATA.projects` / `trees` / `ports` 均为空，页面打开即是空的；访问者扫到的全部是**他自己机器上**的项目，天然零暴露。`build/verify.mjs` 会断言公开版不含用户名、`C:\Users\`、`LAPTOP-` 等标识，并断言示例数据确实已清空。

个人版产物（内嵌本机真实路径、别名与目录样本）为 `workbench/workbench.html` 与 `workbench.registry.json`，已在仓库根 `.gitignore` 中排除，不入库。

## 致谢

视觉体系参考 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable) 的内容结构与实现方式。

---

# 其他产物（测试版）

两个早期的测试构建，保留作参考——**测试版质量，不是本仓库的重点**：

| 产物 | 形态 | 状态 |
|---|---|---|
| TraeCode 扩展 | `.vsix` | 测试版：最初的「视觉骨架派」构建（抽屉 + 布局预设 + 外观主题 + 工程配套） |
| TraeWork 工作台 | Skill + 单文件 HTML | 测试版：功能同源的 TraeWork 形态——Skill 管数据、HTML 做视觉 |

## TraeCode 扩展（测试版）· 安装

```bash
npm install
npm run build
```

在 VS Code / TraeCode 中按 `F5` 启动扩展开发宿主，活动栏即出现「工作台」图标；或 `npm run pack` 产出 `.vsix`，通过「从 VSIX 安装…」装入。

命令：`addProject` / `openWorktable` / `pickLayout` / `renameProject` / `changeIcon` / `moveProjectUp` / `moveProjectDown` / `hideProject` / `showProject` / `removeProject`（二次确认，不动磁盘）/ `revealProjectFolder` / `showChangelog` / `checkUpdates` / `copyUpgradePrompt`。

设置：`traeWorktable.theme.mode`（`system`/`dark`/`light`）、`traeWorktable.theme.accent`（十六进制色值）、`traeWorktable.theme.opacity`（0.3–1）、`traeWorktable.theme.background`（`aurora`/`coast`/`grid`/`none`）、`traeWorktable.updateCheck.enabled`。

测试版范围仅「视觉骨架」：项目 ↔ 会话绑定（M2）、分栏引擎宿主联动（M3）、真实窗格 M5–M8、控制室看板（M9）、点击批注（M10）**均未实现**（依赖宿主私有 API）。所有状态存于 VS Code `globalState`，不上传任何数据。

## 许可证

MIT。见 [LICENSE](LICENSE)。
