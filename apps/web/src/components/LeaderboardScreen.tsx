import { useEffect, useState } from "react";
import type { LeaderboardResponse, ProfileResponse } from "@nonet/shared";
import { getLeaderboard } from "../api/client.js";
import styles from "./LeaderboardScreen.module.css";

type Scope = "daily" | "weekly" | "all_time";

const SCOPE_LABEL: Record<Scope, string> = { daily: "Today", weekly: "This week", all_time: "All-time" };

interface LeaderboardScreenProps {
  readonly sessionToken: string | null;
  readonly profile: ProfileResponse | null;
  readonly onClose: () => void;
}

export function LeaderboardScreen({ sessionToken, profile, onClose }: LeaderboardScreenProps) {
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
        if (!cancelled) setError("Couldn't load the leaderboard.");
      });
    return () => {
      cancelled = true;
    };
  }, [tab, scope, pure, sessionToken]);

  return (
    <div className={styles.overlay} role="dialog" aria-label="Leaderboard">
      <div className={styles.header}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={styles.tab}
            data-active={tab === "leaderboard"}
            onClick={() => setTab("leaderboard")}
          >
            Leaderboard
          </button>
          <button type="button" className={styles.tab} data-active={tab === "mine"} onClick={() => setTab("mine")}>
            My Stats
          </button>
        </div>
        <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </div>

      {tab === "leaderboard" ? (
        <>
          <div className={styles.controls}>
            <div className={styles.scopes}>
              {(Object.keys(SCOPE_LABEL) as Scope[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  className={styles.scopeButton}
                  data-active={scope === s}
                  onClick={() => setScope(s)}
                >
                  {SCOPE_LABEL[s]}
                </button>
              ))}
            </div>
            <label className={styles.pureToggle}>
              <input type="checkbox" checked={pure} onChange={(e) => setPure(e.target.checked)} />
              Pure only
            </label>
          </div>

          <div className={styles.list}>
            {error && <div className={styles.message}>{error}</div>}
            {!data && !error && <div className={styles.message}>Loading…</div>}
            {data && data.entries.length === 0 && <div className={styles.message}>No scores yet — be the first!</div>}
            {data?.entries.map((entry) => (
              <div key={entry.userId} className={styles.row} data-me={entry.userId === data.me?.userId}>
                <span className={styles.rank}>#{entry.rank}</span>
                <span className={styles.name}>{entry.username ?? `Player ${entry.userId}`}</span>
                <span className={styles.score}>{entry.score.toLocaleString()}</span>
              </div>
            ))}
            {data && data.me && !data.entries.some((e) => e.userId === data.me?.userId) && (
              <>
                <div className={styles.divider} />
                <div className={styles.row} data-me>
                  <span className={styles.rank}>#{data.me.rank}</span>
                  <span className={styles.name}>{data.me.username ?? "You"}</span>
                  <span className={styles.score}>{data.me.score.toLocaleString()}</span>
                </div>
              </>
            )}
          </div>
        </>
      ) : (
        <div className={styles.list}>
          {!profile && <div className={styles.message}>Loading…</div>}
          {profile && (
            <>
              <div className={styles.statRow}>
                <span>Best score</span>
                <span className={styles.statValue}>{profile.bestRun ? profile.bestRun.score.toLocaleString() : "—"}</span>
              </div>
              <div className={styles.statRow}>
                <span>Runs played</span>
                <span className={styles.statValue}>{profile.stats.runsPlayed}</span>
              </div>
              <div className={styles.statRow}>
                <span>Pieces placed</span>
                <span className={styles.statValue}>{profile.stats.piecesPlaced}</span>
              </div>
              <div className={styles.statRow}>
                <span>Perfect clears</span>
                <span className={styles.statValue}>{profile.stats.perfectClears}</span>
              </div>
              <div className={styles.statRow}>
                <span>Daily streak</span>
                <span className={styles.statValue}>{profile.streak} 🔥</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
