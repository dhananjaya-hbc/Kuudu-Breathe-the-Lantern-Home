// Guided pace test: the player follows a guide that rises for 4 s (breathe in)
// and falls for 4 s (breathe out). Lining the recorded waveform up with the
// guide tells us, end to end, as the player experiences it:
//   - the breath-to-screen delay (the shift where they match best),
//   - the direction (whether "up" in the waveform means breathing in),
//   - how well the waveform follows the guide (correlation, 0–1).
//
// Times here are local (performance.now()), so no SDK clock is involved.

/** One full breath (in + out) in milliseconds. 8 s = 7.5 breaths per minute. */
export const PACE_CYCLE_MS = 8_000;
export const PACE_CYCLES = 4;
export const PACE_DURATION_MS = PACE_CYCLE_MS * PACE_CYCLES;

/** Largest delay we search for. */
const MAX_LAG_MS = 3_000;
const LAG_STEP_MS = 50;

/**
 * Guide height at `elapsedMs` since the test started, 0 (empty) to 1 (full).
 * Starts empty, rises during the first half of each cycle and falls during the second.
 */
export function guideAt(elapsedMs: number): number {
  const phase = (((elapsedMs % PACE_CYCLE_MS) + PACE_CYCLE_MS) % PACE_CYCLE_MS) / PACE_CYCLE_MS;
  return (1 - Math.cos(2 * Math.PI * phase)) / 2;
}

/** True while the guide is rising. */
export function isInhale(elapsedMs: number): boolean {
  const phase = (((elapsedMs % PACE_CYCLE_MS) + PACE_CYCLE_MS) % PACE_CYCLE_MS) / PACE_CYCLE_MS;
  return phase < 0.5;
}

export interface PacePoint {
  /** Milliseconds since the test started, when the sample reached the screen. */
  elapsedMs: number;
  value: number;
}

export interface PaceResult {
  /** Breath-to-screen delay, including the player's own small reaction time. */
  delayMs: number;
  /** Pearson correlation at the best delay, absolute value, 0–1. */
  match: number;
  /** True if a rising waveform means breathing in. */
  upIsInhale: boolean;
  points: number;
}

/** Removes a straight-line trend so slow drift does not hide the breathing waves. */
export function detrend(points: PacePoint[]): number[] {
  const n = points.length;
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

function pearson(a: number[], b: number[]): number {
  const n = a.length;
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
 * Finds the delay at which the recorded waveform best matches the guide.
 * The first cycle is skipped as warm-up. Returns null if there is too little data.
 */
export function analysePaceTest(points: PacePoint[]): PaceResult | null {
  const used = points.filter((p) => p.elapsedMs >= PACE_CYCLE_MS);
  if (used.length < 60) return null;

  const values = detrend(used);
  let best = { lag: 0, r: 0 };
  for (let lag = 0; lag <= MAX_LAG_MS; lag += LAG_STEP_MS) {
    const guide = used.map((p) => guideAt(p.elapsedMs - lag));
    const r = pearson(values, guide);
    if (Math.abs(r) > Math.abs(best.r)) best = { lag, r };
  }

  return {
    delayMs: best.lag,
    match: Math.abs(best.r),
    upIsInhale: best.r >= 0,
    points: used.length,
  };
}
