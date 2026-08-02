/**
 * i18n (§19): every user-facing string in the app goes through this, no
 * hardcoded literals in components. "Auto" (the default) follows Telegram's
 * own `language_code` for the user; an explicit choice in Settings overrides
 * it, persisted the same way as haptics/theme (CloudStorage, localStorage
 * fallback outside Telegram).
 */
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { en } from "./locales/en.js";
import { ru } from "./locales/ru.js";

export const SUPPORTED_LANGUAGES = ["en", "ru"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export type LanguageMode = "auto" | SupportedLanguage;

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Telegram/browser language tags are like "ru-RU" — only the base tag matters for picking a resource bundle. */
export function resolveLanguage(tag: string | null | undefined): SupportedLanguage {
  const base = tag?.split("-")[0]?.toLowerCase();
  return base && isSupportedLanguage(base) ? base : "en";
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: "en", // resolved to the real starting language by initLanguage() below, before first render
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
});

export default i18next;
