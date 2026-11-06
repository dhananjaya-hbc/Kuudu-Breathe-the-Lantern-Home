import { describe, expect, it } from 'vitest';
import { BreathSignal, RingBuffer } from '../src/renderer/signal';
import type { BreathSample } from '../src/renderer/input/types';

const HZ = 30;
const STEP_MS = 1000 / HZ;

/** Generates samples at 30 Hz for `durationMs`, starting at `startMs`. */
function generate(
  durationMs: number,
  valueAt: (tMs: number) => number,
  startMs = 1_700_000_000_000,
): BreathSample[] {
  const out: BreathSample[] = [];
  for (let t = 0; t < durationMs; t += STEP_MS) {
    out.push({ timeMs: startMs + t, value: valueAt(t), stable: false });
  }
  return out;
}

/** A slow breath: 8 s per cycle, starting at the bottom (fully out). */
const breath = (tMs: number): number => -Math.cos((2 * Math.PI * tMs) / 8_000);

function correlation(a: number[], b: number[]): number {
  const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(a);
  const mb = mean(b);
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < a.length; i++) {
    cov += (a[i]! - ma) * (b[i]! - mb);
    va += (a[i]! - ma) ** 2;
    vb += (b[i]! - mb) ** 2;
  }
  return cov / Math.sqrt(va * vb);
}

describe('RingBuffer', () => {
  it('keeps items oldest first and overwrites the oldest when full', () => {
    const rb = new RingBuffer<number>(3);
    [1, 2, 3, 4].forEach((n) => rb.push(n));
    expect([...rb]).toEqual([2, 3, 4]);
    expect(rb.newest()).toBe(4);
    expect(rb.at(0)).toBe(2);
    expect(rb.at(3)).toBeUndefined();
  });

  it('drops from the oldest end while a condition holds', () => {
    const rb = new RingBuffer<number>(5);
    [1, 2, 3, 4, 5].forEach((n) => rb.push(n));
    rb.dropWhile((n) => n < 3);
    expect([...rb]).toEqual([3, 4, 5]);
    rb.push(6);
    expect([...rb]).toEqual([3, 4, 5, 6]);
  });
});

describe('BreathSignal', () => {
  it('follows the breathing wave and ignores slow drift', () => {
    const signal = new BreathSignal();
    // Breathing wave of size 1, plus a strong drift (3 units per 10 s) and an offset.
    const samples = generate(40_000, (t) => 50 + breath(t) + 0.0003 * t);
    signal.push(samples);

    // Compare the last 16 s (two full breaths) with the clean wave.
    const recent = [...signal.history].filter((p) => p.timeMs >= samples.at(-1)!.timeMs - 16_000);
    const heights = recent.map((p) => p.height);
    const clean = recent.map((p) => breath(p.timeMs - samples[0]!.timeMs));

    expect(correlation(heights, clean)).toBeGreaterThan(0.95);
    expect(Math.min(...heights)).toBeLessThan(0.15);
    expect(Math.max(...heights)).toBeGreaterThan(0.85);
  });

  it('always stays within 0–1', () => {
    const signal = new BreathSignal();
    signal.push(generate(20_000, (t) => breath(t) * (t > 10_000 ? 20 : 1)));
    for (const p of signal.history) {
      expect(p.height).toBeGreaterThanOrEqual(0);
      expect(p.height).toBeLessThanOrEqual(1);
    }
  });

  it('flips the direction when inverted', () => {
    const normal = new BreathSignal();
    const inverted = new BreathSignal({ invert: true });
    const samples = generate(20_000, breath);
    normal.push(samples);
    inverted.push(samples);
    const a = [...normal.history].map((p) => p.height);
    const b = [...inverted.history].map((p) => p.height);
    expect(correlation(a.slice(-240), b.slice(-240))).toBeLessThan(-0.95);
  });

  it('stays in the middle for a flat signal instead of producing NaN', () => {
    const signal = new BreathSignal();
    signal.push(generate(5_000, () => 42));
    expect(signal.target).toBeCloseTo(0.5, 5);
  });

  it('keeps tiny noise small once a minimum range is set by calibration', () => {
    const signal = new BreathSignal();
    signal.setMinRange(1); // the player's normal breath is about 1 unit
    signal.push(generate(10_000, (t) => 0.01 * Math.sin(t / 37)));
    for (const p of [...signal.history].slice(-60)) {
      expect(Math.abs(p.height - 0.5)).toBeLessThan(0.05);
    }
  });

  it('is not ready until the warm-up time has passed', () => {
    const signal = new BreathSignal();
    signal.push(generate(1_000, breath));
    expect(signal.ready).toBe(false);
    signal.push(generate(2_000, breath, 1_700_000_001_000));
    expect(signal.ready).toBe(true);
  });

  it('ignores duplicate, out-of-order and non-finite samples', () => {
    const signal = new BreathSignal();
    signal.push([
      { timeMs: 1000, value: 1, stable: false },
      { timeMs: 1000, value: 9, stable: false },
      { timeMs: 900, value: 9, stable: false },
      { timeMs: 1100, value: Number.NaN, stable: false },
    ]);
    expect(signal.history.length).toBe(1);
  });

  it('restarts after a long gap but keeps calibration', () => {
    const signal = new BreathSignal();
    signal.setMinRange(1);
    signal.push(generate(5_000, breath));
    signal.push(generate(1_000, breath, 1_700_000_000_000 + 60_000));
    expect(signal.history.length).toBeLessThanOrEqual(31);
    expect(signal.ready).toBe(false);
  });

  it('eases the displayed height toward the target without overshooting', () => {
    const signal = new BreathSignal({ alpha: 1 });
    signal.push(generate(3_000, () => 0));
    signal.push([{ timeMs: 1_700_000_003_000, value: 1, stable: false }]);
    const target = signal.target;
    let previous = signal.height;
    for (let i = 0; i < 60; i++) {
      const h = signal.update(1000 / 60);
      expect(h).toBeGreaterThanOrEqual(previous);
      expect(h).toBeLessThanOrEqual(target + 1e-9);
      previous = h;
    }
    expect(target - previous).toBeLessThan(0.01);
  });
});
