/**
 * Telegram Mini App bridge (§12): initData for session auth, the drag-safety
 * tweaks, and the rest of the checklist that was deferred to the polish
 * phase — theme params, haptics, CloudStorage, and share cards.
 * `disableVerticalSwipes` is pulled forward from day one because it's not
 * optional for a game whose core interaction *is* dragging — without it,
 * dragging a piece downward closes the app.
 */

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

export function bootstrapTelegramWebApp(): void {
  const webApp = getWebApp();
  if (!webApp) return;
  webApp.ready();
  webApp.expand();
  webApp.disableVerticalSwipes?.();
  syncTelegramTheme();
  syncSafeAreaInsets();
  requestFullscreenIfNeeded();
  void loadHapticsPreference();
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
  const root = document.documentElement.style;
  const { themeParams: t } = webApp;
  if (t.bg_color) root.setProperty("--nonet-bg", t.bg_color);
  if (t.secondary_bg_color) root.setProperty("--nonet-board", t.secondary_bg_color);
  if (t.section_bg_color) root.setProperty("--nonet-cell-empty", t.section_bg_color);
  if (t.text_color) root.setProperty("--nonet-text", t.text_color);
  if (t.hint_color) root.setProperty("--nonet-text-dim", t.hint_color);
  if (t.button_color) root.setProperty("--nonet-accent", t.button_color);
  if (t.destructive_text_color) root.setProperty("--nonet-danger", t.destructive_text_color);
  root.setProperty("color-scheme", webApp.colorScheme);
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
