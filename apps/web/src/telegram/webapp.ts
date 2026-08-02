/**
 * Minimal Telegram Mini App bridge — just enough to (a) get real `initData`
 * for session auth and (b) not break the moment someone drags a piece. The
 * rest of §12's checklist (haptics, theme params, CloudStorage, share cards)
 * is polish-phase work; `disableVerticalSwipes` is pulled forward because
 * it's not optional for a game whose core interaction *is* dragging —
 * without it, dragging a piece downward closes the app.
 */

export type InvoiceStatus = "paid" | "cancelled" | "failed" | "pending";

interface TelegramWebApp {
  initData: string;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  openInvoice?(url: string, callback: (status: InvoiceStatus) => void): void;
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
