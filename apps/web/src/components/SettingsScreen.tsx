import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Check, Link2, Lock, Vibrate } from "lucide-react";
import { PREMIUM_THEMES, themeInventoryKey } from "@nonet/shared";
import { postWalletLink } from "../api/client.js";
import { useGameStore } from "../store/gameStore.js";
import {
  getLanguageMode,
  getThemeMode,
  hapticSelection,
  isHapticsEnabled,
  setHapticsEnabled,
  setLanguageMode,
  setThemeMode,
  type LanguageMode,
  type ThemeMode,
} from "../telegram/webapp.js";
import { currentWalletAddress, disconnectWallet, onWalletChange, openWalletConnectModal } from "../telegram/tonConnect.js";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

function formatWalletAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

const BASE_THEMES: readonly { mode: ThemeMode; labelKey: string }[] = [
  { mode: "auto", labelKey: "settings.themeAuto" },
  { mode: "light", labelKey: "settings.themeLight" },
  { mode: "dark", labelKey: "settings.themeDark" },
];

const LANGUAGES: readonly { mode: LanguageMode; labelKey: string }[] = [
  { mode: "auto", labelKey: "settings.languageAuto" },
  { mode: "en", labelKey: "settings.languageEn" },
  { mode: "ru", labelKey: "settings.languageRu" },
];

function themeOptionClasses(active: boolean, locked: boolean) {
  return cn(
    "flex min-h-12 items-center gap-2 rounded-lg border bg-muted px-3.5 py-2.5 text-sm",
    active ? "border-primary text-primary" : "border-border text-foreground",
    locked && "text-muted-foreground",
  );
}

export function SettingsScreen() {
  const { t } = useTranslation();
  const inventory = useGameStore((s) => s.inventory);
  const sessionToken = useGameStore((s) => s.sessionToken);
  const goToMenu = useGameStore((s) => s.goToMenu);
  const goToShop = useGameStore((s) => s.goToShop);
  const loadProfile = useGameStore((s) => s.loadProfile);

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
  const [languageMode, setLanguageModeState] = useState<LanguageMode>(() => getLanguageMode());
  const [hapticsOn, setHapticsOn] = useState(() => isHapticsEnabled());
  const [walletAddress, setWalletAddress] = useState<string | null>(() => currentWalletAddress());
  const [walletBusy, setWalletBusy] = useState(false);

  // TonConnectUI fires once immediately with whatever session it already
  // restored on load (or null), then again on every connect/disconnect —
  // each firing is persisted server-side (§14 stub: address capture only).
  useEffect(() => {
    return onWalletChange((address) => {
      setWalletAddress(address);
      if (!sessionToken) return;
      void postWalletLink(sessionToken, address)
        .then(() => void loadProfile())
        .catch((err) => console.error("failed to persist wallet link", err));
    });
  }, [sessionToken, loadProfile]);

  const selectTheme = (mode: ThemeMode) => {
    hapticSelection();
    setThemeMode(mode);
    setThemeModeState(mode);
  };

  const selectLanguage = (mode: LanguageMode) => {
    hapticSelection();
    setLanguageMode(mode);
    setLanguageModeState(mode);
  };

  return (
    <div className="absolute inset-0 z-[600] flex flex-col bg-background">
      <div
        className="flex items-center gap-2 border-b px-4 pb-2.5"
        style={{ paddingTop: "calc(10px + var(--nonet-safe-top))" }}
      >
        <Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={goToMenu}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <span className="text-sm font-bold uppercase tracking-wide">{t("settings.title")}</span>
      </div>

      <div
        className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 py-4"
        style={{ paddingBottom: "calc(16px + var(--nonet-safe-bottom))" }}
      >
        <section className="flex flex-col gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("settings.theme")}</h2>
          <div className="grid grid-cols-2 gap-2">
            {BASE_THEMES.map(({ mode, labelKey }) => (
              <button key={mode} type="button" className={themeOptionClasses(themeMode === mode, false)} onClick={() => selectTheme(mode)}>
                <span className="flex-1 text-left">{t(labelKey)}</span>
                {themeMode === mode && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
            {PREMIUM_THEMES.map((theme) => {
              const owned = (inventory[themeInventoryKey(theme.id)] ?? 0) > 0;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={themeOptionClasses(themeMode === theme.id, !owned)}
                  onClick={() => {
                    if (!owned) {
                      hapticSelection();
                      goToShop();
                      return;
                    }
                    selectTheme(theme.id);
                  }}
                >
                  <span className="h-4 w-4 shrink-0 rounded-full" style={{ background: theme.palette.accent }} aria-hidden="true" />
                  <span className="flex-1 text-left">{t(`shop.themeNames.${theme.id}`)}</span>
                  {owned ? (
                    themeMode === theme.id && <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("settings.language")}</h2>
          <div className="grid grid-cols-3 gap-2">
            {LANGUAGES.map(({ mode, labelKey }) => (
              <button
                key={mode}
                type="button"
                className={themeOptionClasses(languageMode === mode, false)}
                onClick={() => selectLanguage(mode)}
              >
                <span className="flex-1 text-left">{t(labelKey)}</span>
                {languageMode === mode && <Check className="h-4 w-4" aria-hidden="true" />}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("settings.feedback")}</h2>
          <label className="flex min-h-12 cursor-pointer items-center justify-between rounded-lg bg-muted px-3.5 py-2.5">
            <span className="flex items-center gap-2">
              <Vibrate className="h-[18px] w-[18px]" aria-hidden="true" />
              {t("settings.haptics")}
            </span>
            <Switch
              checked={hapticsOn}
              onCheckedChange={(next) => {
                setHapticsOn(next);
                setHapticsEnabled(next);
                if (next) hapticSelection(); // immediate confirmation that it's back on
              }}
            />
          </label>
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{t("settings.wallet")}</h2>
          {walletAddress ? (
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 text-sm tabular-nums text-muted-foreground">
                <Link2 className="h-4 w-4" aria-hidden="true" /> {formatWalletAddress(walletAddress)}
              </span>
              <Button
                variant="outline"
                disabled={walletBusy}
                onClick={() => {
                  hapticSelection();
                  setWalletBusy(true);
                  void disconnectWallet().finally(() => setWalletBusy(false));
                }}
              >
                {t("settings.walletDisconnect")}
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              disabled={walletBusy}
              onClick={() => {
                hapticSelection();
                setWalletBusy(true);
                void openWalletConnectModal().finally(() => setWalletBusy(false));
              }}
            >
              <Link2 className="h-4 w-4" aria-hidden="true" />
              {t("settings.walletConnect")}
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
