# 安装指南（傻瓜版 · Windows）

> 不需要懂命令行。照着一步步做就行，每一步都写了「你会看到什么」。
> 本文只讲**装插件**。想看原理、路由、开发流程，去 [README.zh.md](README.zh.md) 和 [dsh/README.md](dsh/README.md)。

---

## 开始之前，确认三件事

| 检查项 | 怎么确认 |
| --- | --- |
| 系统是 **Windows** | 别的系统目前不支持 |
| 装过 **DeepSeek Harness 桌面端**（DSH） | 开始菜单能搜到、能正常打开 |
| DSH 版本是 **0.2.0-rc.2** 或 **0.2.1-rc.2** | 应用里点开「关于」，或看安装目录名；版本不对插件会被拒绝加载 |

---

## 第 1 步：完整退出 DSH

**在屏幕右下角托盘**找到 DeepSeek Harness 的图标 → **右键 → 退出**。

> ⚠️ 点窗口右上角的 `×` 只是把窗口收起来，**不算退出**。DSH 还在后台跑的话，装插件会失败并报
> `profile "desktop" is managed exclusively by the Electron application`。

保险做法：按 `Ctrl + Shift + Esc` 打开任务管理器，在「进程」里搜 `DeepSeek`，**确认一条都不剩**。

---

## 第 2 步：打开命令行窗口

按 `Win + R` → 弹出「运行」小框 → 输入 `powershell` → 回车。

会出现一个深色（或蓝色）窗口，最后一行是光标在闪，等你输入。**下面的命令都在这个窗口里执行。**

---

## 第 3 步：找到你自己的 `dsh.cmd` 在哪

DSH 的命令行工具叫 `dsh.cmd`，位置固定是：

```
<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd
```

不知道自己的 DSH 装在哪？两种查法，任选：

1. **桌面图标**：右键 DSH 图标 → **打开文件所在位置**，地址栏里那一串就是安装目录；
2. **任务管理器**：`Ctrl + Shift + Esc` → 找到 DSH 进程 → 右键 → **打开文件所在位置**。

常见情况：

| 安装方式 | 安装目录 | 完整路径长相 |
| --- | --- | --- |
| 默认安装 | `C:\Program Files\DeepSeek Harness` | `C:\Program Files\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd` |
| 装到了 D 盘 | `D:\dsh` | `D:\dsh\resources\runtime\cli\bin\dsh.cmd` |

> 下面命令里凡是 `<你的 DSH 安装目录>` 的地方，都换成你上面查到的那个目录。**不要照抄别人的路径。**

---

## 第 4 步：装

### 方式 A：直接按网址装（最省事，需要能访问 GitHub）

在 PowerShell 里粘贴这一整行，回车：

```powershell
& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/download/v0.10.2/trae-usage-worktable-0.10.2.tgz"
```

DSH 会自己去 GitHub 把这个安装包下载下来。

### 方式 B：先下载再装本地文件（GitHub 打不开 / 特别慢时用）

1. 打开 [v0.10.2 Release 页面](https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/tag/v0.10.2)，点 **Assets** 里的
   `trae-usage-worktable-0.10.2.tgz` 下载（245.5 KB）。存到**你自己记得住的目录**，比如 `D:\Downloads`。
2. 在 PowerShell 里粘贴（把路径换成你实际存的位置）：

```powershell
& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "D:\Downloads\trae-usage-worktable-0.10.2.tgz"
```

> 校验下载是否完整（可选）：文件应该是 **251393 字节**，sha256 是
> `aea7d199ebbd0e0316bd7f2eac729e75d83526617ce80f68c005d5ce3d73fe34`。
> 在 PowerShell 里跑 `Get-FileHash "D:\Downloads\trae-usage-worktable-0.10.2.tgz" -Algorithm SHA256` 可以对一下。

---

## 第 5 步：确认装成功了

命令跑完会刷一堆下载信息，最后应该是这类结尾：

```
+ trae-usage-worktable 0.10.2
Done in 12.3s
```

**看到 `0.10.2` 和 `Done` 就是装好了。**

想更确定，再跑这一条（列出已装插件，只读，不影响任何东西）：

```powershell
& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop ls
```

输出里应该有一行：

```
├── trae-usage-worktable@0.10.2
```

> 如果你看到的是 `trae-usage-worktable@link:...`，说明装的是**开发版**（链接到源码目录），不是 Release 版。

---

## 第 6 步：重开 DSH

双击桌面的 DeepSeek Harness 图标。打开后看**左侧边栏**，底部应该出现「**工作台**」卡片。

点它 → 选一个项目 → 左边出现文件 / 终端 / 浏览器等窗格，右边是**真能打字的 DSH 对话**，就全对了。

---

## 出问题了？对照这张表

| 你看到的报错 / 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `profile "desktop" is managed exclusively by the Electron application` | DSH 没退干净 | 回第 1 步：托盘退出 + 任务管理器确认进程全没了 |
| `ERR_PNPM_FETCH_404`、`ETIMEDOUT`、`ECONNRESET`、`fetch failed` | 连不上 GitHub | 改用**方式 B**（先下载再装本地文件） |
| `'dsh' 不是内部或外部命令` | 你敲了 `dsh xxx`，但 PATH 里没有它 | 用完整路径：`& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" ...` |
| 装完侧边栏**没有**「工作台」 | ① DSH 没重开；② profile 里没启用这个 bundle | 先完全退出再开一次；仍没有就把第 5 步 `ls` 的输出发给我 |
| `ls` 里版本不是 0.10.2 | 装的是旧包 | 按第 4 步重装一次（会覆盖旧版本） |
| 报 `Unsupported engine` / 版本不兼容 | DSH 版本不在支持范围 | 升级 DSH 到 `0.2.0-rc.2` 或 `0.2.1-rc.2` |

---

## 升级 / 卸载 / 回滚

**升级**：退出 DSH → 把第 4 步的网址或文件名换成新版本 → 重开。
（新版本会覆盖旧版本，不用先卸。）

**卸载**：退出 DSH，然后：

```powershell
& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop remove trae-usage-worktable
```

**回滚**：装回上一个版本的 tgz 即可，命令和第 4 步形式一样。

---

## 附：这条命令到底在干什么

```powershell
& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd"  plugin --profile desktop  add  "包地址或文件路径"
   └── 调用 DSH 的命令行工具（& 是 PowerShell 的「执行」符号）      └── 往 desktop 这个配置里加插件   └── 装哪个包
```

- 前三段对所有人**都一样**，只有最后的「包地址或文件路径」按情况改。
- `plugin` 后面的参数会原样交给包管理器 pnpm，所以 `add` / `remove` / `ls` 这些用法和 pnpm 一致。
- 想知道还有哪些命令：`& "<你的 DSH 安装目录>\resources\runtime\cli\bin\dsh.cmd" --help`
