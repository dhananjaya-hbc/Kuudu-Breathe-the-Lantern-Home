// Renderer entry point — Phase 1 milestone screen.
//
// Start camera → guided calibration (~19 s) → a glowing lantern dot that
// rises as you breathe in and drifts down as you breathe out. SDK hints show
// as a banner and pause the dot. Press D to toggle the waveform overlay.
//
// Phase 2 replaces this with the full game (consent, river, gates, scoring).

import { CameraBreathInput } from './sdk';
import { BreathSignal } from './signal';
import { Calibration, type CalibrationResult } from './calibration';
import { CALIBRATION_FAILURES, HintDisplay } from './ui/hints';
import { drawTraceGraph } from './debug/trace-graph';

type Mode = 'off' | 'calibrating' | 'playing' | 'failed';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const video = document.querySelector<HTMLVideoElement>('#camera')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const ctx = canvas.getContext('2d')!;

const signal = new BreathSignal();
const calibration = new Calibration();
const hints = new HintDisplay(ui);

let mode: Mode = 'off';
let showGraph = true;
let lastCalibration: CalibrationResult | null = null;
let rateText = '–';
let lastFrame = performance.now();

ui.insertAdjacentHTML(
  'beforeend',
  `<div style="position:fixed;top:16px;left:16px;font:14px/1.5 system-ui;color:#f5e6c8">
     <button id="toggle" style="font:inherit;padding:6px 14px">Start camera</button>
     <button id="recalibrate" hidden style="font:inherit;padding:6px 14px">Recalibrate</button>
     <span id="camera-on" hidden style="margin-left:12px;color:#ff9a3c">● Camera on</span>
     <pre id="stats" style="margin-top:8px"></pre>
   </div>`,
);
const toggle = ui.querySelector<HTMLButtonElement>('#toggle')!;
const recalibrate = ui.querySelector<HTMLButtonElement>('#recalibrate')!;
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

function startCalibration(): void {
  signal.reset();
  calibration.start(performance.now());
  mode = 'calibrating';
  recalibrate.hidden = true;
}

function finishCalibration(now: number): void {
  const result = calibration.finish();
  lastCalibration = result;
  console.log('[calibration]', result);
  recalibrate.hidden = false;
  if (result.ok) {
    signal.setInvert(result.invert);
    signal.setMinRange(result.minRange);
    mode = 'playing';
  } else {
    hints.message(CALIBRATION_FAILURES[result.reason], now, 8_000);
    recalibrate.textContent = 'Try again';
    mode = 'failed';
  }
}

async function init(): Promise<void> {
  const apiKey = await window.kuudu.getApiKey();
  if (!apiKey) {
    stats.textContent = 'No API key found. Add SMARTSPECTRA_API_KEY to .env and restart.';
    toggle.disabled = true;
    return;
  }

  const input = new CameraBreathInput(apiKey, video);

  input.on('samples', (batch) => {
    signal.push(batch);
    if (mode === 'calibrating') calibration.addSamples(batch, performance.now());
  });
  input.on('rate', (r) => {
    rateText = `${r.breathsPerMinute.toFixed(1)} br/min (confidence ${r.confidence.toFixed(0)})`;
  });
  input.on('hint', (h) => hints.set(h, performance.now()));
  input.on('error', (e) => hints.message(e.message, performance.now(), 10_000));

  const stop = async (): Promise<void> => {
    if (mode === 'off') return;
    mode = 'off';
    toggle.textContent = 'Start camera';
    recalibrate.hidden = true;
    cameraOn.hidden = true;
    hints.clear();
    signal.reset();
    await input.stop();
  };

  toggle.addEventListener('click', async () => {
    if (mode !== 'off') return stop();
    toggle.disabled = true;
    try {
      await input.start();
      toggle.textContent = 'Stop camera (Esc)';
      cameraOn.hidden = false;
      startCalibration();
    } catch (e) {
      hints.message(e instanceof Error ? e.message : String(e), performance.now(), 10_000);
    } finally {
      toggle.disabled = false;
    }
  });

  recalibrate.addEventListener('click', () => {
    recalibrate.textContent = 'Recalibrate';
    startCalibration();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void stop();
    if (e.key === 'd' || e.key === 'D') showGraph = !showGraph;
  });
  window.addEventListener('beforeunload', () => input.destroy());
}

function calibrationText(): string {
  const c = lastCalibration;
  if (!c) return 'not run yet';
  if (!c.ok) return `failed: ${c.reason} (match ${c.match.toFixed(2)})`;
  return (
    `match ${c.match.toFixed(2)}, delay ${(c.delayMs / 1000).toFixed(2)} s, ` +
    `breath size ${c.breathSize.toPrecision(3)}, ${c.invert ? 'flipped' : 'not flipped'}`
  );
}

function drawCalibration(w: number, h: number, now: number): void {
  const g = calibration.guide(now);
  const dpr = devicePixelRatio;
  const x = w / 2;
  const top = h * 0.22;
  const height = h * 0.5;

  ctx.strokeStyle = 'rgba(245, 230, 200, 0.2)';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, top);
  ctx.lineTo(x, top + height);
  ctx.stroke();

  const y = top + height - g.height * height;
  ctx.fillStyle = '#7fd4ff';
  ctx.shadowColor = '#7fd4ff';
  ctx.shadowBlur = 30 * dpr;
  ctx.beginPath();
  ctx.arc(x, y, 20 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  const labels = {
    ready: 'Get ready… breathe normally',
    in: 'Breathe in',
    out: 'Breathe out',
    done: '',
  };
  const label = hints.paused ? 'Waiting for a clear view…' : labels[g.phase];
  ctx.fillStyle = '#f5e6c8';
  ctx.font = `${26 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(label, x, top - 36 * dpr);
  ctx.font = `${15 * dpr}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.7)';
  ctx.fillText('Follow the light to calibrate', x, top + height + 40 * dpr);

  const barWidth = 240 * dpr;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.15)';
  ctx.fillRect(x - barWidth / 2, top + height + 60 * dpr, barWidth, 4 * dpr);
  ctx.fillStyle = '#7fd4ff';
  ctx.fillRect(x - barWidth / 2, top + height + 60 * dpr, barWidth * g.progress, 4 * dpr);
  ctx.textAlign = 'start';
}

function drawLantern(w: number, h: number, dt: number): void {
  const dpr = devicePixelRatio;
  // Hold the lantern still while the signal can't be trusted.
  const height = hints.paused ? signal.height : signal.update(dt);
  const x = w * 0.35;
  const top = h * 0.15;
  const range = h * 0.55;
  const y = top + (1 - height) * range;
  const r = 26 * dpr;

  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
  glow.addColorStop(0, hints.paused ? 'rgba(255, 179, 71, 0.15)' : 'rgba(255, 179, 71, 0.45)');
  glow.addColorStop(1, 'rgba(255, 179, 71, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r * 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = hints.paused ? '#8a6a45' : '#ffcf7a';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(245, 230, 200, 0.7)';
  ctx.font = `${16 * dpr}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('Breathe in to rise · breathe out to drift down', w / 2, top + range + 50 * dpr);
  ctx.textAlign = 'start';
}

function draw(): void {
  const now = performance.now();
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  hints.update(now);

  if (mode === 'calibrating') {
    // Calibration only counts while the view is clear; restart it if not.
    if (hints.paused) calibration.start(now);
    else if (calibration.isDone(now)) finishCalibration(now);
    if (mode === 'calibrating') drawCalibration(w, h, now);
  }
  if (mode === 'playing') drawLantern(w, h, dt);

  if (showGraph && mode !== 'off') {
    const dpr = devicePixelRatio;
    drawTraceGraph(
      ctx,
      { x: 16 * dpr, y: h - 170 * dpr, width: w - 32 * dpr, height: 150 * dpr },
      signal.history,
      { scale: dpr },
    );
  }

  stats.textContent = [
    `breathing rate: ${rateText}`,
    `calibration:    ${calibrationText()}`,
    `signal ready:   ${signal.ready ? 'yes' : 'warming up'}`,
    'D = toggle waveform · Esc = stop camera',
  ].join('\n');

  requestAnimationFrame(draw);
}

void init();
requestAnimationFrame(draw);
