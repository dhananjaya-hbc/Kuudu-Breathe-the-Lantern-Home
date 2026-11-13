// Renderer entry point.
//
// Menu → (camera: consent → camera on → guided calibration) or (keyboard) →
// the run (Drift: 2 min, Festival: 3 levels) → the input stops (camera off)
// → the lantern release screen with the breath ribbon and results.
//
// Esc or the Stop button ends everything and turns the camera off from any
// screen. Press D for the waveform overlay and debug stats.

import './styles.css';
import { CameraBreathInput } from './sdk';
import { KeyboardBreathInput } from './input/keyboard';
import type { BreathInput } from './input/types';
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
import { ConsentScreen } from './ui/consent';
import { CameraIndicator } from './ui/camera-indicator';
import { SettingsScreen } from './ui/settings';
import { button, el, Overlay } from './ui/dom';
import { AmbientAudio } from './audio/ambient';

type Screen =
  'menu' | 'consent' | 'settings' | 'warming' | 'calibrating' | 'failed' | 'playing' | 'ended';

/**
 * Presage: the breathing waveform needs up to 30 s before it is reliable.
 * Warm-up lasts until the SDK marks a sample stable (but at least
 * WARMUP_MIN_MS) or WARMUP_MAX_MS has passed, then calibration starts.
 */
const WARMUP_MIN_MS = 6_000;
const WARMUP_MAX_MS = 30_000;
type InputKind = 'camera' | 'keyboard';

const canvas = document.querySelector<HTMLCanvasElement>('#game')!;
const video = document.querySelector<HTMLVideoElement>('#camera')!;
const ui = document.querySelector<HTMLDivElement>('#ui')!;
const ctx = canvas.getContext('2d')!;

const signal = new BreathSignal();
const calibration = new Calibration();
const scene = new Scene();
const lantern = new Lantern();
const highScores = new HighScoreStore();
const ribbon = new RibbonRecorder();
const keyboard = new KeyboardBreathInput();

const menu = new Overlay(ui);
// The menu sits on the scene itself: no dimming or blur.
menu.root.style.background = 'transparent';
menu.root.style.backdropFilter = 'none';
const failedCard = new Overlay(ui);
const consent = new ConsentScreen(ui);
const settings = new SettingsScreen(ui, highScores);
const endScreen = new EndScreen(ui);
const hints = new HintDisplay(ui);
const indicator = new CameraIndicator(ui, () => void stopEverything());
const stats = el('pre', 'k-stats');
ui.append(stats);
const audio = new AmbientAudio();
const soundButton = button('♪ Sound on', () => toggleSound(), 'ghost');
Object.assign(soundButton.style, { position: 'fixed', right: '16px', bottom: '16px' });
soundButton.setAttribute('aria-pressed', 'true');
ui.append(soundButton);

/** Mute is for this session only and is never saved. */
function toggleSound(): void {
  audio.muted = !audio.muted;
  soundButton.textContent = audio.muted ? '♪ Sound off' : '♪ Sound on';
  soundButton.setAttribute('aria-pressed', String(!audio.muted));
}

let screen: Screen = 'menu';
let modeId: ModeId = 'drift';
let inputKind: InputKind = 'keyboard';
let camera: CameraBreathInput | null = null;
let cameraRunning = false;
/**
 * Increases every time the camera is asked to start or stop. A start that
 * finishes after Stop/Esc was pressed sees a newer session and turns the
 * camera straight back off, so Stop always wins.
 */
let cameraSession = 0;
let consentGiven = false;
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
/** Confident SmartSpectra breathing-rate readings during this run (memory only). */
let paceReadings: number[] = [];
/** The SDK treats breathing-rate confidence of 45 or more as reliable. */
const MIN_RATE_CONFIDENCE = 45;
/** Level name banner: text and when it appeared. */
let banner: { text: string; atMs: number } | null = null;

function resize(): void {
  const dpr = devicePixelRatio;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  layout = computeLayout(canvas.width, canvas.height, dpr);
}
window.addEventListener('resize', resize);
resize();

/** World scroll speed: about 9 s of river fits on screen. */
const pxPerMs = (): number => layout.width / 9_000;

/** Calibration delay, so the target the player is scored against is shifted fairly. */
const delayMs = (): number =>
  inputKind === 'camera' && lastCalibration?.ok ? lastCalibration.delayMs : 0;

// ---------------------------------------------------------------- screens

function showMenu(): void {
  screen = 'menu';
  hints.clear();
  const cards = el('div', 'k-modes');
  for (const mode of Object.values(MODES)) {
    const best = highScores.best(mode.id);
    const card = el(
      'button',
      'k-mode',
      el('strong', '', mode.name),
      mode.description,
      best ? el('span', 'k-best', `Best ${best.score.toLocaleString()}`) : null,
    );
    card.type = 'button';
    card.setAttribute('aria-pressed', String(mode.id === modeId));
    card.addEventListener('click', () => {
      modeId = mode.id;
      showMenu();
    });
    cards.append(card);
  }

  const cameraButton = button('Play with camera', playWithCamera, 'primary');
  cameraButton.disabled = camera === null;
  const title = el('h1', '', 'Kuudu');
  Object.assign(title.style, {
    margin: '0',
    font: '600 52px var(--font)',
    color: '#ffe0a3',
    textShadow: '0 0 24px rgba(255, 179, 71, 0.6)',
  });

  menu.open(
    el(
      'div',
      'k-menu',
      title,
      el('p', 'k-lead', 'Breathe the lantern home — a relaxing rhythm game for your breath.'),
      cards,
      el(
        'div',
        'k-actions',
        cameraButton,
        button('Play with keyboard', playWithKeyboard, camera ? 'plain' : 'primary'),
        button('Settings', openSettings, 'ghost'),
      ),
      camera
        ? null
        : el(
            'p',
            'k-note',
            'Camera play needs a SmartSpectra API key (see the README). Keyboard mode works without one.',
          ),
    ),
  );
}

function openSettings(): void {
  menu.close();
  screen = 'settings';
  settings.show(showMenu);
}

function playWithCamera(): void {
  menu.close();
  inputKind = 'camera';
  if (consentGiven) {
    void startCamera();
    return;
  }
  screen = 'consent';
  consent.show({
    onStartCamera: () => {
      consentGiven = true;
      void startCamera();
    },
    onKeyboard: playWithKeyboard,
    onBack: showMenu,
  });
}

async function startCamera(): Promise<void> {
  if (!camera) return;
  inputKind = 'camera';
  const session = ++cameraSession;
  try {
    await camera.start();
    if (session !== cameraSession) {
      // Stop was pressed while the camera was starting.
      await camera.stop();
      return;
    }
    cameraRunning = true;
    indicator.on = true;
    startWarmup();
  } catch (e) {
    hints.message(e instanceof Error ? e.message : String(e), performance.now(), 10_000);
    await stopCamera();
    showMenu();
  }
}

async function stopCamera(): Promise<void> {
  cameraSession++;
  indicator.on = false;
  if (!camera || !cameraRunning) return;
  cameraRunning = false;
  await camera.stop();
}

async function playWithKeyboard(): Promise<void> {
  menu.close();
  consent.hide();
  inputKind = 'keyboard';
  await stopCamera();
  signal.reset();
  signal.setInvert(false);
  signal.setMinRange(0.5);
  await keyboard.start();
  startRun(performance.now());
}

/** When warm-up began (performance.now()), and whether the SDK has reported a stable sample. */
let warmup = { startMs: 0, stableSeen: false };

function startWarmup(): void {
  failedCard.close();
  signal.reset();
  warmup = { startMs: performance.now(), stableSeen: false };
  screen = 'warming';
}

function startCalibration(): void {
  failedCard.close();
  signal.reset();
  calibration.start(performance.now());
  screen = 'calibrating';
}

function finishCalibration(now: number): void {
  const result = calibration.finish();
  lastCalibration = result;
  console.log('[calibration]', result);
  if (result.ok) {
    signal.setInvert(result.invert);
    signal.setMinRange(result.minRange);
    startRun(now);
    return;
  }
  screen = 'failed';
  failedCard.open(
    el(
      'div',
      'k-card',
      el('h2', '', 'Let’s try that again'),
      el('p', 'k-lead', CALIBRATION_FAILURES[result.reason]),
      el(
        'div',
        'k-actions',
        button('Try again', startCalibration, 'primary'),
        button('Play with keyboard', () => {
          failedCard.close();
          void playWithKeyboard();
        }),
        button('Back', () => void stopEverything(), 'ghost'),
      ),
    ),
  );
}

function startRun(now: number): void {
  plan = new RunPlan(modeId);
  wave = new TargetWave();
  gates = new GateTrack(wave);
  scoring = new Scoring();
  ribbon.clear();
  paceReadings = [];
  runMs = 0;
  // A focused button would also react to Space in keyboard mode.
  (document.activeElement as HTMLElement | null)?.blur();
  const first = plan.apply(0, wave, gates);
  banner = first ? { text: bannerText(first.index, first.level.name), atMs: now } : null;
  screen = 'playing';
  void audio.start();
}

function bannerText(index: number, name: string): string {
  return plan.mode.levels.length > 1 ? `Level ${index + 1} · ${name}` : name;
}

async function endRun(now: number): Promise<void> {
  endHeight = signal.height;
  screen = 'ended';
  audio.release();
  audio.stop();
  const summary = scoring.summary();
  const best = highScores.best(modeId);
  // Only breath (camera) runs count toward the best score; keyboard mode is a fallback.
  const newBest = inputKind === 'camera' && highScores.submit(modeId, summary.score);
  console.log('[run]', summary);
  endScreen.show(
    {
      modeName: plan.mode.name,
      summary,
      newBest,
      best: newBest ? null : best,
      keyboard: inputKind === 'keyboard',
      ribbon: ribbon.data,
      pace: paceSummary(),
    },
    now,
    {
      onPlayAgain: () => {
        endScreen.hide();
        if (inputKind === 'camera') void startCamera();
        else void playWithKeyboard();
      },
      onDone: () => {
        endScreen.hide();
        ribbon.clear(); // breathing data is discarded
        paceReadings = [];
        showMenu();
      },
    },
  );
  // The input stops as soon as a run ends; for the camera, that turns it off.
  await keyboard.stop();
  await stopCamera();
}

function paceSummary(): { breathsPerMinute: number; target: string } | null {
  if (inputKind !== 'camera' || paceReadings.length === 0) return null;
  const average = paceReadings.reduce((a, b) => a + b, 0) / paceReadings.length;
  const targets = plan.mode.levels.map((l) => l.bpm);
  const target =
    targets.length > 1 ? `${targets[0]} → ${targets.at(-1)}` : String(targets[0] ?? '');
  return { breathsPerMinute: average, target };
}

/** A camera error during calibration or a run: turn the camera off and offer a way on. */
async function cameraStopped(message: string): Promise<void> {
  screen = 'failed';
  audio.stop();
  ribbon.clear();
  paceReadings = [];
  hints.clear();
  failedCard.open(
    el(
      'div',
      'k-card',
      el('h2', '', 'Camera play stopped'),
      el('p', 'k-lead', message),
      el('p', 'k-note', 'The camera has been turned off.'),
      el(
        'div',
        'k-actions',
        button(
          'Try again',
          () => {
            failedCard.close();
            void startCamera();
          },
          'primary',
        ),
        button('Play with keyboard', () => {
          failedCard.close();
          void playWithKeyboard();
        }),
        button('Back', () => void stopEverything(), 'ghost'),
      ),
    ),
  );
  await stopCamera();
}

/** Esc / Stop: end whatever is happening, turn the camera off, back to the menu. */
async function stopEverything(): Promise<void> {
  consent.hide();
  settings.hide();
  failedCard.close();
  endScreen.hide();
  ribbon.clear();
  paceReadings = [];
  signal.reset();
  audio.stop();
  await keyboard.stop();
  await stopCamera();
  showMenu();
}

// ---------------------------------------------------------------- game loop

function update(dtMs: number, now: number): void {
  hints.update(now);

  if (screen === 'warming') {
    const elapsed = now - warmup.startMs;
    // Warm-up only counts while the view is clear; restart it if not.
    if (hints.paused) warmup = { startMs: now, stableSeen: false };
    else if ((warmup.stableSeen && elapsed >= WARMUP_MIN_MS) || elapsed >= WARMUP_MAX_MS) {
      startCalibration();
    }
  }

  if (screen === 'calibrating') {
    // Calibration only counts while the view is clear; restart it if not.
    if (hints.paused) calibration.start(now);
    else if (calibration.isDone(now)) finishCalibration(now);
  }

  // The river keeps flowing except while paused by a hint.
  const calm = screen === 'menu' || screen === 'settings' || screen === 'consent';
  if (!hints.paused) scrollPx += dtMs * pxPerMs() * (calm ? 0.4 : 1);

  if (screen !== 'playing' || hints.paused) return;

  const height = signal.update(dtMs);
  runMs += dtMs;

  const level = plan.apply(runMs, wave, gates);
  if (level) banner = { text: bannerText(level.index, level.level.name), atMs: now };

  const target = displayHeight(wave.heightAt(runMs - delayMs()), gates.options.inset);
  scoring.update(dtMs, height, target);
  for (const e of gates.update(runMs, height)) {
    scoring.onGate(e.result);
    if (e.result === 'passed') audio.chime(scoring.streak);
    else audio.miss();
  }
  audio.update(height, scoring.glow);
  ribbon.record(runMs, height, target);

  if (plan.isFinished(runMs)) void endRun(now);
}

function render(now: number, dtMs: number): void {
  const l = layout;
  const inRun = screen === 'playing' || screen === 'ended';
  const glow = inRun ? scoring.glow : 0.5;
  // On menu screens the lantern is centred, so its light on the water is too.
  const onMenu = screen === 'menu' || screen === 'consent' || screen === 'settings';
  scene.draw(ctx, onMenu ? { ...l, lanternX: l.width / 2 } : l, {
    scrollPx,
    glow,
    streak: inRun ? scoring.streak : 0,
    timeMs: now,
  });

  const lanternState = { glow, flicker: 0, paused: false, timeMs: now };
  if (screen === 'playing' || screen === 'failed') {
    gates.draw(ctx, l, runMs, pxPerMs());
    lantern.draw(
      ctx,
      l,
      {
        ...lanternState,
        height: signal.height,
        flicker: screen === 'playing' ? scoring.flicker : 0,
        paused: hints.paused,
      },
      dtMs,
    );
  } else if (screen === 'ended') {
    lantern.draw(
      ctx,
      l,
      { ...lanternState, glow: 1, height: endScreen.releaseHeight(now, endHeight) },
      dtMs,
    );
    endScreen.draw(ctx, l, now);
  } else if (screen !== 'calibrating') {
    // Menu, consent, settings, warm-up: the lantern floats gently, centred above the text.
    // During warm-up it slowly brightens, as if being lit.
    const warmGlow = screen === 'warming' ? 0.15 + 0.6 * warmupProgress(now) : glow;
    lantern.draw(
      ctx,
      { ...l, lanternX: l.width / 2 },
      { ...lanternState, glow: warmGlow, height: 0.93 + 0.04 * Math.sin(now / 2_400) },
      dtMs,
    );
  }

  if (screen === 'playing') drawHud(now);
  if (screen === 'warming') drawWarmup(now);
  if (screen === 'calibrating') drawCalibration(now);

  if (showDebug && (screen === 'warming' || screen === 'calibrating' || screen === 'playing')) {
    drawTraceGraph(
      ctx,
      { x: 16 * l.scale, y: l.height - 150 * l.scale, width: l.width * 0.4, height: 130 * l.scale },
      signal.history,
      { scale: l.scale },
    );
  }

  stats.textContent = showDebug
    ? [
        `input:          ${inputKind}`,
        `breathing rate: ${inputKind === 'camera' ? rateText : '–'}`,
        `calibration:    ${calibrationText()}`,
        `glow ${scoring.glow.toFixed(2)} · flicker ${scoring.flicker.toFixed(2)}`,
        'D = toggle debug · Esc = stop',
      ].join('\n')
    : '';
}

/** Score, streak, level and time left, top right; the level banner; keyboard reminder. */
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

  ctx.textAlign = 'center';
  if (inputKind === 'keyboard') {
    ctx.fillStyle = 'rgba(245, 230, 200, 0.75)';
    ctx.fillText(
      'Hold Space (or ↑) to breathe in · release to breathe out',
      l.width / 2,
      l.height - 28 * s,
    );
  }

  if (banner) {
    const age = now - banner.atMs;
    const alpha = age < 400 ? age / 400 : Math.max(0, 1 - (age - 2_200) / 800);
    if (alpha > 0) {
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

function calibrationText(): string {
  const c = lastCalibration;
  if (!c) return 'not run';
  if (!c.ok) return `failed: ${c.reason} (match ${c.match.toFixed(2)})`;
  return (
    `match ${c.match.toFixed(2)}, delay ${(c.delayMs / 1000).toFixed(2)} s, ` +
    `${c.invert ? 'flipped' : 'not flipped'}`
  );
}

function warmupProgress(now: number): number {
  return Math.min(1, (now - warmup.startMs) / WARMUP_MAX_MS);
}

/** "Settling in" while the SDK's breathing waveform warms up. */
function drawWarmup(now: number): void {
  const l = layout;
  const s = l.scale;
  const x = l.width / 2;
  const y = l.height * 0.5;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.fillStyle = '#f5e6c8';
  ctx.font = `600 ${26 * s}px system-ui, sans-serif`;
  ctx.fillText(hints.paused ? 'Waiting for a clear view…' : 'Settling in…', x, y);
  ctx.font = `${16 * s}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.8)';
  ctx.fillText('Sit comfortably, face the camera and breathe naturally.', x, y + 32 * s);
  ctx.fillStyle = 'rgba(245, 230, 200, 0.6)';
  ctx.font = `${14 * s}px system-ui, sans-serif`;
  ctx.fillText(
    'Tip: even light on your face, shoulders in view, and staying still work best.',
    x,
    y + 58 * s,
  );
  const barWidth = 240 * s;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.15)';
  ctx.fillRect(x - barWidth / 2, y + 80 * s, barWidth, 4 * s);
  ctx.fillStyle = '#ffb347';
  ctx.fillRect(x - barWidth / 2, y + 80 * s, barWidth * warmupProgress(now), 4 * s);
  ctx.restore();
}

/** The guide light over the river during calibration. */
function drawCalibration(now: number): void {
  const l = layout;
  const g = calibration.guide(now);
  const s = l.scale;
  const x = l.width / 2;
  const y = l.flyBottom - g.height * (l.flyBottom - l.flyTop);

  ctx.save();
  ctx.strokeStyle = 'rgba(245, 230, 200, 0.2)';
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.moveTo(x, l.flyTop);
  ctx.lineTo(x, l.flyBottom);
  ctx.stroke();

  ctx.fillStyle = '#7fd4ff';
  ctx.shadowColor = '#7fd4ff';
  ctx.shadowBlur = 30 * s;
  ctx.beginPath();
  ctx.arc(x, y, 20 * s, 0, Math.PI * 2);
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
  ctx.font = `${26 * s}px system-ui, sans-serif`;
  ctx.fillText(hints.paused ? 'Waiting for a clear view…' : labels[g.phase], x, l.flyTop - 30 * s);
  ctx.font = `${15 * s}px system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.8)';
  ctx.fillText('Follow the light to calibrate', x, l.flyBottom + 36 * s);

  const barWidth = 240 * s;
  const barY = l.flyBottom + 52 * s;
  ctx.fillStyle = 'rgba(245, 230, 200, 0.15)';
  ctx.fillRect(x - barWidth / 2, barY, barWidth, 4 * s);
  ctx.fillStyle = '#7fd4ff';
  ctx.fillRect(x - barWidth / 2, barY, barWidth * g.progress, 4 * s);
  ctx.restore();
}

let lastDt = 0;
const loop = new GameLoop({
  update: (dt, now) => {
    lastDt = dt;
    update(dt, now);
  },
  render: (now) => render(now, lastDt),
});

// ---------------------------------------------------------------- inputs

function attach(input: BreathInput): void {
  input.on('samples', (batch) => {
    if (input.kind !== inputKind) return;
    signal.push(batch);
    if (screen === 'warming' && batch.some((sample) => sample.stable)) warmup.stableSeen = true;
    if (screen === 'calibrating') calibration.addSamples(batch, performance.now());
  });
  input.on('hint', (h) => {
    if (input.kind === inputKind) hints.set(h, performance.now());
  });
  input.on('error', (e) => {
    const inUse = screen === 'warming' || screen === 'calibrating' || screen === 'playing';
    if (input.kind === 'camera' && inputKind === 'camera' && inUse) void cameraStopped(e.message);
    else hints.message(e.message, performance.now(), 10_000);
  });
}

async function init(): Promise<void> {
  loop.start();
  attach(keyboard);

  const apiKey = await window.kuudu.getApiKey();
  if (apiKey) {
    camera = new CameraBreathInput(apiKey, video);
    attach(camera);
    camera.on('rate', (r) => {
      if (screen === 'playing' && !hints.paused && r.confidence >= MIN_RATE_CONFIDENCE) {
        paceReadings.push(r.breathsPerMinute);
      }
      rateText = `${r.breathsPerMinute.toFixed(1)} br/min (confidence ${r.confidence.toFixed(0)})`;
    });
  }
  showMenu();

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') void stopEverything();
    if (e.key === 'd' || e.key === 'D') showDebug = !showDebug;
    if (e.key === 'm' || e.key === 'M') toggleSound();
  });
  window.addEventListener('beforeunload', () => {
    loop.stop();
    void keyboard.stop();
    camera?.destroy();
  });
}

void init();
