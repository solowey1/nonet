/**
 * Telegram Mini App bridge (§12): initData for session auth, the drag-safety
 * tweaks, and the rest of the checklist that was deferred to the polish
 * phase — theme params, haptics, CloudStorage, and share cards.
 * `disableVerticalSwipes` is pulled forward from day one because it's not
 * optional for a game whose core interaction *is* dragging — without it,
 * dragging a piece downward closes the app.
 */
import { PREMIUM_THEMES, type ThemePalette } from "@nonet/shared";
import i18next, { isSupportedLanguage, resolveLanguage, type LanguageMode } from "../i18n/index.js";
export type { LanguageMode };

export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending";
export type HapticImpactStyle = "light" | "medium" | "heavy" | "rigid" | "soft";
export type HapticNotificationType = "error" | "success" | "warning";

interface ThemeParams {
  bg_color?: string;
  secondary_bg_color?: string;
  section_bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
  destructive_text_color?: string;
  header_bg_color?: string;
}

interface BackButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

interface SettingsButton {
  isVisible: boolean;
  show(): void;
  hide(): void;
  onClick(callback: () => void): void;
  offClick(callback: () => void): void;
}

interface HapticFeedback {
  impactOccurred(style: HapticImpactStyle): void;
  notificationOccurred(type: HapticNotificationType): void;
  selectionChanged(): void;
}

interface CloudStorage {
  setItem(key: string, value: string, callback?: (err: string | null, success?: boolean) => void): void;
  getItem(key: string, callback: (err: string | null, value?: string) => void): void;
}

/** In px, relative to the viewport edge — see applySafeAreaInsets' doc comment for how the two inset types combine. */
interface SafeAreaInset {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

type TelegramEventType =
  | "themeChanged"
  | "safeAreaChanged"
  | "contentSafeAreaChanged"
  | "fullscreenChanged"
  | "fullscreenFailed";

interface TelegramWebApp {
  initData: string;
  initDataUnsafe?: { user?: { language_code?: string } };
  themeParams: ThemeParams;
  colorScheme: "light" | "dark";
  isFullscreen?: boolean;
  safeAreaInset?: SafeAreaInset;
  contentSafeAreaInset?: SafeAreaInset;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
  openInvoice?(url: string, callback: (status: InvoiceStatus) => void): void;
  onEvent?(eventType: TelegramEventType, callback: () => void): void;
  HapticFeedback?: HapticFeedback;
  CloudStorage?: CloudStorage;
  openTelegramLink?(url: string): void;
  BackButton?: BackButton;
  SettingsButton?: SettingsButton;
  /** Color-key mode ('bg_color'/'secondary_bg_color') keeps the native header
   * permanently in sync with that themeParams field — no re-application
   * needed on themeChanged, unlike a static hex value would require. */
  setHeaderColor?(color: "bg_color" | "secondary_bg_color" | string): void;
  setBackgroundColor?(color: "bg_color" | "secondary_bg_color" | string): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp };
  }
}

function getWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

export function getTelegramInitData(): string | null {
  const initData = getWebApp()?.initData;
  return initData ? initData : null;
}

/** BCP-47-ish language tag Telegram reports for the user (e.g. "ru", "en") — used to auto-pick a locale in "Auto" mode (§19 Language setting). */
export function getTelegramLanguageCode(): string | null {
  return getWebApp()?.initDataUnsafe?.user?.language_code ?? null;
}

export async function bootstrapTelegramWebApp(): Promise<void> {
  // Both preferences work with or without a real Telegram WebView (via
  // CloudStorage's localStorage fallback) — resolved before any
  // Telegram-specific setup so plain-browser dev/testing behaves the same
  // as inside Telegram, and so an explicit theme choice is already in
  // effect before Telegram's own live sync below could flash the wrong
  // colors first.
  await loadThemePreference();
  await loadLanguagePreference();
  void loadHapticsPreference();

  const webApp = getWebApp();
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();
  syncTelegramTheme();
  syncSafeAreaInsets();
  requestFullscreenIfNeeded();
}

/**
 * Maps a deliberately small subset of Telegram's theme params onto our own
 * CSS custom properties — background, text, and the button/accent colour.
 * Piece colours, radius, and shadow stay untouched: those are the game's own
 * visual identity (§15), not something that should shift with the user's
 * Telegram theme. Set as inline styles on `<html>`, which always wins over
 * `theme.css`'s `:root { ... }` rule (same element, inline beats stylesheet),
 * so this cleanly layers over — rather than fights with — the existing
 * `prefers-color-scheme` fallback used by plain-browser dev/testing.
 */
function applyThemeParams(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  // An explicit theme choice (§19 Settings) wins outright — don't let
  // Telegram's own live theme (initial or via themeChanged) fight it.
  if (themeMode !== "auto") return;
  const root = document.documentElement.style;
  const { themeParams: t } = webApp;
  if (t.bg_color) root.setProperty("--nonet-bg", t.bg_color);
  if (t.secondary_bg_color) root.setProperty("--nonet-board", t.secondary_bg_color);
  if (t.section_bg_color) root.setProperty("--nonet-cell-empty", t.section_bg_color);
  if (t.text_color) root.setProperty("--nonet-text", t.text_color);
  if (t.hint_color) root.setProperty("--nonet-text-dim", t.hint_color);
  if (t.button_color) {
    root.setProperty("--nonet-accent", t.button_color);
    root.setProperty("--nonet-button-bg", t.button_color);
  }
  if (t.destructive_text_color) root.setProperty("--nonet-danger", t.destructive_text_color);
  root.setProperty("color-scheme", webApp.colorScheme);
  // Keep Telegram's own native header/background chrome pinned to bg_color
  // via the color-key mode (not a static hex) so it tracks every future
  // themeChanged automatically — most important right here at first paint,
  // so the native header never flashes a color that doesn't match the page.
  webApp.setHeaderColor?.("bg_color");
  webApp.setBackgroundColor?.("bg_color");
}

function syncTelegramTheme(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  applyThemeParams();
  webApp.onEvent?.("themeChanged", applyThemeParams);
}

/**
 * Telegram exposes two separate insets: `safeAreaInset` is the OS-level
 * obstruction (notch, home indicator, status bar) — only really non-zero
 * once the app is running fullscreen, since otherwise Telegram's own chrome
 * already sits above the WebView. `contentSafeAreaInset` is Telegram's *own*
 * UI drawn on top of that (header bar, back/close/settings controls) that
 * page content additionally needs to clear. The two stack — content needs
 * to clear both, not just the larger of the two — so each edge's usable
 * inset is their sum. Exposed as CSS vars in px (not `env()`, since these
 * numbers come from Telegram, not the browser) for `theme.css` to consume;
 * falls back to 0 on every edge outside Telegram or on older clients that
 * predate this API (Bot API 8.0), which is exactly the right fallback since
 * `env(safe-area-inset-*)` already covers the plain-browser/notch case.
 */
function applySafeAreaInsets(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  const root = document.documentElement.style;
  const safe = webApp.safeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
  const content = webApp.contentSafeAreaInset ?? { top: 0, bottom: 0, left: 0, right: 0 };
  root.setProperty("--tg-inset-top", `${safe.top + content.top}px`);
  root.setProperty("--tg-inset-bottom", `${safe.bottom + content.bottom}px`);
  root.setProperty("--tg-inset-left", `${safe.left + content.left}px`);
  root.setProperty("--tg-inset-right", `${safe.right + content.right}px`);
}

function syncSafeAreaInsets(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  applySafeAreaInsets();
  webApp.onEvent?.("safeAreaChanged", applySafeAreaInsets);
  webApp.onEvent?.("contentSafeAreaChanged", applySafeAreaInsets);
  // Entering/leaving fullscreen changes both insets (see the doc comment
  // above) — re-sync rather than assume a specific direction of change.
  webApp.onEvent?.("fullscreenChanged", applySafeAreaInsets);
  webApp.onEvent?.("fullscreenFailed", applySafeAreaInsets);
}

/**
 * Launch straight into fullscreen (Bot API 8.0+) rather than waiting for the
 * player to find a toggle for it. Feature-detected and a no-op wherever
 * unsupported — older Telegram clients, or already-fullscreen (e.g. a hot
 * reload) — `requestFullscreen` itself is fire-and-forget; the resulting
 * state change (or failure) arrives via the `fullscreenChanged` /
 * `fullscreenFailed` events already wired above.
 */
function requestFullscreenIfNeeded(): void {
  const webApp = getWebApp();
  if (!webApp || webApp.isFullscreen || typeof webApp.requestFullscreen !== "function") return;
  webApp.requestFullscreen();
}

export function setClosingConfirmation(enabled: boolean): void {
  const webApp = getWebApp();
  if (!webApp) return;
  if (enabled) webApp.enableClosingConfirmation?.();
  else webApp.disableClosingConfirmation?.();
}

// --- BackButton / SettingsButton (§19) ---
// BackButton is toggled per screen (shown on every screen but the main
// menu) with a fresh handler each time navigation changes, since "back"
// means something different depending on where you are. SettingsButton is
// registered once at bootstrap with a single fixed handler — it's a
// persistent native menu control, not a per-screen affordance.

let backButtonHandler: (() => void) | null = null;

/** Registers `onClick` as the BackButton's sole handler (replacing any prior one) and shows it. */
export function showBackButton(onClick: () => void): void {
  const webApp = getWebApp();
  const backButton = webApp?.BackButton;
  if (!backButton) return;
  if (backButtonHandler) backButton.offClick(backButtonHandler);
  backButtonHandler = onClick;
  backButton.onClick(onClick);
  backButton.show();
}

export function hideBackButton(): void {
  const webApp = getWebApp();
  const backButton = webApp?.BackButton;
  if (!backButton) return;
  if (backButtonHandler) {
    backButton.offClick(backButtonHandler);
    backButtonHandler = null;
  }
  backButton.hide();
}

/** Call once at bootstrap; `onClick` should navigate straight to the Settings screen from anywhere. */
export function initSettingsButton(onClick: () => void): void {
  const webApp = getWebApp();
  if (!webApp?.SettingsButton) return;
  webApp.SettingsButton.onClick(onClick);
  webApp.SettingsButton.show();
}

/**
 * Opens Telegram's native Stars payment sheet for an invoice link (§13).
 * Outside a real Telegram WebView (e.g. local dev in a plain browser) there's
 * no such sheet to open — resolves "failed" rather than throwing, since a
 * Stars purchase is fundamentally untestable there (see DECISIONS.md).
 */
export function openInvoice(url: string): Promise<InvoiceStatus> {
  const webApp = getWebApp();
  if (!webApp?.openInvoice) return Promise.resolve("failed");
  return new Promise((resolve) => webApp.openInvoice?.(url, resolve));
}

// --- CloudStorage (§12) ---
// A thin key-value layer: reads/writes Telegram's per-user CloudStorage when
// available, and falls back to localStorage outside Telegram (dev/testing)
// so a preference set there still persists across reloads rather than
// silently doing nothing.

function cloudGetItem(key: string): Promise<string | null> {
  const webApp = getWebApp();
  if (webApp?.CloudStorage) {
    return new Promise((resolve) => {
      webApp.CloudStorage?.getItem(key, (err, value) => resolve(err || !value ? null : value));
    });
  }
  return Promise.resolve(localStorage.getItem(`nonet:cloud:${key}`));
}

function cloudSetItem(key: string, value: string): void {
  const webApp = getWebApp();
  if (webApp?.CloudStorage) {
    webApp.CloudStorage.setItem(key, value);
    return;
  }
  localStorage.setItem(`nonet:cloud:${key}`, value);
}

// --- Theme selection (§19) ---
// "auto" (default) leaves Telegram's own live theme in full control, exactly
// as before this feature existed. "light"/"dark" and any purchased premium
// theme id (from `@nonet/shared`'s PREMIUM_THEMES) instead paint a fixed
// palette via the same "inline style beats stylesheet" mechanism
// `applyThemeParams` already uses — so switching to an explicit theme simply
// means Telegram's own sync (`applyThemeParams`, above) stops applying (see
// its early `themeMode !== "auto"` check) while this takes over the exact
// same CSS custom properties.

export type ThemeMode = "auto" | "light" | "dark" | string;

const THEME_PREFERENCE_KEY = "themeMode";
let themeMode: ThemeMode = "auto";

const LIGHT_PALETTE: ThemePalette = {
  bg: "#eef1f6",
  board: "#ffffff",
  cellEmpty: "#e4e8f0",
  cellFilled: "#3b6fe0",
  blockDivider: "#c7cedb",
  accent: "#0a84ff",
  text: "#1a1d24",
  textDim: "#6b7280",
  danger: "#e0393e",
};

const DARK_PALETTE: ThemePalette = {
  bg: "#14171c",
  board: "#1c2028",
  cellEmpty: "#232833",
  cellFilled: "#4a7dff",
  blockDivider: "#363c48",
  accent: "#5ac8fa",
  text: "#f2f4f8",
  textDim: "#8b93a3",
  danger: "#ff5b5b",
};

function paletteFor(mode: ThemeMode): ThemePalette | null {
  if (mode === "light") return LIGHT_PALETTE;
  if (mode === "dark") return DARK_PALETTE;
  return PREMIUM_THEMES.find((theme) => theme.id === mode)?.palette ?? null;
}

function applyPalette(p: ThemePalette): void {
  const root = document.documentElement.style;
  const isLight = p === LIGHT_PALETTE;
  root.setProperty("--nonet-bg", p.bg);
  root.setProperty("--nonet-board", p.board);
  root.setProperty("--nonet-cell-empty", p.cellEmpty);
  root.setProperty("--nonet-cell-filled", p.cellFilled);
  root.setProperty("--nonet-block-divider", p.blockDivider);
  root.setProperty("--nonet-accent", p.accent);
  root.setProperty("--nonet-text", p.text);
  root.setProperty("--nonet-text-dim", p.textDim);
  root.setProperty("--nonet-danger", p.danger);
  // Every palette's accent reads fine with fixed-dark button text (theme.css's
  // `--nonet-button-fg`) *except* light's — see theme.css's own comment.
  root.setProperty("--nonet-button-bg", isLight ? LIGHT_BUTTON_BG : p.accent);
  root.setProperty("color-scheme", isLight ? "light" : "dark");
  const webApp = getWebApp();
  webApp?.setHeaderColor?.(p.bg);
  webApp?.setBackgroundColor?.(p.bg);
}

const LIGHT_BUTTON_BG = "#84cc16";

const PALETTE_PROPERTIES = [
  "--nonet-bg",
  "--nonet-board",
  "--nonet-cell-empty",
  "--nonet-cell-filled",
  "--nonet-block-divider",
  "--nonet-accent",
  "--nonet-text",
  "--nonet-text-dim",
  "--nonet-danger",
  "--nonet-button-bg",
  "color-scheme",
] as const;

function clearPaletteOverride(): void {
  const root = document.documentElement.style;
  for (const prop of PALETTE_PROPERTIES) root.removeProperty(prop);
}

function applyResolvedTheme(): void {
  if (themeMode === "auto") {
    clearPaletteOverride();
    applyThemeParams(); // hand control back to Telegram's live theme immediately, not just on the next themeChanged
    return;
  }
  const palette = paletteFor(themeMode);
  // An unknown/not-(yet-)owned id (e.g. stale CloudStorage data from before
  // a theme purchase was later refunded, or plain corruption) falls back to
  // auto rather than leaving stale colors on screen from a previous mode.
  if (!palette) {
    clearPaletteOverride();
    applyThemeParams();
    return;
  }
  applyPalette(palette);
}

/** Reads any previously-chosen theme (CloudStorage, or its localStorage fallback outside Telegram) and applies it. Call once, before `syncTelegramTheme`. */
export async function loadThemePreference(): Promise<void> {
  const stored = await cloudGetItem(THEME_PREFERENCE_KEY);
  themeMode = stored ?? "auto";
  applyResolvedTheme();
}

export function getThemeMode(): ThemeMode {
  return themeMode;
}

/** `mode` should be "auto", "light", "dark", or an id the caller has already verified is owned (Settings screen's job — this function doesn't re-check). */
export function setThemeMode(mode: ThemeMode): void {
  themeMode = mode;
  cloudSetItem(THEME_PREFERENCE_KEY, mode);
  applyResolvedTheme();
}

// --- Haptics (§12) ---
// Gated on a user preference (default on) synced via CloudStorage, so
// "disable haptics" is a real setting rather than an all-or-nothing platform
// switch — every trigger call site stays a one-liner regardless.

const HAPTICS_PREFERENCE_KEY = "hapticsEnabled";
let hapticsEnabled = true;

export async function loadHapticsPreference(): Promise<void> {
  const stored = await cloudGetItem(HAPTICS_PREFERENCE_KEY);
  hapticsEnabled = stored !== "false";
}

export function isHapticsEnabled(): boolean {
  return hapticsEnabled;
}

export function setHapticsEnabled(enabled: boolean): void {
  hapticsEnabled = enabled;
  cloudSetItem(HAPTICS_PREFERENCE_KEY, String(enabled));
}

export function hapticImpact(style: HapticImpactStyle = "light"): void {
  if (!hapticsEnabled) return;
  getWebApp()?.HapticFeedback?.impactOccurred(style);
}

export function hapticNotification(type: HapticNotificationType): void {
  if (!hapticsEnabled) return;
  getWebApp()?.HapticFeedback?.notificationOccurred(type);
}

export function hapticSelection(): void {
  if (!hapticsEnabled) return;
  getWebApp()?.HapticFeedback?.selectionChanged();
}

// --- Language (§19) ---
// "auto" (default) follows Telegram's own `language_code` for the user;
// an explicit choice overrides it. Persisted via CloudStorage, same pattern
// as haptics/theme above.

const LANGUAGE_PREFERENCE_KEY = "languageMode";
let languageMode: LanguageMode = "auto";

function applyLanguageMode(): void {
  const resolved = languageMode === "auto" ? resolveLanguage(getTelegramLanguageCode()) : languageMode;
  void i18next.changeLanguage(resolved);
}

/** Reads any previously-chosen language (CloudStorage, or its localStorage fallback outside Telegram) and applies it. */
export async function loadLanguagePreference(): Promise<void> {
  const stored = await cloudGetItem(LANGUAGE_PREFERENCE_KEY);
  languageMode = stored && (stored === "auto" || isSupportedLanguage(stored)) ? (stored as LanguageMode) : "auto";
  applyLanguageMode();
}

export function getLanguageMode(): LanguageMode {
  return languageMode;
}

export function setLanguageMode(mode: LanguageMode): void {
  languageMode = mode;
  cloudSetItem(LANGUAGE_PREFERENCE_KEY, mode);
  applyLanguageMode();
}

// --- Share cards (§12) ---

/**
 * Opens Telegram's native "choose a chat" share sheet with a pre-filled
 * message linking back to this Mini App's own origin — the simplest share
 * flow that needs no bot-side inline-mode configuration. Falls back to a
 * plain `window.open` outside Telegram so the flow is still exercisable
 * (if not "native") in a normal browser during dev/testing.
 */
export function shareViaTelegram(text: string): void {
  const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${encodeURIComponent(text)}`;
  const webApp = getWebApp();
  if (webApp?.openTelegramLink) {
    webApp.openTelegramLink(shareUrl);
    return;
  }
  window.open(shareUrl, "_blank", "noopener,noreferrer");
}
