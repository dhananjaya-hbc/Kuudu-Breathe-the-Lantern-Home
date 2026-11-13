import { describe, expect, it } from 'vitest';
import {
  analyseCalibration,
  Calibration,
  CALIBRATION_CYCLE_MS,
  CALIBRATION_DURATION_MS,
  CALIBRATION_LEAD_IN_MS,
} from '../src/renderer/calibration';
import { guideAt, matchGuide, pearson, percentile, type RhythmPoint } from '../src/renderer/rhythm';

const STEP_MS = 1000 / 30;

/** A simulated player following the guide, as recorded on screen. */
function player({
  delayMs = 0,
  size = 1,
  sign = 1,
  drift = 0,
  noise = 0,
  fromMs = -CALIBRATION_LEAD_IN_MS,
  toMs = CALIBRATION_CYCLE_MS * 2,
  stepMs = STEP_MS,
} = {}): RhythmPoint[] {
  const points: RhythmPoint[] = [];
  // Deterministic pseudo-random noise so tests never flake.
  let seed = 7;
  const random = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = fromMs; t < toMs; t += stepMs) {
    const follow = t - delayMs < 0 ? 0 : guideAt(t - delayMs, CALIBRATION_CYCLE_MS);
    points.push({
      elapsedMs: t,
      value: 100 + sign * size * follow + drift * t + noise * random(),
    });
  }
  return points;
}

describe('rhythm', () => {
  it('guide starts empty, is full at mid-cycle, and empty again at the end', () => {
    expect(guideAt(0, 8000)).toBeCloseTo(0);
    expect(guideAt(4000, 8000)).toBeCloseTo(1);
    expect(guideAt(8000, 8000)).toBeCloseTo(0);
    expect(guideAt(-4000, 8000)).toBeCloseTo(1);
  });

  it('pearson is 1 for matching shapes, -1 for opposite, 0 for flat', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBe(0);
  });

  it('percentile picks values from the sorted data', () => {
    expect(percentile([5, 1, 3, 2, 4], 0)).toBe(1);
    expect(percentile([5, 1, 3, 2, 4], 0.5)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 1)).toBe(5);
    expect(percentile([], 0.5)).toBe(0);
  });

  it('never reports more than half a cycle of delay', () => {
    const m = matchGuide(player({ delayMs: 3_900 }), CALIBRATION_CYCLE_MS, { maxLagMs: 10_000 });
    expect(m.delayMs).toBeLessThan(CALIBRATION_CYCLE_MS / 2);
  });
});

describe('analyseCalibration', () => {
  it('succeeds for a player who follows the guide, despite drift and noise', () => {
    const result = analyseCalibration(player({ delayMs: 800, size: 2, drift: 0.0002, noise: 0.3 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.invert).toBe(false);
    expect(result.delayMs).toBeGreaterThanOrEqual(700);
    expect(result.delayMs).toBeLessThanOrEqual(900);
    expect(result.breathSize).toBeGreaterThan(1.5);
    expect(result.breathSize).toBeLessThan(3);
    expect(result.minRange).toBeCloseTo(result.breathSize * 0.35);
    expect(result.match).toBeGreaterThan(0.8);
  });

  it('asks to flip the signal when up means breathing out', () => {
    const result = analyseCalibration(player({ delayMs: 500, sign: -1 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.invert).toBe(true);
  });

  it('keeps the normal direction when the evidence for flipping is weak', () => {
    // A flipped-looking but noisy calibration (match between 0.4 and 0.55).
    const result = analyseCalibration(player({ delayMs: 500, sign: -1, size: 1, noise: 1.2 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.match).toBeGreaterThanOrEqual(0.4);
    expect(result.match).toBeLessThan(0.55);
    expect(result.invert).toBe(false);
  });

  it('fails as not-following when the waveform does not match the guide', () => {
    const result = analyseCalibration(player({ size: 0, noise: 1 }));
    expect(result).toMatchObject({ ok: false, reason: 'not-following' });
  });

  it('fails as no-signal when too few samples arrive', () => {
    const result = analyseCalibration(player({ stepMs: 500 }));
    expect(result).toMatchObject({ ok: false, reason: 'no-signal' });
  });

  it('fails as weak-signal for a perfectly flat waveform', () => {
    const result = analyseCalibration(player({ size: 0 }));
    expect(result).toMatchObject({ ok: false, reason: 'weak-signal' });
  });
});

describe('Calibration timing', () => {
  it('shows "ready" first, then in/out breaths, then done', () => {
    const c = new Calibration();
    c.start(1000);
    expect(c.guide(1000).phase).toBe('ready');
    expect(c.guide(1000 + CALIBRATION_LEAD_IN_MS + 1000).phase).toBe('in');
    expect(c.guide(1000 + CALIBRATION_LEAD_IN_MS + 5000).phase).toBe('out');
    expect(c.isDone(1000 + CALIBRATION_DURATION_MS - 1)).toBe(false);
    expect(c.isDone(1000 + CALIBRATION_DURATION_MS)).toBe(true);
    expect(c.guide(1000 + CALIBRATION_DURATION_MS).phase).toBe('done');
  });

  it('records samples on the guide clock and analyses them', () => {
    const c = new Calibration();
    c.start(0);
    let sampleTime = 5_000_000; // SDK clock, unrelated to local time
    for (let now = 0; now < CALIBRATION_DURATION_MS; now += STEP_MS) {
      const t = now - CALIBRATION_LEAD_IN_MS;
      const value = t < 0 ? 0 : guideAt(t, CALIBRATION_CYCLE_MS);
      c.addSamples([{ timeMs: (sampleTime += STEP_MS), value, stable: false }], now);
    }
    const result = c.finish();
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.delayMs).toBeLessThanOrEqual(100);
    expect(c.running).toBe(false);
  });
});
