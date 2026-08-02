/**
 * Abbreviates counts of 1000+ as e.g. "1k"/"1.2k" (English) or "1к"/"1.2к"
 * (Russian) — a 3-4 digit inventory count next to a small icon otherwise
 * doesn't fit (§19). `thousandsSuffix` is a translated string (see
 * `common.thousandsSuffix` in the locale files), not hardcoded, so it reads
 * correctly regardless of the active language.
 */
export function formatCount(count: number, thousandsSuffix: string): string {
  if (count < 1000) return String(count);
  const thousands = Math.round(count / 100) / 10; // one decimal place
  const text = Number.isInteger(thousands) ? String(thousands) : thousands.toFixed(1);
  return `${text}${thousandsSuffix}`;
}
