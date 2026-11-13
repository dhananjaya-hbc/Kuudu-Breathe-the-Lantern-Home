// Keyboard mode: hold Space (or the Up arrow) to breathe in, release to
// breathe out. Same interface as the camera input, so the whole game works
// without a camera or an API key — useful for judges and as a fallback.
//
// Produces a smooth breath-like waveform at 30 Hz: the value eases toward
// "full" while the key is held and back toward "empty" when released.

import { InputEmitter, type BreathInput, type BreathInputEvents } from './types';

const SAMPLE_MS = 1000 / 30;
/** How quickly the breath fills or empties. */
const EASE_MS = 900;
const KEYS = new Set([' ', 'Spacebar', 'ArrowUp']);

export class KeyboardBreathInput implements BreathInput {
  readonly kind = 'keyboard' as const;

  private readonly emitter = new InputEmitter();
  private pressed = false;
  private value = 0;
  private timer: number | null = null;

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!KEYS.has(e.key)) return;
    // Don't let Space press a focused button or scroll the page.
    e.preventDefault();
    this.pressed = true;
  };

  private readonly onKeyUp = (e: KeyboardEvent): void => {
    if (KEYS.has(e.key)) this.pressed = false;
  };

  private readonly onBlur = (): void => {
    this.pressed = false;
  };

  on<E extends keyof BreathInputEvents>(event: E, listener: BreathInputEvents[E]): () => void {
    return this.emitter.on(event, listener);
  }

  async start(): Promise<void> {
    if (this.timer !== null) return;
    this.value = 0;
    this.pressed = false;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    this.timer = window.setInterval(() => this.tick(), SAMPLE_MS);
    this.emitter.emit('hint', null);
  }

  async stop(): Promise<void> {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.pressed = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private tick(): void {
    const goal = this.pressed ? 1 : 0;
    this.value += (goal - this.value) * (1 - Math.exp(-SAMPLE_MS / EASE_MS));
    this.emitter.emit('samples', [{ timeMs: Date.now(), value: this.value, stable: true }]);
  }
}
