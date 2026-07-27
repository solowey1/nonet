import { describe, expect, it } from "vitest";
import {
  createRngFromBytes,
  createRngFromHex,
  createRngFromSeed,
  nextFloat,
  nextInt,
  nextUint32,
  pickWeightedIndex,
} from "../src/rng.js";

describe("rng", () => {
  it("is deterministic for a given seed", () => {
    const a = createRngFromSeed(42n);
    const b = createRngFromSeed(42n);
    let sa = a;
    let sb = b;
    const outA: number[] = [];
    const outB: number[] = [];
    for (let i = 0; i < 20; i++) {
      const [va, na] = nextUint32(sa);
      const [vb, nb] = nextUint32(sb);
      outA.push(va);
      outB.push(vb);
      sa = na;
      sb = nb;
    }
    expect(outA).toEqual(outB);
  });

  it("diverges for different seeds", () => {
    let sa = createRngFromSeed(1n);
    let sb = createRngFromSeed(2n);
    const outA: number[] = [];
    const outB: number[] = [];
    for (let i = 0; i < 10; i++) {
      const [va, na] = nextUint32(sa);
      const [vb, nb] = nextUint32(sb);
      outA.push(va);
      outB.push(vb);
      sa = na;
      sb = nb;
    }
    expect(outA).not.toEqual(outB);
  });

  it("round-trips a 128-bit hex seed and stays deterministic", () => {
    const hex = "0123456789abcdeffedcba9876543210";
    const a = createRngFromHex(hex);
    const b = createRngFromHex(hex);
    const [va] = nextUint32(a);
    const [vb] = nextUint32(b);
    expect(va).toBe(vb);
  });

  it("createRngFromBytes never lands on the invalid all-zero state", () => {
    const state = createRngFromBytes(new Uint8Array(16));
    expect(state.s0 === 0n && state.s1 === 0n).toBe(false);
  });

  it("nextFloat stays within [0, 1)", () => {
    let state = createRngFromSeed(7n);
    for (let i = 0; i < 1000; i++) {
      const [f, next] = nextFloat(state);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
      state = next;
    }
  });

  it("nextInt respects the exclusive upper bound", () => {
    let state = createRngFromSeed(99n);
    for (let i = 0; i < 1000; i++) {
      const [v, next] = nextInt(state, 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      state = next;
    }
  });

  it("pickWeightedIndex never picks a zero-weight entry", () => {
    let state = createRngFromSeed(123n);
    const weights = [0, 5, 0, 3, 0];
    for (let i = 0; i < 500; i++) {
      const [idx, next] = pickWeightedIndex(state, weights);
      expect([1, 3]).toContain(idx);
      state = next;
    }
  });

  it("pickWeightedIndex roughly matches weight proportions over many draws", () => {
    let state = createRngFromSeed(555n);
    const weights = [1, 3];
    const counts = [0, 0];
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const [idx, next] = pickWeightedIndex(state, weights);
      counts[idx] = (counts[idx] ?? 0) + 1;
      state = next;
    }
    const ratio = (counts[1] ?? 0) / (counts[0] ?? 1);
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });
});
