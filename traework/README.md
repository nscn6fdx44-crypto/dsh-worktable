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
| `src/main.ts` | 浏览器运行时（页内交互），构建产物为 `lib/app.js` |
| `lib/` | **构建产物，已提交**——Skill 需开箱可用，不能要求用户先构建 |
| `test/` | 离线用例：CLI / HTML 结构 / 产物与源码同步 |

## 数据形状

与 TraeCode 版共用同一套定义（`src/shared/types.ts`），不另起一套：

```json
{
  "version": 1,
  "projects": [{ "id": "…", "name": "…", "icon": "…", "folder": "…", "hidden": false, "order": 0 }],
  "activeProjectId": "…",
  "presetByProject": { "<projectId>": "l2" },
  "layouts": { "<projectId>::<presetId>": { "presetId": "l2", "leftWidth": 320, "topHeight": 0, "chatWidth": 420, "slots": [] } },
  "theme": { "mode": "system", "accent": "#4f9cf9", "opacity": 0.86, "background": "aurora" }
}
```

每次写入都会补齐布局槽位，所以数据文件始终是**完整状态**，而不是只记了「用户改了什么」。

## 用法

```powershell
$WT = "<仓库根>\traework\scripts\wt.mjs"
$FILE = "<目标项目目录>\.worktable\worktable.json"

node $WT add --folder C:\work\alpha --name 甲 --file $FILE
node $WT add --folder C:\work\beta  --name 乙 --file $FILE
node $WT preset --name 乙 --preset g4 --file $FILE
node $WT theme --accent "#22c55e" --background coast --file $FILE
node $WT list --file $FILE
node $WT render --file $FILE      # 默认产出 <数据文件同目录>\worktable.html
```

布局预设：`full` 单窗 / `l2` 左右分栏 / `g4` 田字格 / `l13` 顶部大窗。
`list` 与所有写命令都支持 `--json`。

## 页内交互

生成的 HTML 是自包含的（样式与运行时全部内联、**零外部引用**），双击即可打开：

- 顶栏：切项目、切布局预设、展开外观、导出 JSON
- 外观：模式（跟随系统 / 深色 / 浅色）、背景预设、强调色、不透明度
- 窗格：拖分隔条调宽、切标签页、切四态状态光（空闲 / 进行中 / 待你处理 / 完成）

页内改动只写浏览器 `localStorage`（按种子指纹分键，数据文件一变即失效），
要回写数据文件需点「导出 JSON」。

## 构建与验证

```powershell
npm run build            # 仓库根执行：同时产出扩展与 traework/lib
npm run check            # 产物语法检查
npm test                 # 扩展 29 例 + traework CLI/渲染 26 例
npm run verify:sync      # 校验 lib/ 与源码逐字节一致（提交前跑）
npm run verify:package   # TraeCode 扩展的打包结构断言
```

`verify:sync` 要**单独跑**，不要跟在 `npm run build` 后面——刚构建完当然一致，那样等于没验。
它防的是「改了 `src/` 却忘了重新构建就提交」。

## 已验证范围

- 已验证：CLI 19 例、HTML 结构 7 例、产物同步 2 例全绿；渲染产物为单文件、零外链、约 31 KB。
- **未验证**：没有在真实 TraeWork 里安装本 Skill 并端到端跑过；也没有在浏览器里实机点测过页内交互。
  上述结论仅来自离线断言，不宣称端到端可用。
