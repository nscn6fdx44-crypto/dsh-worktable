# workbench —— 单文件工作台

本仓库的**第三个产物**：把工作台压成**一个自包含 HTML** + **一个零依赖本地服务**，面向「不装扩展、不装 Skill，打开就能用」的场景。

与 `traework/` 的关系：两者功能同源（项目卡片网格 / 控制室 / 分栏工作台 / 本地服务），但形态不同。

| | `traework/` | `workbench/` |
|---|---|---|
| 数据 | Skill 管数据，`.worktable/worktable.json` | 快照数据内嵌进单文件 |
| 视觉 | 渲染管线（`render.mjs` + `lib/` 三件套） | 模板 + 运行时全内联 |
| 打开 | 需先 `npm run traework:install` 装成项目技能 | 双击 HTML 即可，无构建、无依赖 |

## 在线打开

GitHub Pages：`https://nscn6fdx44-crypto.github.io/trae-usage/workbench/`

Pages 是纯静态托管，能力边界为**只读快照**：卡片网格、控制室、分栏工作台、本地检索、AI 对话内嵌都可用；
端口探测 / 一键重扫 / 文件读写 / 网页反代 / 自定义项目登记依赖本地服务，静态站点下自动降级为可读提示。

## 项目栏管理

左侧「项目」栏自带两个入口：

| 入口 | 行为 |
|---|---|
| **添加** | 弹窗填名称 / 目录路径 / 语言标签，写入浏览器 `localStorage`；已连本地服务且填了绝对路径时，会调用 `POST /api/register` 把该目录登记进登记表，`repo` 窗格随即可以直接读写它 |
| **多选** | 行内出现复选框，点行即勾选；工具条提供「全选 / 清空 / 移除」。移除需二次确认，**磁盘上的文件不会被删除** |

移除只影响工作台的可见列表：自定义项从 `localStorage` 摘掉（需重新添加），扫描项记入 `wt2.removed`。
只要存在被移除的扫描项，项目栏顶部就会出现「已移除 N 个扫描项目 · 全部恢复」，一键还原。
登记表只增不删，因此恢复后 `repo` 窗格依旧可读写。

## 目录

| 路径 | 职责 |
|---|---|
| `index.html` | **产物**：公开版单文件（示例数据），Pages 入口 |
| `serve.mjs` | 本地服务：零依赖 Node，现读 HTML + 项目文件读写 API + 端口探测 + 网页反代 + 自定义项目登记 |
| `启动工作台.bat` | Windows 双击启动器 |
| `build/workbench.template.html` | 模板：结构 / 样式 / 运行时，`/*__DATA__*/` 为数据占位符 |
| `build/build-public.mjs` | 注入示例数据生成 `index.html` |
| `build/verify.mjs` | 静态校验：自包含 / 数据契约 / 视觉回归 / 公开版零本机标识 |
| `build/smoke.mjs` | 运行时冒烟：快照模式 + 服务模式双场景 |
| `build/serve.test.mjs` | 服务端路由契约 |

## 两种打开方式

| 方式 | 命令 | 产物 | 能力边界 |
|---|---|---|---|
| 直接打开 | 双击 `index.html` | 仓库内的 `index.html` | 只读快照；连真实目录需 Chrome / Edge + 安全上下文（`https` 或 `http://127.0.0.1`） |
| 本地服务 | `node serve.mjs`，或双击 `启动工作台.bat` | 每次请求现读 HTML | 全能力：读写 / 端口探测 / 重扫 / 反代 |

本地服务默认监听 `7331`，被占用时自动递增；未提供 `workbench.registry.json` 时以空登记表启动，
扫描根由 `os.homedir()` 推导。

## 命令

```bash
node build/build-public.mjs       # 生成 index.html
node build/verify.mjs             # 静态校验（无个人版数据时自动只校验公开版）
node build/smoke.mjs index.html   # 双场景冒烟
node build/serve.test.mjs         # 服务端契约
```

## 安全边界

- `repo` 类读写一律经 `resolveWithin` 钉在已登记项目根内，`..` 与绝对路径拒绝；读取上限 512 KB、写入上限 1 MB、目录列表上限 400 项
- `POST /api/register` 只接受**已存在目录的绝对路径**（相对路径、文件路径、不存在的路径分别 400 / 400 / 404），且只增不删
- 反代剥掉 `X-Frame-Options` / CSP 等内嵌封锁头，并注入 `<base href>` 修正相对资源
- 探测同时识别 `X-Frame-Options` 与 CSP `frame-ancestors`，站点声明禁止内嵌时直接给兜底提示，不停在空白页

## 隐私

`index.html` 用的是**虚构示例数据**，项目路径统一为 `D:\projects\...` 占位，不含任何真实用户信息。
`build/verify.mjs` 会断言公开版不含用户名、`C:\Users\`、`LAPTOP-` 等标识，防止误传。

个人版产物（内嵌本机真实路径、别名与目录样本）为 `workbench/workbench.html` 与 `workbench.registry.json`，
两者已在仓库根 `.gitignore` 中排除，不入库。
