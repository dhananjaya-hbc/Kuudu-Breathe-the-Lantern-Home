// Signal module: turns raw breathing-waveform samples into a smooth lantern
// height from 0 (fully out) to 1 (fully in).
//
// For each new sample:
//   1. Remove drift: subtract the average of the last 10 s, so slow body
//      movement does not make the lantern slowly sink or rise.
//   2. Normalise: map the value into 0–1 using the min/max of the last 10 s.
//      Units are undocumented, so raw values are never used directly. A
//      minimum range (from calibration) stops tiny noise filling the screen.
//   3. Smooth: exponential moving average, so the lantern does not jitter.
// Then, every animation frame:
//   4. Ease the displayed height toward the latest target at 60 fps.
//
// The SDK's `stable` flag is deliberately ignored here: it follows the
// breathing-rate confidence, which drops whenever the player changes pace.

import type { BreathSample } from './input/types';

/** Fixed-capacity ring buffer: the oldest item is overwritten when full. */
export class RingBuffer<T> {
  private readonly items: (T | undefined)[];
  private start = 0;
  private count = 0;

  constructor(readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  get length(): number {
    return this.count;
  }

  push(item: T): void {
    const end = (this.start + this.count) % this.capacity;
    this.items[end] = item;
    if (this.count < this.capacity) this.count++;
    else this.start = (this.start + 1) % this.capacity;
  }

  /** Item `i` counted from the oldest (0) to the newest (length - 1). */
  at(i: number): T | undefined {
    if (i < 0 || i >= this.count) return undefined;
    return this.items[(this.start + i) % this.capacity];
  }

  newest(): T | undefined {
    return this.at(this.count - 1);
  }

  /** Removes items from the oldest end while `predicate` is true. */
  dropWhile(predicate: (item: T) => boolean): void {
    while (this.count > 0 && predicate(this.items[this.start]!)) {
      this.items[this.start] = undefined;
      this.start = (this.start + 1) % this.capacity;
      this.count--;
    }
  }

  clear(): void {
    this.items.fill(undefined);
    this.start = 0;
    this.count = 0;
  }

  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = 0; i < this.count; i++) yield this.at(i)!;
  }
}

export interface SignalOptions {
  /** How much raw history to keep (for the debug graph and end-of-run ribbon). */
  historyMs: number;
  /** Window for the drift-removing average. */
  detrendWindowMs: number;
  /** Window for the rolling min/max used to normalise. */
  rangeWindowMs: number;
  /** EMA weight for each new sample (0–1). Higher reacts faster, lower is smoother. */
  alpha: number;
  /** Time constant for easing the displayed height toward the target. */
  easeMs: number;
  /** Data needed before the signal is considered ready. */
  warmupMs: number;
  /** A gap longer than this (e.g. camera paused) restarts processing. */
  maxGapMs: number;
  /** Set if the waveform goes down when breathing in. */
  invert: boolean;
}

export const DEFAULT_SIGNAL_OPTIONS: SignalOptions = {
  historyMs: 20_000,
  detrendWindowMs: 10_000,
  rangeWindowMs: 10_000,
  alpha: 0.25,
  easeMs: 120,
  warmupMs: 2_000,
  maxGapMs: 2_000,
  invert: false,
};

/** One processed sample, kept for graphs. */
export interface ProcessedSample {
  timeMs: number;
  raw: number;
  /** Raw value minus the recent average. */
  detrended: number;
  /** Smoothed height, 0–1. */
  height: number;
}

/** History capacity: 30 Hz × history window, with headroom. */
const CAPACITY = 2048;

export class BreathSignal {
  readonly options: SignalOptions;
  readonly history = new RingBuffer<ProcessedSample>(CAPACITY);

  private readonly detrendWindow = new RingBuffer<BreathSample>(CAPACITY);
  private detrendSum = 0;
  private readonly rangeWindow = new RingBuffer<{ timeMs: number; value: number }>(CAPACITY);
  private smoothed = 0.5;
  private displayed = 0.5;
  private firstSampleMs: number | null = null;
  /** Minimum normalisation range in detrended units; 0 until calibrated. */
  private minRange = 0;

  constructor(options: Partial<SignalOptions> = {}) {
    this.options = { ...DEFAULT_SIGNAL_OPTIONS, ...options };
  }

  /** True once enough data has arrived for the height to be meaningful. */
  get ready(): boolean {
    const newest = this.history.newest();
    return (
      this.firstSampleMs !== null &&
      newest !== undefined &&
      newest.timeMs - this.firstSampleMs >= this.options.warmupMs
    );
  }

  /** Latest smoothed target height, 0–1. */
  get target(): number {
    return this.smoothed;
  }

  /** Height to draw this frame, 0–1. */
  get height(): number {
    return this.displayed;
  }

  /**
   * Sets the smallest range used for normalising, from calibration
   * (typically a fraction of the player's normal breath size). Stops small
   * noise from swinging the lantern edge to edge when the player is still.
   */
  setMinRange(range: number): void {
    this.minRange = Math.max(0, range);
  }

  setInvert(invert: boolean): void {
    this.options.invert = invert;
  }

  /** Adds new samples (oldest first). */
  push(samples: readonly BreathSample[]): void {
    for (const s of samples) this.pushOne(s);
  }

  /** Eases the displayed height toward the target. Call once per animation frame. */
  update(dtMs: number): number {
    const k = 1 - Math.exp(-Math.max(0, dtMs) / this.options.easeMs);
    this.displayed += (this.smoothed - this.displayed) * k;
    return this.displayed;
  }

  /** Clears all samples, e.g. when a run ends or the camera restarts. Calibration is kept. */
  reset(): void {
    this.history.clear();
    this.detrendWindow.clear();
    this.detrendSum = 0;
    this.rangeWindow.clear();
    this.smoothed = 0.5;
    this.displayed = 0.5;
    this.firstSampleMs = null;
  }

  private pushOne(s: BreathSample): void {
    if (!Number.isFinite(s.value) || !Number.isFinite(s.timeMs)) return;

    const last = this.history.newest();
    if (last) {
      if (s.timeMs <= last.timeMs) return; // out of order or duplicate
      if (s.timeMs - last.timeMs > this.options.maxGapMs) this.reset();
    }
    this.firstSampleMs ??= s.timeMs;

    // 1. Remove drift with a running average over the detrend window.
    this.detrendWindow.push(s);
    this.detrendSum += s.value;
    this.detrendWindow.dropWhile((old) => {
      const expired = old.timeMs < s.timeMs - this.options.detrendWindowMs;
      if (expired) this.detrendSum -= old.value;
      return expired;
    });
    const detrended = s.value - this.detrendSum / this.detrendWindow.length;

    // 2. Normalise with the rolling min/max, never narrower than minRange.
    this.rangeWindow.push({ timeMs: s.timeMs, value: detrended });
    this.rangeWindow.dropWhile((old) => old.timeMs < s.timeMs - this.options.rangeWindowMs);
    let min = Infinity;
    let max = -Infinity;
    for (const p of this.rangeWindow) {
      if (p.value < min) min = p.value;
      if (p.value > max) max = p.value;
    }
    const range = max - min;
    let normalised = 0.5;
    if (range < this.minRange) {
      const mid = (max + min) / 2;
      normalised =
        this.minRange > 0 ? (detrended - (mid - this.minRange / 2)) / this.minRange : 0.5;
    } else if (range > 0) {
      normalised = (detrended - min) / range;
    }
    normalised = Math.min(1, Math.max(0, normalised));
    if (this.options.invert) normalised = 1 - normalised;

    // 3. Smooth.
    this.smoothed += (normalised - this.smoothed) * this.options.alpha;

    this.history.push({ timeMs: s.timeMs, raw: s.value, detrended, height: this.smoothed });
    this.history.dropWhile((old) => old.timeMs < s.timeMs - this.options.historyMs);
  }
}
