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

export interface PremiumThemeDef {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly starsAmount: number;
  readonly palette: ThemePalette;
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
] as const;
