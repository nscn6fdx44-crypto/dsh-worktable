# Trae Worktable

Turn your projects into a sidebar app drawer, with a dockable split workspace and a unified appearance system.

> 中文说明见 [README.zh.md](README.zh.md)

This repository is an independent re-implementation for **TraeCode IDE** of the open-source project [`Aisland-SJL/dsh-worktable`](https://github.com/Aisland-SJL/dsh-worktable) (MIT). Scope is limited to **C1 "visual skeleton"**: drawer + layout presets + theme system + engineering tooling. The feature design is inspired by upstream; the code is written independently.

The repository ships **three artifacts** that do not interfere with each other:

| Artifact | Carrier | Where |
|---|---|---|
| TraeCode extension | `.vsix` | `src/` `out/` `media/` at the repo root — everything documented below |
| TraeWork worktable | Skill + single-file HTML | See [`traework/`](traework/README.md): the Skill manages data, the HTML does the visuals |
| Single-file workbench | Self-contained HTML + local service | See [`workbench/`](workbench/README.md): snapshot data baked into one HTML file, plus a zero-dependency local service |

TraeWork **cannot** import `.vsix`. Its extension surface is a task-scoped plugin / Skill with no custom UI container, so the worktable takes a different shape there (data via CLI, visuals via a self-contained HTML file).

---

## Features

### M1 · Sidebar app drawer

An activity-bar container named **Worktable** with two views:

| View | Contents |
|---|---|
| **Projects** | Visible worktable projects, in custom order |
| **Hidden** | Hidden projects, restorable at any time |

Each project supports: add (pick a folder), rename, change icon (22 built-ins), move up / down, hide / unhide, remove, reveal in file manager.

> Removing only detaches the project from the worktable. **The folder on disk is never deleted**, and a confirmation is required.

### M4 · Layout presets

| Preset | id | Structure |
|---|---|---|
| Single | `full` | 1 content pane + right chat pane |
| Split | `l2` | 1 left column + 1 main pane + right chat pane |
| Grid | `g4` | 2 top row + 2 main row + right chat pane |
| Top hero | `l13` | 1 hero on top + 3 below + right chat pane |

Rules:

- Window numbering is always **left column → top row → main row**
- The chat pane always sits on the far right and is excluded from `contentCount`
- Each project remembers its own preset; dividers are draggable, and sizes are persisted per `project × preset`
- Every pane supports multiple tabs, switchable between **note / todo / link / placeholder**

### M11 · Appearance & theme

- Glassmorphism cards over a blueprint-grid backdrop
- Three theme modes: follow system / dark / light
- Accent color picker — derives the neon RGB channels and a readable ink color automatically
- Live panel opacity (30%–100%)
- Four background presets: aurora / coast / grid / none
- Four pane status glows (click the status chip in a pane header to cycle):

| Status | Visual |
|---|---|
| idle | plain border |
| working | accent border + outer glow + **rotating comet** |
| needs-you | amber border + outer glow |
| done | green border + outer glow |

### M12 · Engineering tooling

- **Update check**: read-only GitHub Releases request. It only notifies, **never auto-upgrades**. When a newer version exists you can copy an upgrade prompt for your AI assistant.
- **Changelog** command
- **Offline regression tests**: layout presets / state normalization / package structure
- **`npm run verify:package`**: computes the packaged file list offline and asserts its structure

---

## Getting started

### Development

```bash
npm install
npm run build
```

Then press `F5` in VS Code / TraeCode to launch the Extension Development Host — the **Worktable** icon appears in the activity bar.

### Package

```bash
npm run pack          # build + check + test + produce .vsix
```

Install the resulting `.vsix` via "Install from VSIX…".

---

## Commands

| Command | Description |
|---|---|
| `traeWorktable.addProject` | Add a folder to the worktable |
| `traeWorktable.openWorktable` | Open the split workspace panel |
| `traeWorktable.pickLayout` | Switch layout preset for the active project |
| `traeWorktable.renameProject` / `changeIcon` | Rename / change icon |
| `traeWorktable.moveProjectUp` / `moveProjectDown` | Reorder |
| `traeWorktable.hideProject` / `showProject` | Hide / unhide |
| `traeWorktable.removeProject` | Detach (confirmation, no disk change) |
| `traeWorktable.revealProjectFolder` | Reveal in file manager |
| `traeWorktable.showChangelog` | Open the changelog |
| `traeWorktable.checkUpdates` | Check for updates |
| `traeWorktable.copyUpgradePrompt` | Copy the upgrade prompt |

## Settings

| Setting | Type | Default | Description |
|---|---|---|---|
| `traeWorktable.theme.mode` | `system` / `dark` / `light` | `system` | Appearance mode |
| `traeWorktable.theme.accent` | hex color | `#4f9cf9` | Accent color |
| `traeWorktable.theme.opacity` | 0.3–1 | `0.86` | Panel opacity |
| `traeWorktable.theme.background` | `aurora` / `coast` / `grid` / `none` | `aurora` | Background preset |
| `traeWorktable.updateCheck.enabled` | boolean | `true` | Enable update check |

The **Appearance** button in the panel top bar exposes graphical controls for the same settings; changes are written back to the configuration (global scope).

---

## Scripts

```bash
npm run build            # esbuild bundles (host + webview) and copies the stylesheet
npm run check            # node --check on built artifacts
npm test                 # offline regression (builds first)
npm run verify:package   # offline package-structure assertions
npm run verify:sync      # assert traework/lib matches the sources byte-for-byte (run standalone before committing)
npm run traework:install # install the TraeWork worktable as a project skill (.trae/skills/traework-worktable/)
npm run pack             # build + check + test + .vsix
npm run typecheck        # tsc --noEmit (requires npm install)
```

---

## Scope boundaries

This release is the "visual skeleton" subset. Not included:

| Missing | Why |
|---|---|
| M2 project ↔ session binding | Needs host session-switching APIs that TraeCode does not expose |
| M3 host-coupled split engine | This release is a pure-frontend split only |
| M5–M8 real panes (file / terminal / browser / custom window + artifact mount) | Depends on host-private APIs |
| M9 control room dashboard | Depends on host session-state snapshots |
| M10 click-to-annotate | Depends on host input bridging |

Pane contents are currently pure frontend (note / todo / link / placeholder); the chat pane is a placeholder.

## Privacy

- All state lives in VS Code `globalState`
- **No TRAE data files are read or written**; nothing is uploaded
- The only network request is the update check (read-only GitHub Releases), which can be disabled

## License

MIT — see [LICENSE](LICENSE).
