# Trae Worktable — DSH Plugin

A **DeepSeek Harness (DSH)** side-panel *worktable* plugin: turn your projects into a side-panel app drawer with a dockable split workspace — file browser, editor, terminal, in-app browser, custom window, and read-only git — all inside DSH.

> 中文说明见 [README.zh.md](README.zh.md)

Requires **DSH `0.2.0-rc.2` or `0.2.1-rc.2`**.

## Install (from Release — recommended)

No build needed. Grab the prebuilt package and add it to DSH:

1. Download `trae-usage-worktable-0.8.11.tgz` from the [v0.8.11 release](https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/tag/v0.8.11)
2. **Fully quit DSH first** (right-click the tray icon → Exit) — otherwise the CLI refuses with `profile "desktop" is managed exclusively by the Electron application`
3. In PowerShell:
   ```powershell
   & "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\path\to\trae-usage-worktable-0.8.11.tgz"
   ```
4. Reopen DSH — the **工作台 (Worktable)** panel appears in the sidebar

## What's inside

- **Project drawer** — scan, pin and manage your local projects from the sidebar
- **Dockable split workspace** — file browser / editor / terminal / browser / custom window / read-only git, arranged in resizable panes
- **File browser & editor** — browse, open and edit files with a sandbox that blocks credential dirs (`.ssh` / `.aws` / `.env*` …) and path escapes
- **Terminal** — run commands inside your project
- **In-app browser** — open internal tools and web pages in a docked pane
- **Custom window** — generate and save small HTML tools, preview them in-pane
- **Read-only git** — quick repo status / log without leaving DSH

## Security

- **CSRF guard** — only the local DSH host (localhost) may call plugin routes; cross-origin requests are rejected (403)
- **Sandbox** — file access is confined to registered project roots; `..` and absolute paths are rejected
- **Credential protection** — `.ssh` / `.aws` / `.gnupg` / `.kube` / `.dsh` / `.netrc` / `.env*` / `.npmrc` / `.gitconfig` / `.pki` / `.azure` are blocked
- **SSRF guard** — the web-probe feature refuses link-local and cloud-metadata addresses (`169.254.*`, `fe80::`)

## Build from source / developer install

```sh
cd dsh
npm install
npm run build      # produces lib/index.js + lib/client.js
npm test           # offline self-tests (host routes + client smoke)
```

Developer `link` install (after fully quitting DSH):

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<repo-root>\dsh"
```

The plugin source lives in the [`dsh/`](dsh) directory. Full documentation: [`dsh/README.md`](dsh/README.md).

## License

MIT — see [LICENSE](LICENSE).
