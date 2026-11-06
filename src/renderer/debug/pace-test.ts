// Guided pace test (debug screen): the player follows a guide that rises for
// 4 s (breathe in) and falls for 4 s (breathe out), four times. Lining the
// recorded waveform up with the guide shows, as the player experiences it,
// the breath-to-screen delay, the direction, and how well it follows.
//
// Times are local (performance.now()), so no SDK clock is involved.
// The maths lives in ../rhythm.ts and is shared with calibration and scoring.

import {
  guideAt as rhythmGuideAt,
  isInhale as rhythmIsInhale,
  matchGuide,
  type RhythmMatch,
  type RhythmPoint,
} from '../rhythm';

/** One full breath (in + out). 8 s = 7.5 breaths per minute. */
export const PACE_CYCLE_MS = 8_000;
export const PACE_CYCLES = 4;
export const PACE_DURATION_MS = PACE_CYCLE_MS * PACE_CYCLES;

export type PacePoint = RhythmPoint;
export type PaceResult = RhythmMatch;

export const guideAt = (elapsedMs: number): number => rhythmGuideAt(elapsedMs, PACE_CYCLE_MS);
export const isInhale = (elapsedMs: number): boolean => rhythmIsInhale(elapsedMs, PACE_CYCLE_MS);

/**
 * Finds the delay at which the recorded waveform best matches the guide.
 * The first cycle is skipped as warm-up. Returns null if there is too little data.
 */
export function analysePaceTest(points: readonly PacePoint[]): PaceResult | null {
  const used = points.filter((p) => p.elapsedMs >= PACE_CYCLE_MS);
  if (used.length < 60) return null;
  return matchGuide(used, PACE_CYCLE_MS);
}
