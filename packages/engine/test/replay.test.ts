import { describe, expect, it } from "vitest";
import type { Action } from "../src/reduce.js";
import { detectSuperhumanApm, replay } from "../src/replay.js";
import { autoplay, seedFromIndex } from "./helpers/autoplay.js";

describe("replay property test", () => {
  it("reproduces the exact score and board for many random seeded games", () => {
    const N = 500;
    for (let i = 0; i < N; i++) {
      const seedBytes = seedFromIndex(i * 97 + 13);
      const { actions, finalState } = autoplay(seedBytes);
      const result = replay(seedBytes, actions);
      expect(result.valid, `seed index ${i} replay should be valid`).toBe(true);
      if (!result.valid) continue;
      expect(result.score).toBe(finalState.score);
      expect(result.finalState.board).toBe(finalState.board);
      expect(result.finalState.status).toBe(finalState.status);
    }
  });

  it("produces an identical rolling hash for two replays of the same log", () => {
    const seedBytes = seedFromIndex(42);
    const { actions } = autoplay(seedBytes);
    const a = replay(seedBytes, actions);
    const b = replay(seedBytes, actions);
    expect(a.valid && b.valid).toBe(true);
    if (a.valid && b.valid) expect(a.hash).toBe(b.hash);
  });

  it("a different seed produces a different hash (sanity: hash isn't a constant)", () => {
    const seedA = seedFromIndex(1);
    const seedB = seedFromIndex(2);
    const a = autoplay(seedA);
    const b = autoplay(seedB);
    const resultA = replay(seedA, a.actions);
    const resultB = replay(seedB, b.actions);
    expect(resultA.valid && resultB.valid).toBe(true);
    if (resultA.valid && resultB.valid) expect(resultA.hash).not.toBe(resultB.hash);
  });

  it("a tampered action log fails verification or diverges from the legitimate hash/score", () => {
    const seedBytes = seedFromIndex(1);
    const { actions } = autoplay(seedBytes, 20);
    expect(actions.length).toBeGreaterThan(0);

    const tampered = actions.slice();
    const first = tampered[0] as Action & { type: "place" };
    tampered[0] = { ...first, slot: ((first.slot + 1) % 3) as 0 | 1 | 2 };

    const result = replay(seedBytes, tampered);
    if (result.valid) {
      const legit = replay(seedBytes, actions);
      expect(legit.valid && (result.hash !== legit.hash || result.score !== legit.score)).toBe(true);
    } else {
      expect(result.reason).toBe("illegal_action");
    }
  });

  it("flags a superhuman sustained action rate", () => {
    const actions: Action[] = [];
    for (let i = 0; i < 40; i++) {
      actions.push({ t: i * 50, type: "place", slot: 0, r: 0, c: 0 }); // 20 actions/sec sustained
    }
    const result = replay(seedFromIndex(2), actions);
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toBe("superhuman_apm");
  });

  it("does not flag a normal human-paced action log", () => {
    const check = detectSuperhumanApm(
      Array.from({ length: 10 }, (_, i) => ({ t: i * 300, type: "place" as const, slot: 0 as const, r: 0, c: 0 })),
    );
    expect(check.flagged).toBe(false);
  });
});
