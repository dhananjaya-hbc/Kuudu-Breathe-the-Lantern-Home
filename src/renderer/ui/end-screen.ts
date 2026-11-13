// The "lantern release" screen at the end of a run.
//
// The kuudu drifts up into the night sky, then the whole run is drawn
// across the sky as a glowing ribbon (the player's breath), over a faint
// line showing the target wave. A card shows the results, with Play again
// and Done.
//
// The ribbon data lives only in memory and is discarded with the screen.

import type { RunSummary } from '../game/scoring';
import type { HighScore } from '../storage';
import type { Layout } from '../game/scene';

/** One point of the run, recorded a few times per second. */
export interface RibbonPoint {
  runMs: number;
  /** Lantern height, 0–1. */
  player: number;
  /** Target height, 0–1. */
  target: number;
}

const RECORD_EVERY_MS = 100;

/** Records the run at 10 Hz for the ribbon. */
export class RibbonRecorder {
  private points: RibbonPoint[] = [];

  get data(): readonly RibbonPoint[] {
    return this.points;
  }

  record(runMs: number, player: number, target: number): void {
    const last = this.points.at(-1);
    if (last && runMs - last.runMs < RECORD_EVERY_MS) return;
    this.points.push({ runMs, player, target });
  }

  clear(): void {
    this.points = [];
  }
}

/** How long the lantern takes to float away. */
export const RELEASE_MS = 3_000;
const RIBBON_DELAY_MS = 1_200;
const RIBBON_DRAW_MS = 2_800;
const CARD_DELAY_MS = 2_400;

export interface EndScreenData {
  modeName: string;
  summary: RunSummary;
  newBest: boolean;
  best: HighScore | null;
  ribbon: readonly RibbonPoint[];
  /**
   * Average breathing pace from the SmartSpectra breathing rate (confident
   * readings only), and the run's target pace. Null in keyboard mode or when
   * there were no confident readings.
   */
  pace: { breathsPerMinute: number; target: string } | null;
}

export interface EndScreenActions {
  onPlayAgain(): void;
  onDone(): void;
}

export class EndScreen {
  private readonly card: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly lines: HTMLDivElement;
  private readonly playAgain: HTMLButtonElement;
  private readonly done: HTMLButtonElement;
  private data: EndScreenData | null = null;
  private shownAtMs = 0;
  private actions: EndScreenActions | null = null;
  private cardTimer: number | null = null;

  constructor(parent: HTMLElement) {
    this.card = document.createElement('div');
    Object.assign(this.card.style, {
      position: 'fixed',
      left: '50%',
      bottom: '6vh',
      transform: 'translateX(-50%)',
      minWidth: '340px',
      padding: '22px 30px',
      borderRadius: '18px',
      background: 'rgba(8, 16, 38, 0.88)',
      border: '1px solid rgba(255, 179, 71, 0.35)',
      color: '#f5e6c8',
      font: '16px/1.6 system-ui, sans-serif',
      textAlign: 'center',
      boxShadow: '0 10px 40px rgba(0, 0, 0, 0.4)',
      transition: 'opacity 0.6s',
      opacity: '0',
      display: 'none',
    });

    this.title = document.createElement('h2');
    Object.assign(this.title.style, { margin: '0 0 10px', font: '600 24px system-ui, sans-serif' });
    this.lines = document.createElement('div');

    const buttons = document.createElement('div');
    Object.assign(buttons.style, {
      marginTop: '16px',
      display: 'flex',
      gap: '12px',
      justifyContent: 'center',
    });
    this.playAgain = makeButton('Play again', true);
    this.done = makeButton('Done', false);
    this.playAgain.addEventListener('click', () => this.actions?.onPlayAgain());
    this.done.addEventListener('click', () => this.actions?.onDone());
    buttons.append(this.playAgain, this.done);

    this.card.append(this.title, this.lines, buttons);
    parent.appendChild(this.card);
  }

  get visible(): boolean {
    return this.data !== null;
  }

  /** Time since the screen opened, for the release animation. */
  elapsed(nowMs: number): number {
    return nowMs - this.shownAtMs;
  }

  show(data: EndScreenData, nowMs: number, actions: EndScreenActions): void {
    this.data = data;
    this.actions = actions;
    this.shownAtMs = nowMs;

    const s = data.summary;
    const total = s.gatesPassed + s.gatesMissed;
    this.title.textContent = 'Your lantern drifts home';
    const rows: [string, string][] = [
      ['Score', s.score.toLocaleString()],
      ['Gates', total > 0 ? `${s.gatesPassed} of ${total}` : '–'],
      ['Best streak', String(s.bestStreak)],
      ['Time glowing', `${Math.round(s.timeInGlow * 100)}%`],
      ['Rhythm match', `${Math.round(s.averageMatch * 100)}%`],
    ];
    if (data.pace) {
      rows.push([
        'Your pace',
        `${data.pace.breathsPerMinute.toFixed(1)} breaths/min · target ${data.pace.target}`,
      ]);
    }
    this.lines.replaceChildren(...rows.map(([label, value]) => row(label, value)), bestLine(data));

    this.card.style.display = 'block';
    this.card.style.opacity = '0';
    if (this.cardTimer !== null) window.clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => {
      this.card.style.opacity = '1';
      this.playAgain.focus();
    }, CARD_DELAY_MS);
  }

  hide(): void {
    this.data = null;
    this.actions = null;
    if (this.cardTimer !== null) window.clearTimeout(this.cardTimer);
    this.cardTimer = null;
    this.card.style.opacity = '0';
    this.card.style.display = 'none';
  }

  /** Height for the lantern as it floats up and away (above 1 = off the top). */
  releaseHeight(nowMs: number, fromHeight: number): number {
    const t = Math.min(1, this.elapsed(nowMs) / RELEASE_MS);
    const eased = t * t * (3 - 2 * t);
    return fromHeight + (2.2 - fromHeight) * eased;
  }

  /** Draws the ribbon of the run across the sky. */
  draw(ctx: CanvasRenderingContext2D, l: Layout, nowMs: number): void {
    const data = this.data;
    if (!data || data.ribbon.length < 2) return;
    const elapsed = this.elapsed(nowMs);
    const reveal = Math.min(1, Math.max(0, (elapsed - RIBBON_DELAY_MS) / RIBBON_DRAW_MS));
    if (reveal <= 0) return;

    const points = data.ribbon;
    const first = points[0]!.runMs;
    const span = Math.max(1, points.at(-1)!.runMs - first);
    const left = l.width * 0.08;
    const width = l.width * 0.84;
    const top = l.height * 0.1;
    const height = l.height * 0.3;
    const px = (p: RibbonPoint): number => left + ((p.runMs - first) / span) * width;
    const py = (v: number): number => top + (1 - v) * height;

    ctx.save();
    ctx.globalAlpha = Math.min(1, reveal * 3);

    // The target wave: a faint dotted line under the ribbon.
    ctx.strokeStyle = 'rgba(160, 190, 230, 0.35)';
    ctx.lineWidth = 2 * l.scale;
    ctx.setLineDash([3 * l.scale, 7 * l.scale]);
    trace(ctx, points, px, (p) => py(p.target), points.length);
    ctx.setLineDash([]);

    // The player's breath: a glowing ribbon, revealed left to right.
    const count = Math.max(2, Math.round(points.length * reveal));
    const gradient = ctx.createLinearGradient(left, 0, left + width, 0);
    gradient.addColorStop(0, '#ff8fa3');
    gradient.addColorStop(0.35, '#ffc15e');
    gradient.addColorStop(0.7, '#ffb347');
    gradient.addColorStop(1, '#ffe0a3');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 179, 71, 0.8)';
    ctx.shadowBlur = 18 * l.scale;
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 9 * l.scale;
    trace(ctx, points, px, (p) => py(p.player), count);
    ctx.shadowBlur = 0;
    ctx.strokeStyle = 'rgba(255, 250, 230, 0.7)';
    ctx.lineWidth = 2 * l.scale;
    trace(ctx, points, px, (p) => py(p.player), count);

    // A spark at the drawing tip while the ribbon is still being drawn.
    if (reveal < 1) {
      const tip = points[count - 1]!;
      const x = px(tip);
      const y = py(tip.player);
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 22 * l.scale);
      glow.addColorStop(0, 'rgba(255, 245, 210, 0.95)');
      glow.addColorStop(1, 'rgba(255, 179, 71, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 22 * l.scale, y - 22 * l.scale, 44 * l.scale, 44 * l.scale);
    }

    ctx.fillStyle = 'rgba(245, 230, 200, 0.75)';
    ctx.font = `${14 * l.scale}px system-ui, sans-serif`;
    ctx.fillText(`Your breath · ${data.modeName}`, left, top - 14 * l.scale);
    ctx.restore();
  }
}

function trace(
  ctx: CanvasRenderingContext2D,
  points: readonly RibbonPoint[],
  px: (p: RibbonPoint) => number,
  py: (p: RibbonPoint) => number,
  count: number,
): void {
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const p = points[i]!;
    if (i === 0) ctx.moveTo(px(p), py(p));
    else ctx.lineTo(px(p), py(p));
  }
  ctx.stroke();
}

function row(label: string, value: string): HTMLDivElement {
  const div = document.createElement('div');
  Object.assign(div.style, { display: 'flex', justifyContent: 'space-between', gap: '32px' });
  const a = document.createElement('span');
  a.style.opacity = '0.75';
  a.textContent = label;
  const b = document.createElement('strong');
  b.textContent = value;
  div.append(a, b);
  return div;
}

function bestLine(data: EndScreenData): HTMLDivElement {
  const div = document.createElement('div');
  div.style.marginTop = '10px';
  if (data.newBest) {
    div.style.color = '#ffc15e';
    div.textContent = `✦ New best for ${data.modeName}!`;
  } else if (data.best) {
    div.style.opacity = '0.75';
    div.textContent = `Best ${data.modeName}: ${data.best.score.toLocaleString()} (${data.best.date})`;
  }
  return div;
}

function makeButton(label: string, primary: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  Object.assign(button.style, {
    font: '600 15px system-ui, sans-serif',
    padding: '9px 22px',
    borderRadius: '999px',
    border: primary ? 'none' : '1px solid rgba(245, 230, 200, 0.4)',
    background: primary ? '#ffb347' : 'transparent',
    color: primary ? '#1a1206' : '#f5e6c8',
    cursor: 'pointer',
  });
  return button;
}
