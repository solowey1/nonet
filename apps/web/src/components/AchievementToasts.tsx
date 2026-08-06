import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Award, X } from "lucide-react";
import { Toast, ToastDescription, ToastTitle, ToastViewport } from "@/components/ui/toast";
import { useGameStore } from "../store/gameStore.js";

/**
 * Announces newly unlocked achievements at the bottom of the screen instead of
 * listing them inline on the game-over card, where a good run could push the
 * buttons off-screen (§19 round 9).
 *
 * More than one at a time collapses into a *stack* — one card with the count,
 * plus a couple of decorative layers peeking out behind it — which the player
 * taps to expand into the full list. So the cost on screen is fixed no matter
 * how many landed at once.
 */

/** Collapsed toasts fade on their own; an expanded list is a deliberate read, so it waits for a tap. */
const AUTO_DISMISS_MS = 7000;
/** How many cards are drawn in the collapsed pile, including the front one. */
const MAX_PEEK_LAYERS = 3;

export function AchievementToasts() {
  const { t } = useTranslation();
  const ids = useGameStore((s) => s.achievementToasts);
  const dismiss = useGameStore((s) => s.dismissAchievementToasts);
  const [expanded, setExpanded] = useState(false);

  // A fresh batch always starts collapsed, even if the previous one was left open.
  useEffect(() => {
    setExpanded(false);
  }, [ids]);

  useEffect(() => {
    if (ids.length === 0 || expanded) return;
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [ids, expanded, dismiss]);

  if (ids.length === 0) return null;

  const many = ids.length > 1;

  if (expanded) {
    return (
      <ToastViewport>
        <Toast className="max-w-sm" role="status" aria-live="polite">
          <div className="mb-1.5 flex items-center gap-2">
            <ToastTitle className="flex-1">{t("achievements.toastStack", { count: ids.length })}</ToastTitle>
            <button
              type="button"
              aria-label={t("common.back")}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              onClick={dismiss}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          {/* Capped height so a very lucky run can't grow the card past the viewport. */}
          <ul className="flex max-h-[40vh] flex-col gap-1.5 overflow-y-auto">
            {ids.map((id) => (
              <li key={id} className="flex items-center gap-2">
                <Award className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate text-sm">{t(`achievements.names.${id}`)}</span>
              </li>
            ))}
          </ul>
        </Toast>
      </ToastViewport>
    );
  }

  const layers = Math.min(ids.length, MAX_PEEK_LAYERS);

  return (
    <ToastViewport>
      {/*
        The whole pile is one hit target: a tap expands a stack, or dismisses a
        lone toast. No separate affordance to aim at on a phone.
      */}
      <button
        type="button"
        className="pointer-events-auto relative w-full max-w-sm text-left outline-none"
        // Room for the peeking layers, which are translated up out of the card.
        style={{ marginTop: (layers - 1) * 8 }}
        onClick={() => (many ? setExpanded(true) : dismiss())}
      >
        {Array.from({ length: layers - 1 }, (_, i) => {
          const depth = layers - 1 - i; // furthest back first
          return (
            <div
              key={depth}
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 rounded-xl border border-border bg-card shadow-lg"
              style={{ transform: `translateY(${-depth * 8}px) scale(${1 - depth * 0.05})`, opacity: 1 - depth * 0.25 }}
            />
          );
        })}
        <Toast className="relative flex items-center gap-2.5" role="status" aria-live="polite">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/20 text-primary">
            <Award className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <ToastTitle className="truncate">
              {many ? t("achievements.toastStack", { count: ids.length }) : t(`achievements.names.${ids[0]}`)}
            </ToastTitle>
            <ToastDescription>{many ? t("achievements.toastExpandHint") : t("achievements.toastTitle")}</ToastDescription>
          </span>
        </Toast>
      </button>
    </ToastViewport>
  );
}
