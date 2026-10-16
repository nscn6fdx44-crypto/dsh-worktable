# TraeWork 工作台

同一仓库里 `trae-usage` 的**第二个产物**：面向 **TraeWork** 的工作台，形态是
「**Skill 管数据 + HTML 做视觉**」。

## 为什么不是扩展

TraeCode 支持导入 `.vsix`；**TraeWork 不支持**。TraeWork 的扩展面是**插件**——
面向任务场景封装的能力组件，由智能体在对话中调用，**没有自定义 UI 容器**。
所以侧边栏抽屉、分栏引擎这类 UI 在 TraeWork 里没有宿主可挂，必须换形态：

- 数据与流程 → 走 Skill（`SKILL.md` + CLI）
- 视觉 → 走一个自包含的单文件 HTML，用户自己打开

仓库根目录的 TraeCode 扩展（`src/` `out/` `media/`）**原样保留、互不影响**。

## 目录

| 路径 | 职责 |
|---|---|
| `SKILL.md` | Skill 定义：触发条件与调用方式 |
| `scripts/wt.mjs` | 数据层 CLI，读写 `.worktable/worktable.json` |
| `scripts/render.mjs` | 把数据组装成单文件 HTML |
| `scripts/serve.mjs` | 本地服务：HTML 现渲染 + 项目文件读写 API + 网页反代（`repo` / `web` 模块靠它） |
| `src/main.ts` | 浏览器运行时（页内交互），构建产物为 `lib/app.js` |
| `lib/` | **构建产物，已提交**——`core.mjs` / `app.js` / `styles.css`，Skill 需开箱可用 |
| `test/` | 离线用例：CLI / HTML 结构 / 本地服务 / 产物与源码同步 |

`lib/` 三件套就够跑：CLI 从 `lib/core.mjs` 取纯逻辑，渲染从 `lib/app.js` + `lib/styles.css` 取运行时与样式。
技能目录因此是**自持**的，复制到哪都能独立工作。

## 两种打开方式

| 方式 | 命令 | 产物 | 能力边界 |
|---|---|---|---|
| 单文件 HTML | `render` | 数据文件同目录的 `worktable.html` | 样式与运行时全内联、零外部引用，双击即开；**没有本地后端** |
| 本地服务 | `serve` | `http://127.0.0.1:7331/` | 每次请求现渲染；额外提供项目文件读写与网页反代 |

`repo` / `web` 两类模块**只有走 `serve` 才可用**。在单文件形态下它们会显示「需要本地服务」提示——
这是预期降级，不是故障。

## 窗格模块

窗格可切类型，`slot --kind` 支持六种。前四种是通用兜底，后两种是**项目相关模块**：

| kind | 含义 | 载荷 `content` | 需要 `serve` |
|---|---|---|---|
| `note` | 随手记 | 文本 | 否 |
| `todo` | 待办清单 | `[ ]` / `[x]` 行文本 | 否 |
| `link` | 一个外链 | URL | 否 |
| `placeholder` | 预留占位 | — | 否 |
| `repo` | **仓库**：目录树 + 源码编辑保存 | 相对项目根的路径（`""` = 项目根） | **是** |
| `web` | **网页**：窗格内嵌浏览器 | 目标 URL | **是** |

`repo` 的路径**不区分目录与文件**：是目录就列目录，是文件就开编辑器，改完点「保存」**直接写回磁盘**。
`web` 先在服务端探一次上游状态：可嵌入才内嵌，上游返回 401/403 会给出可读原因，不塞空白框。

所以「给 C 语言练习做一个能看仓库、能改源码的工作台」= `repo` 模块 + `serve`。

## 安装

官方约定，**项目技能**必须在项目下的 `.trae/skills/` 里才会被扫描到
（[docs.trae.cn/ide_skills](https://docs.trae.cn/ide_skills)）。
所以 `traework/` 本身**不是一个技能目录**，需要先安装：

```powershell
npm run traework:install                            # 装到本仓库：<仓库根>\.trae\skills\traework-worktable\
npm run traework:install -- --project <项目目录>     # 装到别的项目
```

装好的技能目录是**自持**的：`SKILL.md` + `scripts/` + `lib/` 三样就够跑，
整体复制到任何位置都能独立工作，不再回头依赖仓库根的 `src/`。

`.trae/` 在本仓库被 `.gitignore` 忽略，所以装好的技能**不进版本库**，换机器要重新安装。

## 数据形状

与 TraeCode 版共用同一套定义（`src/shared/types.ts`），不另起一套：

```json
{
  "version": 1,
  "projects": [{
    "id": "…", "name": "…", "icon": "…", "folder": "…", "hidden": false, "order": 0,
    "status": "working", "duration": "2h", "description": "一句话说明"
  }],
  "activeProjectId": null,
  "presetByProject": { "<projectId>": "l2" },
  "layouts": { "<projectId>::<presetId>": { "presetId": "l2", "leftWidth": 320, "topHeight": 0, "chatWidth": 420, "slots": [] } },
  "theme": { "mode": "system", "accent": "#4f9cf9", "opacity": 0.86, "background": "aurora" }
}
```

`status` 复用窗格的四态域（`idle` / `working` / `needs-you` / `done`），卡片上的状态光与窗格共用一套色板。
`activeProjectId` 为 `null` 表示「未选中任何项目」，主界面右侧显示卡片网格；这是**显式**状态，会被持久化。

每次写入都会补齐布局槽位，所以数据文件始终是**完整状态**，而不是只记了「用户改了什么」。

## 用法

```powershell
$WT = "<技能目录>\scripts\wt.mjs"          # 仓库内开发时即 <仓库根>\traework\scripts\wt.mjs
$FILE = "<项目根>\.worktable\worktable.json"

node $WT add --folder C:\work\alpha --name 甲 --status working --duration 2h --desc "演示项目" --file $FILE
node $WT add --folder C:\work\beta  --name 乙 --file $FILE
node $WT meta --name 乙 --status needs-you --desc "第二个项目" --file $FILE
node $WT slot --name 甲 --window 1 --kind todo --content "[ ] 甲任务`n[x] 已完成" --file $FILE
node $WT slot --name 甲 --window 1 --kind repo --content "" --file $FILE        # 仓库根：目录树 + 源码编辑
node $WT slot --name 甲 --window 2 --kind web --content "https://example.com" --file $FILE
node $WT preset --name 乙 --preset g4 --file $FILE
node $WT theme --accent "#22c55e" --background coast --file $FILE
node $WT active --none --file $FILE          # 清空当前项目 → 主界面显示卡片网格
node $WT list --file $FILE
node $WT render --file $FILE      # 默认产出 <数据文件同目录>\worktable.html
node $WT serve --port 7331 --file $FILE      # 常驻；repo / web 模块靠它，Ctrl+C 结束
```

布局预设：`full` 单窗 / `l2` 左右分栏 / `g4` 田字格 / `l13` 顶部大窗。
`list` 与所有写命令都支持 `--json`。

非法值会被拒绝且不改动数据文件：`theme --background neon`、`theme --opacity 2`、
`meta --status 紫色`、`slot --window 99` 都会报错退出。

## 页内交互

生成的 HTML 是自包含的（样式与运行时全部内联、**零外部引用**），双击即可打开：

- 左栏：列出未隐藏项目（名称、目录、四态状态光），当前项目高亮；点非当前项进入它，点当前项退回网格
- 顶栏：`← 全部项目`（仅在选中项目时出现）、切布局预设、展开外观、导出 JSON
- 右侧：未选中项目 → 项目卡片网格（描述 / 目录·预设·时长 / 状态统计，状态胶囊可点击循环四态）；
  选中项目 → 分栏工作台
- 外观：模式（跟随系统 / 深色 / 浅色）、背景预设、强调色、不透明度
- 窗格：拖分隔条调宽、切标签页、切四态状态光（空闲 / 进行中 / 待你处理 / 完成）
- `repo` 窗格（走 `serve`）：点目录进下一层、点文件进编辑器；编辑器里改完点「保存」**直写磁盘**，
  未保存的草稿按标签页暂存，切走再回来不丢
- `web` 窗格（走 `serve`）：先显示上游探测结果；可嵌入则内嵌，不可嵌入则给出状态码与原因

页内改动只写浏览器 `localStorage`（按种子指纹分键，数据文件一变即失效），
要回写数据文件需点「导出 JSON」。
**例外**：`repo` 窗格的「保存」是直写磁盘，不经 `localStorage`，也不需要导出。

## 构建与验证

```powershell
npm run build            # 仓库根执行：同时产出扩展与 traework/lib（含 lib/styles.css）
npm run check            # 产物语法检查
npm test                 # 扩展 40 例 + traework 72 例（CLI 32 / HTML 结构 10 / 本地服务 30）
npm run verify:sync      # 校验 lib/（含 styles.css）与源码逐字节一致（提交前跑）
npm run traework:install # 安装成项目技能，供 TraeWork 使用
npm run verify:package   # TraeCode 扩展的打包结构断言
```

`verify:sync` 要**单独跑**，不要跟在 `npm run build` 后面——刚构建完当然一致，那样等于没验。
它防的是「改了 `src/` 却忘了重新构建就提交」。

## 已验证范围

- 已验证（离线）：扩展 40 例、CLI 32 例、HTML 结构 10 例、本地服务 30 例、产物同步 3 例全绿；
  渲染产物为单文件、零外链。
- 已验证（本地实跑 · 渲染）：把技能目录整体复制到仓库之外后仍能独立渲染，不依赖仓库根的 `src/`。
- 已验证（本地实跑 · 服务）：对真实 C 项目目录起 `serve` 后，根目录列出 `Project1`–`Project9`；
  `Project9` 子目录列出 `二叉排序树.c` 等；`/api/file` 正确读出该 `.c`（2633 字节、判定为文本）；
  对文件调 `/api/tree` 回 `code: not-a-directory`（前端据此改按文件打开）；
  `/api/probe` 对 runoob 的 C 教程报 `embeddable: true`，对 gitee 仓库页如实报 `status: 403`、`embeddable: false`。
- 已验证（离线 · 服务写盘）：`serve.test.mjs` 覆盖写入落盘、越界拒绝、超限拒绝、反代剥头。
- **未验证**：没有在真实 TraeWork 里安装本 Skill 并端到端跑过；没有在浏览器里实机点测页内交互；
  也没有在真实项目上实跑过 `repo` 的「保存」写盘（写盘路径只在临时目录的离线用例里覆盖）。
  上述结论仅来自离线断言与本地实跑，不宣称端到端可用。
