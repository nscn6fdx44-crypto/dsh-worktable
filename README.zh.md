# Trae Worktable

把项目收纳成侧边栏应用抽屉，并提供可停靠的分栏工作区与统一外观系统。

本仓库是开源项目 [`Aisland-SJL/dsh-worktable`](https://github.com/Aisland-SJL/dsh-worktable)（MIT）在 **TraeCode IDE 上的独立复刻实现**。复刻范围为 **C1「视觉骨架派」**：抽屉 + 布局预设 + 外观主题 + 工程配套。功能设计参考上游，代码为独立编写。

仓库同时产出**两个形态**，互不影响：

| 产物 | 载体 | 说明 |
|---|---|---|
| TraeCode 扩展 | `.vsix` | 根目录的 `src/` `out/` `media/`，即下文全部内容 |
| TraeWork 工作台 | Skill + 单文件 HTML | 见 [`traework/`](traework/README.md)：Skill 管数据、HTML 做视觉 |

TraeWork **不支持**导入 `.vsix`，其扩展面是面向任务场景的插件 / Skill，没有自定义 UI 容器，
因此工作台在 TraeWork 侧换了形态实现（数据走 CLI，视觉走自包含 HTML）。

---

## 功能

### M1 · 侧边栏应用抽屉

活动栏新增「工作台」容器，内含两个视图：

| 视图 | 内容 |
|---|---|
| **项目** | 当前可见的工作台项目，按自定义顺序排列 |
| **已隐藏** | 被隐藏的项目，可随时取消隐藏 |

每个项目可执行：添加（选择目录）、重命名、更换图标（22 个内置图标）、上移 / 下移、隐藏 / 取消隐藏、移除、在文件管理器中打开。

> 移除只把项目从工作台摘除，**不会删除磁盘上的目录**，且需要二次确认。

### M4 · 布局预设

| 预设 | id | 结构 |
|---|---|---|
| 单窗 | `full` | 1 个内容窗 + 右侧会话窗 |
| 左右分栏 | `l2` | 左栏 1 + 主行 1 + 右侧会话窗 |
| 田字格 | `g4` | 顶行 2 + 主行 2 + 右侧会话窗 |
| 顶部大窗 | `l13` | 顶部大窗 1 + 底部三小窗 + 右侧会话窗 |

约定：

- 窗口编号顺序恒为 **左栏 → 顶行 → 主行**
- 聊天窗恒在最右侧，不计入 `contentCount`
- 每个项目独立记忆当前预设；分隔条可拖拽，宽度 / 高度按「项目 × 预设」记忆
- 每个窗格支持多标签页；标签页可在 **笔记 / 待办 / 链接 / 占位** 四种形态间切换

### M11 · 外观与主题

- 毛玻璃卡片 + 蓝图网格底纹
- 明暗三态：跟随系统 / 深色 / 浅色
- 强调色取色器 —— 自动推导霓虹光的 RGB 分量与前景墨色，保证可读性
- 面板不透明度实时可调（30%–100%）
- 四套背景预设：极光 / 海岸 / 网格 / 无
- 窗格四态状态光（点击窗格标题栏的状态标签循环切换）：

| 状态 | 视觉 |
|---|---|
| 空闲 | 常规描边 |
| 进行中 | 强调色描边 + 外发光 + **旋转彗星** |
| 待你处理 | 琥珀色描边 + 外发光 |
| 完成 | 绿色描边 + 外发光 |

### M12 · 工程配套

- **更新检查**：只读请求 GitHub Releases，**只提示、不自动升级**；发现新版本可一键「复制升级提示」交给 AI 助手执行升级
- **变更日志**：命令直接打开 `CHANGELOG.md`
- **离线回归测试**：布局预设 / 状态归一化 / 打包结构，全部不触网
- **`npm run verify:package`**：离线计算打包清单并做结构断言

---

## 安装

### 开发调试

```bash
npm install
npm run build
```

然后在 VS Code / TraeCode 中按 `F5` 启动扩展开发宿主，活动栏即会出现「工作台」图标。

### 打包安装

```bash
npm run pack          # 构建 + 检查 + 测试 + 出 .vsix
```

产出的 `.vsix` 通过「从 VSIX 安装…」装入即可。

---

## 命令

| 命令 | 标题 | 说明 |
|---|---|---|
| `traeWorktable.addProject` | 添加项目 | 选择目录加入工作台 |
| `traeWorktable.openWorktable` | 打开工作台 | 打开分栏工作区面板 |
| `traeWorktable.pickLayout` | 选择布局预设 | 为当前项目切换预设 |
| `traeWorktable.renameProject` | 重命名项目 | |
| `traeWorktable.changeIcon` | 更换图标 | |
| `traeWorktable.moveProjectUp` / `moveProjectDown` | 上移 / 下移 | |
| `traeWorktable.hideProject` / `showProject` | 隐藏 / 取消隐藏 | |
| `traeWorktable.removeProject` | 移除项目 | 二次确认，不动磁盘 |
| `traeWorktable.revealProjectFolder` | 在文件管理器中打开 | |
| `traeWorktable.showChangelog` | 变更日志 | |
| `traeWorktable.checkUpdates` | 检查更新 | |
| `traeWorktable.copyUpgradePrompt` | 复制升级提示 | |

## 设置

| 配置项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `traeWorktable.theme.mode` | `system` / `dark` / `light` | `system` | 外观模式 |
| `traeWorktable.theme.accent` | 十六进制色值 | `#4f9cf9` | 强调色 |
| `traeWorktable.theme.opacity` | 0.3–1 | `0.86` | 卡片与面板不透明度 |
| `traeWorktable.theme.background` | `aurora` / `coast` / `grid` / `none` | `aurora` | 背景预设 |
| `traeWorktable.updateCheck.enabled` | 布尔 | `true` | 是否启用更新检查 |

工作区面板顶栏的「外观」按钮可展开同一组设置的图形化控件，改动会写回上述配置项（全局作用域）。

---

## 工程命令

```bash
npm run build            # esbuild 双端构建 + 复制样式
npm run check            # node --check 构建产物
npm test                 # 离线回归（自动先 build）
npm run verify:package   # 离线打包结构断言
npm run verify:sync      # 校验 traework/lib 与源码逐字节一致（提交前单独跑）
npm run traework:install # 把 TraeWork 工作台安装成项目技能（.trae/skills/traework-worktable/）
npm run pack             # 构建 + 检查 + 测试 + 出 .vsix
npm run typecheck        # tsc --noEmit（需先 npm install）
```

---

## 范围边界

本版本是「视觉骨架派」子集，**不含**以下模块：

| 未实现 | 原因 |
|---|---|
| M2 项目 ↔ 会话绑定 | 依赖宿主会话切换 API，TraeCode 侧不存在等价能力 |
| M3 分栏引擎的宿主联动 | 本版本只做纯前端分栏，未接宿主窗格 |
| M5–M8 真实窗格（文件 / 终端 / 浏览器 / 自定义窗口 + 产物挂载） | 依赖宿主私有 API |
| M9 控制室看板 | 依赖宿主会话状态快照订阅 |
| M10 点击批注 | 依赖宿主输入框桥接 |

窗格内容目前为纯前端实现（笔记 / 待办 / 链接 / 占位），会话窗格为占位。

## 隐私

- 所有状态存于 VS Code `globalState`
- **不读写任何 TRAE 原始数据文件**，不上传任何本地数据
- 唯一的网络请求是更新检查（只读 GitHub Releases），可在设置中关闭

## 许可证

MIT。见 [LICENSE](LICENSE)。
