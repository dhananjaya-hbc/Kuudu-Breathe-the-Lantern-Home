// Live waveform graph. Used for debugging and as the overlay in the demo
// video, so viewers can see the SmartSpectra signal driving the lantern.
//
// Draws, over the last `windowMs`:
//   - the drift-removed raw waveform (thin, faint), scaled to fit,
//   - the smoothed lantern height, 0–1 (thick, warm).

import type { ProcessedSample } from '../signal';

export interface GraphRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TraceGraphOptions {
  windowMs?: number;
  /** Device pixel ratio, for line widths and text. */
  scale?: number;
  label?: string;
}

export function drawTraceGraph(
  ctx: CanvasRenderingContext2D,
  rect: GraphRect,
  samples: Iterable<ProcessedSample>,
  {
    windowMs = 20_000,
    scale = 1,
    label = 'SmartSpectra breathing waveform',
  }: TraceGraphOptions = {},
): void {
  const points = [...samples];
  const { x, y, width, height } = rect;

  ctx.save();
  ctx.fillStyle = 'rgba(5, 12, 28, 0.65)';
  ctx.strokeStyle = 'rgba(245, 230, 200, 0.15)';
  ctx.lineWidth = scale;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 10 * scale);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(245, 230, 200, 0.7)';
  ctx.font = `${12 * scale}px system-ui, sans-serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(label, x + 12 * scale, y + 8 * scale);
  ctx.fillStyle = 'rgba(160, 190, 230, 0.8)';
  ctx.fillText('raw (drift removed)', x + width - 250 * scale, y + 8 * scale);
  ctx.fillStyle = '#ffb347';
  ctx.fillText('lantern height', x + width - 110 * scale, y + 8 * scale);

  const newest = points.at(-1);
  if (!newest || points.length < 2) {
    ctx.restore();
    return;
  }

  const pad = 28 * scale;
  const top = y + pad;
  const plotHeight = height - pad - 10 * scale;
  const toX = (timeMs: number): number => x + width - ((newest.timeMs - timeMs) / windowMs) * width;
  const visible = points.filter((p) => newest.timeMs - p.timeMs <= windowMs);

  let min = Infinity;
  let max = -Infinity;
  for (const p of visible) {
    min = Math.min(min, p.detrended);
    max = Math.max(max, p.detrended);
  }
  const range = max - min || 1;

  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  const line = (value: (p: ProcessedSample) => number, color: string, lineWidth: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth * scale;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    visible.forEach((p, i) => {
      const px = toX(p.timeMs);
      const py = top + plotHeight - value(p) * plotHeight;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.stroke();
  };

  line((p) => (p.detrended - min) / range, 'rgba(160, 190, 230, 0.6)', 1.5);
  line((p) => p.height, '#ffb347', 3);

  ctx.restore();
}
