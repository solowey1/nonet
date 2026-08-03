import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Flame, Share2 } from "lucide-react";
import type { LeaderboardResponse, ProfileResponse } from "@nonet/shared";
import { getLeaderboard } from "../api/client.js";
import { hapticSelection, shareViaTelegram } from "../telegram/webapp.js";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

type Scope = "daily" | "weekly" | "all_time";

const SCOPE_KEYS: Record<Scope, string> = {
  daily: "leaderboard.scopeDaily",
  weekly: "leaderboard.scopeWeekly",
  all_time: "leaderboard.scopeAllTime",
};

interface LeaderboardScreenProps {
  readonly sessionToken: string | null;
  readonly profile: ProfileResponse | null;
  readonly onClose: () => void;
}

export function LeaderboardScreen({ sessionToken, profile, onClose }: LeaderboardScreenProps) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"leaderboard" | "mine">("leaderboard");
  const [scope, setScope] = useState<Scope>("all_time");
  const [pure, setPure] = useState(false);
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (tab !== "leaderboard") return;
    let cancelled = false;
    setData(null);
    setError(null);
    getLeaderboard({ scope, pure }, sessionToken)
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        console.error("failed to load leaderboard", err);
        if (!cancelled) setError(t("leaderboard.loadError"));
      });
    return () => {
      cancelled = true;
    };
  }, [tab, scope, pure, sessionToken, t]);

  return (
    <div className="absolute inset-0 z-[600] flex flex-col bg-background" role="dialog" aria-label={t("leaderboard.dialogLabel")}>
      <Tabs value={tab} onValueChange={(v) => setTab(v as "leaderboard" | "mine")}>
        <div
          className="flex items-center gap-2 border-b px-2 pb-0"
          style={{ paddingTop: "calc(10px + var(--nonet-safe-top))" }}
        >
          <Button variant="ghost" size="icon" aria-label={t("common.back")} onClick={onClose}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Button>
          <TabsList
            className="h-auto rounded-none bg-transparent p-0"
            onClick={() => hapticSelection()}
          >
            <TabsTrigger
              value="leaderboard"
              className="h-11 rounded-none border-b-2 border-transparent bg-transparent px-3.5 font-semibold text-muted-foreground aria-selected:border-primary aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none data-[active]:border-primary data-[active]:bg-transparent data-[active]:text-foreground data-[active]:shadow-none"
            >
              {t("leaderboard.tabLeaderboard")}
            </TabsTrigger>
            <TabsTrigger
              value="mine"
              className="h-11 rounded-none border-b-2 border-transparent bg-transparent px-3.5 font-semibold text-muted-foreground aria-selected:border-primary aria-selected:bg-transparent aria-selected:text-foreground aria-selected:shadow-none data-[active]:border-primary data-[active]:bg-transparent data-[active]:text-foreground data-[active]:shadow-none"
            >
              {t("leaderboard.tabMine")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="leaderboard">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5">
            <div className="flex gap-1.5">
              {(Object.keys(SCOPE_KEYS) as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={cn(
                    "min-h-8 rounded-lg border px-2.5 text-xs",
                    scope === s ? "border-primary text-primary" : "border-border text-muted-foreground",
                  )}
                  onClick={() => {
                    hapticSelection();
                    setScope(s);
                  }}
                >
                  {t(SCOPE_KEYS[s])}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
              <Checkbox checked={pure} onCheckedChange={(checked) => setPure(checked === true)} />
              {t("leaderboard.pureOnly")}
            </label>
          </div>

          <div
            className="flex flex-col gap-1 overflow-y-auto px-4 pb-4"
            style={{ paddingBottom: "calc(16px + var(--nonet-safe-bottom))" }}
          >
            {error && <div className="py-6 text-center text-muted-foreground">{error}</div>}
            {!data && !error && <div className="py-6 text-center text-muted-foreground">{t("common.loading")}</div>}
            {data && data.entries.length === 0 && (
              <div className="py-6 text-center text-muted-foreground">{t("leaderboard.empty")}</div>
            )}
            {data?.entries.map((entry) => (
              <div
                key={entry.userId}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-2.5 py-2",
                  entry.userId === data.me?.userId && "bg-primary/15",
                )}
              >
                <span className="min-w-10 tabular-nums text-muted-foreground">#{entry.rank}</span>
                <span className="flex-1 truncate">{entry.username ?? t("leaderboard.player", { id: entry.userId })}</span>
                <span className="font-bold tabular-nums">{entry.score.toLocaleString()}</span>
              </div>
            ))}
            {data && data.me && !data.entries.some((e) => e.userId === data.me?.userId) && (
              <>
                <div className="my-1 border-t border-dashed border-border" />
                <div className="flex items-center gap-2.5 rounded-lg bg-primary/15 px-2.5 py-2">
                  <span className="min-w-10 tabular-nums text-muted-foreground">#{data.me.rank}</span>
                  <span className="flex-1 truncate">{data.me.username ?? t("leaderboard.you")}</span>
                  <span className="font-bold tabular-nums">{data.me.score.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        </TabsContent>

        <TabsContent value="mine">
          <div
            className="flex flex-col gap-1 overflow-y-auto px-4 py-3"
            style={{ paddingBottom: "calc(16px + var(--nonet-safe-bottom))" }}
          >
            {!profile && <div className="py-6 text-center text-muted-foreground">{t("common.loading")}</div>}
            {profile && (
              <>
                <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-3">
                  <span>{t("leaderboard.bestScore")}</span>
                  <span className="font-bold tabular-nums">
                    {profile.bestRun ? profile.bestRun.score.toLocaleString() : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-3">
                  <span>{t("leaderboard.runsPlayed")}</span>
                  <span className="font-bold tabular-nums">{profile.stats.runsPlayed}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-3">
                  <span>{t("leaderboard.piecesPlaced")}</span>
                  <span className="font-bold tabular-nums">{profile.stats.piecesPlaced}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-3">
                  <span>{t("leaderboard.perfectClears")}</span>
                  <span className="font-bold tabular-nums">{profile.stats.perfectClears}</span>
                </div>
                <div className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-3">
                  <span>{t("leaderboard.dailyStreak")}</span>
                  <span className="inline-flex items-center gap-1 font-bold tabular-nums">
                    {profile.streak} <Flame className="h-4 w-4" aria-hidden="true" />
                  </span>
                </div>
                {profile.bestRun && (
                  <Button
                    variant="outline"
                    className="mt-2"
                    onClick={() => {
                      hapticSelection();
                      shareViaTelegram(t("leaderboard.shareText", { score: profile.bestRun?.score.toLocaleString() }));
                    }}
                  >
                    <Share2 className="h-4 w-4" aria-hidden="true" /> {t("leaderboard.share")}
                  </Button>
                )}
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
