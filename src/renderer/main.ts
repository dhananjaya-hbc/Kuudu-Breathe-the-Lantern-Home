// Renderer entry point — first playable version.
//
// Start camera → guided calibration over the river (~19 s) → the kuudu
// floats down the night river and the player breathes it through the gates.
// SDK hints show as a banner and pause the river. Press D to toggle the
// waveform overlay and debug stats.
//
// Still to come: scoring (glow and flicker from rhythm match), consent
// screen, modes, end-of-run ribbon.

import { CameraBreathInput } from './sdk';
import { BreathSignal } from './signal';
import { Calibration, type CalibrationResult } from './calibration';
import { CALIBRATION_FAILURES, HintDisplay } from './ui/hints';
import { drawTraceGraph } from './debug/trace-graph';
import { GameLoop } from './game/loop';
import { computeLayout, Scene, type Layout } from './game/scene';
import { Lantern } from './game/lantern';
import { TargetWave } from './game/target-wave';
import { GateTrack } from './game/gates';

type Mode = 'off' | 'calibrating' | 'playing' | 'failed';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const video = document.querySelector<HTMLVideoElement>('#camera')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const ctx = canvas.getContext('2d')!;

const signal = new BreathSignal();
const calibration = new Calibration();
const hints = new HintDisplay(ui);
const scene = new Scene();
const lantern = new Lantern();
let wave = new TargetWave();
let gates = new GateTrack(wave);

let mode: Mode = 'off';
let showDebug = true;
let lastCalibration: CalibrationResult | null = null;
let rateText = '–';
let layout: Layout = computeLayout(1, 1, 1);

// Run state.
let runMs = 0;
let scrollPx = 0;
let streak = 0;
let bestStreak = 0;
let passed = 0;
let missed = 0;
/** Placeholder glow until scoring.ts: rises on a passed gate, falls on a miss. */
let glow = 0.3;
let glowTarget = 0.3;

ui.insertAdjacentHTML(
  'beforeend',
  `<div style="position:fixed;top:16px;left:16px;font:14px/1.5 system-ui;color:#f5e6c8">
     <button id="toggle" style="font:inherit;padding:6px 14px">Start camera</button>
     <button id="recalibrate" hidden style="font:inherit;padding:6px 14px">Recalibrate</button>
     <span id="camera-on" hidden style="margin-left:12px;color:#ff9a3c">● Camera on</span>
     <pre id="stats" style="margin-top:8px;text-shadow:0 1px 2px #000"></pre>
   </div>`,
);
const toggle = ui.querySelector<HTMLButtonElement>('#toggle')!;
const recalibrate = ui.querySelector<HTMLButtonElement>('#recalibrate')!;
const cameraOn = ui.querySelector<HTMLSpanElement>('#camera-on')!;
const stats = ui.querySelector<HTMLPreElement>('#stats')!;

function resize(): void {
  const dpr = devicePixelRatio;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  document.body.style.margin = '0';
  document.body.style.background = '#0b1630';
  document.body.style.overflow = 'hidden';
  layout = computeLayout(canvas.width, canvas.height, dpr);
}
window.addEventListener('resize', resize);
resize();

/** World scroll speed: about 9 s of river fits on screen. */
const pxPerMs = (): number => layout.width / 9_000;

function startCalibration(): void {
  signal.reset();
  calibration.start(performance.now());
  mode = 'calibrating';
  recalibrate.hidden = true;
}

function startRun(): void {
  wave = new TargetWave();
  gates = new GateTrack(wave);
  runMs = 0;
  streak = 0;
  passed = 0;
  missed = 0;
  glow = glowTarget = 0.3;
  mode = 'playing';
}

function finishCalibration(now: number): void {
  const result = calibration.finish();
  lastCalibration = result;
  console.log('[calibration]', result);
  recalibrate.hidden = false;
  if (result.ok) {
    signal.setInvert(result.invert);
    signal.setMinRange(result.minRange);
    recalibrate.textContent = 'Recalibrate';
    startRun();
  } else {
    hints.message(CALIBRATION_FAILURES[result.reason], now, 8_000);
    recalibrate.textContent = 'Try again';
    mode = 'failed';
  }
}

function update(dtMs: number, now: number): void {
  hints.update(now);

  if (mode === 'calibrating') {
    // Calibration only counts while the view is clear; restart it if not.
    if (hints.paused) calibration.start(now);
    else if (calibration.isDone(now)) finishCalibration(now);
  }

  // The river flows gently during calibration too, but only the run moves gates.
  if (mode !== 'off' && !hints.paused) scrollPx += dtMs * pxPerMs();

  if (mode === 'playing') {
    if (hints.paused) return; // hold everything until the view is clear
    const height = signal.update(dtMs);
    runMs += dtMs;
    for (const e of gates.update(runMs, height)) {
      if (e.result === 'passed') {
        passed++;
        streak++;
        bestStreak = Math.max(bestStreak, streak);
        glowTarget = Math.min(1, glowTarget + 0.2);
      } else {
        missed++;
        streak = 0;
        glowTarget = Math.max(0.15, glowTarget - 0.3);
      }
    }
    glow += (glowTarget - glow) * Math.min(1, dtMs / 400);
  }
}

function render(now: number, dtMs: number): void {
  const l = layout;
  scene.draw(ctx, l, { scrollPx, glow, streak, timeMs: now });

  if (mode === 'playing' || mode === 'failed') {
    gates.draw(ctx, l, runMs, pxPerMs());
    lantern.draw(
      ctx,
      l,
      { height: signal.height, glow, flicker: 0, paused: hints.paused, timeMs: now },
      dtMs,
    );
  }
  if (mode === 'calibrating') drawCalibration(now);

  if (showDebug && mode !== 'off') {
    const dpr = l.scale;
    drawTraceGraph(
      ctx,
      { x: 16 * dpr, y: l.height - 150 * dpr, width: l.width * 0.4, height: 130 * dpr },
      signal.history,
      { scale: dpr },
    );
  }

  stats.textContent = showDebug
    ? [
        `breathing rate: ${rateText}`,
        `calibration:    ${calibrationText()}`,
        `gates:          ${passed} passed, ${missed} missed · streak ${streak} (best ${bestStreak})`,
        'D = toggle debug · Esc = stop camera',
      ].join('\n')
    : '';
}

function calibrationText(): string {
  const c = lastCalibration;
  if (!c) return 'not run yet';
  if (!c.ok) return `failed: ${c.reason} (match ${c.match.toFixed(2)})`;
  return (
    `match ${c.match.toFixed(2)}, delay ${(c.delayMs / 1000).toFixed(2)} s, ` +
    `${c.invert ? 'flipped' : 'not flipped'}`
  );
}

/** The guide light over the river during calibration. */
function drawCalibration(now: number): void {
  const l = layout;
  const g = calibration.guide(now);
  const dpr = l.scale;
  const x = l.width / 2;
  const y = l.flyBottom - g.height * (l.flyBottom - l.flyTop);

  ctx.strokeStyle = 'rgba(245, 230, 200, 0.2)';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(x, l.flyTop);
  ctx.lineTo(x, l.flyBottom);
  ctx.stroke();

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
  ctx.fillStyle = '#f5e6c8';
  ctx.textAlign = 'center';
  ctx.font = `${26 * dpr}px system-ui, sans-serif`;
  ctx.fillText(
    hints.paused ? 'Waiting for a clear view…' : labels[g.phase],
    x,
    l.flyTop - 30 * dpr,
  );
  ctx.font = `${15 * dpr}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.8)';
  ctx.fillText('Follow the light to calibrate', x, l.flyBottom + 36 * dpr);

  const barWidth = 240 * dpr;
  const barY = l.flyBottom + 52 * dpr;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.15)';
  ctx.fillRect(x - barWidth / 2, barY, barWidth, 4 * dpr);
  ctx.fillStyle = '#7fd4ff';
  ctx.fillRect(x - barWidth / 2, barY, barWidth * g.progress, 4 * dpr);
  ctx.textAlign = 'start';
}

let lastDt = 0;
const loop = new GameLoop({
  update: (dt, now) => {
    lastDt = dt;
    update(dt, now);
  },
  render: (now) => render(now, lastDt),
});

async function init(): Promise<void> {
  loop.start();

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

  recalibrate.addEventListener('click', startCalibration);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void stop();
    if (e.key === 'd' || e.key === 'D') showDebug = !showDebug;
  });
  window.addEventListener('beforeunload', () => {
    loop.stop();
    input.destroy();
  });
}

void init();
