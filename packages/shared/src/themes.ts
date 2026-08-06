/**
 * Purchasable cosmetic theme catalogue (§19 settings). A single source of
 * truth shared by apps/api (seeds the matching shop SKUs) and apps/web
 * (renders the picker + the palette itself) so the two can't drift — the
 * shop SKU id, the inventory item key, and the palette definition are all
 * derived from the same `id` here rather than duplicated per app.
 *
 * "Light" and "Dark" are always free and aren't part of this list — see
 * apps/web's theme system.
 */

export interface ThemePalette {
  readonly bg: string;
  readonly board: string;
  readonly cellEmpty: string;
  readonly cellFilled: string;
  readonly blockDivider: string;
  readonly accent: string;
  readonly text: string;
  readonly textDim: string;
  readonly danger: string;
}

/**
 * A theme's non-colour traits (§19 round 9). Most themes are a pure palette
 * swap; a premium one can also re-voice the sound engine and switch on extra
 * visual treatment. Both are plain enums rather than free-form config so the
 * web app can exhaustively switch on them — a theme cannot smuggle in
 * arbitrary behaviour.
 */
export type ThemeSoundProfile = "default" | "retro";
export type ThemeEffects = "none" | "neonGlow";

export interface PremiumThemeDef {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly starsAmount: number;
  readonly palette: ThemePalette;
  readonly soundProfile?: ThemeSoundProfile;
  readonly effects?: ThemeEffects;
}

/** The shop SKU and the inventory item granting ownership are both this exact string — a one-time unlock, not a consumable, so there's no need for them to differ. */
export function themeInventoryKey(id: string): string {
  return `theme_${id}`;
}

export const PREMIUM_THEMES: readonly PremiumThemeDef[] = [
  {
    id: "sunset",
    title: "Sunset",
    description: "Warm dusk palette — unlocked forever",
    starsAmount: 60,
    palette: {
      bg: "#1f1410",
      board: "#2b1c15",
      cellEmpty: "#3a2419",
      cellFilled: "#ff8a4c",
      blockDivider: "#4a2f20",
      accent: "#ffb454",
      text: "#fbe9dd",
      textDim: "#c99b7c",
      danger: "#ff5b5b",
    },
  },
  {
    id: "ocean",
    title: "Ocean",
    description: "Cool teal depths — unlocked forever",
    starsAmount: 60,
    palette: {
      bg: "#0d1b1f",
      board: "#12262b",
      cellEmpty: "#17323a",
      cellFilled: "#2dd4bf",
      blockDivider: "#204049",
      accent: "#38bdf8",
      text: "#e6f6f6",
      textDim: "#7fa8ac",
      danger: "#ff6b6b",
    },
  },
  {
    id: "neon",
    title: "Neon",
    description: "Vivid arcade glow — unlocked forever",
    starsAmount: 60,
    palette: {
      bg: "#0a0a0f",
      board: "#121218",
      cellEmpty: "#1b1b26",
      cellFilled: "#ff2e88",
      blockDivider: "#2a2a3a",
      accent: "#39ff88",
      text: "#f2f2ff",
      textDim: "#8888aa",
      danger: "#ff3860",
    },
  },
  {
    id: "monochrome",
    title: "Monochrome",
    description: "Black, white, and gray only — unlocked forever",
    starsAmount: 60,
    palette: {
      bg: "#101010",
      board: "#1c1c1c",
      cellEmpty: "#282828",
      cellFilled: "#e0e0e0",
      blockDivider: "#383838",
      accent: "#ffffff",
      text: "#f5f5f5",
      textDim: "#8f8f8f",
      danger: "#c7c7c7",
    },
  },
  {
    // The one theme that is more than a repaint (§19 round 9): a synthwave
    // palette, a neon glow treatment on the board, and its own sound voice —
    // hence twice the price of the palette-only themes, and last in the list
    // so the shop's theme row still reads cheapest-first.
    id: "retrowave",
    title: "Retrowave",
    description: "Neon synthwave — glowing grid and its own retro sound set",
    starsAmount: 120,
    soundProfile: "retro",
    effects: "neonGlow",
    palette: {
      bg: "#190b2e",
      board: "#241040",
      cellEmpty: "#331a57",
      cellFilled: "#ff2e97",
      blockDivider: "#7b2ff7",
      accent: "#00f0ff",
      text: "#ffe9ff",
      textDim: "#b489da",
      danger: "#ff5f6d",
    },
  },
] as const;
