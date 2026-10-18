# 交接说明 · 单文件工作台 workbench

> 交接时间：2026-10-16
> 交接范围：`workbench/` 这条产物线（与 `traework/` 那条独立，两者交接文档分开）
> 本文自包含，不依赖前序对话。接手前先读仓库根 `AGENTS.md` 与本文。

---

## 0. 一句话现状

`workbench/` 的四条能力线已写完，离线验收全绿，产物已推送到 `feat/workbench` 分支，GitHub Pages 已开启并实测可访问（站点根与工作台页均返回 200）。
没做完的是**真实浏览器里的真人点击验证**：目录授权链路在自动化测试里用的是注入桩，真实句柄的授权行为尚未取证，详见 §9。

---

## 1. 产物身份

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/nscn6fdx44-crypto/dsh-worktable.git` |
| 分支 | `feat/workbench`。`main` 尚未包含本线改动，`behind_by = 0` |
| 本线提交 | `928cc34` 建 `workbench/` 产物 · `2835de8` 项目栏自定义添加与多选移除 · `8ee4280` 零服务扫描 + 兼容模式兜底 · `87d687e` Pages 根入口页（本文档本身是随后的一个 docs 提交） |
| 本地服务端口 | 默认 `7331`，被占用自动递增；交接时本机仍有实例跑在 `7332` 与 `7333` |
| 上游参考 | `https://github.com/Aisland-SJL/dsh-worktable`（只参考内容结构与视觉，未复制源码） |

产物形态有两个，互不干扰：仓库里的 `workbench/` 是发布态，TRAE 工作区是开发态。发布动作就是把工作区的 `index.html`、`serve.mjs`、`启动工作台.bat`、`build/*.mjs`、`build/workbench.template.html` 同步进仓库的 `workbench/`，再提交推送。

---

## 2. 线上地址与 Pages 配置

| 项 | 值 |
|---|---|
| 站点根 | `https://nscn6fdx44-crypto.github.io/trae-usage/` —— 返回 200，用 meta refresh 跳到 `workbench/` |
| 工作台页 | `https://nscn6fdx44-crypto.github.io/trae-usage/workbench/` —— 返回 200，189206 字节 |
| Pages 源 | 分支 `feat/workbench`，文件夹 `/`（根目录） |
| 构建触发 | 推送到该分支后约 30 秒自动重建 |

三条必须记住的约束：

1. Pages 绑在 `feat/workbench` 上，**删除或重命名这个分支会让站点 404**。要换分支，得同步改 Pages 配置。
2. `workbench/index.html` 不在仓库根，根地址靠仓库根的 `index.html` 做跳转。**删掉那个入口页，根地址就会 404。**
3. 仓库根的 `.nojekyll` 关掉了 Jekyll 处理。删掉它，Pages 会重新走 Jekyll 扫整仓库。

---

## 3. 目录与产物结构

`workbench/` 目录：

| 路径 | 职责 |
|---|---|
| `index.html` | 公开版单文件产物（示例数据），Pages 入口 |
| `serve.mjs` | 零依赖本地服务：现读 HTML + 文件读写 API + 端口探测 + 网页反代 + 自定义项目登记 |
| `启动工作台.bat` | Windows 双击启动器 |
| `README.md` | 使用者视角说明，含换机流程、兼容模式、扫描上限 |
| `build/workbench.template.html` | 模板：结构 / 样式 / 运行时，`/*__DATA__*/` 是数据占位符 |
| `build/build.mjs` | 注入本机扫描快照 → `workbench.html`（个人版） |
| `build/build-public.mjs` | 注入示例数据 → `index.html`（公开版） |
| `build/verify.mjs` | 静态校验链 |
| `build/smoke.mjs` | 运行时冒烟，六场景 |
| `build/e2e.mjs` | 真实浏览器端到端（Edge / Chrome headless + CDP） |
| `build/serve.test.mjs` | 服务端路由契约 |

仓库根本次新增或改动：

| 路径 | 职责 |
|---|---|
| `index.html` | Pages 站点根入口页，跳转到 `workbench/` |
| `.nojekyll` | 关闭 Jekyll |
| `.vscodeignore` | 追加 `index.html` 与 `.nojekyll`，避免它们被打进 `.vsix` |

---

## 4. 已完成的四条能力线

### 4.1 主界面与视觉

正方形贴片卡片网格，控制室卡片占 2×2；多层漂移模糊光斑背景叠加网格底纹；深色主题配克制的琥珀金强调色，未用紫蓝渐变；工作中卡片带旋转彗星光环。卡片网格间距 46px，顶部留白加大以保持疏朗。

### 4.2 分栏工作台与窗格

点击卡片进入分栏工作台，布局预设含 `chat`（右侧 AI 对话占大头）。窗格类型为 `note` / `todo` / `link` / `repo` / `web` / `projects`（本地检索）/ `chat`（AI 对话 iframe）。裸地址自动补协议：本机与内网走 `http`，其余走 `https`。探测到站点声明禁止内嵌时给兜底提示，不停在空白页。

### 4.3 项目栏管理

「添加」填名称 / 目录路径 / 语言标签，写入 `localStorage` 的 `wt2.custom`；已连本地服务且填了绝对路径时，会调 `POST /api/register` 把该目录登记进登记表，`repo` 窗格随即可以直接读写它。
「多选」支持勾选 / 全选 / 清空 / 移除，移除需二次确认，**磁盘上的文件不会被删除**。扫描项记入 `wt2.removed` 并可一键恢复，自定义项移除后需重新添加。登记表只增不删。

### 4.4 零服务版：浏览器端扫描本机目录

两条通道，各管一段：

- 原生通道：`showDirectoryPicker` 取目录句柄 → 授权 → 扫描 → 渲染。句柄存 IndexedDB，刷新或下次打开时浏览器把权限降级为待确认，点一次「续期授权」即恢复读写。
- 兼容模式通道：用 `<input webkitdirectory>` 拿一份文件清单，页面在内存里重建目录树，再按同一套规则识别项目。**不依赖目录选择器、不需要任何权限，`file://` 下也能用**，代价是只能只读浏览、刷新后需重扫一次。

项目识别规则：命中 `.git` 或任一工程标记文件（`package.json` / `CMakeLists.txt` / `Cargo.toml` / `go.mod` 等）即认定为项目。被选中的根目录本身也参与判定，所以选中单个项目文件夹会得到 1 个项目。

---

## 5. 扫描的硬预算与跳过名单

遍历设了硬上限，目的是让任意大小的根都能在几秒内返回结果，不出现「点了没反应」：

| 限制项 | 值 |
|---|---|
| 目录数 | 2500 |
| 耗时 | 5 秒 |
| 项目数 | 150 |
| 单项目测量 | 5 秒 |
| 兼容模式文件清单 | 60000 |

遍历为广度优先，避免某一支体量极大（如 `AppData`）吃光预算、让后面的浅层项目轮不到。`Windows` / `Program Files` / `Program Files (x86)` / `ProgramData` / `AppData` / `node_modules` 等 20+ 个系统与缓存目录直接跳过，不参与遍历。超限即停，并在结果行标注已截断。

扫描期间「本机目录」区块实时显示已遍历目录数与最深层数，扫完在结果行写明遍历统计，弹窗给出具体原因。

兼容模式不要选整个盘（如 `C:\`）：浏览器会先把整盘文件枚举完再交给页面，这一步页面拦不住，会卡很久。

---

## 6. 验证链与本轮实测结果

```bash
node build/build-public.mjs       # 示例数据 → index.html
node build/verify.mjs             # 静态校验
node build/smoke.mjs index.html   # 六场景冒烟
node build/e2e.mjs workbench.html # 真实浏览器端到端，需 Edge / Chrome
node build/serve.test.mjs         # 服务端路由契约
```

本轮实测（2026-10-16）：

| 命令 | 结果 |
|---|---|
| `node build/verify.mjs` | 92 项通过 |
| `node build/smoke.mjs index.html` | 六场景全通过 |
| `node build/smoke.mjs workbench.html` | 六场景全通过 |
| `node build/e2e.mjs workbench.html` | 真实 Edge、`file://` 下全部断言通过 |
| `node build/serve.test.mjs` | 全部通过 |

冒烟覆盖的六个场景：快照模式 / 服务模式 / 零服务模式（假目录树 + 假 IndexedDB）/ 直接选中项目文件夹 / 超大根（C:\ 场景）/ 兼容模式（webkitdirectory 文件清单）。

`build/e2e.mjs` 的退出码可能是 1 而断言全绿：沙箱会拦下 Edge 写系统缓存目录（`AppData\Local\Microsoft\...`），报错来自沙箱而不是测试本身。判断看断言输出，不看退出码。

---

## 7. 安全与脱敏边界

- 公开版 `index.html` 用虚构示例数据，项目路径统一为 `D:\projects\...` 占位；`build/verify.mjs` 会断言公开版不含用户名、`C:\Users\`、`LAPTOP-` 等标识，防止误传。
- 个人版 `workbench.html`（内嵌本机真实路径、别名、目录样本）、`workbench.registry.json`、`build/data/` 都在仓库根 `.gitignore` 里，不入库。
- 服务端 `repo` 类读写一律经 `resolveWithin` 钉在已登记项目根内，`..` 与绝对路径拒绝；读取上限 512 KB、写入上限 1 MB、目录列表上限 400 项。
- 零服务模式的路径一律以扫描根加相对路径钉死，不把绝对路径落盘。
- 反代剥掉 `X-Frame-Options` 与 CSP 等封锁头并注入 `<base href>` 修正相对资源；探测同时识别 `X-Frame-Options` 与 CSP `frame-ancestors`。

---

## 8. 已知边界（诚实的近似）

| 项 | 说明 |
|---|---|
| 端口探测 | 浏览器无法枚举本机全端口，只探 27 个常见端口，结果是近似值 |
| 网页内嵌 | 无 Node 反代时退化为直连 iframe；站点声明禁止内嵌时给兜底提示 |
| 写盘 | 句柄模式可读写；兼容模式只能只读浏览 |
| 浏览器门槛 | 原生通道需 Chrome / Edge 86+；兼容模式无版本门槛 |
| 浏览器差异 | `https → http://127.0.0.1` 的请求在 Chrome / Edge 放行，Safari 会拦 |

---

## 9. 未验证项（不得宣称已通过）

1. **真实句柄的授权链路**。`e2e` 注入的是假 `FileSystemDirectoryHandle`，其 `queryPermission` / `requestPermission` 一律返回 `granted`。真实句柄在 `file://` 下的写权限行为没有取证。用户实测反馈过「选完目录才报错」，现象与写权限被拒相符，但根因未坐实。
2. **真实 `webkitdirectory` 的文件清单**。`e2e` 直接注入 `FileList`，没有真的点过系统文件夹选择框。
3. **Pages 线上地址的授权链路**。未在 `https` 地址上点过「选择本机目录」。
4. **跨机实测**。换一台机器扫描本机项目，未跑过。
5. **真实项目上的写盘**。`repo` 窗格的保存只在临时目录的用例里覆盖，没在用户真实项目上写过。
6. **移动端与响应式**。未验证。

---

## 10. 待办与待拍板

| # | 事项 | 现状 |
|---|---|---|
| T1 | 用户在线上地址回测「选择本机目录」与「兼容模式扫描」的实际表现 | 待回测 |
| T2 | 是否把「兼容模式扫描」提为控制室的第一入口，不必先失败一次才出现 | 已提出，未表态 |
| T3 | `feat/workbench` 是否合入 `main` | 未定。按既有约定，`main` 只接收打 tag 的提交 |
| T4 | `docs/handoff.md`（traework 线）里含一条本机绝对路径示例，而仓库是公开的，Pages 开启后该文件同样可直接访问 | 建议脱敏 |

---

## 11. 坑与教训

1. **写权限被拒后不能原地重试**。`await` 之后用户手势已失效，再调 `requestPermission` 必然失败。所以「以只读方式重选」要用户再点一次按钮，不能在同一个手势里链式重试。
2. **重试时不要让次生错误覆盖真实原因**。第一次 `readwrite` 被拒后，第二次调用往往报「缺用户手势」，把「系统不允许写入」这个真实原因盖掉了。实现里保留第一次的错误并常驻显示。
3. **扫描相关的状态更新函数必须完整实现**。曾因 `setScanState` 未定义、异常被 `catch` 吞掉，扫描静默失败、界面毫无反馈。
4. **不要把 IndexedDB 写入排在扫描之前**。数据库一旦无响应，整条链路吊死。改为扫描先跑、句柄持久化后台尽力而为，所有 IndexedDB 操作加 1.5 秒超时。
5. **被选中的根目录本身要参与项目判定**。只把子目录当候选，会让「选中项目根目录」返回 0 个结果。
6. **行尾符会让文件比对失真**。仓库里的 `.mjs` 是 CRLF、工作区是 LF，字节数差恰好等于行数，`git diff --no-index` 因 `autocrlf` 会报「无差异」。比对内容时看 diff 输出，别只看体积。
7. **仓库根的 `index.html` 与 `.nojekyll` 需要手动加进 `.vscodeignore`**，否则会被打进扩展包；`docs/**` 已在里面，所以交接文档不会进包。

---

## 12. 关键文件索引

| 文件 | 作用 |
|---|---|
| `AGENTS.md` | 仓库长期约定，先读 |
| `workbench/README.md` | 使用者视角说明，含换机流程与兼容模式 |
| `workbench/index.html` | 线上产物，Pages 入口 |
| `workbench/build/workbench.template.html` | 唯一的事实来源：结构 / 样式 / 运行时 |
| `workbench/build/build-public.mjs` | 公开版生成脚本，脱敏断言在文件末尾 |
| `workbench/build/verify.mjs` | 静态校验链 |
| `workbench/build/smoke.mjs` | 六场景冒烟 |
| `workbench/build/e2e.mjs` | 真实浏览器端到端 |
| `workbench/build/serve.test.mjs` | 服务端契约 |
| `workbench/serve.mjs` | 本地服务 |
| `docs/handoff.md` | traework 线的交接说明，另一条产物线 |

---

## 13. 交接自检清单

- [ ] 读过 `AGENTS.md`
- [ ] `git log --oneline -4` 在 `feat/workbench` 上能看到 `87d687e` 与 `8ee4280`
- [ ] 站点根与工作台页各返回 200
- [ ] `node build/verify.mjs` 通过
- [ ] `node build/smoke.mjs index.html` 六场景全通过
- [ ] 改动前先跑一次 `node build/serve.test.mjs`
- [ ] §9 的未验证项不得写成「已通过」
