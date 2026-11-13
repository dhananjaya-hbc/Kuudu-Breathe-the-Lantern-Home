// Calibration before every run: a short guided breath (about 19 s).
//
//   3 s  "Get ready"   the signal warms up, the guide light rests at the bottom
//   16 s two slow breaths following the guide (4 s in, 4 s out, twice)
//
// From that one step we learn:
//   - whether the signal arrives at all,
//   - its direction (flip it if "up" means breathing out for this player),
//   - the player's breath size (sets the signal's minimum range, so small
//     noise does not swing the lantern),
//   - how well the waveform follows the guide,
//   - the delay, so the game can shift its target wave for fair scoring.

import type { BreathSample } from './input/types';
import { detrend, guideAt, isInhale, matchGuide, percentile, type RhythmPoint } from './rhythm';

export const CALIBRATION_LEAD_IN_MS = 3_000;
export const CALIBRATION_CYCLE_MS = 8_000;
export const CALIBRATION_CYCLES = 2;
export const CALIBRATION_DURATION_MS =
  CALIBRATION_LEAD_IN_MS + CALIBRATION_CYCLE_MS * CALIBRATION_CYCLES;

/** Below this match the player probably was not followed by the signal. */
export const MIN_CALIBRATION_MATCH = 0.4;
/**
 * Flipping the signal needs clearer evidence than passing calibration. A
 * player slightly out of step with the light can look like a flipped signal,
 * so weak evidence keeps the normal direction (up = breathing in). The player
 * can still flip it with F during a run.
 */
export const MIN_FLIP_MATCH = 0.55;
/** Fewer points than this (≈ 8 Hz over 16 s) means the signal barely arrived. */
const MIN_POINTS = 128;
/** The lantern's minimum range, as a fraction of the player's breath size. */
const MIN_RANGE_FRACTION = 0.35;

export type CalibrationFailure = 'no-signal' | 'weak-signal' | 'not-following';

export type CalibrationResult =
  | {
      ok: true;
      /** True if the signal must be flipped so that up means breathing in. */
      invert: boolean;
      /** Typical breath size in raw (detrended) units, 5th to 95th percentile. */
      breathSize: number;
      /** Value for `BreathSignal.setMinRange()`. */
      minRange: number;
      delayMs: number;
      match: number;
    }
  | { ok: false; reason: CalibrationFailure; match: number };

export type GuidePhase = 'ready' | 'in' | 'out' | 'done';

export interface GuideState {
  phase: GuidePhase;
  /** Guide light height, 0 (bottom) to 1 (top). */
  height: number;
  /** Overall progress, 0–1. */
  progress: number;
  secondsLeft: number;
}

export class Calibration {
  private startedAt: number | null = null;
  private readonly points: RhythmPoint[] = [];

  /** Begins calibration. `nowMs` is performance.now(). */
  start(nowMs: number): void {
    this.startedAt = nowMs;
    this.points.length = 0;
  }

  get running(): boolean {
    return this.startedAt !== null;
  }

  /** Records samples as they reach the screen. Call from the input's `samples` event. */
  addSamples(batch: readonly BreathSample[], nowMs: number): void {
    if (this.startedAt === null || batch.length === 0) return;
    const newest = batch.at(-1)!;
    // Time on the guide's clock (0 = first breath begins) when each sample was shown.
    const shownAt = nowMs - this.startedAt - CALIBRATION_LEAD_IN_MS;
    for (const s of batch) {
      this.points.push({ elapsedMs: shownAt - (newest.timeMs - s.timeMs), value: s.value });
    }
  }

  /** What to draw right now. */
  guide(nowMs: number): GuideState {
    const elapsed = this.startedAt === null ? 0 : nowMs - this.startedAt;
    const progress = Math.min(1, elapsed / CALIBRATION_DURATION_MS);
    const secondsLeft = Math.max(0, Math.ceil((CALIBRATION_DURATION_MS - elapsed) / 1000));
    if (elapsed >= CALIBRATION_DURATION_MS) {
      return { phase: 'done', height: 0, progress: 1, secondsLeft: 0 };
    }
    const t = elapsed - CALIBRATION_LEAD_IN_MS;
    if (t < 0) return { phase: 'ready', height: 0, progress, secondsLeft };
    return {
      phase: isInhale(t, CALIBRATION_CYCLE_MS) ? 'in' : 'out',
      height: guideAt(t, CALIBRATION_CYCLE_MS),
      progress,
      secondsLeft,
    };
  }

  isDone(nowMs: number): boolean {
    return this.startedAt !== null && nowMs - this.startedAt >= CALIBRATION_DURATION_MS;
  }

  /** Analyses the recording. Can be called once `isDone()` is true. */
  finish(): CalibrationResult {
    this.startedAt = null;
    return analyseCalibration(this.points);
  }
}

/** Pure analysis, separate from timing so it can be tested directly. */
export function analyseCalibration(points: readonly RhythmPoint[]): CalibrationResult {
  const used = points.filter((p) => p.elapsedMs >= 0);
  if (used.length < MIN_POINTS) return { ok: false, reason: 'no-signal', match: 0 };

  const values = detrend(used);
  const breathSize = percentile(values, 0.95) - percentile(values, 0.05);
  // Units are unknown, so "flat" is judged relative to the signal's own size;
  // this also ignores floating-point leftovers from detrending.
  const scale = used.reduce((sum, p) => sum + Math.abs(p.value), 0) / used.length;
  if (!(breathSize > Math.max(scale, 1) * 1e-9)) {
    return { ok: false, reason: 'weak-signal', match: 0 };
  }

  const m = matchGuide(used, CALIBRATION_CYCLE_MS, { maxLagMs: 2_500 });
  if (m.match < MIN_CALIBRATION_MATCH) {
    return { ok: false, reason: 'not-following', match: m.match };
  }

  return {
    ok: true,
    invert: !m.upIsInhale && m.match >= MIN_FLIP_MATCH,
    breathSize,
    minRange: breathSize * MIN_RANGE_FRACTION,
    delayMs: m.delayMs,
    match: m.match,
  };
}
