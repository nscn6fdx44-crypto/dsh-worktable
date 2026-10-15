import type { LayoutState, WorktableState } from "../shared/types";
import { mainRowCount, paneSlots, presetById } from "../shared/presets";
import { el } from "./dom";
import { renderPane, type PaneCallbacks } from "./panes";

export interface SplitContext extends PaneCallbacks {
  state: WorktableState;
  layoutKey: string;
}

const MIN_LEFT = 180;
const MAX_LEFT = 720;
const MIN_TOP = 120;
const MIN_CHAT = 260;
const MAX_CHAT = 900;

function attachDrag(
  handle: HTMLElement,
  axis: "x" | "y",
  onDelta: (delta: number) => void,
  onCommit: () => void
): void {
  handle.addEventListener("pointerdown", (event: PointerEvent) => {
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    const start = axis === "x" ? event.clientX : event.clientY;
    handle.classList.add("is-dragging");

    const move = (e: PointerEvent) => onDelta((axis === "x" ? e.clientX : e.clientY) - start);
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.classList.remove("is-dragging");
      onCommit();
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function renderSplit(ctx: SplitContext): HTMLElement {
  const layout = ctx.state.layouts[ctx.layoutKey] as LayoutState;
  const preset = presetById(layout.presetId);
  const slots = paneSlots(preset);

  const stage = el("div", "wt-stage");
  const persist = () => ctx.onPersist();

  // ---- 左栏 ----
  if (preset.leftCount > 0) {
    const left = el("div", "wt-col-left");
    left.style.width = `${layout.leftWidth}px`;
    for (let i = 0; i < preset.leftCount; i++) {
      left.appendChild(renderPane(layout.slots[i], slots[i].windowNo, ctx));
    }
    stage.appendChild(left);

    const divider = el("div", "wt-divider wt-divider-x");
    attachDrag(
      divider,
      "x",
      (delta) => {
        const next = clamp(layout.leftWidth + delta, MIN_LEFT, MAX_LEFT);
        layout.leftWidth = next;
        left.style.width = `${next}px`;
      },
      persist
    );
    stage.appendChild(divider);
  }

  // ---- 主区（顶行 + 主行）----
  const main = el("div", "wt-main");

  if (preset.topCount > 0) {
    const top = el("div", "wt-row wt-row-top");
    top.style.height = `${layout.topHeight}px`;
    for (let i = 0; i < preset.topCount; i++) {
      const index = preset.leftCount + i;
      top.appendChild(renderPane(layout.slots[index], slots[index].windowNo, ctx));
    }
    main.appendChild(top);

    if (mainRowCount(preset) > 0) {
      const divider = el("div", "wt-divider wt-divider-y");
      attachDrag(
        divider,
        "y",
        (delta) => {
          const next = clamp(layout.topHeight + delta, MIN_TOP, window.innerHeight - MIN_TOP);
          layout.topHeight = next;
          top.style.height = `${next}px`;
        },
        persist
      );
      main.appendChild(divider);
    }
  }

  const mainRow = el("div", "wt-row wt-row-main");
  const mainStart = preset.leftCount + preset.topCount;
  for (let i = 0; i < mainRowCount(preset); i++) {
    const index = mainStart + i;
    mainRow.appendChild(renderPane(layout.slots[index], slots[index].windowNo, ctx));
  }
  main.appendChild(mainRow);
  stage.appendChild(main);

  // ---- 聊天窗 ----
  const chat = el("aside", "wt-chat");
  chat.style.width = `${layout.chatWidth}px`;
  const chatHead = el("div", "wt-chat-head");
  chatHead.appendChild(el("span", "wt-chat-title", "会话"));
  chatHead.appendChild(el("span", "wt-chat-hint", "M2 预留"));
  chat.appendChild(chatHead);
  chat.appendChild(
    el(
      "div",
      "wt-placeholder",
      "会话窗格预留给「项目 ↔ 会话绑定」（M2）。C1 范围只复刻抽屉 / 布局 / 外观 / 工程配套。"
    )
  );

  const dividerChat = el("div", "wt-divider wt-divider-x");
  attachDrag(
    dividerChat,
    "x",
    (delta) => {
      const next = clamp(layout.chatWidth - delta, MIN_CHAT, MAX_CHAT);
      layout.chatWidth = next;
      chat.style.width = `${next}px`;
    },
    persist
  );

  stage.appendChild(dividerChat);
  stage.appendChild(chat);

  return stage;
}
