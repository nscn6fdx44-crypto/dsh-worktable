---
name: traework-worktable
description: "把项目收纳成工作台：维护 .worktable/worktable.json（项目增删改排序隐藏、布局预设、外观主题、窗格模块内容），并渲染出可直接打开的单文件 HTML，或用本地服务打开带仓库浏览/源码编辑/网页内嵌的工作台。当用户要整理/收纳多个项目、给项目分组排序、切换分栏布局预设、调整工作台外观（模式/背景/强调色/不透明度）、在工作台里浏览编辑项目文件或内嵌网页，或要看一份可视化工作台时使用。不用于 TraeCode 扩展开发，也不用于修改 trae-usage 仓库里的 src/。"
---

# TraeWork 工作台

## 这是什么

两个部分：

- **数据层**：`.worktable/worktable.json` 是单一事实来源，由 `scripts/wt.mjs` 读写。
- **视觉层**：两种打开方式，按需要选：
  - `render` → **单文件 HTML**（样式与运行时全内联、零外部引用），双击即开，零依赖。
  - `serve` → **本地服务**（`http://127.0.0.1:7331`），页面每次请求现渲染，并提供
    项目文件读写与网页反代。**仓库 / 网页两类模块只有走 `serve` 才可用**。

数据形状与仓库里 TraeCode 扩展共用同一套定义（`src/shared/types.ts`），不另起一套。

## 窗格模块：不只是占位

每个窗格可切类型，`--kind` 支持六种。前四种是通用兜底，后两种是**项目相关模块**：

| kind | 含义 | 载荷 `content` | 需要 `serve` |
|---|---|---|---|
| `note` | 随手记 | 文本 | 否 |
| `todo` | 待办清单 | `[ ]` / `[x]` 行文本 | 否 |
| `link` | 一个外链 | URL | 否 |
| `placeholder` | 预留占位 | — | 否 |
| `repo` | **仓库**：目录树 + 源码编辑保存 | 相对项目根的路径（`""` = 项目根） | **是** |
| `web` | **网页**：窗格内嵌浏览器 | 目标 URL | **是** |

`repo` 的路径**不区分目录与文件**：是目录就列目录，是文件就开编辑器，改完点「保存」直接写回磁盘
（写前先探上游状态，越界路径与超限内容都会被服务端拒绝）。
`web` 先在服务端探一次上游状态：可嵌入才内嵌；上游返回 401/403 等会直接给出原因，
不塞一个空白框。反代只转发正文，并剥掉 `X-Frame-Options` / CSP 等封锁头。

所以「给 C 语言练习做一个能看仓库、能改源码的工作台」= `repo` 模块 + `serve`。

## 何时用

- 用户要把一堆项目收纳成一个可排序、可隐藏的清单
- 用户要按项目切换分栏布局（单窗 / 左右分栏 / 田字格 / 顶部大窗）
- 用户要调工作台外观（深色 / 浅色 / 跟随系统、背景预设、强调色、不透明度）
- 用户要一份可视化的工作台视图
- 用户要在工作台里直接浏览/编辑项目文件，或内嵌一个网页

## 怎么做

所有命令都以**本技能目录下的绝对路径**调用 `scripts/wt.mjs`（本技能目录 = 本 `SKILL.md` 所在目录），
并显式传 `--file`，不要依赖当前工作目录：

```
node <技能目录>/scripts/wt.mjs <命令> --file <项目根>/.worktable/worktable.json
```

数据文件放在**当前项目根目录**下的 `.worktable/worktable.json`，不要写进技能目录。

常用流程：

1. 收纳项目
   `add --folder <路径> [--name <名>] [--icon <图标>] [--status idle|working|needs-you|done] [--duration <文本>] [--desc <文本>]`
2. 调整顺序与可见性
   `move (--id|--name) (--up|--down)`、`hide`、`show`、`remove`、`active (--id|--name|--none)`
3. 改项目信息
   `meta (--id|--name) [--status idle|working|needs-you|done] [--duration <文本>] [--desc <文本>]`
4. 写窗格内容
   `slot (--id|--name) --window <序号> [--preset <预设>] [--kind note|todo|link|placeholder|repo|web] [--title <标题>] [--content <文本> | --content-file <路径>] [--status idle|working|needs-you|done]`
5. 选布局预设
   `preset (--id|--name) --preset full|l2|g4|l13`
6. 调外观
   `theme [--mode system|dark|light] [--accent #rrggbb] [--opacity 0.3-1] [--background aurora|coast|grid|none]`
7. 出图 / 起服务
   - `render [--out <html 路径>]` —— 默认输出到数据文件同目录的 `worktable.html`（零依赖单文件）
   - `serve [--port <端口>] [--host <地址>]` —— 默认 `127.0.0.1:7331`，**常驻**；仓库 / 网页模块要靠它
8. 汇报
   `list` 查看当前全貌；加 `--json` 得到机器可读结果

用了 `repo` / `web` 就必须用 `serve`，并把服务打印出的地址告诉用户；其余情况用 `render` 出单文件即可。
两种方式都**不要把 HTML 内容贴进对话**，让用户自己打开。

## 界面怎么读

渲染出的主界面分左右两块：

- **左栏**：列出所有未隐藏项目（名称、目录、四态状态光），当前项目高亮。
- **右侧**：`activeProjectId` 为空时是**各项目的卡片网格**（名称、描述、目录·预设·时长、状态统计）；
  有当前项目时是**分栏工作台**（预设舞台 + 会话窗）。
- 退出当前项目有两种方式：再点一次左栏里已高亮的那个项目，或点顶栏的「← 全部项目」。

所以「想看到卡片总览」就把当前项目清掉：`active --none`。

## 边界

- **不要手改** `scripts/` 与 `lib/`——它们由源码构建生成。要改逻辑得改源码后重新构建，
  并跑 `npm run verify:sync` 确认产物与源码同步（仅当手上有源码仓库时可用）。
- 这个技能只读写 `.worktable/worktable.json` 与它渲染出的 HTML；`serve` 起来后还会读写
  **数据文件里登记过的项目目录**（`repo` 模块的保存动作），路径一律被钉在项目根内。
  除此之外不要碰其他文件。
- 单文件 HTML（`render` 产物）没有本地后端，`repo` / `web` 会显示「需要本地服务」提示——
  这是预期行为，不要当成故障。
- 数据文件损坏时 CLI 会直接报错并停止，**不会**覆盖原文件；遇到这种报错先让用户确认再处理。
- 非法主题值（如 `--background neon`、`--opacity 2`）会被拒绝且**不改动文件**。
  报错时如实转述，不要自行换成合法值重试。
- 项目级字段同样按域校验：`--status` 只接受 `idle|working|needs-you|done`，非法值会被拒绝且不改动文件。
- `slot --window` 从 1 起且不得超过该预设的窗口数；越界会报出合法范围并拒绝写入。
- 页内交互（切项目、切预设、切主题、拖分隔条、切窗格状态）只写浏览器 localStorage，
  要回写数据文件需用户点页内的「导出 JSON」。
  **例外**：`repo` 模块的「保存」是直写磁盘，不在 localStorage 里，也不需要导出。
