# Trae Worktable — DSH Plugin

A **DeepSeek Harness (DSH)** side-panel *worktable* plugin: turn your projects into a side-panel app drawer with a dockable split workspace — file browser, real terminal, in-app browser, media viewer, notes, custom window (including hosting a local
`.html` file), and full git/GitHub management — all inside DSH.

> 中文说明见 [README.zh.md](README.zh.md) · 当前版本 **0.10.7**

Requires **DSH `0.2.0-rc.2` or `0.2.1-rc.2`** (Windows desktop).

## Install (from Release — recommended)

> 🔰 **Not comfortable with the command line?** Follow the step-by-step walkthrough: **[INSTALL.md](INSTALL.md)** (Chinese, every step with what you should see on screen).

No build needed. **Fully quit DSH first** (right-click the tray icon → Exit) — otherwise the CLI refuses with `profile "desktop" is managed exclusively by the Electron application`.

The CLI lives at `<your DSH install dir>\resources\runtime\cli\bin\dsh.cmd` — substitute your own path everywhere below (e.g. `D:\dsh\...` or `C:\Program Files\DeepSeek Harness\...`).

**Option A — install straight from the release URL** (DSH downloads the asset itself):

```powershell
& "<your DSH install dir>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/download/v0.10.7/trae-usage-worktable-0.10.7.tgz"
```

**Option B — download the file and install it locally** (use this if GitHub is slow or blocked):

1. Download `trae-usage-worktable-0.10.7.tgz` from the [v0.10.7 release](https://github.com/nscn6fdx44-crypto/dsh-worktable/releases/tag/v0.10.7) to any folder you like
   (253.6 KB, sha256 `ec609bc94ef1621adf1fa01506b602eb7e8f952624a0b34bbab67c2f86d25b70`)
2. In PowerShell — replace the path with wherever **you** saved it:
   ```powershell
   & "<your DSH install dir>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "<full path to>\trae-usage-worktable-0.10.7.tgz"
   ```

Then reopen DSH — the **工作台 (Worktable)** panel appears in the sidebar. Verify with `/api/trae-worktable/health` → `"version": "0.10.7"`.

## What's inside

- **Project drawer** — scan, pin, reorder and manage your local projects from the sidebar; auto-adapts to how much room the host sidebar gives it
- **Dockable split workspace** — panes sit left of the conversation and hand the right side back to a *real* DSH chat, resizable and remembered per project
- **Layout presets** — six of them: single / side-by-side / stacked / top-row + two / three columns / 2×2, each with drag-to-resize splits; drag a tab onto another pane to swap them
- **File browser** — browse and open files (by type: media pane, custom window for `.html`, OS default program for
  everything else) inside a sandbox that blocks credential dirs (`.ssh` / `.aws` / `.env*` …) and path escapes
- **Terminal** — a real PTY (xterm.js + the host's own node-pty): `vim`, `top`, `ssh` and REPLs work, `Ctrl+C` reaches the foreground process; falls back to one-process-per-command if the native module is unavailable
- **Run configs** — one click ▶ feeds a command to the terminal in the project directory, ■ stops it, ports open in a pane
- **In-app browser** — open internal tools and web pages in a docked pane (reachability + iframe-ability probed first)
- **Media pane** — images, PDF, SVG, audio and video, picked from disk or browsed from the project
- **Notes pane** — per-project scratch notes, Ctrl+S / save-on-blur
- **Custom window** — generate and save small HTML tools, preview them in-pane
- **Artifacts** — a `.wt/artifact.json` in a project re-attaches its outputs into panes automatically
- **Overview page** — every project and host session in one place, with search, sorting, filtering and drag-to-pin
- **Git & GitHub** — stage / commit / push / pull / branches / tags / history and diffs in a dedicated pane;
  log in to GitHub (or it reuses the credentials git already has), create a repo from a local project, and clone
  private or public repos with live progress
- **Keyboard shortcuts**, per-project templates, and JSON import/export for your setup
- **Drag to chat** — drop a file row or a browser URL on the top bar and it lands in the chat input as a ready-to-send block

## Latest changes (0.8.48 → 0.10.7)

- **0.10.7** dropping a local `.html` file straight into a **custom window** now works, and it no longer leaves the
  host's full-window "drop here" overlay stuck on screen. That overlay is pure decoration — `pointer-events: none`,
  no buttons at all — and it only closes when the host handles the `drop` itself (there is no `dragend` for drags
  coming from Explorer), so swallowing the drop left it hanging there forever, immune to clicks and `Esc`. We now
  mute the host's `dragenter` in the **capture** phase while the pointer is over the workbench, and hand it a
  synthetic `dragleave` if it did light up. Preview iframes also stop running `alert` / `confirm` modals.
- **0.10.6** three UI changes. (1) The **editor pane is gone** — it duplicated the host editor and your OS default
  program; files now route by type: images / PDF / audio / video → media pane, `.html` → a custom window, everything
  else → the OS default program. Stale `editor` tabs from older versions are migrated away on load.
  (2) **Project tabs scroll horizontally** — `‹ ›` arrows appear on overflow, the wheel scrolls sideways, switching to
  an off-screen tab brings it back, and a thin scrollbar sits at the bottom.
  (3) **Custom windows can hold a local HTML file** — new `kind:'file'` plus `GET /asset/<dir-token>/<rel>`, so css /
  js / images next to it still load (which `srcDoc` cannot do). Only web-asset types are served, `../` is rejected,
  and the page runs inside a CSP sandbox.
- **0.10.5** the project name now **matches the session name shown in the sidebar**. That name is folded by the
  host from the *whole* event log (the `session/title` event sits at the very beginning), while we scanned only the
  last 400 events and read nothing at all for cold sessions — so we fell back to the working-directory name, and the
  default workspace is literally called `default-workspace`. We now call `sessionQuery.readTitleSnapshots` in one
  batch (60s cache) and flag each row with `titled` to tell a real name apart from a directory fallback.
- **0.10.4** dragging a DSH session in now **names the project for you**: the host only supplies the session id,
  so we look it up in `/sessions` (creating first and renaming once the snapshot arrives if needed); dropping onto a
  project **binds** the session to it instead of creating another one. Also fixes `effectAllowed=move` vs
  `dropEffect=copy` making Chromium skip the drop event entirely.
- **0.10.3** the clone dialog can **browse for a destination**: a「浏览…」button next to the path opens an inline
  directory tree (arrow up, refresh, one-click apply). Only subdirectories are listed, and a location that is
  readable but not writable is flagged red with the confirm button disabled.
- **0.10.2** the editor **gutter shows git changes**: green = added, amber = modified, red stub = deleted,
  plus a `+n ~n −n` counter. Derived from `git diff -U0` against HEAD (minimal hunks), recomputed after save;
  files outside a repo simply show no markers.
- **0.10.1** **un-initialize a repo** (delete `.git`): only `.git` is removed, project files stay untouched.
  Three server-side guards — explicit confirm, must be the repo root, `.git` must be a directory.
- **0.10.0** git goes from read-only to a complete workflow: a dedicated **Source Control** pane (staged / unstaged /
  untracked, inline diff, commit, push, branch & tag management, history with soft reset), **GitHub sign-in**
  (auto-detects credentials git already has, or paste a token), **create a repo from a project and push**, and
  **clone** with live NDJSON progress. Tokens never appear in argv and are stored 0600.

- **0.9.0** three gaps against upstream closed at once: **real PTY terminal** (borrows the host's own `node-pty`, so `vim` / `top` / `ssh` / REPLs work and `Ctrl+C` reaches the foreground process; degrades to command mode with a readable reason if the native module is missing), **six layout presets** (adds top-row + two, three columns, and 2×2), and **drag tabs across panes**
- **0.8.53** drag & drop into the conversation: drag a file from the file browser, or a URL from the browser address bar, onto the workbench top bar — the path/URL plus a heading is filled into the DSH chat input (**not auto-sent**); toolbar buttons 「→ 对话」/「💬」 do the same in one click

The 0.8.48 – 0.8.52 releases in this range fix the same family of bugs — sidebar sizing and host hand-off geometry:

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
& "<your DSH install dir>\resources\runtime\cli\bin\dsh.cmd" plugin --profile desktop add "link:<repo-root>\dsh"
```

The plugin source lives in the [`dsh/`](dsh) directory. Full documentation — routes, contracts, pitfalls, acceptance checklist: [`dsh/README.md`](dsh/README.md) · hand-off notes: [`dsh/HANDOFF.md`](dsh/HANDOFF.md).

## License

MIT — see [LICENSE](LICENSE).
