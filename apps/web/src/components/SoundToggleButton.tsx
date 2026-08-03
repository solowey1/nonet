import * as React from "react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { playSound } from "../audio/sounds.js";
import { hapticSelection, isSoundEnabled, setSoundEnabled } from "../telegram/webapp.js";

/**
 * Mute/unmute everything, without a trip to Settings (§19 round 7).
 *
 * Reads the preference once on mount rather than through shared store state:
 * every screen that renders this button (the menu, the game) is unmounted by
 * App's `switch (screen)` when navigating away, so a fresh mount always
 * re-reads the current value — and Settings' own toggle is a separate mount
 * for the same reason. No global reactive state needed for them to agree.
 */
export function SoundToggleButton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  const { t } = useTranslation();
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());

  return (
    <Button
      variant="secondary"
      size="icon"
      className={className}
      style={style}
      aria-label={t("settings.sound")}
      aria-pressed={soundOn}
      onClick={() => {
        const next = !soundOn;
        setSoundOn(next);
        setSoundEnabled(next);
        hapticSelection();
        // Ordered after setSoundEnabled — playSound reads that flag, so
        // turning sound back on can immediately demonstrate itself.
        if (next) playSound("grab");
      }}
    >
      {soundOn ? (
        <Volume2 className="h-[18px] w-[18px]" aria-hidden="true" />
      ) : (
        <VolumeX className="h-[18px] w-[18px]" aria-hidden="true" />
      )}
    </Button>
  );
}
