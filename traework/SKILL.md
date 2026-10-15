---
name: traework-worktable
description: "把项目收纳成工作台：维护 .worktable/worktable.json（项目增删改排序隐藏、布局预设、外观主题），并渲染出可直接打开的单文件 HTML 工作台。当用户要整理/收纳多个项目、给项目分组排序、切换分栏布局预设、调整工作台外观（模式/背景/强调色/不透明度），或要看一份可视化工作台时使用。不用于 TraeCode 扩展开发，也不用于修改 trae-usage 仓库里的 src/。"
---

# TraeWork 工作台

## 这是什么

两个部分：

- **数据层**：`.worktable/worktable.json` 是单一事实来源，由 `scripts/wt.mjs` 读写。
- **视觉层**：`scripts/render.mjs` 把它组装成**单文件 HTML**（样式与运行时全内联、零外部引用），
  用户双击即可打开，也能丢进 TraeWork 预览。

数据形状与仓库里 TraeCode 扩展共用同一套定义（`src/shared/types.ts`），不另起一套。

## 何时用

- 用户要把一堆项目收纳成一个可排序、可隐藏的清单
- 用户要按项目切换分栏布局（单窗 / 左右分栏 / 田字格 / 顶部大窗）
- 用户要调工作台外观（深色 / 浅色 / 跟随系统、背景预设、强调色、不透明度）
- 用户要一份可视化的工作台视图

## 怎么做

所有命令都以**仓库根目录下的绝对路径**调用 `traework/scripts/wt.mjs`，并显式传 `--file`，
不要依赖当前工作目录：

```
node <仓库根>/traework/scripts/wt.mjs <命令> --file <目标项目目录>/.worktable/worktable.json
```

常用流程：

1. 收纳项目
   `add --folder <路径> [--name <名>] [--icon <图标>]`
2. 调整顺序与可见性
   `move (--id|--name) (--up|--down)`、`hide`、`show`、`remove`、`active`
3. 选布局预设
   `preset (--id|--name) --preset full|l2|g4|l13`
4. 调外观
   `theme [--mode system|dark|light] [--accent #rrggbb] [--opacity 0.3-1] [--background aurora|coast|grid|none]`
5. 出图
   `render [--out <html 路径>]` —— 默认输出到数据文件同目录的 `worktable.html`
6. 汇报
   `list` 查看当前全貌；加 `--json` 得到机器可读结果

改完务必把 `render` 输出的 HTML 路径告诉用户，让用户自己打开。

## 边界

- **不要改** `src/`、`out/`、`media/`、`test/`、`scripts/`——那些是 TraeCode 扩展的产物。
- **不要手改** `traework/lib/`——它是构建产物，由仓库根 `npm run build` 从 `src/` 与 `traework/src/` 生成。
  若确实要改逻辑，改源码后必须重新构建，并跑 `npm run verify:sync` 确认产物与源码同步。
- 数据文件损坏时 CLI 会直接报错并停止，**不会**覆盖原文件；遇到这种报错先让用户确认再处理。
- 页内交互（切项目、切预设、切主题、拖分隔条、切窗格状态）只写浏览器 localStorage，
  要回写数据文件需用户点页内的「导出 JSON」。
