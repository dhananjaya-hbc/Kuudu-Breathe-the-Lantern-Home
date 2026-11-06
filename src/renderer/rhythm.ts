// Shared rhythm maths: the guide wave the player follows, and how closely a
// recorded waveform matches it. Used by calibration, the debug pace test, and
// later the game's scoring.

/** A recorded waveform point, in local time relative to some start. */
export interface RhythmPoint {
  elapsedMs: number;
  value: number;
}

export interface RhythmMatch {
  /** Shift (ms) at which the waveform best matches the guide: breath-to-screen delay plus reaction. */
  delayMs: number;
  /** Pearson correlation at that shift, absolute value, 0–1. */
  match: number;
  /** True if a rising waveform means breathing in. */
  upIsInhale: boolean;
  points: number;
}

/** Position within a cycle, 0 (start) to 1 (end). Works for negative times too. */
function phaseOf(elapsedMs: number, cycleMs: number): number {
  return (((elapsedMs % cycleMs) + cycleMs) % cycleMs) / cycleMs;
}

/**
 * Guide height, 0 (fully out) to 1 (fully in). Starts empty, rises during
 * the first half of each cycle (breathe in) and falls during the second.
 */
export function guideAt(elapsedMs: number, cycleMs: number): number {
  return (1 - Math.cos(2 * Math.PI * phaseOf(elapsedMs, cycleMs))) / 2;
}

/** True while the guide is rising. */
export function isInhale(elapsedMs: number, cycleMs: number): boolean {
  return phaseOf(elapsedMs, cycleMs) < 0.5;
}

/** Removes a straight-line trend so slow drift does not hide the breathing waves. */
export function detrend(points: readonly RhythmPoint[]): number[] {
  const n = points.length;
  if (n === 0) return [];
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sx += p.elapsedMs;
    sy += p.value;
    sxx += p.elapsedMs * p.elapsedMs;
    sxy += p.elapsedMs * p.value;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  return points.map((p) => p.value - (slope * p.elapsedMs + intercept));
}

/** Pearson correlation of two equal-length series; 0 if either is flat. */
export function pearson(a: readonly number[], b: readonly number[]): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[i]!;
    mb += b[i]!;
  }
  ma /= n;
  mb /= n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  return va === 0 || vb === 0 ? 0 : cov / Math.sqrt(va * vb);
}

/**
 * Finds the shift at which `points` best match the guide wave.
 * Search stays under half a cycle, so a flipped signal is reported as flipped
 * rather than as a half-cycle delay.
 */
export function matchGuide(
  points: readonly RhythmPoint[],
  cycleMs: number,
  { maxLagMs = 3_000, stepMs = 50 }: { maxLagMs?: number; stepMs?: number } = {},
): RhythmMatch {
  const values = detrend(points);
  const limit = Math.min(maxLagMs, cycleMs / 2 - stepMs);
  let best = { lag: 0, r: 0 };
  for (let lag = 0; lag <= limit; lag += stepMs) {
    const guide = points.map((p) => guideAt(p.elapsedMs - lag, cycleMs));
    const r = pearson(values, guide);
    if (Math.abs(r) > Math.abs(best.r)) best = { lag, r };
  }
  return {
    delayMs: best.lag,
    match: Math.abs(best.r),
    upIsInhale: best.r >= 0,
    points: points.length,
  };
}

/** Value at the given fraction (0–1) of the sorted data. */
export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))));
  return sorted[i]!;
}
