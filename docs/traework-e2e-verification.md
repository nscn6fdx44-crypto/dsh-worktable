# TraeWork 工作台 · 端到端验证计划

> 状态：**未执行**（本文件是待执行清单，不是验证结论）
> 适用对象：本仓库的 TraeWork 产物 `traework/`，基线 commit `44575f6`
> 更新：本机取证（TraeWork 自带技能的目录约定与实际落点）已并入 §3 R3 与 §4；L0 基线于 2026-10-16 复跑全绿
> 更新（2026-10-16 · 模块扩展）：窗格新增 `repo` / `web` 两类项目模块与 `serve` 本地服务，L0 用例数由 82 变为 112；
> 新增 **L8 · 模块窗格与本地服务**，判据见 §5；该级的「离线 + 本地实跑」部分已有证据，**实机部分仍未执行**

---

## 1. 结论先行

**目前只有离线断言通过。「在真实 TraeWork 里能用」这件事，一条证据都没有。**

| 分类 | 内容 |
|---|---|
| 已有证据（离线） | CLI 32 例 / HTML 结构 10 例 / 本地服务 30 例 / 产物同步 3 例；扩展侧 40 例回归不破 |
| 已有证据（本地实跑） | 开发机上渲染出单文件 HTML（约 40 KB，零外部引用）；把技能目录整体复制到仓库之外后仍能独立渲染 |
| 已有证据（本地实跑 · 服务） | 对真实 C 项目目录起 `serve`：根目录列出 `Project1`–`Project9`、`Project9` 子目录列出 `二叉排序树.c`、`/api/file` 正确读出该 `.c`（2633 字节、文本）；对文件调 `/api/tree` 回 `code: not-a-directory`；`/api/probe` 对 runoob C 教程报可嵌入、对 gitee 仓库页报 `403 / 不可嵌入` |
| 已有证据（本机取证） | TraeWork 自带 `skill-creator` 原文写明工作区技能目录为 `.trae/skills/<skill-name>/`；TraeWork 内置技能实际落在 `%userprofile%/.trae-cn/builtin/work/default/skills/` |
| **本计划要补的** | L1–L7：装载、触发、数据层端到端、渲染与打开、回写闭环、失败路径、跨端；**L8：模块窗格与本地服务的实机部分** |
| 明确不验证 | TraeCode 扩展（已单独验收）；TraeWork 的 UI 视觉质量；性能与并发 |

验收口径沿用 `AGENTS.md`：**「构建成功」不算验收，必须实跑用户路径**；**结论只写已验证范围**。

---

## 2. 记录表（执行前先填，这是证据的一部分）

| 项 | 值 |
|---|---|
| 执行人 / 日期 | |
| TraeWork 形态（web / 桌面 / 移动） | |
| TraeWork 版本号 | |
| 操作系统 | |
| `node -v` | |
| 仓库 commit | `44575f6` |
| 目标项目目录（数据文件落点） | |
| 技能安装形态（A / B / C，见 §4） | |

> Node 版本必须记录：`wt.mjs` 是纯 Node ESM，版本过低会直接语法失败。

---

## 3. 已知风险（先声明，再用实验证伪）

按「声明可证伪」的纪律，这些是**预测**，不是结论。验证时逐条确认或推翻。

| 编号 | 风险 | 预测后果 | 关联项 |
|---|---|---|---|
| **R1** | ~~高~~ **已修复（代码侧）** —— 原文写死「以仓库根目录下的绝对路径调用 `traework/scripts/wt.mjs`」，且 `traework/` 不是官方认的技能目录。现已改为「本技能目录下的 `scripts/wt.mjs`」，补了 `npm run traework:install`，并让渲染从 `lib/styles.css` 取样式、不再回头依赖仓库根。**仍需实测的是 TraeWork 侧的目录约定**（见 R3） | 代码侧障碍已清除；真实 TraeWork 里能否被扫描到仍未知 | L1、L3 |
| **R2** | ~~中~~ **已修复（代码侧）** —— 仓库内源目录仍叫 `traework/`，但安装脚本已按约定把它落到 `.trae/skills/traework-worktable/`，与 frontmatter `name: traework-worktable` 一致（本机实查该目录已存在，含 `SKILL.md` + `scripts/` + `lib/`）。**待实测**：面板显示名是否等于该 name | 风险已大幅降低，仍留 L1 复核 | L1 |
| **R3** | ~~中~~ **已基本确证（本机取证）** —— TraeWork 自带技能 `skill-creator`（`%userprofile%/.trae-cn/builtin/work/default/skills/skill-creator/SKILL.md`）原文写明：「**Directory**: `.trae/skills/<skill-name>/`」「**File**: `SKILL.md` inside the directory」，与 TraeCode 侧约定同构。另实查确认 TraeWork 内置技能落在 `%userprofile%/.trae-cn/builtin/work/default/skills/`（**不是**文档所写的 `.trae-cn/skills`）。**剩余唯一未知**：本仓库的「工作区」是 TraeWork 的内部工程目录 `ModularData\ai-agent\work-mode-projects\...`，该目录是否在扫描范围内尚无实证 | 安装位置基本正确；能否被发现仍待实测 | L1 |
| **R4** | 中 —— TraeWork 能否直接预览/打开自包含 HTML | 需要退化为「导出到本地再双击打开」 | L4 |
| **R5** | 低 —— 页内 `localStorage` 缓存与「导出 JSON」回写闭环未实机验证 | 页内改动与数据文件不一致 | L5 |
| **R6** | ~~高~~ **已修复** —— `theme` 曾对非法值静默覆盖：`themeFromConfig` 会把非法值回落成默认值，而 CLI 的守卫写的是「结果与当前主题相同才报错」，于是 `--background neon` 退出码 0 且把 `coast` 改写成 `aurora`。现已改为按域显式校验（`themeIssues`）：非法值退出码 1、文件不动，并补了回归用例 | 已消除（本地复现路径已验证） | L6·F7 |

**R3 已从「完全未知」降级为「基本确证，仅剩一处未知」**：TraeWork 自带 `skill-creator` 明写工作区技能目录就是 `.trae/skills/<skill-name>/`，与 TraeCode 侧同构；本机实查也确认 TraeWork 内置技能落在 `%userprofile%/.trae-cn/builtin/work/default/skills/`。剩下的未知只有一条：**本仓库所在的内部工程目录是否在 TraeWork 的扫描范围内**。

另有一条**反向证据**要如实记下：对 `%userprofile%/.trae-cn` 做全量文本检索，**没有找到任何 `traework-worktable` 的索引痕迹**——说明技能当前尚未被装载。这与「本会话早于安装、需要新会话或重载」的预测一致，但**不能据此断定约定不成立**，必须靠 L1 实证。

R1 / R2 / R6 的代码侧障碍已清除，但它们是否真的解决了问题，仍要靠 L1 / L6 在实机上确认——**修复不等于验证通过**。

---

## 4. 前置项 P0：安装形态拍板（阻塞 L1）

官方约定（文档侧）：项目技能在项目下的 `.trae/skills/`，全局技能在 Windows 的 `%userprofile%/.trae-cn/skills`。

**产品内取证**（TraeWork 自带技能 `skill-creator` 原文，路径 `%userprofile%/.trae-cn/builtin/work/default/skills/skill-creator/SKILL.md`）：

> A valid SKILL requires: 1. **Directory**: `.trae/skills/<skill-name>/` 2. **File**: `SKILL.md` inside the directory

frontmatter 需 `name` 与 `description`；`description` 要同时写「做什么」和「什么时候用」，建议 200 字符内。**这与方案 A 完全一致**。

**本机实际落点**：TraeWork 内置技能位于 `%userprofile%/.trae-cn/builtin/work/default/skills/`（含 `doc-writing-guide` / `html-report` / `skill-creator` 等），可作为目录形状的参照——注意它**不是**文档所写的 `.trae-cn/skills`。

本仓库当前把 `SKILL.md` 放在 `traework/` 下——**这不是一个技能目录**，TraeWork 不会自动发现它。

| 方案 | 做法 | 优点 | 代价 |
|---|---|---|---|
| **A · 项目技能 ← 已选定** | 在目标项目建 `.trae/skills/traework-worktable/`，把 `SKILL.md` + `scripts/` + `lib/` 复制进去。已提供一键安装：<br>`npm run traework:install`（默认装到本仓库）<br>`npm run traework:install -- --project <项目目录>` | 与官方约定一致；随项目走 | 本仓库 `.gitignore` 已忽略 `.trae/`，装好的技能**不入库**，换机器要重装 |
| B · 全局技能 | 复制到 `%userprofile%/.trae-cn/skills/traework-worktable/` | 跨项目可用 | 脚本必须随技能一起走，路径问题更尖锐 |
| C · 就地使用 | 把本仓库本身作为项目，让技能目录指向 `traework/` | 不用改路径 | 依赖本机目录结构，不可分发 |

**当前状态**：技能目录已按 A 装到本仓库 `.trae/skills/traework-worktable/`（本机实查已确认存在，含 `SKILL.md` + `scripts/wt.mjs` + `scripts/render.mjs` + `lib/{core.mjs,app.js,styles.css}`），
并在仓库外用安装后的副本实跑过 `add / preset / theme / render`（退出码 0，单文件 HTML，零外链）。
**剩下要做的**是在真实 TraeWork 的技能面板里确认它真的出现了——那是 P0 的通过判据。

**P0 通过判据**：在 TraeWork 的技能面板里**肉眼看到**这个技能，并能读到它的 description。
**执行提示**：本机检索已确认 `%userprofile%/.trae-cn` 下**没有** `traework-worktable` 的索引痕迹，即技能当前尚未装载。所以**务必开新会话或重载工作区后再查**，不要在本会话里查不到就判失败。
**P0 若失败**：不要继续 L1–L7，先记录失败现象与安装路径，回到本文档更新 R3。

---

## 5. 验证阶梯

每级都要**留下证据**（§6）。级与级之间停下汇报，不要一口气跑完。

### L0 · 离线基线（可复跑，防止「改了源码忘了构建」）

```powershell
cd <仓库根>
npm run verify:sync      # 必须单独跑，不要紧跟 npm run build
npm test
npm run verify:package
```

**通过判据**：`verify:sync` **3 例**全绿；`npm test` **112 例**全绿（扩展 9/26/5 + traework 32/10/30）；打包清单 13 个文件（含此前实跑产生的 `.trae-html-share-packages/` 与 `.worktable/` 两份产物，它们不在扩展包清单断言范围内）。
**失败处置**：先修同步问题再谈端到端，否则后面验的是旧产物。

---

### L1 · 装载（Skill 能不能被 TraeWork 认出来）

1. 按 §4 选定的方案安装。
2. **先开新会话 / 重载工作区**（本机已确认技能尚未被索引，见 §4 执行提示），再打开 TraeWork 的技能面板，确认技能出现在「项目」或「全局」页签下。
3. 记录面板上显示的**技能名**与**描述原文**。

**通过判据**：
- 技能可见，且描述能被完整读到（不是被截断成一行）
- 显示名与 `SKILL.md` frontmatter 的 `name: traework-worktable` 一致 —— **若不一致，R2 成立，记录实际显示值**
- 补充断言（本机取证支持）：`description` 长度需在 200 字符以内（`skill-creator` 原文建议），超长可能被截断。**当前实测 199 字符（临界）**——任何加长都会越界，L1 若发现描述被截断，先怀疑长度而不是约定

**失败处置**：记录安装目录树（`Get-ChildItem -Recurse`）与面板截图，判定是 R2 还是 R3。
**区分 R2 / R3 的判据**：目录树形状正确（`.trae/skills/traework-worktable/SKILL.md` 在位）却看不到 → **R3 成立**（扫描范围问题）；看到了但名字不对 → **R2 成立**。

---

### L2 · 触发命中（描述写得准不准）

在 TraeWork 新会话里，逐句输入，记录**是否触发**与**触发了哪个技能**。

正向（应命中）：

| # | 句子 | 期望 |
|---|---|---|
| P1 | 把这些项目收纳成一个工作台 | 命中 |
| P2 | 给「甲」这个项目换成田字格布局 | 命中 |
| P3 | 把工作台调成深色、背景用海岸、强调色换成绿色 | 命中 |
| P4 | 我要一份可视化的工作台视图 | 命中 |

反向（**不应**命中）：

| # | 句子 | 期望 |
|---|---|---|
| N1 | 帮我改一下 TraeCode 扩展的 src/webview/styles.css | 不命中 |
| N2 | 这个 `.vsix` 怎么打包发布 | 不命中 |
| N3 | 帮我把这个 JSON 文件的字段名从 a 改成 b | 不命中 |

**通过判据**：正向 4/4 命中；反向 0/3 误命中。
**失败处置**：误命中说明 description 的「不用于」边界不够硬，记为待改项，不要当场改 SKILL.md（改完又要重跑 L1）。

---

### L3 · 数据层端到端（**由 TraeWork 里的智能体执行，不是我手动敲**）

这一级验的是「智能体能不能按 SKILL.md 正确调用 CLI」，而不是 CLI 本身对不对。

准备：建一个干净的临时数据目录，**不要用真实项目目录**。

技能目录是**自持**的（`SKILL.md` + `scripts/` + `lib/`），所以下面的命令不需要仓库根参与。
把当前工作目录设在仓库之外再跑，能顺带证明这一点。

```powershell
$SKILL = "<技能安装目录>"   # 如 <仓库根>\.trae\skills\traework-worktable（见 §4）
$F     = "<项目根>\.worktable\worktable.json"
$WT    = "$SKILL\scripts\wt.mjs"

node $WT add    --folder "C:\wt-e2e\alpha" --name 甲 --status working --duration 2h --desc "演示项目" --file $F
node $WT add    --folder "C:\wt-e2e\beta"  --name 乙 --icon rocket --file $F
node $WT list   --file $F --json
node $WT meta   --name 乙 --status needs-you --desc "第二个项目" --file $F
node $WT slot   --name 甲 --window 1 --kind todo --content "[ ] 甲任务`n[x] 已完成" --status working --file $F
node $WT preset --name 乙 --preset g4 --file $F
node $WT move   --name 乙 --up --file $F
node $WT rename --name 乙 --to 乙项目 --file $F
node $WT icon   --name 乙项目 --icon star --file $F
node $WT hide   --name 乙项目 --file $F
node $WT show   --name 乙项目 --file $F
node $WT active --name 甲 --file $F
node $WT active --none --file $F
node $WT theme  --mode dark --accent "#22c55e" --opacity 0.72 --background coast --file $F
node $WT render --file $F
```

**通过判据**：
- 每一步退出码为 0，且**智能体转述的结果与命令输出一致**（不能报「已完成」但文件没变）
- 全部命令后，`worktable.json` 的项目顺序、`hidden`、`status` / `duration` / `description`、`presetByProject`、`theme`、以及 `activeProjectId === null` 与预期**逐字段一致**
- 每个项目在其当前预设下都有 `layouts` 槽位（`materialize()` 的效果）；`slot` 写入的槽位其 `activeTabId` 对应的标签页 `kind`/`content` 与 `slot.status` 正确
- `render` 产出的 HTML 落在数据文件同目录（默认路径），或 `--out` 指定处

**失败处置**：
- 命令找不到脚本 → **R1 成立**，停止 L3，先修 `SKILL.md` 的路径写法
- 命令能跑但智能体转述失真 → 记为「Skill 指令清晰度」问题
- 数据文件字段不符 → 对比 `core.normalizeState` 期望，可能是 CLI 缺陷（真 bug，需修）

---

### L4 · 渲染与打开

1. 确认 HTML 是**单文件**：`Get-Item <html>` 有大小，且文件可独立复制到别处打开。
2. 断言零外部引用：
   ```powershell
   Select-String -Path <html> -Pattern '<link|src="http|href="http|@import'
   ```
   期望命中数 **0**。
3. **断网**打开（拔网线或关 Wi-Fi），确认样式、图标、交互仍完整。
4. 在 TraeWork 内尝试预览该 HTML，记录是否可行。
5. **主界面交互逐项确认**（左栏 + 右侧双范式）：

   | # | 操作 | 期望 |
   |---|---|---|
   | U1 | 打开 HTML（数据里 `activeProjectId === null`） | 左栏列出全部未隐藏项目并显示数量；右侧是**项目卡片网格** |
   | U2 | 看卡片内容 | 每张卡片有：名称、描述（无描述时灰色「暂无描述」）、目录 · 预设名 · 时长、状态统计「进行中 n / 待你处理 n / 完成 n / 共 m 窗」 |
   | U3 | 点某张卡片 | 右侧切到该项目的**分栏工作台**；左栏该项高亮，顶栏出现「← 全部项目」与预设 chip 组 |
   | U4 | 再点一次左栏里已高亮的那一项 | 回到卡片网格（退出方式一） |
   | U5 | 重新进入某项目后点顶栏「← 全部项目」 | 回到卡片网格（退出方式二） |
   | U6 | 点卡片上的状态胶囊 | 状态按 `idle → working → needs-you → done → idle` 循环，胶囊文字与配色即时变化 |
   | U7 | 点「导出 JSON」 | 下载文件的 `activeProjectId` 为 `null`（即「退出到网格」可持久化） |

**通过判据**：文件大小 > 20 KB；外部引用 0 处；断网打开后顶栏、左栏、分栏、窗格四态光**视觉完整**（不是白屏、不是裸 HTML）；U1–U7 全部符合期望。
**失败处置**：断网后样式丢失 = 有外链漏了，属真 bug；TraeWork 不能预览则退化为「双击本地文件」，**不算失败**，但要在结论里写明。U1–U7 中任何一项不符，先判断是「数据层字段缺失」（回到 L3 查 seed）还是「渲染器缺陷」（查 `src/webview/projects.ts`）。

---

### L5 · 回写闭环

1. 在 HTML 里改：退出到卡片网格、点卡片状态胶囊循环四态、进项目后切预设、切主题、拖分隔条、把某个窗格状态切到「进行中」。
2. 刷新页面，确认改动仍在（`localStorage` 生效）。
3. 点「导出 JSON」，把内容**覆盖**回 `worktable.json`。
4. 重新 `render`，确认新 HTML 与页内状态一致。

**通过判据**：刷新后状态保持；导出 JSON 合法且能通过 `normalizeState`；重渲染后状态一致。
**失败处置**：记录「页内改了但导出丢字段」的具体字段名——这是数据模型缺口，不是小问题。

---

### L6 · 失败路径（智能体与 CLI 的出错行为）

| # | 场景 | 操作 | 期望 |
|---|---|---|---|
| F1 | 数据文件损坏 | 写入 `{{{` 后跑 `list` | 报错并**停止**，原文件字节不变（跑前后比对 SHA256） |
| F2 | 未知项目 id | `preset --id nope --preset g4` | 退出码 1，提示找不到 |
| F3 | 重名不唯一 | 两个项目都叫「甲」，`hide --name 甲` | 要求改用 `--id`，并列出候选 id |
| F4 | 路径含空格与中文 | `add --folder "C:\wt e2e\甲 项目"` | 正常写入（不因空格/中文报错） |
| F5 | `add` 一个不存在的目录 | `add --folder C:\不存在的路径` | **行为记录**：当前实现只存字符串、不校验存在性 —— 记录实际行为即可，不算失败 |
| F6 | 目标目录只读 | 对只读目录跑 `add` | 报错信息可读，不静默失败 |
| F7 | 非法主题值 | 当前 background 为 `coast`，执行 `theme --background neon` | 退出码 1、文件**字节不变**、`coast` 保持不变；再试 `theme --opacity 2` 与 `theme --accent 绿色`，行为一致 |
| F8 | 无参数 | 直接 `node $WT` | 打印用法，退出码 1 |
| F9 | 非法项目级字段 | `meta --status 紫色`、`add --status 紫色` | 退出码 1、文件**字节不变**；`slot --window 99` 报出该预设的合法范围并拒绝写入 |

**通过判据**：F1–F4、F6–F8 行为符合「期望」列；F5 如实记录。
**失败处置**：任何「静默失败」（退出码 0 但没干活，或报错却改了文件）都按真 bug 处理。
F7 的代码侧缺陷已修并补了离线用例，但**离线用例不等于实机通过**——这一条必须在真实 TraeWork 里再走一遍。

---

### L7 · 跨端与边界环境

| # | 场景 | 通过判据 |
|---|---|---|
| C1 | 把同一个 HTML 复制到另一台设备打开 | 视觉与交互一致，无外链报错 |
| C2 | 移动端 TraeWork 打开 | 布局不溢出、可滚动；若不可用则如实记录 |
| C3 | 换浏览器（Chrome / Edge / 任一） | 顶栏与四态状态光渲染一致 |
| C4 | 系统深浅色切换 | 「跟随系统」模式下自动跟随 |

**失败处置**：C2 不通过不阻塞发布，但必须在结论里写明「移动端未验证/不可用」。

---

### L8 · 模块窗格与本地服务（`repo` / `web` + `serve`）

这一级验的是「工作台能不能真的读写项目文件、内嵌网页」，也就是用户要的
「C 语言练习里能看仓库、能改源码」这条路径。**它必须走 `serve`**——`render` 出的单文件 HTML 没有后端，跑不了。

准备：用真实项目目录（或它的副本），数据文件里给它配一个 `repo` 窗格（`content` 为空 = 项目根）和一个 `web` 窗格。

```powershell
$WT   = "<技能目录>\scripts\wt.mjs"
$F    = "<项目根>\.worktable\worktable.json"
node $WT slot   --name 甲 --window 1 --kind repo --content "" --file $F
node $WT slot   --name 甲 --window 2 --kind web  --content "https://example.com" --file $F
node $WT preset --name 甲 --preset l2 --file $F
node $WT serve  --port 7331 --file $F          # 常驻；记下打印出的地址
```

**通过判据**（逐项实跑，不看「服务启动成功」）：

| # | 操作 | 期望 |
|---|---|---|
| M1 | 浏览器打开服务打印出的地址 | 工作台 HTML 正常渲染；改数据文件后**刷新即变**（现渲染、不缓存） |
| M2 | `repo` 窗格点目录 | 进入下一层；构建产物目录（`.git` / `bin` / `obj` / `node_modules` 等）**不出现** |
| M3 | `repo` 窗格点源码文件 | 打开编辑器并显示文件内容（中文文件名正常，不乱码） |
| M4 | 改动后点「保存」 | **磁盘上的文件真的变了**（保存后用命令行读回比对）；切走再回来草稿不丢 |
| M5 | 保存后按 F5 刷新 | 内容仍是保存后的值 |
| M6 | `web` 窗格 | 先显示上游探测结果；可嵌入则内嵌，不可嵌入（如 401/403）给出状态码与原因，**不是空白框** |
| M7 | 把 `repo` 的 `content` 改成 `..\..\` 后保存 | 服务端拒绝（越界），**磁盘文件不变** |
| M8 | 单文件形态（`render` 产物）打开 | `repo` / `web` 窗格显示「需要本地服务」提示，**不是空白、不报错** |

**失败处置**：
- M4 不通过 → 真 bug，查 `serve.mjs` 的 `writeTextFile` 与前端保存调用，**不要**用「刷新一下就好」搪塞。
- M6 出现空白框 → 检查是否漏了 `/api/probe` 分支，或上游响应头不是 HTML。
- M1 刷新不变 → 检查缓存头，`serve.mjs` 对 HTML 与 JSON 都应是 `no-store`。
- M7 越界被写进去 → **安全缺陷**，立刻停止写入类操作，按最高优先级修。

**已有证据 vs 待补**：本级的离线部分（30 例，含写盘 / 越界 / 超限 / 反代剥头）与
「对真实 C 项目的**读**路径」（根目录、子目录、`/api/file` 读 `.c`、`not-a-directory` 分支、`/api/probe` 两种上游）
已跑过，见 §1；**浏览器里的 M1–M8 实机点测仍未执行**——离线用例绿不等于实机通过。
`repo` 的「保存」写盘也**只在临时目录的离线用例里覆盖过**，没有在真实项目上实跑。

---

## 6. 证据清单

每个 checkpoint 至少留一项：

| 级别 | 证据 |
|---|---|
| L0 | 命令原文 + 完整输出 + 退出码 |
| L1 | 技能面板截图 + 安装目录树 |
| L2 | 7 条输入的触发结果表 |
| L3 | 全部命令的退出码 + 数据文件全文 |
| L4 | HTML 文件路径 + 大小 + 外链命中数 + 断网截图 + U1–U7 的逐项截图 |
| L5 | 导出 JSON 全文 + 重渲染后的数据文件 |
| L6 | 每个失败场景的实际报错原文 + 文件 SHA256 对比 |
| L7 | 各环境截图 |
| L8 | 服务地址 + M1–M8 逐项截图 + 「保存」前后磁盘文件比对 + 越界拒绝的报错原文 |

**证据落点**：`dist/e2e-<日期>/`（已被 `.gitignore` 与 `.vscodeignore` 覆盖，不会污染仓库与扩展包）。
**约束**：证据里不得出现密钥 / 凭证；测试数据一律用假路径，不要指向真实项目目录。

---

## 7. 停止条件（出现即停，先记录再决定）

1. **P0 失败**（技能面板里看不到）—— 后面的级别全部无意义。
2. **R1 成立**（脚本找不到）—— 需要先改 `SKILL.md`，改完 L1 起全部重跑。
3. 出现「静默失败」—— 退出码 0 但实际没生效，或报错却改动了文件。
4. 数据文件被破坏到无法复原 —— 立刻停止写入类操作，先备份现场。

**严禁**：为了让某项通过而手改 `traework/lib/`（它是构建产物），或绕过检查直接改结论。

---

## 8. 退出判据与打 tag 决策

| 结果 | 处置 |
|---|---|
| L0–L8 全通过 | 可打 tag 发布；CHANGELOG 把「未发布」转正 |
| L1–L5 通过，L6/L7/L8 有失败 | **不打 tag**；先修失败项。L8 的 M7（越界写入）失败按安全缺陷最高优先级处理 |
| 仅 L0 + L4 通过 | 只声称「数据层与渲染离线可用」，**不声称 TraeWork 端到端可用**；`repo` / `web` 模块仅声称「离线与本地实跑可用」 |
| P0 / L1 / L3 失败 | TraeWork 版事实上不可用，回退到「仓库内文档 + 本地渲染」定位 |

无论结果如何，**结论只写已验证范围**，未跑的项目一律标注「未验证」。

---

## 9. 时间盒与 checkpoint

| 阶段 | 内容 | 停下汇报 |
|---|---|---|
| CP1 | §2 记录表 + §4 安装形态拍板 | 是 |
| CP2 | L0 + L1 + L2 | 是 |
| CP3 | L3 + L4 | 是 |
| CP4 | L5 + L6 + L7 | 是 |
| CP5 | L8（模块窗格与本地服务） | 是 |
| CP6 | 汇总证据，给出退出判据结论 | 是 |

每一档汇报：**通过了什么 / 失败了什么 / 下一步**。不要在失败后自行「想办法绕过」。

---

## 10. 参考

- 官方技能目录约定与 `SKILL.md` 格式：https://docs.trae.cn/ide_skills
- TraeWork 产品内约定（本机取证来源）：`%userprofile%/.trae-cn/builtin/work/default/skills/skill-creator/SKILL.md`
- 本仓库工程纪律：`AGENTS.md`
- TraeWork 产物说明：`traework/README.md`、`traework/SKILL.md`
