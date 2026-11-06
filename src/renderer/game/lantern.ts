// The kuudu: an original take on the eight-sided Vesak paper lantern,
// drawn in code. Coloured paper panels on a thin bamboo frame, a warm glow
// from inside, and paper tails that sway as it rises and falls. Its
// reflection shimmers on the river below.
//
// `flicker` (0–1) dims and unsettles the light, for jerky or held breaths.

import { yForHeight, type Layout } from './scene';

export interface LanternState {
  /** 0 (bottom) to 1 (top). */
  height: number;
  /** How well the player matches the rhythm, 0–1. Brighter when higher. */
  glow: number;
  /** 0 = steady light, 1 = strong flicker. */
  flicker: number;
  /** Signal paused (e.g. no face): the lantern dims and holds still. */
  paused: boolean;
  timeMs: number;
}

type Point = readonly [number, number];

// Front view of the eight-sided double pyramid, in units of the lantern's size.
const TOP: Point = [0, -1.3];
const BOTTOM: Point = [0, 1.3];
const L1: Point = [-0.95, -0.3];
const L2: Point = [-0.95, 0.3];
const R1: Point = [0.95, -0.3];
const R2: Point = [0.95, 0.3];
const I1: Point = [-0.38, -0.3];
const I2: Point = [-0.38, 0.3];
const J1: Point = [0.38, -0.3];
const J2: Point = [0.38, 0.3];

/** Facets with a brightness: the centre faces the viewer, the sides turn away. */
const FACETS: { points: Point[]; color: string; light: number }[] = [
  { points: [TOP, L1, I1], color: '#ff8fa3', light: 0.7 },
  { points: [TOP, I1, J1], color: '#ffc15e', light: 1 },
  { points: [TOP, J1, R1], color: '#ff8fa3', light: 0.7 },
  { points: [L1, L2, I2, I1], color: '#ffb347', light: 0.75 },
  { points: [I1, I2, J2, J1], color: '#ffe0a3', light: 1.15 },
  { points: [J1, J2, R2, R1], color: '#ffb347', light: 0.75 },
  { points: [BOTTOM, L2, I2], color: '#ff8fa3', light: 0.6 },
  { points: [BOTTOM, I2, J2], color: '#ffc15e', light: 0.9 },
  { points: [BOTTOM, J2, R2], color: '#ff8fa3', light: 0.6 },
];

/** Paper tails: where they hang from (lantern units), their colour, and length. */
const TAILS: { from: Point; color: string; length: number; phase: number }[] = [
  { from: L2, color: '#ff8fa3', length: 2.2, phase: 0 },
  { from: [-0.4, 0.85], color: '#fff1d6', length: 2.8, phase: 1.1 },
  { from: BOTTOM, color: '#ffc15e', length: 3.2, phase: 2.3 },
  { from: [0.4, 0.85], color: '#fff1d6', length: 2.8, phase: 3.4 },
  { from: R2, color: '#ff8fa3', length: 2.2, phase: 4.2 },
];

/** Cheap smooth noise for the flicker, -1 to 1. */
function noise(t: number): number {
  return Math.sin(t * 13.1) * 0.5 + Math.sin(t * 29.7 + 1.3) * 0.3 + Math.sin(t * 47.3 + 2.1) * 0.2;
}

export class Lantern {
  private lastY: number | null = null;
  /** Smoothed vertical speed in screen pixels per ms; drives the tail sway. */
  private velocity = 0;

  /** Call once per frame before drawing, with the lantern's screen y. */
  private track(y: number, dtMs: number): void {
    if (this.lastY !== null && dtMs > 0) {
      const v = (y - this.lastY) / dtMs;
      this.velocity += (v - this.velocity) * Math.min(1, dtMs / 150);
    }
    this.lastY = y;
  }

  draw(ctx: CanvasRenderingContext2D, layout: Layout, state: LanternState, dtMs: number): void {
    const size = Math.min(layout.width, layout.height) * 0.045;
    const x = layout.lanternX;
    // Gentle bob so it always feels afloat.
    const y = yForHeight(layout, state.height) + Math.sin(state.timeMs / 1100) * size * 0.08;
    this.track(y, dtMs);

    const t = state.timeMs / 1000;
    const flicker = state.flicker * (0.5 + 0.5 * noise(t));
    const brightness = (state.paused ? 0.35 : 1) * (1 - 0.55 * flicker);
    const glow = (0.35 + 0.65 * state.glow) * brightness;

    this.drawReflection(ctx, layout, x, y, size, glow);
    this.drawHalo(ctx, x, y, size, glow);
    this.drawTails(ctx, x, y, size, t, brightness);
    this.drawBody(ctx, x, y, size, brightness);
  }

  private drawHalo(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    glow: number,
  ): void {
    const halo = ctx.createRadialGradient(x, y, s * 0.3, x, y, s * 5);
    halo.addColorStop(0, `rgba(255, 190, 90, ${(0.55 * glow).toFixed(3)})`);
    halo.addColorStop(0.4, `rgba(255, 150, 60, ${(0.18 * glow).toFixed(3)})`);
    halo.addColorStop(1, 'rgba(255, 150, 60, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(x - s * 5, y - s * 5, s * 10, s * 10);
  }

  private drawBody(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    brightness: number,
  ): void {
    const at = ([px, py]: Point): Point => [x + px * s, y + py * s];

    // Hanging loop on top.
    ctx.strokeStyle = 'rgba(90, 55, 30, 0.9)';
    ctx.lineWidth = Math.max(1, s * 0.06);
    ctx.beginPath();
    ctx.ellipse(x, y - 1.45 * s, s * 0.12, s * 0.16, 0, 0, Math.PI * 2);
    ctx.stroke();

    for (const facet of FACETS) {
      ctx.beginPath();
      facet.points.forEach((p, i) => {
        const [px, py] = at(p);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.closePath();
      ctx.fillStyle = facet.color;
      ctx.globalAlpha = Math.min(1, 0.55 + 0.45 * brightness * facet.light);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Warm light shining through the paper from the centre.
    const inner = ctx.createRadialGradient(x, y, 0, x, y, s * 1.1);
    inner.addColorStop(0, `rgba(255, 250, 225, ${(0.75 * brightness).toFixed(3)})`);
    inner.addColorStop(1, 'rgba(255, 250, 225, 0)');
    ctx.fillStyle = inner;
    ctx.beginPath();
    for (const [i, p] of [TOP, R1, R2, BOTTOM, L2, L1].entries()) {
      const [px, py] = at(p);
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();

    // Bamboo frame.
    ctx.strokeStyle = 'rgba(110, 60, 30, 0.85)';
    ctx.lineWidth = Math.max(1, s * 0.05);
    ctx.lineJoin = 'round';
    const edges: [Point, Point][] = [
      [TOP, L1],
      [TOP, I1],
      [TOP, J1],
      [TOP, R1],
      [L1, L2],
      [I1, I2],
      [J1, J2],
      [R1, R2],
      [L1, R1],
      [L2, R2],
      [BOTTOM, L2],
      [BOTTOM, I2],
      [BOTTOM, J2],
      [BOTTOM, R2],
    ];
    ctx.beginPath();
    for (const [a, b] of edges) {
      const [ax, ay] = at(a);
      const [bx, by] = at(b);
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
  }

  /** Paper tails trail opposite to the motion and wave gently in the breeze. */
  private drawTails(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    s: number,
    t: number,
    brightness: number,
  ): void {
    // Moving up (negative velocity) pushes the tails down and back; moving down lifts them.
    const lift = Math.max(-1, Math.min(1, this.velocity * 25));
    ctx.lineCap = 'round';
    for (const tail of TAILS) {
      const sx = x + tail.from[0] * s;
      const sy = y + tail.from[1] * s;
      const len = tail.length * s;
      const sway = Math.sin(t * 1.6 + tail.phase) * s * 0.35;
      const trail = -s * (0.6 + 0.4 * Math.abs(lift)); // the river carries the lantern right, so tails trail left
      const ex = sx + trail + sway;
      const ey = sy + len * (1 - 0.35 * Math.max(0, lift));
      const cx = sx + sway * 1.6 + trail * 0.3;
      const cy = sy + len * 0.55;

      ctx.strokeStyle = tail.color;
      ctx.globalAlpha = 0.85 * (0.5 + 0.5 * brightness);
      ctx.lineWidth = Math.max(1, s * 0.13);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.quadraticCurveTo(cx, cy, ex, ey);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  /** A soft, stretched reflection on the water, brighter when the lantern is low. */
  private drawReflection(
    ctx: CanvasRenderingContext2D,
    l: Layout,
    x: number,
    y: number,
    s: number,
    glow: number,
  ): void {
    const distance = Math.max(0, l.waterY - y);
    const ry = l.waterY + distance * 0.35 + s;
    const closeness = 1 - Math.min(1, distance / (l.waterY - l.flyTop));
    const alpha = (0.15 + 0.35 * closeness) * glow;

    const reflection = ctx.createRadialGradient(x, ry, 0, x, ry, s * 3);
    reflection.addColorStop(0, `rgba(255, 179, 71, ${alpha.toFixed(3)})`);
    reflection.addColorStop(1, 'rgba(255, 179, 71, 0)');
    ctx.save();
    ctx.translate(x, ry);
    ctx.scale(1, 0.45);
    ctx.translate(-x, -ry);
    ctx.fillStyle = reflection;
    ctx.fillRect(x - s * 3, ry - s * 3, s * 6, s * 6);
    ctx.restore();

    // Broken shimmer lines, like light on moving water.
    ctx.strokeStyle = `rgba(255, 200, 120, ${(alpha * 0.9).toFixed(3)})`;
    ctx.lineWidth = Math.max(1, s * 0.08);
    for (let i = 0; i < 4; i++) {
      const wy = ry - s * 0.6 + i * s * 0.4;
      const half = s * (1.1 - i * 0.2);
      ctx.beginPath();
      ctx.moveTo(x - half, wy);
      ctx.lineTo(x + half, wy);
      ctx.stroke();
    }
  }
}
