/**
 * Sound effects (§12 feedback, §19 round 6) — synthesized at runtime with the
 * Web Audio API rather than loaded from audio files.
 *
 * Every sound this game needs is a short arcade one-shot (a pluck, a thunk, a
 * sweep, a boom), which is exactly what oscillators, gain envelopes, and
 * filtered noise produce well. Generating them here instead of shipping
 * `.mp3`/`.ogg` assets means: nothing added to the bundle or the network
 * budget (§16) beyond this file, no binary blobs in git, and every sound stays
 * editable as code — the same reason the theme system is custom properties
 * rather than pre-rendered images. If a future round wants richer, sampled
 * audio, the call sites below don't change: only the bodies of the synth
 * functions do.
 *
 * Autoplay policy: mobile WebViews (Telegram's included) refuse to start an
 * AudioContext until a real user gesture. `installAudioUnlock()` hooks the
 * first pointer/touch/click anywhere in the app — of which there is always one
 * before any sound-producing action — so no "tap to enable sound" prompt is
 * ever needed.
 */

import type { ThemeSoundProfile } from "@nonet/shared";
import { getThemeSoundProfile, isSoundEnabled } from "../telegram/webapp.js";

export type SoundName =
  | "grab"
  | "place"
  | "clear"
  | "perfectClear"
  | "gameOver"
  | "revive"
  | "pencil"
  | "eraser"
  | "rocket"
  | "bomb"
  | "fill";

/**
 * Everything is mixed through one master gain well below 1.0: these are
 * synthetic tones with hard transients, which read as far louder (and
 * harsher) than sampled audio at the same nominal amplitude.
 */
const MASTER_VOLUME = 0.22;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/**
 * Creates the context on first use. Deliberately NOT called at module load:
 * a context constructed before a user gesture starts life suspended (and on
 * some platforms logs a warning), so it's built the moment the first gesture
 * arrives instead — see `installAudioUnlock`.
 */
function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null; // no Web Audio (very old WebView) — every play() below becomes a no-op
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = MASTER_VOLUME;
  master.connect(ctx.destination);
  return ctx;
}

/** One second of white noise, generated once and re-used by every noise-based sound. */
function getNoiseBuffer(c: AudioContext): AudioBuffer {
  if (noiseBuffer) return noiseBuffer;
  const length = Math.floor(c.sampleRate);
  const buffer = c.createBuffer(1, length, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  noiseBuffer = buffer;
  return buffer;
}

interface ToneOptions {
  readonly type: OscillatorType;
  readonly freq: number;
  /** Glides to this frequency across `dur` when set — the sweep behind rocket/bomb/fill. */
  readonly toFreq?: number;
  /** Seconds from "now" to start, for scheduling arpeggios without timers. */
  readonly at: number;
  readonly dur: number;
  readonly peak: number;
  readonly attack?: number;
}

function tone(o: ToneOptions): void {
  const c = ctx;
  const m = master;
  if (!c || !m) return;
  const t0 = c.currentTime + o.at;
  const osc = c.createOscillator();
  const gain = c.createGain();

  osc.type = o.type;
  osc.detune.setValueAtTime(voice().detune, t0);
  osc.frequency.setValueAtTime(o.freq, t0);
  if (o.toFreq !== undefined) {
    // Exponential ramps can't touch 0 — clamp rather than silently throwing.
    osc.frequency.exponentialRampToValueAtTime(Math.max(o.toFreq, 1), t0 + o.dur);
  }

  const attack = o.attack ?? 0.004;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(o.peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  osc.connect(gain);
  gain.connect(m);
  osc.start(t0);
  osc.stop(t0 + o.dur + 0.02);
}

interface NoiseOptions {
  readonly at: number;
  readonly dur: number;
  readonly peak: number;
  readonly filter: BiquadFilterType;
  readonly freq: number;
  /** Sweeps the filter across `dur` when set — what turns a flat hiss into a whoosh. */
  readonly toFreq?: number;
  readonly q?: number;
  readonly attack?: number;
}

function noise(o: NoiseOptions): void {
  const c = ctx;
  const m = master;
  if (!c || !m) return;
  const t0 = c.currentTime + o.at;
  const src = c.createBufferSource();
  const filter = c.createBiquadFilter();
  const gain = c.createGain();

  src.buffer = getNoiseBuffer(c);
  // Start at a random offset so repeated hits (a run of pencil taps) don't
  // replay the byte-identical slice of noise and read as a looping artifact.
  const offset = Math.random() * Math.max(0, (src.buffer?.duration ?? 1) - o.dur - 0.05);

  filter.type = o.filter;
  filter.frequency.setValueAtTime(o.freq, t0);
  if (o.toFreq !== undefined) filter.frequency.exponentialRampToValueAtTime(Math.max(o.toFreq, 1), t0 + o.dur);
  if (o.q !== undefined) filter.Q.value = o.q;

  const attack = o.attack ?? 0.003;
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.linearRampToValueAtTime(o.peak, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

  src.connect(filter);
  filter.connect(gain);
  gain.connect(m);
  src.start(t0, offset);
  src.stop(t0 + o.dur + 0.02);
}

/** Major pentatonic, in semitones — no interval in it can clash, so an arpeggio of any length stays consonant. */
const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26];
/** Minor pentatonic: the retro voice's darker scale, which is what makes synthwave sound like synthwave. */
const MINOR_PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22, 24, 27];

/**
 * A theme can re-voice the whole synth (§19 round 9). Rather than duplicating
 * every sound per theme, each voice is a small set of substitutions the
 * existing sound bodies read: which waveform stands in for the "body" of a
 * tone, which scale arpeggios walk, and a global detune. Retrowave's square
 * body and minor scale are the entire difference between the two voices.
 */
interface Voice {
  readonly body: OscillatorType;
  readonly lead: OscillatorType;
  readonly scale: readonly number[];
  readonly detune: number;
}

const VOICES: Record<ThemeSoundProfile, Voice> = {
  default: { body: "triangle", lead: "sine", scale: PENTATONIC, detune: 0 },
  // Square + sawtooth is the classic chiptune/synthwave timbre; the slight
  // flat detune keeps it from sounding like a clean modern synth.
  retro: { body: "square", lead: "sawtooth", scale: MINOR_PENTATONIC, detune: -8 },
};

function voice(): Voice {
  return VOICES[getThemeSoundProfile()] ?? VOICES.default;
}

function semitone(base: number, steps: number): number {
  return base * Math.pow(2, steps / 12);
}

/**
 * A clear's sound scales with the move that caused it: more units cleared at
 * once means a longer arpeggio, and a higher combo starts it higher up the
 * scale — so the audio tracks the same "that was a big move" signal the
 * score and the combo readout already show (§6 round 5 made both of those
 * scale too).
 */
function playClear(unitsCleared: number, comboLevel: number): void {
  const v = voice();
  const notes = Math.min(2 + Math.max(unitsCleared, 1), 7);
  const base = semitone(392, Math.min(Math.max(comboLevel - 1, 0), 7)); // G4, shifted up by combo
  for (let i = 0; i < notes; i++) {
    tone({
      type: v.body,
      freq: semitone(base, v.scale[i] ?? 0),
      at: i * 0.052,
      dur: 0.19,
      peak: 0.5,
    });
  }
}

function playPerfectClear(): void {
  const v = voice();
  // Same shape as a normal clear but longer, brighter, and with an octave
  // shimmer on top — the audio counterpart of the "success" haptic that
  // already fires only here.
  for (let i = 0; i < 8; i++) {
    const freq = semitone(523.25, v.scale[i] ?? 0); // C5
    tone({ type: v.body, freq, at: i * 0.045, dur: 0.26, peak: 0.5 });
    tone({ type: v.lead, freq: freq * 2, at: i * 0.045, dur: 0.3, peak: 0.16 });
  }
}

function playSoundInternal(name: SoundName, intensity: number, comboLevel: number): void {
  switch (name) {
    // A "pinch": short, bright, rising — reads as picking something up
    // rather than putting it down (which `place` deliberately inverts).
    case "grab":
      tone({ type: voice().body, freq: 520, toFreq: 790, at: 0, dur: 0.075, peak: 0.5 });
      break;

    // A soft thunk: a pitch drop for the weight, plus a tiny filtered-noise
    // transient for the contact "tap".
    case "place":
      tone({ type: voice().body, freq: 240, toFreq: 130, at: 0, dur: 0.11, peak: 0.62 });
      noise({ at: 0, dur: 0.045, peak: 0.22, filter: "lowpass", freq: 2200 });
      break;

    case "clear":
      playClear(intensity, comboLevel);
      break;

    case "perfectClear":
      playPerfectClear();
      break;

    // Descending minor-ish fall — the one unambiguously "down" sound here.
    case "gameOver":
      tone({ type: voice().body, freq: 392, at: 0, dur: 0.22, peak: 0.5 });
      tone({ type: voice().body, freq: 311, at: 0.15, dur: 0.24, peak: 0.5 });
      tone({ type: voice().body, freq: 233, at: 0.32, dur: 0.5, peak: 0.55 });
      break;

    // Warm rising triad: the reward for spending a revive.
    case "revive":
      tone({ type: voice().body, freq: 261.63, at: 0, dur: 0.3, peak: 0.45 });
      tone({ type: voice().body, freq: 329.63, at: 0.09, dur: 0.3, peak: 0.45 });
      tone({ type: voice().body, freq: 392, at: 0.18, dur: 0.42, peak: 0.5 });
      tone({ type: voice().lead, freq: 523.25, at: 0.27, dur: 0.5, peak: 0.3 });
      break;

    // --- Power-ups: each gets a distinct timbre, not just a distinct pitch,
    // so they're told apart by ear without having to learn a scale (§19). ---

    // Pencil: a single tiny scratch — the smallest, driest sound in the set.
    case "pencil":
      noise({ at: 0, dur: 0.055, peak: 0.3, filter: "highpass", freq: 2600 });
      tone({ type: "square", freq: 900, toFreq: 1250, at: 0, dur: 0.05, peak: 0.12 });
      break;

    // Eraser: a softer, longer swish — same "rubbing" family as pencil, wider and duller.
    case "eraser":
      noise({ at: 0, dur: 0.2, peak: 0.34, filter: "bandpass", freq: 1900, toFreq: 700, q: 1.1 });
      break;

    // Rocket: a whoosh — filter sweeping up fast, with a rising body under it.
    case "rocket":
      noise({ at: 0, dur: 0.34, peak: 0.36, filter: "bandpass", freq: 420, toFreq: 4200, q: 1.4 });
      tone({ type: "sawtooth", freq: 180, toFreq: 900, at: 0, dur: 0.3, peak: 0.22 });
      break;

    // Bomb: the heaviest sound here — a low body drop plus a broad low-passed blast.
    case "bomb":
      tone({ type: "sine", freq: 170, toFreq: 42, at: 0, dur: 0.45, peak: 0.9 });
      noise({ at: 0, dur: 0.38, peak: 0.5, filter: "lowpass", freq: 1400, toFreq: 220 });
      break;

    // Fill: a rising "pour" — continuous upward sweep, no transient, so it
    // reads as filling rather than striking.
    case "fill":
      tone({ type: voice().body, freq: 200, toFreq: 880, at: 0, dur: 0.28, peak: 0.45 });
      tone({ type: voice().lead, freq: 400, toFreq: 1760, at: 0.02, dur: 0.26, peak: 0.2 });
      break;
  }
}

/**
 * Plays a one-shot. Silently does nothing when sound is off, before the
 * first user gesture has unlocked audio, or on a platform without Web Audio
 * — so call sites never need to guard.
 *
 * `intensity`/`comboLevel` are only read by "clear" (units cleared this
 * placement, and the combo level it produced).
 */
export function playSound(name: SoundName, intensity = 0, comboLevel = 0): void {
  if (!isSoundEnabled()) return;
  const c = ensureContext();
  if (!c) return;
  // Backgrounding the app (or the WebView reclaiming audio focus) can suspend
  // the context after it was unlocked — resume rather than dropping the sound.
  if (c.state === "suspended") void c.resume();
  try {
    playSoundInternal(name, intensity, comboLevel);
  } catch (err) {
    // Audio is never worth breaking a turn over.
    console.error("sound playback failed", err);
  }
}

let unlockInstalled = false;

/**
 * Creates and resumes the AudioContext on the first real user gesture, then
 * removes itself. Listens on the capture phase so it still fires for gestures
 * that a component's own handler stops propagating (the hand tray's
 * pointerdown, for one, captures the pointer immediately).
 */
export function installAudioUnlock(): void {
  if (unlockInstalled || typeof window === "undefined") return;
  unlockInstalled = true;

  const unlock = () => {
    const c = ensureContext();
    if (c && c.state === "suspended") void c.resume();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("touchstart", unlock, true);
    window.removeEventListener("click", unlock, true);
  };

  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("touchstart", unlock, true);
  window.addEventListener("click", unlock, true);
}
