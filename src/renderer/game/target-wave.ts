// The target wave: the "ideal breath" the player tries to match. Gates sit
// on it, and a faint ghost path shows it ahead of the lantern.
//
// The wave starts empty (fully out) and rises first, like calibration.
// Its pace can change mid-run (e.g. slower in later levels) without a jump:
// each pace change starts a new segment that continues from the current phase.

/** Breaths per minute → milliseconds per breath. */
export const cycleMsFromBpm = (bpm: number): number => 60_000 / bpm;

/** Default starting pace: the same as calibration, 7.5 breaths per minute. */
export const DEFAULT_BPM = 7.5;

interface Segment {
  fromMs: number;
  cycleMs: number;
  /** Phase (in cycles, unbounded) at `fromMs`. */
  phaseAtFrom: number;
}

export interface WaveGate {
  /** Run time (ms) when the gate should be passed. */
  atMs: number;
  /** Target height there: 1 = top of a breath in, 0 = bottom of a breath out. */
  height: number;
  kind: 'peak' | 'trough';
}

export class TargetWave {
  private readonly segments: Segment[];

  constructor(bpm = DEFAULT_BPM) {
    this.segments = [{ fromMs: 0, cycleMs: cycleMsFromBpm(bpm), phaseAtFrom: 0 }];
  }

  /** Changes the pace from `atMs` onwards, continuing smoothly from the current phase. */
  setPace(bpm: number, atMs: number): void {
    const phase = this.phaseAt(atMs);
    // Drop any segments that start after the change.
    while (this.segments.length > 1 && this.segments.at(-1)!.fromMs >= atMs) this.segments.pop();
    this.segments.push({ fromMs: atMs, cycleMs: cycleMsFromBpm(bpm), phaseAtFrom: phase });
  }

  /** Breaths per minute at `atMs`. */
  bpmAt(atMs: number): number {
    return 60_000 / this.segmentAt(atMs).cycleMs;
  }

  /** Phase in cycles at `atMs` (0, 1, 2… = bottom of a breath out; 0.5, 1.5… = top of a breath in). */
  phaseAt(atMs: number): number {
    const s = this.segmentAt(atMs);
    return s.phaseAtFrom + (atMs - s.fromMs) / s.cycleMs;
  }

  /** Target height at `atMs`, 0 (fully out) to 1 (fully in). */
  heightAt(atMs: number): number {
    return (1 - Math.cos(2 * Math.PI * this.phaseAt(atMs))) / 2;
  }

  /** True while the target is rising (breathing in). */
  isInhaleAt(atMs: number): boolean {
    const phase = this.phaseAt(atMs);
    return phase - Math.floor(phase) < 0.5;
  }

  /**
   * Gates at every peak and trough in [fromMs, toMs), in time order.
   * `skipFirstMs` leaves the start of the run free of gates.
   */
  gatesBetween(fromMs: number, toMs: number, skipFirstMs = 0): WaveGate[] {
    const gates: WaveGate[] = [];
    const start = Math.max(fromMs, skipFirstMs);
    if (toMs <= start) return gates;
    // Peaks and troughs fall on half-cycle phases.
    let k = Math.ceil(this.phaseAt(start) * 2 - 1e-9);
    for (;;) {
      const atMs = this.timeAtPhase(k / 2, start);
      if (atMs >= toMs) break;
      if (atMs >= start) {
        const peak = k % 2 !== 0;
        gates.push({ atMs, height: peak ? 1 : 0, kind: peak ? 'peak' : 'trough' });
      }
      k++;
    }
    return gates;
  }

  /** Earliest time at or after `notBeforeMs` when the phase reaches `phase`. */
  private timeAtPhase(phase: number, notBeforeMs: number): number {
    for (let i = 0; i < this.segments.length; i++) {
      const s = this.segments[i]!;
      const next = this.segments[i + 1];
      const atMs = s.fromMs + (phase - s.phaseAtFrom) * s.cycleMs;
      const inSegment = atMs >= s.fromMs && (next === undefined || atMs < next.fromMs);
      if (inSegment && atMs >= notBeforeMs - 1e-6) return Math.max(atMs, notBeforeMs);
    }
    return Infinity;
  }

  private segmentAt(atMs: number): Segment {
    for (let i = this.segments.length - 1; i > 0; i--) {
      if (atMs >= this.segments[i]!.fromMs) return this.segments[i]!;
    }
    return this.segments[0]!;
  }
}
