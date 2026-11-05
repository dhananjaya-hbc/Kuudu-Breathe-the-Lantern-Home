// Renderer entry point.
//
// For now this is the Phase 1 signal test screen: start the camera, then watch
// the live chest waveform, the breath-to-screen delay, the breathing rate and
// SDK hints. It will grow into the full app (consent → calibration → game).

import { CameraBreathInput } from './sdk';
import type { BreathSample } from './input/types';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const video = document.querySelector<HTMLVideoElement>('#camera')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const ctx = canvas.getContext('2d')!;

/** How much waveform history to draw. */
const WINDOW_MS = 20_000;

const samples: BreathSample[] = [];
let delayMs: number | null = null;
let sampleRateHz = 0;
let rateText = '–';
let hintText = 'none';
let errorText = '';
let running = false;

ui.innerHTML = `
  <div style="position:fixed;top:16px;left:16px;font:14px/1.5 system-ui;color:#f5e6c8">
    <button id="toggle" style="font:inherit;padding:6px 14px">Start camera</button>
    <span id="camera-on" hidden style="margin-left:12px;color:#ff9a3c">● Camera on</span>
    <pre id="stats" style="margin-top:8px"></pre>
  </div>`;
const toggle = ui.querySelector<HTMLButtonElement>('#toggle')!;
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
    delayMs = Date.now() - newest.timeMs;
    const cutoff = newest.timeMs - WINDOW_MS;
    while (samples.length && samples[0]!.timeMs < cutoff) samples.shift();
    const span = (newest.timeMs - samples[0]!.timeMs) / 1000;
    sampleRateHz = span > 0 ? (samples.length - 1) / span : 0;
    console.log(
      `[trace] +${batch.length} samples, value=${newest.value.toFixed(4)}, ` +
        `stable=${newest.stable}, delay=${delayMs.toFixed(0)} ms`,
    );
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
    toggle.textContent = 'Start camera';
    cameraOn.hidden = true;
    await input.stop();
  };

  toggle.addEventListener('click', async () => {
    if (running) return stop();
    errorText = '';
    samples.length = 0;
    delayMs = null;
    toggle.disabled = true;
    try {
      await input.start();
      running = true;
      toggle.textContent = 'Stop camera (Esc)';
      cameraOn.hidden = false;
    } catch (e) {
      errorText = e instanceof Error ? e.message : String(e);
    } finally {
      toggle.disabled = false;
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void stop();
  });
  window.addEventListener('beforeunload', () => input.destroy());
}

function draw(): void {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  stats.textContent = [
    `samples (20 s): ${samples.length}  ~${sampleRateHz.toFixed(1)} Hz`,
    `delay:          ${delayMs === null ? '–' : `${(delayMs / 1000).toFixed(2)} s`}`,
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

  requestAnimationFrame(draw);
}

void init();
requestAnimationFrame(draw);
