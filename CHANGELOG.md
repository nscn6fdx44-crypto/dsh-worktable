# 变更日志

## workbench（未发布）

### 本地目录扫描：授权链路 + 遍历健壮性

- **权限模型（P0）**：把「读」「写」拆成两个维度（`permLevel`），修正 Chrome 语义坑——read 已 granted 时 `queryPermission({mode:'readwrite'})` 返回的是 `prompt` 而非 `granted`，旧实现据此把只读目录判成不可用
- 选择目录默认只申请 `read`，删掉为写权限而做的二次弹窗：`C:\` 盘根在 `showDirectoryPicker({mode:'readwrite'})` 返回句柄**前**就抛 SecurityError（「选完目录才报错」根因）
- 页面启动与刷新恢复路径一律只查询、不请求：此时没有用户手势，`requestPermission` 必失败，旧实现失败后还不 `return` 仍硬扫一遍
- 保存时改为读时只读、存时才临时要写权限；被拒时**保留句柄不清除浏览能力**
- **扫描健壮性（P1）**：单次 IO 超时 + 入队分层配额（防止浅层巨型目录吃光遍历预算）；深度扫描开关（6 层 / 8000 目录）；`measureDir` 采样 400 个文件后外推，卡片体积不再逐文件 `getFile`；`flatListAt` 改查表；兼容模式分片让出主线程；估算值统一加 `~` 前缀
- **修数据层 bug**：句柄模式曾把「体积采样外推」误当「扫描被截断」（`truncated: m.truncated || m.estimated`），导致任何文件数 >400 的项目被算成未测量、界面还谎报「已达扫描上限」；两条采集通道已对齐
- **修真 bug**：`.toasts` 固定右下 + `z-index:80`，多条提示堆叠会盖住右上按钮并吞点击
- **README 修正**：删除已移除的「以只读方式重选」按钮说明；默认登记表实为「6 个 `os.homedir()` 推导的扫描根 + 6 个 AI 预设」，不是空表；补深度扫描开关与 `build/e2e/` 目录说明
- **端到端回归重构**：新增 `workbench/build/e2e/`（零依赖 CDP 驱动器 + 假句柄桩，35 条断言覆盖盘根被拦 / 只读 / 权限被拒 / 刷新续期 / 深度扫描 / 超大根 / 6 万条清单 / 单大项目外推）；`run.mjs` 的 `CASES` 表改为唯一事实来源，`--only` 与全量同源；假句柄补齐真实 `FileSystemHandle` 两项行为（IndexedDB 可结构化克隆、`request`/`query` 状态联动）

### 项目栏管理：自定义添加 + 多选移除

- 左侧「项目」栏新增两个入口：**添加**（弹窗填名称 / 目录路径 / 语言标签）与 **多选**（行内复选框 + 全选 / 清空 / 移除工具条）
- 移除需二次确认，只影响工作台可见列表，**不动磁盘文件**；自定义项从 `localStorage` 摘掉，扫描项记入 `wt2.removed`
- 存在被移除的扫描项时，项目栏顶部出现「已移除 N 个扫描项目 · 全部恢复」，一键还原
- `serve.mjs` 新增 `POST /api/register`：把自定义目录登记进 `workbench.registry.json`，`repo` 窗格随即可直接读写；只接受已存在目录的绝对路径，只增不删
- 统计口径同步收紧：`allProjects()` 统一过滤被移除项，项目数 / 磁盘占用 / 运行中服务 / 本地检索窗格一并跟随
- 校验链新增覆盖：`serve.test.mjs` 12 项 `register` 断言，`smoke.mjs` 双场景各 11 项项目栏断言

### 首个版本

新增仓库的**第三个产物**：`workbench/` —— 把工作台压成「**自包含单文件 HTML** + **零依赖本地服务**」，面向「不装扩展、不装 Skill，打开就能用」的场景。

- `workbench/index.html`：产物，公开版单文件（虚构示例数据），同时作为 GitHub Pages 入口
- `workbench/serve.mjs`：独立本地服务，零依赖 Node；提供项目文件读写、端口探测、重扫与网页反代
- `workbench/build/`：模板 + 构建 + 校验链（`build-public.mjs` / `verify.mjs` / `smoke.mjs` / `serve.test.mjs`）
- 与 `traework/` 功能同源、形态不同：`traework/` 走「Skill 管数据 + 渲染管线」，本目录走「快照数据内嵌单文件」
- 扫描根一律由 `os.homedir()` 推导，不写死用户名，仓库可公开
- 隐私：个人版产物（内嵌本机真实路径）为 `workbench/workbench.html` 与 `workbench.registry.json`，已在 `.gitignore` 排除
- `workbench/` 已进 `.vscodeignore`，不混入扩展 `.vsix`

## v0.2.0-traework

新增仓库的**第二个产物**：面向 **TraeWork** 的工作台（`traework/`），形态为「Skill 管数据 + 单文件 HTML 做视觉」。

- `traework/SKILL.md`：Skill 定义；`traework/scripts/wt.mjs` 读写 `.worktable/worktable.json`（项目增删改排序隐藏 / 布局预设 / 外观主题）
- `traework/scripts/render.mjs`：组装自包含单文件 HTML，样式与运行时全内联、**零外部引用**
- 数据形状与扩展共用 `src/shared/types.ts`，不另起一套
- 安装：官方要求**项目技能**必须位于 `.trae/skills/`，故 `traework/` 本身不是技能目录；新增 `npm run traework:install` 安装到 `.trae/skills/traework-worktable/`
- 修缺陷：`theme` 对非法值曾静默覆盖用户设置（`--background neon` 退出码 0，且把 `coast` 改写成默认 `aurora`）；现按域显式校验，非法值退出码 1 且不改动文件
- 修缺陷：`render.mjs` 曾依赖仓库根的 `src/webview/styles.css`，技能复制到别处即渲染失败；现从自持的 `lib/styles.css` 取样式
- 配套：`npm run verify:sync` 校验 `traework/lib/` 与源码逐字节一致；`traework/` 已进 `.vscodeignore`，不混入扩展 `.vsix`
- 界面重构：主界面改为**左栏项目列表 + 右侧双范式**——未选项目时是**项目卡片网格**，选中项目时是**分栏工作台**；
  退出当前项目两条路：再点左栏已高亮那项，或点顶栏「← 全部项目」
- 项目级字段：`status`（四态）/ `duration` / `description`，卡片状态光与窗格**共用同一套色板**；
  `activeProjectId` 支持显式 `null`（`active --none`）表示「停在卡片视图」，且可持久化
- 新增 `slot` 命令：按窗口序号写入窗格标签页（类型 / 标题 / 内容 / 状态），解决「只有界面没有内容」
- 新增 `src/webview/projects.ts`：左栏与卡片网格视图
- 窗格模块从四种扩为六种：新增 **`repo`**（目录树 + 源码编辑保存，保存直写磁盘）与 **`web`**（窗格内嵌浏览器）；
  原先的 `note` / `todo` / `link` / `placeholder` 保留为通用兜底，不再当默认占位
- 新增**本地服务** `traework/scripts/serve.mjs` 与 `wt.mjs serve` 命令：一个进程同时提供「每次请求现渲染的工作台 HTML」
  「项目文件目录树与读写 API」「网页反代」；`repo` / `web` 两类模块只有走它才可用，静态单文件形态下自动降级为可读提示
- 安全边界：`repo` / `web` 的所有路径经 `resolveWithin` 钉在项目根内，`..` 与绝对路径一律拒绝；读取上限 512 KB、
  写入上限 1 MB、目录列表上限 400 项；反代剥掉 `X-Frame-Options` / CSP 等封锁头，且不给 iframe `allow-same-origin`
- 新增服务端机器可读错误码（`not-found` / `not-a-directory` / `not-a-file`），前端据此在「目录 / 文件」共用同一路径字段时分支
- 新增 `/api/probe`：网页模块先探上游状态再决定是否内嵌，上游 401/403 会给出可读原因，不塞空白框
- 新增离线用例 `traework/test/serve.test.mjs`（30 例，含越界防护、读写边界与反代头剥离）

> 本版对应 tag `v0.2.0-traework`。
> **注意**：`src/shared/` 与 `src/webview/` 由两个产物**共用**，所以扩展侧也同步获得了新的主界面
> （左栏项目列表 + 双范式）与 `repo` / `web` 两种窗格类型。这两类模块依赖本地服务，
> 扩展侧没有对应后端，预期显示「需要本地服务」提示（该分支未在扩展内实机验证）。
> 扩展的 `package.json` 版本仍为 `0.1.0`，未随本版调整。

## v0.1.0

首个版本。复刻范围：**C1（视觉骨架派）** —— M1 + M4 + M11 + M12。

### 新增

- **M1 侧边栏应用抽屉**
  - 活动栏新增「工作台」容器，含「项目」与「已隐藏」两个树视图
  - 项目可添加（选择目录）、重命名、更换图标、上移 / 下移、隐藏 / 取消隐藏、移除、在文件管理器中打开
  - 移除只从工作台摘除，**不动磁盘上的目录**（有二次确认）

- **M4 布局预设**
  - 四个声明式预设：`单窗` / `左右分栏` / `田字格` / `顶部大窗`
  - 窗口编号顺序固定为 **左栏 → 顶行 → 主行**；聊天窗恒在最右侧，不计入 `contentCount`
  - 每个项目独立记忆当前预设；分隔条可拖拽，宽度 / 高度按「项目 × 预设」记忆
  - 每个窗格支持多标签页，标签页可切换、新建、关闭，并可在 笔记 / 待办 / 链接 / 占位 四种形态间切换

- **M11 外观与主题**
  - 毛玻璃卡片 + 蓝图网格底纹
  - 明暗模式三态：跟随系统 / 深色 / 浅色
  - 强调色取色器，自动推导霓虹光的 RGB 分量与前景墨色
  - 面板不透明度实时可调（30%–100%）
  - 四套背景预设：极光 / 海岸 / 网格 / 无
  - 窗格四态状态光：空闲 / 进行中 / 待你处理 / 完成；进行中窗格带旋转彗星

- **M12 工程配套**
  - 只读更新检查（GitHub Releases），**只提示、不自动升级**；可一键复制升级提示交给 AI 助手
  - 变更日志命令
  - 离线回归测试：布局预设 / 状态归一化 / 打包结构
  - `npm run verify:package`：离线计算打包清单并做结构断言

### 已知边界

- 本版本是子集，**不含** M2 项目↔会话绑定、M3 分栏引擎的宿主联动、M5–M8 真实窗格、M9 控制室看板、M10 点击批注
- 窗格内容为纯前端实现（笔记 / 待办 / 链接 / 占位）；会话窗格为占位
- 全部状态存于 VS Code `globalState`；不读写任何 TRAE 原始数据文件，不上传任何本地数据
