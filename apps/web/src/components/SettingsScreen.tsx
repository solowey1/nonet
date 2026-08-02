import { useEffect, useState } from "react";
import { ArrowLeft, Check, Link2, Lock, Vibrate } from "lucide-react";
import { PREMIUM_THEMES, themeInventoryKey } from "@nonet/shared";
import { postWalletLink } from "../api/client.js";
import { useGameStore } from "../store/gameStore.js";
import {
  getThemeMode,
  hapticSelection,
  isHapticsEnabled,
  setHapticsEnabled,
  setThemeMode,
  type ThemeMode,
} from "../telegram/webapp.js";
import { currentWalletAddress, disconnectWallet, onWalletChange, openWalletConnectModal } from "../telegram/tonConnect.js";
import styles from "./SettingsScreen.module.css";

function formatWalletAddress(address: string): string {
  return address.length > 10 ? `${address.slice(0, 4)}…${address.slice(-4)}` : address;
}

const BASE_THEMES: ReadonlyArray<{ mode: ThemeMode; label: string }> = [
  { mode: "auto", label: "Auto" },
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
];

export function SettingsScreen() {
  const inventory = useGameStore((s) => s.inventory);
  const sessionToken = useGameStore((s) => s.sessionToken);
  const goToMenu = useGameStore((s) => s.goToMenu);
  const goToShop = useGameStore((s) => s.goToShop);
  const loadProfile = useGameStore((s) => s.loadProfile);

  const [themeMode, setThemeModeState] = useState<ThemeMode>(() => getThemeMode());
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <button type="button" className={styles.back} aria-label="Back" onClick={goToMenu}>
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <span className={styles.title}>Settings</span>
      </div>

      <div className={styles.content}>
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Theme</h2>
          <div className={styles.themeGrid}>
            {BASE_THEMES.map(({ mode, label }) => (
              <button
                key={mode}
                type="button"
                className={styles.themeOption}
                data-active={themeMode === mode}
                onClick={() => selectTheme(mode)}
              >
                <span>{label}</span>
                {themeMode === mode && <Check size={16} aria-hidden="true" />}
              </button>
            ))}
            {PREMIUM_THEMES.map((theme) => {
              const owned = (inventory[themeInventoryKey(theme.id)] ?? 0) > 0;
              return (
                <button
                  key={theme.id}
                  type="button"
                  className={styles.themeOption}
                  data-active={themeMode === theme.id}
                  data-locked={!owned}
                  onClick={() => {
                    if (!owned) {
                      hapticSelection();
                      goToShop();
                      return;
                    }
                    selectTheme(theme.id);
                  }}
                >
                  <span className={styles.swatch} style={{ background: theme.palette.accent }} aria-hidden="true" />
                  <span>{theme.title}</span>
                  {owned ? themeMode === theme.id && <Check size={16} aria-hidden="true" /> : <Lock size={14} aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Feedback</h2>
          <label className={styles.toggleRow}>
            <span className={styles.toggleLabel}>
              <Vibrate size={18} aria-hidden="true" />
              Haptic feedback
            </span>
            <input
              type="checkbox"
              checked={hapticsOn}
              onChange={(e) => {
                const next = e.target.checked;
                setHapticsOn(next);
                setHapticsEnabled(next);
                if (next) hapticSelection(); // immediate confirmation that it's back on
              }}
            />
          </label>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Wallet</h2>
          {walletAddress ? (
            <div className={styles.walletRow}>
              <span className={styles.walletAddress}>
                <Link2 size={16} aria-hidden="true" /> {formatWalletAddress(walletAddress)}
              </span>
              <button
                type="button"
                className={styles.walletButton}
                disabled={walletBusy}
                onClick={() => {
                  hapticSelection();
                  setWalletBusy(true);
                  void disconnectWallet().finally(() => setWalletBusy(false));
                }}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.walletConnectButton}
              disabled={walletBusy}
              onClick={() => {
                hapticSelection();
                setWalletBusy(true);
                void openWalletConnectModal().finally(() => setWalletBusy(false));
              }}
            >
              <Link2 size={16} aria-hidden="true" />
              Connect wallet for future Gram rewards
            </button>
          )}
        </section>
      </div>
    </div>
  );
}
