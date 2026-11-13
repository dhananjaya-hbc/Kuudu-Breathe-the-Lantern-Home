// Gates: floating bamboo posts with a glowing opening, placed on the target
// wave — high at each breath-in peak, low at each breath-out trough. The
// world scrolls right to left past the lantern.
//
// Forgiving by design: a gate counts as passed if the lantern is inside the
// opening at any moment in a short window around it, so being a little
// early or late (or a little signal delay) is fine.
//
// A faint dotted ghost path previews the coming wave ahead of the lantern.

import { yForHeight, type Layout } from './scene';
import type { TargetWave, WaveGate } from './target-wave';

export interface GateOptions {
  /** Opening size in lantern-height units (0–1). */
  gap: number;
  /** How far peak/trough centres sit in from the very top/bottom. */
  inset: number;
  /** No gates during the first part of a run, to settle in. */
  skipFirstMs: number;
  /** The lantern may enter the opening this early… */
  windowBeforeMs: number;
  /** …or this late, and still pass. */
  windowAfterMs: number;
  /** How far ahead gates are created. */
  aheadMs: number;
}

export const DEFAULT_GATE_OPTIONS: GateOptions = {
  gap: 0.45,
  inset: 0.2,
  skipFirstMs: 6_000,
  windowBeforeMs: 400,
  windowAfterMs: 900,
  aheadMs: 8_000,
};

export type GateResult = 'passed' | 'missed';

export interface Gate extends WaveGate {
  /** Centre of the opening, in lantern-height units. */
  center: number;
  /** True once the lantern has been inside the opening during the window. */
  hit: boolean;
  result: GateResult | null;
  /** Run time when the result was decided, for the flare animation. */
  resolvedAtMs: number | null;
}

export interface GateEvent {
  gate: Gate;
  result: GateResult;
}

/** Maps a target height (0–1) to where the lantern should be, inset from the edges. */
export function displayHeight(targetHeight: number, inset: number): number {
  return inset + (1 - 2 * inset) * targetHeight;
}

export class GateTrack {
  readonly options: GateOptions;
  private gates: Gate[] = [];
  private generatedUntilMs = 0;

  constructor(
    private readonly wave: TargetWave,
    options: Partial<GateOptions> = {},
  ) {
    this.options = { ...DEFAULT_GATE_OPTIONS, ...options };
  }

  /** Gates currently tracked (on or near the screen). */
  get active(): readonly Gate[] {
    return this.gates;
  }

  /** Lets later levels tighten the opening. Applies to gates created from now on. */
  setGap(gap: number): void {
    this.options.gap = gap;
  }

  reset(): void {
    this.gates = [];
    this.generatedUntilMs = 0;
  }

  /** Advances to `runMs` with the lantern at `lanternHeight`. Returns gates decided this frame. */
  update(runMs: number, lanternHeight: number): GateEvent[] {
    const o = this.options;
    const until = runMs + o.aheadMs;
    if (until > this.generatedUntilMs) {
      for (const g of this.wave.gatesBetween(this.generatedUntilMs, until, o.skipFirstMs)) {
        this.gates.push({
          ...g,
          center: g.kind === 'peak' ? 1 - o.inset : o.inset,
          hit: false,
          result: null,
          resolvedAtMs: null,
        });
      }
      this.generatedUntilMs = until;
    }

    const events: GateEvent[] = [];
    for (const gate of this.gates) {
      if (gate.result) continue;
      const inWindow =
        runMs >= gate.atMs - o.windowBeforeMs && runMs <= gate.atMs + o.windowAfterMs;
      if (inWindow && Math.abs(lanternHeight - gate.center) <= o.gap / 2) gate.hit = true;
      if (runMs > gate.atMs + o.windowAfterMs) {
        gate.result = gate.hit ? 'passed' : 'missed';
        gate.resolvedAtMs = runMs;
        events.push({ gate, result: gate.result });
      }
    }

    // Forget gates well behind the lantern.
    this.gates = this.gates.filter((g) => g.atMs > runMs - 6_000);
    return events;
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout, runMs: number, pxPerMs: number): void {
    this.drawGhostPath(ctx, layout, runMs, pxPerMs);
    for (const gate of this.gates) {
      const x = layout.lanternX + (gate.atMs - runMs) * pxPerMs;
      if (x < -50 * layout.scale || x > layout.width + 50 * layout.scale) continue;
      this.drawGate(ctx, layout, gate, x, runMs);
    }
  }

  /** Dotted preview of where the lantern should go next, fading into the distance. */
  private drawGhostPath(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    runMs: number,
    pxPerMs: number,
  ): void {
    const step = 14 * l.scale;
    const span = l.width - l.lanternX;
    for (let dx = step; dx < span; dx += step) {
      const t = runMs + dx / pxPerMs;
      const h = displayHeight(this.wave.heightAt(t), this.options.inset);
      const fade = 1 - dx / span;
      ctx.fillStyle = `rgba(255, 214, 140, ${(0.35 * fade).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(l.lanternX + dx, yForHeight(l, h), 2.2 * l.scale, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawGate(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    gate: Gate,
    x: number,
    runMs: number,
  ): void {
    const s = l.scale;
    const half = this.options.gap / 2;
    const openTop = yForHeight(l, gate.center + half);
    const openBottom = yForHeight(l, gate.center - half);
    const poleWidth = 9 * s;
    const skyTop = l.flyTop - 70 * s;

    // Hanging pole from above (only if there is room), standing pole from the water.
    if (openTop > skyTop + 10 * s) this.drawPole(ctx, x, skyTop, openTop, poleWidth, s);
    this.drawPole(ctx, x, openBottom, l.waterY, poleWidth, s);

    // Warm while waiting, flaring when passed, dim blue when missed.
    const since = gate.resolvedAtMs === null ? Infinity : runMs - gate.resolvedAtMs;
    const flare = gate.result === 'passed' ? Math.max(0, 1 - since / 900) : 0;
    const color =
      gate.result === 'missed'
        ? '120, 150, 200'
        : gate.result === 'passed'
          ? '255, 225, 150'
          : '255, 190, 90';
    const alpha = gate.result === 'missed' ? 0.45 : 0.95;

    // Crossbars framing the opening, like a small festival arch.
    const barHalf = 18 * s;
    ctx.strokeStyle = gate.result === 'missed' ? 'rgba(80, 100, 150, 0.8)' : '#3a4f86';
    ctx.lineWidth = 5 * s;
    ctx.lineCap = 'round';
    for (const y of [openTop, openBottom]) {
      if (y < skyTop) continue;
      ctx.beginPath();
      ctx.moveTo(x - barHalf, y);
      ctx.lineTo(x + barHalf, y);
      ctx.stroke();
    }

    this.drawLightString(ctx, x, Math.max(openTop, skyTop), openBottom, s, gate, flare, runMs);

    // Lamps at the edges of the opening.
    for (const y of [openTop, openBottom]) {
      if (y < skyTop) continue;
      const r = (6 + 10 * flare) * s;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      halo.addColorStop(0, `rgba(${color}, ${(0.5 * alpha + 0.4 * flare).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
      ctx.fillStyle = `rgba(${color}, ${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, 6 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * A string of small lights bowing gently across the opening, so it is
   * obvious where to fly through. They twinkle in festival colours while
   * waiting, brighten when passed, and dim to blue when missed.
   */
  private drawLightString(
    ctx: CanvasRenderingContext2D,
    x: number,
    top: number,
    bottom: number,
    s: number,
    gate: Gate,
    flare: number,
    runMs: number,
  ): void {
    const length = bottom - top;
    if (length < 20 * s) return;
    const bow = 16 * s; // how far the string sags toward the viewer's right
    const pointAt = (t: number): [number, number] => [
      x + bow * Math.sin(Math.PI * t),
      top + t * length,
    ];

    ctx.strokeStyle =
      gate.result === 'missed' ? 'rgba(120, 150, 200, 0.2)' : 'rgba(255, 214, 140, 0.3)';
    ctx.lineWidth = 1.5 * s;
    ctx.beginPath();
    for (let i = 0; i <= 20; i++) {
      const [px, py] = pointAt(i / 20);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();

    const palette = ['255, 143, 163', '255, 193, 94', '255, 241, 214'];
    const count = Math.max(3, Math.round(length / (22 * s)));
    for (let i = 1; i < count; i++) {
      const [px, py] = pointAt(i / count);
      const twinkle = 0.65 + 0.35 * Math.sin(runMs / 260 + i * 1.9 + gate.atMs);
      const rgb = gate.result === 'missed' ? '120, 150, 200' : palette[i % palette.length]!;
      const a = gate.result === 'missed' ? 0.35 : Math.min(1, twinkle + flare);
      const r = (3 + 2 * flare) * s;

      const halo = ctx.createRadialGradient(px, py, 0, px, py, r * 3.5);
      halo.addColorStop(0, `rgba(${rgb}, ${(0.45 * a).toFixed(3)})`);
      halo.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(px - r * 3.5, py - r * 3.5, r * 7, r * 7);
      ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** A bamboo pole with joints. */
  private drawPole(
    ctx: CanvasRenderingContext2D,
    x: number,
    fromY: number,
    toY: number,
    width: number,
    s: number,
  ): void {
    if (toY - fromY < 2) return;
    ctx.fillStyle = '#2b3d6e';
    ctx.beginPath();
    ctx.roundRect(x - width / 2, fromY, width, toY - fromY, width / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(160, 190, 230, 0.18)';
    ctx.fillRect(x - width / 2 + 1.5 * s, fromY + 2 * s, 2 * s, Math.max(0, toY - fromY - 4 * s));
    ctx.strokeStyle = 'rgba(10, 20, 45, 0.7)';
    ctx.lineWidth = 2 * s;
    for (let y = fromY + 40 * s; y < toY - 10 * s; y += 40 * s) {
      ctx.beginPath();
      ctx.moveTo(x - width / 2, y);
      ctx.lineTo(x + width / 2, y);
      ctx.stroke();
    }
  }
}
