# 交接说明 · TraeWork 工作台

> 交接时间：2026-10-16
> 交接原因：当前会话上下文已耗尽，转由新任务继续
> 本文自包含，**不依赖前序对话**。新任务请先通读本文 + 仓库根 `AGENTS.md`

---

## 0. 一句话现状

**代码已写完、离线验收全绿、进度已提交并推送并打 tag，但「真实 TraeWork 里的装载与端到端」尚未验证。**
`main` 与 `origin/main` 已同步，工作区干净，发版 tag `v0.2.0-traework` 已发布（锚点 `b581b2d`）。
下一步的核心工作是：**执行端到端验证计划**；验证通过后再考虑下一个版本。

---

## 1. 项目身份

| 项 | 值 |
|---|---|
| 包名 | `trae-worktable` |
| 远端 | `https://github.com/nscn6fdx44-crypto/dsh-worktable.git` |
| 分支 | `main`（与 `origin/main` **已同步**；发版 tag `v0.2.0-traework` 锚在 `b581b2d`） |
| 已有 tag | `v0.1.0`（`acf383c`，扩展初始实现）、`v0.2.0-traework`（`b581b2d`，TraeWork 窗格模块化 + 本地服务） |
| 提交作者 | 已统一为 `438567753@qq.com` |
| 上游参考 | `https://github.com/Aisland-SJL/dsh-worktable`（MIT）。本项目是**独立实现**，只参考功能设计与工程纪律，未复制源码 |

**产出两个互不干扰的产物**：

| 产物 | 形态 | 位置 | 状态 |
|---|---|---|---|
| TraeCode 扩展 | `.vsix`（VS Code 扩展格式） | 仓库根 `src/` `media/` `out/` | 已完成，离线验收全绿 |
| TraeWork 版 | Skill + HTML | `traework/` | 本轮重点，见 §3 |

TraeWork 不支持导入 `.vsix`、扩展面没有自定义 UI 容器，所以工作台在那里换了形态。

---

## 2. 目录职责与硬性约束

目录职责见根 `AGENTS.md` §2，此处只重复**最容易踩的三条**：

1. `src/shared/` 与 `src/webview/` **禁止** import `vscode`；宿主能力只能走 `src/shared/protocol.ts` 的消息协议
2. Webview 的 CSP **不得**放宽到 `'unsafe-inline'`；动态尺寸/主题一律走 CSSOM，不用内联 `style`
3. 任何来自 Webview 的 URL 必须先校验 scheme 只允许 `http` / `https` 才 `openExternal`
4. **样式单一来源**：CSS 只写 `src/webview/styles.css`，构建复制到 `media/worktable.css`（`traework/lib/styles.css` 同源）
5. 不读写 TRAE 原始数据文件；扩展状态一律存 VS Code `globalState`
6. 新布局预设**只追加到 `PRESET_DEFS` 末尾**；字段名保持稳定；改完必须 `test/presets.test.mjs` 全绿

工程纪律（`AGENTS.md` §5，交接时尤其要守）：**验收用最终产物**（「构建成功」「退出码 0」不算验收）、**声明可证伪不许写满**、**对外动作永远先审**（push / 发布一律先过目）、**改完必读回**。

---

## 3. 当前方案

### 3.1 数据层（单一事实来源）

`.worktable/worktable.json`，由 `scripts/wt.mjs` 读写。数据形状与扩展**共用** `src/shared/types.ts`，不另起一套。

CLI 命令：`add` / `meta` / `move` / `hide` / `show` / `remove` / `active` / `slot` / `preset` / `theme` / `list` / `render` / `serve`。

### 3.2 视觉层：两种打开方式

| 方式 | 命令 | 产物 | 能力 |
|---|---|---|---|
| 单文件 | `render` | 数据文件同目录 `worktable.html`，样式与运行时全内联、零外链、双击即开 | **无后端** |
| 本地服务 | `serve` | `http://127.0.0.1:7331/`，每次请求现渲染 | 加项目文件读写 + 网页反代 |

`repo` / `web` 两类模块**只有走 `serve`** 才可用；单文件形态下自动降级为「需要本地服务」提示（预期行为，不是故障）。

### 3.3 界面结构

- **左栏**：项目列表（名称 / 目录 / 四态状态光），当前项高亮
- **右侧双范式**：`activeProjectId` 为空 → 项目卡片网格；有当前项目 → 分栏工作台
- **退出当前项目**两条路：再点左栏已高亮那项，或点顶栏「← 全部项目」
- 布局预设：`full` 单窗 / `l2` 左右分栏 / `g4` 田字格 / `l13` 顶部大窗
- 四态状态光：`idle` / `working` / `needs-you` / `done`，窗格与项目卡片**共用同一套色板**

### 3.4 窗格模块（六种）

| kind | 含义 | 载荷 `content` | 需要 serve |
|---|---|---|---|
| `note` | 随手记 | 文本 | 否 |
| `todo` | 待办清单 | `[ ]` / `[x]` 行文本 | 否 |
| `link` | 一个外链 | URL | 否 |
| `placeholder` | 预留占位 | — | 否 |
| `repo` | **仓库**：目录树 + 源码编辑保存 | 相对项目根的路径（`""` = 项目根） | **是** |
| `web` | **网页**：窗格内嵌浏览器 | 目标 URL | **是** |

- `repo` 路径**不区分目录与文件**：是目录就列目录，是文件就开编辑器，改完点「保存」**直写磁盘**
- `web` 先在服务端探一次上游状态（`/api/probe`）：可嵌入才内嵌，401/403 给可读原因，不塞空白框

### 3.5 安全边界（服务端统一做）

- 所有路径经 `resolveWithin` 钉在项目根内，`..` 与绝对路径一律拒绝
- 读取上限 512 KB、写入上限 1 MB、目录列表上限 400 项
- 反代剥掉 `X-Frame-Options` / CSP 等封锁头；**不给 iframe `allow-same-origin`**（防反代页面反过来调 `/api/file` 动项目文件）
- 服务端错误带机器可读 `code`：`not-found` / `not-a-directory` / `not-a-file`（前端据此在「目录/文件」共用同一路径字段时分支）

---

## 4. 已完成并验收

### 4.1 本轮（模块扩展）已完成

- 数据层：`PaneKind` 扩为六种，`state-core` 归一化与默认标题同步（旧数据兼容）
- 渲染层：`src/webview/panes.ts` 完成 `repo` / `web` 两个模块（目录树、编辑器、草稿暂存、保存、上游探测、内嵌）；`src/webview/styles.css` 补模块样式
- 服务层：`traework/scripts/serve.mjs`（HTML 现渲染 + `/api/tree` + `/api/file` 读写 + `/proxy` 反代 + `/api/probe`）；`wt.mjs` 新增 `serve` 命令
- 用例：`traework/test/serve.test.mjs` 30 例

### 4.2 验收结果（本轮实跑，可复现）

```
npm run build            # 通过
npm run check            # 通过
npm run typecheck        # 通过
npm test                 # 112 例全绿（扩展 9+26+5，traework CLI 32 + HTML 结构 10 + 本地服务 30）
npm run verify:sync      # 3 例通过（traework/lib 与源码逐字节一致）
npm run verify:package   # 打包结构断言，14 个文件
```

### 4.3 真实 C 项目实跑证据（读路径）

对 `C:\Users\jinshuaiyu\Desktop\code\gitee`（项目 id `proj-mva881lf-1`）起 `serve` 后实测：

- 根目录列出 `Project1`–`Project9`
- `Project9` 子目录列出 `二叉排序树.c` 等
- `/api/file` 正确读出 `Project9/二叉排序树.c`（2633 字节、判定为文本）
- 对文件调 `/api/tree` 回 `code: not-a-directory` → 前端改按文件打开，**该分支实测通过**
- `/api/probe`：runoob C 教程 `embeddable: true`；gitee 仓库页 `status: 403 / embeddable: false`
- 服务产物 50 KB、零外部引用

### 4.4 关键结论：gitee 无法被内嵌

gitee 对**任何非浏览器请求**一律回 403「您的访问受限」——仓库页、raw 文件地址都试过，**换浏览器 UA 也一样**。
所以「内置浏览器访问 gitee 仓库」这条路走不通。缓解方式：用 `repo` 模块看**本地克隆**（同一份内容，而且能改）。

---

## 5. 改动落库情况（新任务必读）

**`main` 与 `origin/main` 已同步，工作区干净。最近一次发版 tag：`v0.2.0-traework` → `b581b2d`。**

本次进度已作为提交推送到远端：

| 提交 | 内容 |
|---|---|
| `b581b2d` | docs(changelog): 未发布转为 v0.2.0-traework —— **即 tag `v0.2.0-traework`** |
| `cbda0de` | docs: 交接文档同步最新落库状态 |
| `6a7744a` | feat(traework): 窗格新增 repo/web 模块与本地服务，主界面改为左栏+双范式 —— **32 文件，+4597 / -225** |
| `44575f6` | feat(traework): 新增 TraeWork 版工作台（形态为 Skill 管数据 + 单文件 HTML 做视觉） |
| `acf383c` | feat: 工作台扩展初始实现（M1 / M4 / M11 / M12）—— 即 tag `v0.1.0` |

`6a7744a` 覆盖：界面重构（左栏项目列表 + 双范式）、项目级字段、`slot` 命令、
`repo` / `web` 模块、本地服务 `serve`、安全边界、`/api/probe`、离线用例，
以及 `.worktable/` 进 `.gitignore`。更新日志见 `CHANGELOG.md` 的「v0.2.0-traework」一节。

**注意点**：
- `.worktable/` 已加入 `.gitignore`：它记录的是**本机项目绝对路径**，属本地实例数据，不入库（换机器重新 `add` 即可）
- `traework/lib/` 是**构建产物但要求提交**（Skill 需开箱可用），改源码后必须重新 `npm run build`，并用 `npm run verify:sync` 校验同步
- 改过 `traework/` 后必须重跑 `node scripts/install-traework-skill.mjs`，否则 `.trae/skills/` 里那份是旧的
- 提交前 `git status` 必须干净且 `npm test` 全绿
- **网络注意**：本机 `github.com:443` 会被拦（连接重置），推送需先挂代理；SSH 端口反而是通的，但本机没有 SSH 密钥

---

## 6. 未验证项（不得宣称已通过）

1. **真实 TraeWork 里的技能装载与端到端**——从未装进真实 TraeWork 跑过
2. **浏览器实机点测页内交互**——切项目、切预设、切主题、拖分隔条、切标签页、切四态状态光，均未在浏览器里点过
3. **`repo` 的「保存」写盘在真实项目上跑过**——写盘路径**只在临时目录的离线用例**里覆盖；交接时刻意没在真实项目上写盘，避免动用户原始文件
4. 移动端 / 响应式：未验证，结论里必须写明

离线用例全绿 **不等于** 实机通过。按 `AGENTS.md` §5「验收用最终产物」，上述四项都属**未验收**。

---

## 7. 待拍板的决策

| # | 决策点 | 现状 |
|---|---|---|
| D1 | gitee 那条标签怎么处理 | 换掉 / 删掉 / 保留（会显示 403 原因）。用户此前跳过了这个提问，尚未拍板 |
| D2 | ~~`.worktable/` 是否进 `.gitignore`~~ | **已定**：已加入 `.gitignore`（记录本机绝对路径，属本地实例数据） |
| D3 | ~~30 项改动是否提交、何时推送~~ / 是否打新 tag | **已定**：已提交并推送，并打 tag `v0.2.0-traework`（`b581b2d`） |
| D4 | TraeWork 版是否也要出「最小版」文档供拍板 | 未定 |

---

## 8. 下一步建议（按顺序）

**第一步：跑端到端验证计划**（这是当前唯一的阻塞项）

计划文档：`docs/traework-e2e-verification.md`，七级阶梯 **L0–L7**，外加本轮新增的 **L8 · 模块窗格与本地服务**（判据 M1–M8）。
安装形态已定为**项目技能**：`.trae/skills/traework-worktable/`（含 `SKILL.md` + `lib/` + `scripts/`）。
全局技能目录 `%userprofile%\.trae-cn\builtin\work\default\skills\` 里**没有**它——它是项目技能，不是全局技能。

> **交接时已修的一个坑**：原先装好的那份技能是**旧的**——`scripts/` 下只有 `render.mjs` 与 `wt.mjs`，
> **缺 `serve.mjs`**，而新版 `wt.mjs` 的 `serve` 命令要 import 它，跑起来会直接失败。
> 已重跑 `node scripts/install-traework-skill.mjs` 刷新，并逐文件 SHA256 比对确认装好的 7 个文件与 `traework/` 源码
> **完全一致**；另跑 `node .trae/skills/traework-worktable/scripts/wt.mjs list --file .worktable/worktable.json`
> 确认装好的副本能独立运行。**改过 `traework/` 后务必重跑安装脚本**，否则装好的那份会再次变旧。

验证时按阶梯逐级取证（截图 / 命令原文 / 文件哈希对比），**L8 的 M7（越界写入被拒）失败按安全缺陷最高优先级处理**。

**第二步：按验证结论决定发布动作**

退出判据见计划文档 §8：L0–L8 全通过才可打 tag；只有 L0 + L4 通过时，只能声称「数据层与渲染离线可用」，**不得**声称 TraeWork 端到端可用。

**第三步：提交 / 推送**（需用户明确授权，先过目）

---

## 9. 关键文件索引

| 文件 | 作用 | 备注 |
|---|---|---|
| `AGENTS.md` | 仓库长期约定，**先读** | 硬性约束与工程纪律 |
| `docs/handoff.md` | 本文 | 交接说明 |
| `docs/traework-e2e-verification.md` | 端到端验证计划 | 待执行清单，含 L8 判据 M1–M8 |
| `src/shared/types.ts` | 类型定义（两端共用） | `PaneKind` 六种 |
| `src/shared/state-core.ts` | 状态归一化 / 布局 / 主题纯逻辑 | `PANE_KINDS`、`defaultTabTitle` |
| `src/shared/presets.ts` | 布局预设定义 | `PRESET_DEFS`，只追加 |
| `src/webview/panes.ts` | 窗格渲染核心 | `repo` / `web` 模块、`SERVER_KINDS`、`isServed`、`ApiError` |
| `src/webview/projects.ts` | 左栏 + 卡片网格视图 | 新增文件 |
| `src/webview/split.ts` | 分栏布局入口 | 构造 `PaneContext` 传给窗格 |
| `src/webview/styles.css` | 唯一样式来源 | `.wt-mod*` 模块样式 |
| `traework/scripts/wt.mjs` | TraeWork CLI 入口 | 含 `serve` 命令 |
| `traework/scripts/serve.mjs` | 本地服务 | `/api/tree` `/api/file` `/proxy` `/api/probe` |
| `traework/SKILL.md` | 技能对外文档 | 触发条件 + 用法 + 边界 |
| `traework/README.md` | 技能说明 + 已验证范围 | §已验证范围 写明未验证项 |
| `scripts/install-traework-skill.mjs` | 技能安装脚本 | 新增文件 |

---

## 10. 坑与教训（前序踩过的，别重踩）

1. **技能必须在约定目录**才能被扫描：项目级 `.trae/skills/<skill-name>/`，全局 `%userprofile%\.trae-cn\builtin\work\default\skills\`。放 `traework/` 目录下**不会被识别**
2. `theme` 命令曾**静默覆盖**用户合法配置且返回退出码 0 —— 已修。改 theme 相关逻辑时保持「非法值拒绝且不改动文件」的语义
3. `render.mjs` **不能直接独立调用**，必须经 `wt.mjs render --file ... --out ...`
4. 技能产物是**独立 HTML 文件**，需用户自己打开，不会自动渲染进对话界面
5. esbuild 构建产物对非 ASCII **默认转义成 `\uXXXX`**（`charset` 未设为 `utf8`）。所以在构建产物里 grep 中文会搜不到，属正常现象，别误判为「字符串丢了」
6. `slot --window` 从 1 起且不得超过该预设窗口数；`slot` 写的是窗格的**当前活动标签**（想改非活动标签得直接改 JSON 或先切活动标签）
7. 数据文件损坏时 CLI 会报错停止且**不覆盖原文件**；遇到这种报错先让用户确认
8. **改完 `traework/` 一定要重跑安装脚本**。已装技能是**整目录快照**，不会跟着源码自动更新；
   交接时就发现装好的那份缺 `serve.mjs`（比源码旧），跑 `serve` 会 import 失败
9. `.trae/` 在仓库里被 `.gitignore` 忽略，所以装好的技能**不进版本库**——换机器要重新装

---

## 11. 交接自检清单

- [ ] 读过根 `AGENTS.md`
- [ ] 确认 `git status` 干净、本地存在 tag `v0.2.0-traework`（锚点 `b581b2d`）
- [ ] 确认服务在 `http://127.0.0.1:7331/`（交接时存活，PID 3740；重启后需重新 `serve`）
- [ ] 跑过一次 `npm test`（应 112 例全绿）再动手改任何东西
- [ ] 读完 `docs/traework-e2e-verification.md` 再开始验证
- [ ] **若改过 `traework/`，重跑 `node scripts/install-traework-skill.mjs` 刷新已装技能**（否则装好的那份是旧的）
- [ ] 未验证项（§6）不得写成「已通过」
