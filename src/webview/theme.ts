import type { BackgroundId, ThemeState } from "../shared/types";

const BACKGROUNDS: Record<BackgroundId, string> = {
  aurora:
    "radial-gradient(1200px 600px at 12% -8%, rgba(79,156,249,.30), transparent 60%)," +
    "radial-gradient(900px 520px at 88% 8%, rgba(168,85,247,.26), transparent 62%)," +
    "radial-gradient(1000px 700px at 50% 108%, rgba(34,197,94,.20), transparent 60%)",
  coast: "linear-gradient(180deg, #071a2e 0%, #0f3352 38%, #175f7d 68%, #26889b 100%)",
  grid: "none",
  none: "none"
};

export const BACKGROUND_LABEL: Record<BackgroundId, string> = {
  aurora: "极光",
  coast: "海岸",
  grid: "网格",
  none: "无"
};

function hexToRgb(hex: string): [number, number, number] {
  let body = hex.replace("#", "");
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  const value = Number.parseInt(body, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function inkFor(rgb: [number, number, number]): string {
  const [r, g, b] = rgb.map((v) => v / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.62 ? "#0a1626" : "#f4f8ff";
}

/** 把 #rgb 补全成 color 输入框要求的 #rrggbb。 */
export function toFullHex(hex: string): string {
  const body = hex.replace("#", "");
  if (body.length === 3) {
    return `#${body.split("").map((c) => c + c).join("")}`;
  }
  return body.length === 6 ? `#${body}` : "#4f9cf9";
}

export function applyTheme(
  el: HTMLElement,
  theme: ThemeState,
  kind: "dark" | "light"
): void {
  const mode = theme.mode === "system" ? kind : theme.mode;
  el.dataset.theme = mode;
  el.dataset.background = theme.background;
  const rgb = hexToRgb(theme.accent);
  el.style.setProperty("--wt-accent", theme.accent);
  el.style.setProperty("--wt-accent-rgb", rgb.join(", "));
  el.style.setProperty("--wt-accent-ink", inkFor(rgb));
  el.style.setProperty("--wt-opacity", String(theme.opacity));
  el.style.setProperty("--wt-bg-image", BACKGROUNDS[theme.background]);
}
