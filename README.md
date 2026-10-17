# Trae Worktable

An independent re-implementation for **TraeCode IDE** of the open-source project [`Aisland-SJL/dsh-worktable`](https://github.com/Aisland-SJL/dsh-worktable) (MIT). The feature design is inspired by upstream; the code is written independently.

> 中文说明见 [README.zh.md](README.zh.md)

The repository's **main deliverable** is the **single-file workbench**: a self-contained HTML file that scans the projects on **your own machine** — no extension, no install, no build, no dependency.

**Try it online**: <https://nscn6fdx44-crypto.github.io/trae-usage/workbench/> — a pure static page (GitHub Pages). It opens empty; after one click you scan your own machine's projects in the browser.

---

# Single-file workbench

Three core capabilities:

1. **Scan local projects** — click "Select local directory"; the browser scans in place and recognizes a project by `.git` / `package.json` / `CMakeLists.txt` markers
2. **Read & write files** — with permission, the `repo` pane views and edits files inside the scanned directory directly
3. **Project workbench** — card grid / control room / split workspace; projects can be renamed, batched and managed (renaming only changes the display name in your browser, never the files on disk)

The `traework/` artifact has the same features in a Skill + single-file HTML form (data via CLI); this document covers the workbench.

Three ways to open: **Pages online** (recommended — https is a secure context, authorization goes smoothly) / **double-click `index.html`** (`file://` works; use compatibility mode if the picker is blocked) / **`node serve.mjs`** (full capabilities).

## Usage

### 1. Scan local projects (zero-service, recommended)

1. Open the Pages link with **Chrome / Edge**, or double-click `index.html`
2. Go to the **control room** → "local directory" block → click **"Select local directory"**, pick your project root (e.g. `D:\projects`)
3. The browser scans in place; results merge into the project bar. The directory handle is stored in **IndexedDB** — it survives refresh and reopening

Permissions: "Select local directory" **requests read permission only** — enough for scanning and read-only browsing, so locations like `C:\` scan fine. Write permission is requested temporarily only when you click **Save**; denying it does not affect reading. When the browser downgrades permission to "pending", click **"Renew authorization"** once to restore.

### 2. Picker blocked / location not writable: compatibility mode

The "Compatibility mode scan" button in the local-directory block **needs no directory picker and no permission at all**: it uses `<input webkitdirectory>` to get a file list, rebuilds the directory tree in memory, then recognizes projects by the same rules.

- System locations like `C:\` and `file://` addresses scan fine
- Cost: no directory handle — **read-only browsing, no writing**, and a re-scan is needed after refresh
- ⚠️ **Do not pick a whole disk**: the browser enumerates every file before the page sees anything, and that step cannot be intercepted — it hangs for a very long time. Pick a parent directory closer to your projects instead, e.g. `C:\Users\you\Desktop\code`

### 3. Whole disks / large directories

A **persistent "Whole-disk scan" guide box** sits at the top of the local-directory block — visible before you pick anything:

1. Select a drive root (e.g. `C:`) → 2. enable **Deep scan** → 3. if the system drive forbids reading, switch to compatibility mode

| | Normal scan | Deep scan |
|---|---|---|
| Levels | 4 | 8 |
| Directory budget | 2500 | 20000 |
| Time budget | 5 s | 40 s |

While scanning, a **spinner + progress bar** shows real-time progress (percentage from directories visited / budget) — never a dead "nothing happens" click. You can cancel mid-scan; discovered projects are kept and honestly marked incomplete. **A failed scan never dead-ends the UI** — the selected directory is kept and you are prompted to re-pick or fall back to compatibility mode. Project cap: 150; single-project measurement cap: 5 s. 20+ system and cache directories (`Windows` / `Program Files` / `AppData` / `node_modules` …) are skipped outright.

### 4. Project bar management

| Entry | Behavior |
|---|---|
| **Add** | Dialog for name / path / language tags, written to browser `localStorage`; when the local service is running and an absolute path is given, it is registered so the `repo` pane can read/write it right away |
| **Multi-select** | Per-row checkboxes + select all / clear / remove toolbar; removal needs confirmation, **files on disk are never deleted** |
| **Rename** | A button at the end of every row — changes the project's **display name** (browser-local alias only, no disk change); the project bar, pane title and card name update together |

Removed scan projects are recorded in `wt2.removed`; a "N scan projects removed · restore all" button appears at the top of the project bar for one-click restore.

### 5. Full capabilities: local service

```bash
node serve.mjs        # or double-click 启动工作台.bat
```

Full capabilities: file read/write / port probing / server-side re-scan / web reverse proxy / custom project registration. Listens on `7331` by default, auto-incrementing when occupied. One-click start from the web page via `launcher.mjs` (`启动器.bat` / `安装后台启动器.bat`). Let other computers connect: `WB_HOST=0.0.0.0 WB_TOKEN=your-token node serve.mjs`, then colleagues visit `http://your-lan-ip:7331/`.

> ⚠️ Key fact: "Select local directory" in the web page **always scans the machine that opened the page** (browser sandbox — no web page can bypass this). After a colleague connects to your service, *their* click scans **their own computer**; the server-side "re-scan" scans **the machine running serve**.

## Known issues & solutions

Recorded as symptom → cause → fix, covering both usage and development:

| Symptom | Cause | Fix |
|---|---|---|
| Repeated permission prompts / wrong authorization state when picking a directory | Chrome's FileSystem Access semantics: once read is granted, querying "read-write" returns `prompt`, not `granted` — the state machine gets derailed | Layered permission evaluation: read and write judged separately; only read is requested normally, write is upgraded only when you click Save |
| Scan looks frozen after clicking | No exception fallback: one failed `getFile()` leaves the "scanning" state stuck true | `try/finally` restores the UI on any failure + layered budget + cancelable; failures prompt "re-pick a directory or use compatibility mode" |
| Scanning `C:\` returns in seconds with few projects | Default budget is only 4 levels / 2500 dirs / 5 s — shallow giant directories eat it first | Enable **Deep scan** (8 levels / 20000 dirs / 40 s), or use compatibility mode on a parent directory closer to the projects |
| Compatibility mode hangs on a whole disk | `webkitdirectory` enumerates every file before the page can intervene | Pick a parent directory close to the projects (e.g. `Desktop\code`), not a drive root |
| Size / file count takes long on big projects | Measuring file-by-file with `getFile()` — thousands of files means thousands of calls | Beyond 400 files, switch to **sampling extrapolation** and show a `~`-prefixed estimate; never present extrapolated values as exact |
| "Scan limit reached" shown with only a few dozen results | Extrapolated and truncated values were conflated — `estimated` was mislabeled `truncated` | Separate the two states: "limit reached" only when the cap is truly hit |
| Left project bar cannot scroll; many projects stretch the whole page | The list's parent was not flex — `flex:1` failed, no constrained height, `overflow-y:auto` was void | Parent becomes a flex column + `min-height:0`; the list scrolls inside the bar |
| "27 projects · scanned at …" stays stale after a re-scan | Scan completion re-rendered the list and cards but forgot the info bar | Info-bar rendering merged into the unified refresh function; it updates with every completed scan |
| Worry about the public page exposing your machine | Server mode exposes the directory and registry of **the machine running serve** | Public page is pure static zero-service: visitors only ever see their own machine; `verify.mjs` asserts no username / `C:\Users\` markers |
| git push fails with `CRYPT_E_NO_REVOCATION_CHECK` (dev) | Corporate network blocks certificate-revocation (CRL/OCSP) endpoints | `git -c http.sslVerify=false push` as a one-time bypass; long-term, use a proxy or the openssl backend |
| Local file differs from the live page by a few KB with identical content (dev) | Windows `core.autocrlf=true` stores CRLF as LF — a line-ending difference | Known behavior, zero content difference, nothing to do |

## Limits of a pure web frontend

These are not bugs — they are boundaries set by the browser security model:

| Limit | Why | What to do |
|---|---|---|
| Can only scan the machine that opened the page | Browser sandbox: no web page can reach another machine's file system | Each machine opens the page itself; or run `node serve.mjs` on that machine and use server-side re-scan |
| Port probing covers common ports only | Browsers cannot enumerate local ports — they can only try connecting | Zero-service probes 27 common ports; full probing via the local service's `/api/ports` |
| Write permission gets revoked | Browsers treat permission as temporary; refresh / new session downgrades it to "pending" | Directory handles live in IndexedDB — click "Renew authorization"; read-only browsing is unaffected |
| Drive roots may not be writable | Browsers default to read-only or refuse locations like `C:\` | Scanning and read-only browsing work; pick a concrete project directory to write |
| `file://` may block the directory picker | Browsers restrict APIs more strictly on local file pages | Open via the https Pages link or `http://127.0.0.1`; or use compatibility mode |
| Compatibility mode is read-only and needs a re-scan after refresh | It only gets a file list, no directory handle | Read-only browsing is usually enough; click "Select local directory" when you need to write |
| Scan results have caps; huge disks get truncated | Hard budgets guarantee "results within seconds" — never a dead click | Deep scan raises it to 20000 dirs / 8 levels / 40 s; truncation is honestly marked |
| Data is lost when changing browser / clearing cache | Data lives only in browser `localStorage` / IndexedDB | Re-scan once; registry-type data lives on the local service side |
| Requires Chrome / Edge 86+ | FileSystem Access API is not in every browser | Firefox / Safari: compatibility mode (read-only) |
| Server-side re-scan / reverse proxy / registry unavailable | These need a resident backend; a static page has none | Run `node serve.mjs` on the target machine (zero-dependency, single file) |

## Layout

| Path | Role |
|---|---|
| `index.html` | **Artifact**: public single file (no sample data, opens empty), Pages entry |
| `serve.mjs` | Local service: zero-dependency Node — serves the HTML on read + project file read/write API + port probing + reverse proxy + custom project registration |
| `启动工作台.bat` | Windows double-click launcher |
| `build/workbench.template.html` | Template: structure / styles / runtime, `/*__DATA__*/` is the data placeholder |
| `build/build.mjs` | Injects a local scan snapshot to produce `workbench.html` (personal build, not in the repo) |
| `build/build-public.mjs` | Produces `index.html` (public build: no sample data, opens empty) |
| `build/verify.mjs` | Static checks: self-containment / data contract / visual regression / public build has zero local-machine markers |
| `build/smoke.mjs` | Runtime smoke: snapshot / service / zero-service / single project root / huge root / compatibility mode — six scenarios |
| `build/e2e.mjs` | Real-browser end-to-end (Edge/Chrome headless + CDP; runs authorize → scan → read/write for real under `file://`) |
| `build/e2e/` | Permission-matrix regression: `cdp.mjs` zero-dependency CDP client, `fs-mock.mjs` fake handle stub, `run.mjs` assertion matrix M1–M15 (41 assertions) |
| `build/serve.test.mjs` | Server route contract |

## Commands

```bash
node build/build-public.mjs       # produce index.html
node build/verify.mjs             # static checks (public build only when no personal data exists)
node build/smoke.mjs              # six-scenario smoke
node build/e2e.mjs                # real-browser e2e (skips automatically if Edge / Chrome is absent)
node build/e2e/run.mjs            # permission matrix M1–M15 (same requirement)
node build/serve.test.mjs         # server contract
node launcher.mjs                 # launcher: one-click local service from the web page (127.0.0.1:7339)
```

From the repo root: `npm run workbench:build` / `workbench:check` / `workbench:e2e` (the latter two cover everything above except build). Fixed acceptance order: build → check → e2e — e2e runs the built `index.html`, not the template.

## Security boundary

- `repo` read/write is pinned inside registered project roots via `resolveWithin`; `..` and absolute paths are rejected; read cap 512 KB, write cap 1 MB, directory listing cap 400 entries
- `POST /api/register` only accepts **absolute paths of existing directories**, and is append-only
- The reverse proxy strips `X-Frame-Options` / CSP embed-blocking headers and injects `<base href>` to fix relative resources
- Probing recognizes both `X-Frame-Options` and CSP `frame-ancestors`; sites that forbid embedding get a fallback hint instead of a blank page
- Zero-service paths are pinned as scan-root + relative path — no absolute paths are persisted
- Remote sharing (`WB_HOST=0.0.0.0`) must be paired with `WB_TOKEN`; non-local requests are rejected when no token is set

## Privacy

`index.html` **carries no sample projects**: `DATA.projects` / `trees` / `ports` are all empty and the page opens empty; everything a visitor sees after scanning is from **their own machine** — zero exposure by design. `build/verify.mjs` asserts the public build contains no username, `C:\Users\`, `LAPTOP-` markers and that sample data is really cleared.

The personal build (with real local paths, aliases and directory samples) is `workbench/workbench.html` and `workbench.registry.json` — both excluded via `.gitignore`, never committed.

## Acknowledgements

Visual system inspired by the content structure and implementation of [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable).

---

# Other artifacts (beta)

Two earlier test builds, kept for reference — **beta quality, not the focus of this repo**:

| Artifact | Form | Status |
|---|---|---|
| TraeCode extension | `.vsix` | Beta: the original "visual skeleton" test build (drawer + layout presets + theme + tooling) |
| TraeWork worktable | Skill + single-file HTML | Beta: same features in TraeWork's Skill form — the Skill manages data, the HTML does the visuals |

## TraeCode extension (beta) — install

```bash
npm install
npm run build
```

Press `F5` in VS Code / TraeCode to launch the Extension Development Host — the **Worktable** icon appears in the activity bar. Or `npm run pack` to produce a `.vsix` and install it via "Install from VSIX…".

Commands: `addProject` / `openWorktable` / `pickLayout` / `renameProject` / `changeIcon` / `moveProjectUp` / `moveProjectDown` / `hideProject` / `showProject` / `removeProject` (confirmation, no disk change) / `revealProjectFolder` / `showChangelog` / `checkUpdates` / `copyUpgradePrompt`.

Settings: `traeWorktable.theme.mode` (`system`/`dark`/`light`), `traeWorktable.theme.accent` (hex), `traeWorktable.theme.opacity` (0.3–1), `traeWorktable.theme.background` (`aurora`/`coast`/`grid`/`none`), `traeWorktable.updateCheck.enabled`.

Scope of the beta: "visual skeleton" only — project ↔ session binding (M2), host-coupled split engine (M3), real panes M5–M8, control room M9 and click-to-annotate M10 are **not included** (they depend on host-private APIs). All state lives in VS Code `globalState`; nothing is uploaded.

## License

MIT — see [LICENSE](LICENSE).
