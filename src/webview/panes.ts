import type { PaneKind, PaneSlotState, PaneStatus, TabState } from "../shared/types";
import { el } from "./dom";

export interface PaneCallbacks {
  /** 仅持久化，不重绘（用于输入类交互，避免抢焦点）。 */
  onPersist(): void;
  /** 持久化并重绘（用于结构性交互）。 */
  onRerender(): void;
  onOpenExternal(url: string): void;
}

const KIND_ORDER: PaneKind[] = ["note", "todo", "link", "placeholder"];

const KIND_LABEL: Record<PaneKind, string> = {
  note: "笔记",
  todo: "待办",
  link: "链接",
  placeholder: "占位"
};

const STATUS_ORDER: PaneStatus[] = ["idle", "working", "needs-you", "done"];

const STATUS_LABEL: Record<PaneStatus, string> = {
  idle: "空闲",
  working: "进行中",
  "needs-you": "待你处理",
  done: "完成"
};

function newTabId(): string {
  return `tab-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function activeTab(slot: PaneSlotState): TabState | undefined {
  return slot.tabs.find((t) => t.id === slot.activeTabId) ?? slot.tabs[0];
}

export function renderPane(
  slot: PaneSlotState,
  windowNo: number,
  cb: PaneCallbacks
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
    cb.onRerender();
  });
  head.appendChild(statusButton);

  const tabs = el("div", "wt-tabs");
  for (const tab of slot.tabs) {
    const chip = el("button", `wt-tab${tab.id === slot.activeTabId ? " is-active" : ""}`, tab.title);
    chip.addEventListener("click", () => {
      slot.activeTabId = tab.id;
      cb.onRerender();
    });
    if (slot.tabs.length > 1) {
      const close = el("span", "wt-tab-x", "×");
      close.title = "关闭标签页";
      close.addEventListener("click", (event) => {
        event.stopPropagation();
        slot.tabs = slot.tabs.filter((t) => t.id !== tab.id);
        if (slot.activeTabId === tab.id) slot.activeTabId = slot.tabs[0].id;
        cb.onRerender();
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
    cb.onRerender();
  });
  head.appendChild(addButton);
  pane.appendChild(head);

  const body = el("div", "wt-pane-body");
  const current = activeTab(slot);
  if (current) body.appendChild(renderTabBody(current, cb));
  pane.appendChild(body);

  return pane;
}

function renderTabBody(tab: TabState, cb: PaneCallbacks): HTMLElement {
  const wrap = el("div", "wt-tab-body");

  const kindBar = el("div", "wt-kind-bar");
  for (const kind of KIND_ORDER) {
    const button = el("button", `wt-kind${tab.kind === kind ? " is-active" : ""}`, KIND_LABEL[kind]);
    button.addEventListener("click", () => {
      tab.kind = kind;
      tab.title = KIND_LABEL[kind];
      cb.onRerender();
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
        cb.onPersist();
      });
      wrap.appendChild(area);
      break;
    }
    case "todo": {
      wrap.appendChild(renderTodo(tab, cb));
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
        cb.onPersist();
      });
      const open = el("button", "wt-btn", "打开");
      open.addEventListener("click", () => {
        const url = tab.content.trim();
        if (/^https?:\/\//i.test(url)) cb.onOpenExternal(url);
      });
      row.appendChild(input);
      row.appendChild(open);
      wrap.appendChild(row);
      break;
    }
    default: {
      wrap.appendChild(
        el("div", "wt-placeholder", "占位窗格 —— 预留给后续模块（文件 / 终端 / 浏览器 / 自定义窗口）")
      );
    }
  }

  return wrap;
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
