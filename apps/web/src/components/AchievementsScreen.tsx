import { useTranslation } from "react-i18next";
import { ArrowLeft, Award, Lock } from "lucide-react";
import { ACHIEVEMENTS, type AchievementProgress, type AchievementReward } from "@nonet/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { POWERUP_ICON } from "../utils/powerupIcon.js";

function RewardLine({ reward }: { reward: AchievementReward }) {
  const { t } = useTranslation();
  if (reward.kind === "inventory") {
    return (
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {Object.entries(reward.items).map(([item, qty]) => {
          const Icon = (POWERUP_ICON as Partial<Record<string, (typeof POWERUP_ICON)["pencil"]>>)[item];
          return (
            <span key={item} className="inline-flex items-center gap-1">
              {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : item} x{qty}
            </span>
          );
        })}
      </div>
    );
  }
  const fallback = Object.entries(reward.fallbackItems)
    .map(([item, qty]) => `${qty}x ${t(`inventory.${item}`, item)}`)
    .join(", ");
  return (
    <div className="text-xs text-muted-foreground">
      {t("achievements.rewardThemeOrFallback", { theme: t(`shop.themeNames.${reward.themeId}`), items: fallback })}
    </div>
  );
}

interface AchievementsScreenProps {
  readonly achievements: readonly AchievementProgress[] | null;
  readonly onClose: () => void;
}

export function AchievementsScreen({ achievements, onClose }: AchievementsScreenProps) {
  const { t } = useTranslation();
  return (
    <div
      className="absolute inset-0 z-[600] flex flex-col bg-background"
      role="dialog"
      aria-label={t("achievements.dialogLabel")}
    >
      <div
        className="flex items-center gap-2 border-b px-4 pb-2.5"
        style={{ paddingTop: "calc(10px + var(--nonet-safe-top))" }}
      >
        <Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={onClose}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Button>
        <span className="text-sm font-bold uppercase tracking-wide">{t("mainMenu.achievements")}</span>
      </div>
      <div
        className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3"
        style={{ paddingBottom: "calc(12px + var(--nonet-safe-bottom))" }}
      >
        {!achievements && <div className="py-6 text-center text-muted-foreground">{t("common.loading")}</div>}
        {achievements?.map((progress) => {
          const def = ACHIEVEMENTS.find((a) => a.id === progress.id);
          if (!def) return null;
          const pct =
            progress.progress.target > 0
              ? Math.min(100, (progress.progress.current / progress.progress.target) * 100)
              : 0;
          return (
            <div key={progress.id} className={cn("rounded-lg bg-muted p-3", !progress.unlocked && "opacity-70")}>
              <div className="flex items-start gap-2.5">
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                    progress.unlocked ? "bg-primary/20 text-primary" : "bg-background text-muted-foreground",
                  )}
                >
                  {progress.unlocked ? (
                    <Award className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{t(`achievements.names.${progress.id}`)}</span>
                    {progress.repeatable && progress.timesCompleted > 0 && (
                      <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[0.65rem] font-bold text-primary">
                        x{progress.timesCompleted}
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">{t(`achievements.descriptions.${progress.id}`)}</div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-background">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                  <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {Math.min(progress.progress.current, progress.progress.target).toLocaleString()} /{" "}
                    {progress.progress.target.toLocaleString()}
                  </div>
                  <div className="mt-1.5">
                    <RewardLine reward={def.reward} />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
