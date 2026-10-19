# Trae Worktable — DSH Plugin

A **DeepSeek Harness (DSH)** side-panel *worktable* plugin: turn your projects into a side-panel app drawer with a dockable split workspace — file browser, editor, terminal, in-app browser, media viewer, notes, custom window and read-only git — all inside DSH.

> 中文说明见 [README.zh.md](README.zh.md) · 当前版本 **0.8.52**

Requires **DSH `0.2.0-rc.2` or `0.2.1-rc.2`** (Windows desktop).

## Install (from Release — recommended)

No build needed. **Fully quit DSH first** (right-click the tray icon → Exit) — otherwise the CLI refuses with `profile "desktop" is managed exclusively by the Electron application`.

**Option A — install straight from the release URL:**

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/download/v0.8.52/trae-usage-worktable-0.8.52.tgz"
```

**Option B — download and install a local file:**

1. Download `trae-usage-worktable-0.8.52.tgz` from the [v0.8.52 release](https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/tag/v0.8.52)
   (128.1 KB, sha256 `d263ec9e917d764e3dd0eef0657ad61671d8a1bbe405648459644954f831da66`)
2. In PowerShell:
   ```powershell
   & "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "C:\path\to\trae-usage-worktable-0.8.52.tgz"
   ```

Then reopen DSH — the **工作台 (Worktable)** panel appears in the sidebar. Verify with `/api/trae-worktable/health` → `"version": "0.8.52"`.

## What's inside

- **Project drawer** — scan, pin, reorder and manage your local projects from the sidebar; auto-adapts to how much room the host sidebar gives it
- **Dockable split workspace** — panes sit left of the conversation and hand the right side back to a *real* DSH chat, resizable and remembered per project
- **Layout presets** — single column / side-by-side / stacked, plus drag-to-resize splits
- **File browser & editor** — browse, open and edit files with a sandbox that blocks credential dirs (`.ssh` / `.aws` / `.env*` …) and path escapes
- **Terminal** — run commands inside your project, with command history
- **Run configs** — one click ▶ feeds a command to the terminal in the project directory, ■ stops it, ports open in a pane
- **In-app browser** — open internal tools and web pages in a docked pane (reachability + iframe-ability probed first)
- **Media pane** — images, PDF, SVG, audio and video, picked from disk or browsed from the project
- **Notes pane** — per-project scratch notes, Ctrl+S / save-on-blur
- **Custom window** — generate and save small HTML tools, preview them in-pane
- **Artifacts** — a `.wt/artifact.json` in a project re-attaches its outputs into panes automatically
- **Overview page** — every project and host session in one place, with search, sorting, filtering and drag-to-pin
- **Read-only git** — quick repo status / log / branches without leaving DSH
- **Keyboard shortcuts**, per-project templates, and JSON import/export for your setup

## Latest changes (0.8.48 → 0.8.52)

All five releases in this range fix the same family of bugs — sidebar sizing and host hand-off geometry:

- **0.8.48** sidebar card now measures the space the host actually gives it (`sideModeOf`) instead of a fixed `46vh / 330px`
- **0.8.49** card no longer covers the host session list — root cause was *overflow*, not z-index: the card refused to shrink (`flex: 0 0 auto`) and spilled over the list
- **0.8.50** opening a file preview no longer makes the workbench cover the whole window (`pickDock` keeps the last good geometry, marks it `stale`, re-measures)
- **0.8.51** when the host anchor cannot be found at all, the dock now falls back to a bounded `is-undocked` box instead of `inset: 0`
- **0.8.52** with the host sidebar expanded, the workbench no longer swallows the sidebar's close/collapse buttons (the fallback box no longer starts at `x = 0`)

Offline suite: host **131** + client **481** assertions, all green.

## Security

- **CSRF guard** — only the local DSH host (localhost) may call plugin routes; cross-origin requests are rejected (403)
- **Sandbox** — write access is confined to registered project roots; `..` and absolute paths are rejected
- **Credential protection** — `.ssh` / `.aws` / `.gnupg` / `.kube` / `.dsh` / `.netrc` / `.env*` / `.npmrc` / `.gitconfig` / `.pki` / `.azure` are blocked
- **SSRF guard** — the web-probe feature refuses link-local and cloud-metadata addresses (`169.254.*`, `fe80::`)
- Reads are *not* sandboxed to project roots by design (see [dsh/README.md](dsh/README.md) for the full disclosure)

## Build from source / developer install

```sh
cd dsh
npm install
npm run build      # produces lib/index.js + lib/client.js
npm test           # offline self-tests (131 host + 481 client assertions)
```

Developer `link` install (after fully quitting DSH):

```powershell
& "D:\dsh\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<repo-root>\dsh"
```

The plugin source lives in the [`dsh/`](dsh) directory. Full documentation — routes, contracts, pitfalls, acceptance checklist: [`dsh/README.md`](dsh/README.md) · hand-off notes: [`dsh/HANDOFF.md`](dsh/HANDOFF.md).

## License

MIT — see [LICENSE](LICENSE).
