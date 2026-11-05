// Renderer entry point.
//
// For now this is the Phase 1 signal test screen: start the camera, then watch
// the live chest waveform, the breathing rate and SDK hints, and run the guided
// pace test to measure the real breath-to-screen delay and direction.
// It will grow into the full app (consent → calibration → game).

import { CameraBreathInput } from './sdk';
import type { BreathSample } from './input/types';
import {
  analysePaceTest,
  guideAt,
  isInhale,
  PACE_DURATION_MS,
  type PacePoint,
} from './debug/pace-test';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const video = document.querySelector<HTMLVideoElement>('#camera')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const ctx = canvas.getContext('2d')!;

/** How much waveform history to draw. */
const WINDOW_MS = 20_000;

const samples: BreathSample[] = [];
/** Recent frame-to-sample pipeline times: [arrival time, ms]. Not the full delay. */
const delays: [number, number][] = [];
/** performance.now() when the pace test started, or null when it is not running. */
let paceStart: number | null = null;
const pacePoints: PacePoint[] = [];
let paceText = 'not run yet';
let sampleRateHz = 0;
let rateText = '–';
let hintText = 'none';
let errorText = '';
let running = false;

ui.innerHTML = `
  <div style="position:fixed;top:16px;left:16px;font:14px/1.5 system-ui;color:#f5e6c8">
    <button id="toggle" style="font:inherit;padding:6px 14px">Start camera</button>
    <button id="pace" disabled style="font:inherit;padding:6px 14px">Pace test (32 s)</button>
    <span id="camera-on" hidden style="margin-left:12px;color:#ff9a3c">● Camera on</span>
    <pre id="stats" style="margin-top:8px"></pre>
  </div>`;
const toggle = ui.querySelector<HTMLButtonElement>('#toggle')!;
const paceButton = ui.querySelector<HTMLButtonElement>('#pace')!;
const cameraOn = ui.querySelector<HTMLSpanElement>('#camera-on')!;
const stats = ui.querySelector<HTMLPreElement>('#stats')!;

function resize(): void {
  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  document.body.style.margin = '0';
  document.body.style.background = '#0b1630';
  document.body.style.overflow = 'hidden';
}
window.addEventListener('resize', resize);
resize();

async function init(): Promise<void> {
  const apiKey = await window.kuudu.getApiKey();
  if (!apiKey) {
    errorText = 'No API key found. Add SMARTSPECTRA_API_KEY to .env and restart.';
    toggle.disabled = true;
    return;
  }

  const input = new CameraBreathInput(apiKey, video);

  input.on('samples', (batch) => {
    samples.push(...batch);
    const newest = batch.at(-1)!;
    const cutoff = newest.timeMs - WINDOW_MS;
    while (samples.length && samples[0]!.timeMs < cutoff) samples.shift();
    const span = (newest.timeMs - samples[0]!.timeMs) / 1000;
    sampleRateHz = span > 0 ? (samples.length - 1) / span : 0;
    if (paceStart !== null) {
      // Each sample's on-screen time: now for the newest, earlier ones spaced by their timestamps.
      const shownAt = performance.now() - paceStart;
      for (const s of batch) {
        pacePoints.push({ elapsedMs: shownAt - (newest.timeMs - s.timeMs), value: s.value });
      }
    }
    console.log(
      `[trace] +${batch.length} samples, value=${newest.value.toFixed(4)}, stable=${newest.stable}`,
    );
  });
  input.on('latency', (ms) => {
    const now = performance.now();
    delays.push([now, ms]);
    while (delays.length && delays[0]![0] < now - 10_000) delays.shift();
    console.log(`[latency] ${ms.toFixed(0)} ms`);
  });
  input.on('rate', (r) => {
    rateText = `${r.breathsPerMinute.toFixed(1)} br/min (confidence ${r.confidence.toFixed(0)})`;
  });
  input.on('hint', (h) => {
    hintText = h ?? 'none';
  });
  input.on('error', (e) => {
    errorText = e.message;
  });

  const stop = async (): Promise<void> => {
    if (!running) return;
    running = false;
    paceStart = null;
    paceButton.disabled = true;
    toggle.textContent = 'Start camera';
    cameraOn.hidden = true;
    await input.stop();
  };

  toggle.addEventListener('click', async () => {
    if (running) return stop();
    errorText = '';
    samples.length = 0;
    delays.length = 0;
    toggle.disabled = true;
    try {
      await input.start();
      running = true;
      paceButton.disabled = false;
      toggle.textContent = 'Stop camera (Esc)';
      cameraOn.hidden = false;
    } catch (e) {
      errorText = e instanceof Error ? e.message : String(e);
    } finally {
      toggle.disabled = false;
    }
  });

  paceButton.addEventListener('click', () => {
    pacePoints.length = 0;
    paceStart = performance.now();
    paceButton.disabled = true;
    paceText = 'running… follow the guide dot on the right';
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void stop();
  });
  window.addEventListener('beforeunload', () => input.destroy());
}

function delayText(): string {
  if (!delays.length) return running ? 'measuring…' : '–';
  const values = delays.map(([, ms]) => ms);
  const s = (ms: number): string => `${(ms / 1000).toFixed(2)} s`;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return `now ${s(values.at(-1)!)}  avg ${s(avg)}  worst ${s(Math.max(...values))}`;
}

function draw(): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  stats.textContent = [
    `samples (20 s): ${samples.length}  ~${sampleRateHz.toFixed(1)} Hz`,
    `pipeline:       ${delayText()}  (frame done → sample, not full delay)`,
    `pace test:      ${paceText}`,
    `breathing rate: ${rateText}`,
    `hint:           ${hintText}`,
    errorText ? `error:          ${errorText}` : '',
  ].join('\n');

  if (samples.length > 1) {
    let min = Infinity;
    let max = -Infinity;
    for (const s of samples) {
      min = Math.min(min, s.value);
      max = Math.max(max, s.value);
    }
    const range = max - min || 1;
    const end = samples.at(-1)!.timeMs;
    const top = h * 0.3;
    const height = h * 0.6;

    ctx.lineWidth = 3 * devicePixelRatio;
    ctx.strokeStyle = '#ffb347';
    ctx.beginPath();
    samples.forEach((s, i) => {
      const x = w - ((end - s.timeMs) / WINDOW_MS) * w;
      const y = top + height - ((s.value - min) / range) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  if (paceStart !== null) drawPaceGuide(w, h, performance.now() - paceStart);

  requestAnimationFrame(draw);
}

/** Draws the guide dot and finishes the pace test when time is up. */
function drawPaceGuide(w: number, h: number, elapsedMs: number): void {
  if (elapsedMs >= PACE_DURATION_MS) {
    paceStart = null;
    paceButton.disabled = !running;
    const result = analysePaceTest(pacePoints);
    paceText = result
      ? `delay ${(result.delayMs / 1000).toFixed(2)} s, match ${result.match.toFixed(2)}, ` +
        `${result.upIsInhale ? 'up = breathe in ✓' : 'up = breathe OUT (flipped)'}`
      : 'not enough data, try again';
    console.log('[pace test]', result);
    return;
  }

  const x = w - 120 * devicePixelRatio;
  const top = h * 0.3;
  const height = h * 0.6;
  const y = top + height - guideAt(elapsedMs) * height;

  ctx.strokeStyle = 'rgba(245, 230, 200, 0.25)';
  ctx.lineWidth = 2 * devicePixelRatio;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + height);
  ctx.stroke();

  ctx.fillStyle = '#7fd4ff';
  ctx.beginPath();
  ctx.arc(x, y, 18 * devicePixelRatio, 0, Math.PI * 2);
  ctx.fill();

  ctx.font = `${18 * devicePixelRatio}px system-ui`;
  ctx.textAlign = 'center';
  ctx.fillText(isInhale(elapsedMs) ? 'Breathe in' : 'Breathe out', x, top - 24 * devicePixelRatio);
  const left = Math.ceil((PACE_DURATION_MS - elapsedMs) / 1000);
  ctx.fillText(`${left} s`, x, top + height + 40 * devicePixelRatio);
}

void init();
requestAnimationFrame(draw);
