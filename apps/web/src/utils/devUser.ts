const STORAGE_KEY = "nonet:devUserId";

/** A stable per-browser fake Telegram user id, so local dev sessions (via
 * /api/session/dev) persist their inventory/progress across reloads instead
 * of minting a brand-new user every refresh. */
export function getOrCreateDevUserId(): number {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) return Number.parseInt(stored, 10);
  // Telegram user ids are well below 2^31; keep this comfortably inside a safe range.
  const id = 900_000_000 + Math.floor(Math.random() * 99_999_999);
  localStorage.setItem(STORAGE_KEY, String(id));
  return id;
}
