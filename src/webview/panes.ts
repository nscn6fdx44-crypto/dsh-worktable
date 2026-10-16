import type { PaneKind, PaneSlotState, Project, TabState } from "../shared/types";
import { PANE_KIND_ORDER, STATUS_LABEL, STATUS_ORDER } from "../shared/state-core";
import { clear, el } from "./dom";

export interface PaneCallbacks {
  /** 仅持久化，不重绘（用于输入类交互，避免抢焦点）。 */
  onPersist(): void;
  /** 持久化并重绘（用于结构性交互）。 */
  onRerender(): void;
  onOpenExternal(url: string): void;
}

/** 窗格渲染上下文：回调 + 该窗格所属项目（模块靠它定位仓库根）。 */
export interface PaneContext extends PaneCallbacks {
  project: Project | null;
}

const KIND_LABEL: Record<PaneKind, string> = {
  note: "笔记",
  todo: "待办",
  link: "链接",
  placeholder: "占位",
  repo: "仓库",
  web: "网页"
};

/** 需要本地服务（wt.mjs serve）提供文件读写与网页反代的模块。 */
const SERVER_KINDS: PaneKind[] = ["repo", "web"];

const SERVER_HINT = [
  "此模块需要本地服务。",
  "在项目根目录运行：",
  "  node <技能目录>/scripts/wt.mjs serve",
  "再用它打印出的地址打开工作台。"
].join("\n");

/** 单文件快照（file://）下没有同源后端，模块无法工作。 */
function isServed(): boolean {
  return typeof window !== "undefined" && /^https?:$/.test(window.location.protocol);
}

interface TreeEntry {
  name: string;
  path: string;
  size?: number;
}

interface TreeData {
  name: string;
  path: string;
  dirs: TreeEntry[];
  files: TreeEntry[];
  truncated: boolean;
}

interface FileData {
  path: string;
  content: string;
  bytes: number;
  truncated: boolean;
  binary: boolean;
}

/** 未保存的编辑草稿，按标签页 id 暂存：结构性重绘（如切状态）不会丢字。 */
const drafts = new Map<string, string>();

class ApiError extends Error {
  code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.code = code;
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: "application/json" } });
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; code?: string | null }
    | null;
  if (!response.ok) {
    throw new ApiError(payload?.error ?? `HTTP ${response.status}`, payload?.code ?? null);
  }
  return payload as T;
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

function serverHintBox(): HTMLElement {
  return el("div", "wt-mod-note", SERVER_HINT);
}

function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function activeTab(slot: PaneSlotState): TabState | undefined {
  return slot.tabs.find((t) => t.id === slot.activeTabId) ?? slot.tabs[0];
}

export function renderPane(
  slot: PaneSlotState,
  windowNo: number,
  ctx: PaneContext
): HTMLElement {
  const pane = el("section", "wt-pane");
  pane.dataset.status = slot.status;

  const head = el("div", "wt-pane-head");
  head.appendChild(el("span", "wt-pane-no", `窗口 ${windowNo}`));

  const statusButton = el("button", "wt-status", STATUS_LABEL[slot.status]);
  statusButton.title = "切换状态：外观系统按状态施加霓虹光";
  statusButton.addEventListener("click", () => {
    const index = STATUS_ORDER.indexOf(slot.status);
    slot.status = STATUS_ORDER[(index + 1) % STATUS_ORDER.length];
    ctx.onRerender();
  });
  head.appendChild(statusButton);

  const tabs = el("div", "wt-tabs");
  for (const tab of slot.tabs) {
    const chip = el("button", `wt-tab${tab.id === slot.activeTabId ? " is-active" : ""}`, tab.title);
    chip.addEventListener("click", () => {
      slot.activeTabId = tab.id;
      ctx.onRerender();
    });
    if (slot.tabs.length > 1) {
      const close = el("span", "wt-tab-x", "×");
      close.title = "关闭标签页";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        slot.tabs = slot.tabs.filter((t) => t.id !== tab.id);
        if (slot.activeTabId === tab.id) slot.activeTabId = slot.tabs[0].id;
        ctx.onRerender();
      });
      chip.appendChild(close);
    }
    tabs.appendChild(chip);
  }
  head.appendChild(tabs);

  const addButton = el("button", "wt-icon-btn", "+");
  addButton.title = "新建标签页";
  addButton.addEventListener("click", () => {
    const tab: TabState = { id: newTabId(), title: "笔记", kind: "note", content: "" };
    slot.tabs.push(tab);
    slot.activeTabId = tab.id;
    ctx.onRerender();
  });
  head.appendChild(addButton);
  pane.appendChild(head);

  const body = el("div", "wt-pane-body");
  const current = activeTab(slot);
  if (current) body.appendChild(renderTabBody(current, ctx));
  pane.appendChild(body);

  return pane;
}

function renderTabBody(tab: TabState, ctx: PaneContext): HTMLElement {
  const wrap = el("div", "wt-tab-body");

  const kindBar = el("div", "wt-kind-bar");
  for (const kind of PANE_KIND_ORDER) {
    const button = el("button", `wt-kind${tab.kind === kind ? " is-active" : ""}`, KIND_LABEL[kind]);
    if (SERVER_KINDS.includes(kind)) button.title = "模块窗格，需要本地服务";
    button.addEventListener("click", () => {
      if (kind === tab.kind) return;
      // 切类型时清空载荷：路径与 URL 不能互相沿用，否则模块会指向一个不存在的目标。
      tab.content = "";
      tab.kind = kind;
      tab.title = KIND_LABEL[kind];
      ctx.onRerender();
    });
    kindBar.appendChild(button);
  }
  wrap.appendChild(kindBar);

  switch (tab.kind) {
    case "note": {
      const area = el("textarea", "wt-note");
      area.value = tab.content;
      area.placeholder = "随手记点什么…";
      area.addEventListener("input", () => {
        tab.content = area.value;
        ctx.onPersist();
      });
      wrap.appendChild(area);
      break;
    }
    case "todo": {
      wrap.appendChild(renderTodo(tab, ctx));
      break;
    }
    case "link": {
      const row = el("div", "wt-link-row");
      const input = el("input", "wt-link-input");
      input.type = "url";
      input.placeholder = "https://…";
      input.value = tab.content;
      input.addEventListener("input", () => {
        tab.content = input.value;
        ctx.onPersist();
      });
      const open = el("button", "wt-btn", "打开");
      open.addEventListener("click", () => {
        if (isHttpUrl(tab.content)) ctx.onOpenExternal(tab.content.trim());
      });
      row.appendChild(input);
      row.appendChild(open);
      wrap.appendChild(row);
      break;
    }
    case "repo": {
      wrap.appendChild(renderRepoModule(tab, ctx));
      break;
    }
    case "web": {
      wrap.appendChild(renderWebModule(tab, ctx));
      break;
    }
    default: {
      wrap.appendChild(el("div", "wt-placeholder", "占位窗格 —— 预留给后续模块（终端 / 自定义窗口）"));
    }
  }

  return wrap;
}

// ---------------------------------------------------------------- repo 模块

function renderRepoModule(tab: TabState, ctx: PaneContext): HTMLElement {
  const wrap = el("div", "wt-mod");

  if (!isServed()) {
    wrap.appendChild(serverHintBox());
    return wrap;
  }
  if (!ctx.project) {
    wrap.appendChild(el("div", "wt-mod-note", "该窗格不属于任何项目，无法定位仓库。"));
    return wrap;
  }

  const bar = el("div", "wt-mod-bar");
  const where = el("span", "wt-mod-path", tab.content || "项目根目录");
  where.title = tab.content || ctx.project.folder;
  bar.appendChild(where);

  if (tab.content) {
    const up = el("button", "wt-mod-btn", "↑ 上级");
    up.title = "回到上一级目录";
    up.addEventListener("click", () => {
      tab.content = parentPath(tab.content);
      ctx.onRerender();
    });
    bar.appendChild(up);
  }

  const refresh = el("button", "wt-mod-btn", "刷新");
  refresh.addEventListener("click", () => ctx.onRerender());
  bar.appendChild(refresh);
  wrap.appendChild(bar);

  const body = el("div", "wt-mod-body");
  body.appendChild(el("div", "wt-mod-note", "正在读取…"));
  wrap.appendChild(body);

  const projectId = ctx.project.id;
  void openTarget(body, projectId, tab, ctx);
  return wrap;
}

/**
 * `content` 只存相对项目根的路径，目录与文件共用这一个字段，
 * 所以先按目录读；服务端回 not-a-directory 时说明那是个文件，再按文件读。
 */
async function openTarget(
  body: HTMLElement,
  projectId: string,
  tab: TabState,
  ctx: PaneContext
): Promise<void> {
  try {
    if (tab.content) {
      try {
        await loadTree(body, projectId, tab.content, tab, ctx);
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "not-a-directory") throw error;
      }
      await loadFile(body, projectId, tab.content, tab);
      return;
    }
    await loadTree(body, projectId, "", tab, ctx);
  } catch (error) {
    clear(body);
    body.appendChild(el("div", "wt-mod-note", `读取失败：${message(error)}`));
  }
}

async function loadTree(
  body: HTMLElement,
  projectId: string,
  relPath: string,
  tab: TabState,
  ctx: PaneContext
): Promise<void> {
  const data = await apiGet<TreeData>(
    `/api/tree?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relPath)}`
  );
  clear(body);
  if (data.dirs.length === 0 && data.files.length === 0) {
    body.appendChild(el("div", "wt-mod-note", "空目录。"));
    return;
  }
  const list = el("div", "wt-mod-list");
  for (const dir of data.dirs) {
    const row = el("button", "wt-mod-row", `▸ ${dir.name}`);
    row.title = dir.path;
    row.addEventListener("click", () => {
      tab.content = dir.path;
      ctx.onRerender();
    });
    list.appendChild(row);
  }
  for (const file of data.files) {
    const row = el("button", "wt-mod-row", file.name);
    row.title = file.path;
    row.appendChild(el("span", "wt-mod-size", formatBytes(file.size ?? 0)));
    row.addEventListener("click", () => {
      tab.content = file.path;
      ctx.onRerender();
    });
    list.appendChild(row);
  }
  body.appendChild(list);
  if (data.truncated) {
    body.appendChild(el("div", "wt-mod-note", "条目过多，只列出前 400 项。"));
  }
}

async function loadFile(
  body: HTMLElement,
  projectId: string,
  relPath: string,
  tab: TabState
): Promise<void> {
  const data = await apiGet<FileData>(
    `/api/file?project=${encodeURIComponent(projectId)}&path=${encodeURIComponent(relPath)}`
  );
  clear(body);
  if (data.binary) {
    body.appendChild(el("div", "wt-mod-note", "二进制文件，不支持在窗格内编辑。"));
    return;
  }
  const draft = drafts.get(tab.id) ?? data.content;
  const editor = el("textarea", "wt-mod-editor");
  editor.value = draft;
  editor.spellcheck = false;

  const status = el("span", "wt-mod-status", draft === data.content ? "" : "未保存");
  const save = el("button", "wt-mod-btn", "保存");
  save.addEventListener("click", () => {
    void saveFile(projectId, data.path, editor.value, save, status);
  });

  const foot = el("div", "wt-mod-foot");
  foot.appendChild(save);
  foot.appendChild(status);
  if (data.truncated) {
    foot.appendChild(el("span", "wt-mod-status", `文件过大，只读取前 ${formatBytes(data.bytes)}`));
  }

  editor.addEventListener("input", () => {
    drafts.set(tab.id, editor.value);
    status.textContent = editor.value === data.content ? "" : "未保存";
  });

  body.appendChild(editor);
  body.appendChild(foot);
}

async function saveFile(
  projectId: string,
  path: string,
  content: string,
  button: HTMLButtonElement,
  status: HTMLElement
): Promise<void> {
  button.disabled = true;
  status.textContent = "保存中…";
  try {
    const response = await fetch("/api/file", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: projectId, path, content })
    });
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
    status.textContent = "已保存";
  } catch (error) {
    status.textContent = `保存失败：${message(error)}`;
  } finally {
    button.disabled = false;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ----------------------------------------------------------------- web 模块

function renderWebModule(tab: TabState, ctx: PaneContext): HTMLElement {
  const wrap = el("div", "wt-mod");

  const bar = el("div", "wt-mod-bar");
  const input = el("input", "wt-mod-url");
  input.type = "url";
  input.placeholder = "https://…";
  input.value = tab.content;
  input.addEventListener("input", () => {
    tab.content = input.value;
    ctx.onPersist();
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") ctx.onRerender();
  });
  bar.appendChild(input);

  const load = el("button", "wt-mod-btn", "载入");
  load.title = "在窗格内加载该地址";
  load.addEventListener("click", () => ctx.onRerender());
  bar.appendChild(load);

  const open = el("button", "wt-mod-btn", "打开");
  open.title = "在系统浏览器中打开";
  open.addEventListener("click", () => {
    if (isHttpUrl(tab.content)) ctx.onOpenExternal(tab.content.trim());
  });
  bar.appendChild(open);
  wrap.appendChild(bar);

  const body = el("div", "wt-mod-body");
  if (!isHttpUrl(tab.content)) {
    body.appendChild(el("div", "wt-mod-note", "填一个 http/https 地址，再点「载入」。"));
  } else if (!isServed()) {
    body.appendChild(serverHintBox());
  } else {
    body.appendChild(el("div", "wt-mod-note", "正在探测上游…"));
    void loadEmbed(body, tab.content.trim());
  }
  wrap.appendChild(body);
  return wrap;
}

interface ProbeData {
  url: string;
  status: number;
  contentType: string;
  ok: boolean;
  embeddable: boolean;
}

function probeHint(status: number): string {
  if (status === 401 || status === 403) return "该站点拒绝服务器端匿名访问（需要登录，或被策略屏蔽）。";
  if (status === 404) return "地址不存在，或该页面已私有化。";
  if (status >= 500) return "上游服务异常，稍后再试。";
  return "该站点拒绝了这次请求。";
}

async function loadEmbed(body: HTMLElement, url: string): Promise<void> {
  let info: ProbeData;
  try {
    info = await apiGet<ProbeData>(`/api/probe?url=${encodeURIComponent(url)}`);
  } catch (error) {
    clear(body);
    body.appendChild(el("div", "wt-mod-note", `探测失败：${message(error)}`));
    return;
  }
  clear(body);

  if (!info.ok) {
    body.appendChild(
      el("div", "wt-mod-note", `上游返回 ${info.status} —— ${probeHint(info.status)}点「打开」去系统浏览器看。`)
    );
    return;
  }

  const frame = el("iframe", "wt-mod-frame");
  // 不给 allow-same-origin：反代内容跑在本机同源上，放行后它能反过来调 /api/file 读写项目文件。
  frame.setAttribute(
    "sandbox",
    "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
  );
  frame.title = url;
  frame.src = `/proxy?url=${encodeURIComponent(url)}`;
  body.appendChild(frame);
  body.appendChild(
    el(
      "div",
      "wt-mod-note",
      "空白或残缺 = 该站点拒绝被内嵌（登录态 / 前端路由），点「打开」去系统浏览器看。"
    )
  );
}


function todoLines(tab: TabState): string[] {
  return tab.content.split("\n").filter((line) => line.trim().length > 0);
}

function renderTodo(tab: TabState, cb: PaneCallbacks): HTMLElement {
  const wrap = el("div", "wt-todo");
  const list = el("ul", "wt-todo-list");

  todoLines(tab).forEach((line, index) => {
    const done = /^\[x\]\s*/i.test(line);
    const text = line.replace(/^\[[ x]\]\s*/i, "");
    const item = el("li", `wt-todo-item${done ? " is-done" : ""}`);

    const box = el("button", "wt-check", done ? "✓" : "");
    box.addEventListener("click", () => {
      const all = todoLines(tab);
      all[index] = `${done ? "[ ]" : "[x]"} ${text}`;
      tab.content = all.join("\n");
      cb.onRerender();
    });

    const remove = el("button", "wt-todo-del", "×");
    remove.title = "删除该项";
    remove.addEventListener("click", () => {
      const all = todoLines(tab);
      all.splice(index, 1);
      tab.content = all.join("\n");
      cb.onRerender();
    });

    item.appendChild(box);
    item.appendChild(el("span", "wt-todo-text", text));
    item.appendChild(remove);
    list.appendChild(item);
  });

  wrap.appendChild(list);

  const input = el("input", "wt-todo-input");
  input.placeholder = "新增一项，回车确认";
  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const value = input.value.trim();
    if (!value) return;
    tab.content = tab.content ? `${tab.content}\n[ ] ${value}` : `[ ] ${value}`;
    cb.onRerender();
  });
  wrap.appendChild(input);

  return wrap;
}
