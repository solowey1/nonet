import type { ThemePalette } from "@nonet/shared";

function hexToRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (c: number) => Math.max(0, Math.min(255, Math.round(c)));
  return `#${[clamp(r), clamp(g), clamp(b)].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function mix(hex: string, towardHex: string, amount: number): string {
  const [r1, g1, b1] = hexToRgb(hex);
  const [r2, g2, b2] = hexToRgb(towardHex);
  return rgbToHex(r1 + (r2 - r1) * amount, g1 + (g2 - g1) * amount, b1 + (b2 - b1) * amount);
}

/**
 * Every premium theme is authored as one (dark-leaning) palette — there's no
 * separate light variant to hand-author per theme. The Shop's preview
 * dialog still needs a "Light" vs "Dark" toggle (§19) before purchase, so a
 * light preview is *derived* here (background/board/empty-cell lightened
 * toward white, text darkened toward black) rather than doubling every
 * theme's data. It's an approximation for preview purposes only — the
 * theme itself always applies as authored, regardless of the app's own
 * light/dark mode.
 */
export function derivePreviewPalette(palette: ThemePalette, mode: "light" | "dark"): ThemePalette {
  if (mode === "dark") return palette;
  return {
    bg: mix(palette.bg, "#ffffff", 0.88),
    board: mix(palette.board, "#ffffff", 0.92),
    cellEmpty: mix(palette.cellEmpty, "#ffffff", 0.8),
    cellFilled: palette.cellFilled,
    blockDivider: mix(palette.blockDivider, "#ffffff", 0.5),
    accent: palette.accent,
    text: mix(palette.text, "#000000", 0.85),
    textDim: mix(palette.textDim, "#000000", 0.3),
    danger: palette.danger,
  };
}
