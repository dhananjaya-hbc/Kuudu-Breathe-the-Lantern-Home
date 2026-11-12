// Renderer entry point — full run.
//
// Pick a mode → Start camera → guided calibration over the river (~19 s) →
// the run (Drift: 2 min, Festival: 3 levels) → the camera turns off and the
// lantern release screen shows the breath ribbon and results.
//
// SDK hints show as a banner and pause the river. Press D for the waveform
// overlay and debug stats, Esc to stop the camera at any time.
//
// Still to come: consent screen, keyboard mode, settings, sound.

import { CameraBreathInput } from './sdk';
import { BreathSignal } from './signal';
import { Calibration, type CalibrationResult } from './calibration';
import { CALIBRATION_FAILURES, HintDisplay } from './ui/hints';
import { drawTraceGraph } from './debug/trace-graph';
import { GameLoop } from './game/loop';
import { computeLayout, Scene, type Layout } from './game/scene';
import { Lantern } from './game/lantern';
import { TargetWave } from './game/target-wave';
import { displayHeight, GateTrack } from './game/gates';
import { Scoring } from './game/scoring';
import { MODES, RunPlan, type ModeId } from './game/modes';
import { HighScoreStore } from './storage';
import { EndScreen, RibbonRecorder } from './ui/end-screen';

type Mode = 'off' | 'calibrating' | 'playing' | 'failed' | 'ended';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const video = document.querySelector<HTMLVideoElement>('#camera')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const ctx = canvas.getContext('2d')!;

const signal = new BreathSignal();
const calibration = new Calibration();
const hints = new HintDisplay(ui);
const scene = new Scene();
const lantern = new Lantern();
const highScores = new HighScoreStore();
const endScreen = new EndScreen(ui);
const ribbon = new RibbonRecorder();

let mode: Mode = 'off';
let modeId: ModeId = 'drift';
let showDebug = false;
let lastCalibration: CalibrationResult | null = null;
let rateText = '–';
let layout: Layout = computeLayout(1, 1, 1);

// Run state.
let plan = new RunPlan(modeId);
let wave = new TargetWave();
let gates = new GateTrack(wave);
let scoring = new Scoring();
let runMs = 0;
let scrollPx = 0;
/** Lantern height when the run ended, for the release animation. */
let endHeight = 0.5;
/** Level name banner: text and when it appeared. */
let banner: { text: string; atMs: number } | null = null;

ui.insertAdjacentHTML(
  'beforeend',
  `<div style="position:fixed;top:16px;left:16px;font:14px/1.5 system-ui;color:#f5e6c8">
     <span id="mode-picker">
       <button data-mode="drift" style="font:inherit;padding:6px 14px">Drift</button>
       <button data-mode="festival" style="font:inherit;padding:6px 14px">Festival</button>
     </span>
     <button id="toggle" style="font:inherit;padding:6px 14px">Start camera</button>
     <button id="recalibrate" hidden style="font:inherit;padding:6px 14px">Recalibrate</button>
     <span id="camera-on" hidden style="margin-left:12px;color:#ff9a3c">● Camera on</span>
     <pre id="stats" style="margin-top:8px;text-shadow:0 1px 2px #000"></pre>
   </div>`,
);
const modePicker = ui.querySelector<HTMLSpanElement>('#mode-picker')!;
const toggle = ui.querySelector<HTMLButtonElement>('#toggle')!;
const recalibrate = ui.querySelector<HTMLButtonElement>('#recalibrate')!;
const cameraOn = ui.querySelector<HTMLSpanElement>('#camera-on')!;
const stats = ui.querySelector<HTMLPreElement>('#stats')!;

function showModePicker(): void {
  modePicker.hidden = mode !== 'off';
  for (const b of modePicker.querySelectorAll<HTMLButtonElement>('button')) {
    const selected = b.dataset['mode'] === modeId;
    b.style.background = selected ? '#ffb347' : '';
    b.style.fontWeight = selected ? '600' : '';
  }
}
modePicker.addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).dataset['mode'];
  if (id === 'drift' || id === 'festival') modeId = id;
  showModePicker();
});
showModePicker();

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

/** Calibration delay, so the target the player is scored against is shifted fairly. */
const delayMs = (): number => (lastCalibration?.ok ? lastCalibration.delayMs : 0);

function startCalibration(): void {
  signal.reset();
  calibration.start(performance.now());
  mode = 'calibrating';
  recalibrate.hidden = true;
  showModePicker();
}

function startRun(now: number): void {
  plan = new RunPlan(modeId);
  wave = new TargetWave();
  gates = new GateTrack(wave);
  scoring = new Scoring();
  ribbon.clear();
  runMs = 0;
  const first = plan.apply(0, wave, gates);
  banner = first ? { text: bannerText(first.index, first.level.name), atMs: now } : null;
  mode = 'playing';
}

function bannerText(index: number, name: string): string {
  return plan.mode.levels.length > 1 ? `Level ${index + 1} · ${name}` : name;
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
    startRun(now);
  } else {
    hints.message(CALIBRATION_FAILURES[result.reason], now, 8_000);
    recalibrate.textContent = 'Try again';
    mode = 'failed';
  }
}

/** Set by init(); turns the camera off. */
let stopCamera: () => Promise<void> = async () => {};
/** Set by init(); turns the camera on and calibrates. */
let startCamera: () => Promise<void> = async () => {};

async function endRun(now: number): Promise<void> {
  endHeight = signal.height;
  mode = 'ended';
  const summary = scoring.summary();
  const best = highScores.best(modeId);
  const newBest = highScores.submit(modeId, summary.score);
  console.log('[run]', summary);
  endScreen.show(
    {
      modeName: plan.mode.name,
      summary,
      newBest,
      best: newBest ? null : best,
      ribbon: ribbon.data,
    },
    now,
    {
      onPlayAgain: () => {
        endScreen.hide();
        void startCamera();
      },
      onDone: () => {
        endScreen.hide();
        ribbon.clear(); // breathing data is discarded
        mode = 'off';
        showModePicker();
      },
    },
  );
  // The camera turns off as soon as a run ends.
  await stopCamera();
}

function update(dtMs: number, now: number): void {
  hints.update(now);

  if (mode === 'calibrating') {
    // Calibration only counts while the view is clear; restart it if not.
    if (hints.paused) calibration.start(now);
    else if (calibration.isDone(now)) finishCalibration(now);
  }

  // The river keeps flowing except while paused by a hint.
  if (!hints.paused) scrollPx += dtMs * pxPerMs() * (mode === 'off' ? 0.4 : 1);

  if (mode !== 'playing' || hints.paused) return;

  const height = signal.update(dtMs);
  runMs += dtMs;

  const level = plan.apply(runMs, wave, gates);
  if (level) banner = { text: bannerText(level.index, level.level.name), atMs: now };

  const target = displayHeight(wave.heightAt(runMs - delayMs()), gates.options.inset);
  scoring.update(dtMs, height, target);
  for (const e of gates.update(runMs, height)) scoring.onGate(e.result);
  ribbon.record(runMs, height, target);

  if (plan.isFinished(runMs)) void endRun(now);
}

function render(now: number, dtMs: number): void {
  const l = layout;
  const glow = mode === 'playing' || mode === 'ended' ? scoring.glow : 0.3;
  const streak = mode === 'playing' || mode === 'ended' ? scoring.streak : 0;
  scene.draw(ctx, l, { scrollPx, glow, streak, timeMs: now });

  if (mode === 'playing' || mode === 'failed') {
    gates.draw(ctx, l, runMs, pxPerMs());
    lantern.draw(
      ctx,
      l,
      {
        height: signal.height,
        glow,
        flicker: mode === 'playing' ? scoring.flicker : 0,
        paused: hints.paused,
        timeMs: now,
      },
      dtMs,
    );
  }
  if (mode === 'playing') drawHud(now);
  if (mode === 'calibrating') drawCalibration(now);
  if (mode === 'ended') {
    lantern.draw(
      ctx,
      l,
      {
        height: endScreen.releaseHeight(now, endHeight),
        glow: 1,
        flicker: 0,
        paused: false,
        timeMs: now,
      },
      dtMs,
    );
    endScreen.draw(ctx, l, now);
  }
  if (mode === 'off' && !endScreen.visible) drawTitle();

  if (showDebug && (mode === 'calibrating' || mode === 'playing')) {
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
        `glow ${scoring.glow.toFixed(2)} · flicker ${scoring.flicker.toFixed(2)}`,
        'D = toggle debug · Esc = stop camera',
      ].join('\n')
    : '';
}

/** Score, streak, level and time left, top right; plus the level banner. */
function drawHud(now: number): void {
  const l = layout;
  const s = l.scale;
  const left = Math.ceil(plan.remainingMs(runMs) / 1000);
  const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  const level = plan.levelAt(runMs);

  ctx.save();
  ctx.textAlign = 'right';
  ctx.fillStyle = '#f5e6c8';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.6)';
  ctx.shadowBlur = 4 * s;
  ctx.font = `600 ${28 * s}px system-ui, sans-serif`;
  ctx.fillText(scoring.score.toLocaleString(), l.width - 24 * s, 44 * s);
  ctx.font = `${14 * s}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.8)';
  const streakText = scoring.streak > 1 ? ` · streak ${scoring.streak}` : '';
  ctx.fillText(
    `${bannerText(level.index, level.level.name)} · ${time}${streakText}`,
    l.width - 24 * s,
    68 * s,
  );

  if (banner) {
    const age = now - banner.atMs;
    const alpha = age < 400 ? age / 400 : Math.max(0, 1 - (age - 2_200) / 800);
    if (alpha > 0) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffe0a3';
      ctx.font = `600 ${34 * s}px system-ui, sans-serif`;
      ctx.fillText(banner.text, l.width / 2, l.height * 0.12);
    } else if (age > 3_000) {
      banner = null;
    }
  }
  ctx.restore();
}

function drawTitle(): void {
  const l = layout;
  const s = l.scale;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffe0a3';
  ctx.shadowColor = 'rgba(255, 179, 71, 0.6)';
  ctx.shadowBlur = 20 * s;
  ctx.font = `600 ${44 * s}px system-ui, sans-serif`;
  ctx.fillText('Kuudu', l.width / 2, l.height * 0.3);
  ctx.shadowBlur = 0;
  ctx.font = `${20 * s}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.85)';
  ctx.fillText('Breathe the lantern home', l.width / 2, l.height * 0.3 + 36 * s);
  ctx.font = `${15 * s}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.65)';
  ctx.fillText(MODES[modeId].description, l.width / 2, l.height * 0.3 + 72 * s);
  ctx.restore();
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
  let cameraRunning = false;

  input.on('samples', (batch) => {
    signal.push(batch);
    if (mode === 'calibrating') calibration.addSamples(batch, performance.now());
  });
  input.on('rate', (r) => {
    rateText = `${r.breathsPerMinute.toFixed(1)} br/min (confidence ${r.confidence.toFixed(0)})`;
  });
  input.on('hint', (h) => hints.set(h, performance.now()));
  input.on('error', (e) => hints.message(e.message, performance.now(), 10_000));

  stopCamera = async () => {
    toggle.textContent = 'Start camera';
    recalibrate.hidden = true;
    cameraOn.hidden = true;
    hints.clear();
    signal.reset();
    if (!cameraRunning) return;
    cameraRunning = false;
    await input.stop();
  };

  startCamera = async () => {
    toggle.disabled = true;
    try {
      await input.start();
      cameraRunning = true;
      toggle.textContent = 'Stop camera (Esc)';
      cameraOn.hidden = false;
      startCalibration();
    } catch (e) {
      hints.message(e instanceof Error ? e.message : String(e), performance.now(), 10_000);
      mode = 'off';
      showModePicker();
    } finally {
      toggle.disabled = false;
    }
  };

  /** Stop button / Esc: ends whatever is happening and turns the camera off. */
  const stopEverything = async (): Promise<void> => {
    endScreen.hide();
    ribbon.clear();
    mode = 'off';
    showModePicker();
    await stopCamera();
  };

  toggle.addEventListener('click', () => {
    if (cameraRunning) void stopEverything();
    else {
      endScreen.hide();
      void startCamera();
    }
  });

  recalibrate.addEventListener('click', startCalibration);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void stopEverything();
    if (e.key === 'd' || e.key === 'D') showDebug = !showDebug;
  });
  window.addEventListener('beforeunload', () => {
    loop.stop();
    input.destroy();
  });
}

void init();
