# Trae Worktable —— DSH 插件

DeepSeek Harness（DSH）侧边栏**工作台**插件：把你的项目收纳成侧边栏应用抽屉，提供可停靠的分栏工作区——文件浏览、编辑器、终端、内置浏览器、自定义窗口与只读 git——全部在 DSH 内完成。

> 英文说明见 [README.md](README.md)

需要 **DSH `0.2.0-rc.2` 或 `0.2.1-rc.2`**。

## 安装（从 Release，推荐）

无需构建。下载预构建包，装进 DSH 即可：

1. 从 [v0.8.11 Release](https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/tag/v0.8.11) 下载 `trae-usage-worktable-0.8.11.tgz`
2. **先完整退出 DSH**（右键托盘图标 → 退出）——否则 CLI 会报错 `profile "desktop" is managed exclusively by the Electron application`
3. 在 PowerShell 执行：
   ```powershell
   & "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\路径\trae-usage-worktable-0.8.11.tgz"
   ```
4. 重开 DSH —— 侧边栏即出现「工作台」面板

## 功能

- **项目抽屉**——从侧边栏扫描、固定、管理本机项目
- **可停靠分栏工作区**——文件浏览 / 编辑器 / 终端 / 浏览器 / 自定义窗口 / 只读 git，分栏可拖拽缩放
- **文件浏览与编辑**——带沙箱，拦截凭证目录（`.ssh` / `.aws` / `.env*` 等）与越界路径
- **终端**——在项目里跑命令
- **内置浏览器**——在停靠窗格里打开内部工具与网页
- **自定义窗口**——生成并保存小型 HTML 工具，窗格内预览
- **只读 git**——离开 DSH 也能快速看仓库状态 / 日志

## 安全

- **防 CSRF**——仅本机 DSH（localhost）可调用插件路由，跨域请求一律 403
- **沙箱**——文件访问限定在已注册的项目根目录，`..` 与绝对路径被拒
- **凭证保护**——`.ssh` / `.aws` / `.gnupg` / `.kube` / `.dsh` / `.netrc` / `.env*` / `.npmrc` / `.gitconfig` / `.pki` / `.azure` 均被拦截
- **SSRF 防护**——网页探测功能拒绝链路本地与云元数据地址（`169.254.*`、`fe80::`）

## 从源码构建 / 开发者安装

```sh
cd dsh
npm install
npm run build      # 产出 lib/index.js + lib/client.js
npm test           # 离线自测（host 路由 + client 冒烟）
```

开发者 `link` 安装（需先完整退出 DSH）：

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<仓库根目录>\dsh"
```

插件源码位于 [`dsh/`](dsh) 目录。完整文档见 [`dsh/README.md`](dsh/README.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
