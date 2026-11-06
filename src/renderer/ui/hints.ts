// Friendly on-screen hints from the SDK's validation codes, plus the rules
// for when a hint pauses the game.
//
// Hints are debounced: one only appears (and pauses) after it has lasted a
// moment, and clears only after things have been fine for a moment, so a
// single bad frame never makes the screen flicker.

import type { InputHint } from '../input/types';
import type { CalibrationFailure } from '../calibration';

interface HintInfo {
  text: string;
  /** True if the signal cannot be trusted while this hint is showing. */
  pauses: boolean;
}

export const HINTS: Record<InputHint, HintInfo> = {
  'no-face': { text: 'We can’t see you. Sit in front of the camera.', pauses: true },
  'multiple-faces': { text: 'Only one player at a time, please.', pauses: true },
  'not-centered': { text: 'Move to the middle of the camera view.', pauses: true },
  'too-close': { text: 'Sit back a little.', pauses: true },
  'too-far': { text: 'Move a little closer.', pauses: true },
  'too-high': { text: 'Move down a little, or tilt the screen up.', pauses: true },
  'too-low': { text: 'Move up a little, or tilt the screen down.', pauses: true },
  'not-facing': { text: 'Face the screen.', pauses: true },
  'too-dark': { text: 'Find a little more light.', pauses: true },
  'too-bright': {
    text: 'It’s too bright. Avoid light shining straight into the camera.',
    pauses: true,
  },
  'chest-not-visible': { text: 'Make sure your shoulders and chest are in view.', pauses: true },
  'too-much-motion': {
    text: 'Try to sit still and let your breath move the lantern.',
    pauses: false,
  },
  'low-frame-rate': {
    text: 'The camera is running slowly. Close other apps if you can.',
    pauses: false,
  },
  'camera-tuning': { text: 'Adjusting the camera…', pauses: false },
};

export const CALIBRATION_FAILURES: Record<CalibrationFailure, string> = {
  'no-signal': 'We couldn’t pick up your breathing. Check the hints, then try again.',
  'weak-signal': 'Your breathing was hard to see. Sit a little closer, in good light.',
  'not-following':
    'Let’s try again. Breathe slowly with the light: in as it rises, out as it falls.',
};

/** Time a hint must last before it shows. */
const SHOW_AFTER_MS = 700;
/** Time without a hint before it clears. */
const CLEAR_AFTER_MS = 500;

/** Shows the current hint in a small banner and reports whether the game should pause. */
export class HintDisplay {
  private readonly banner: HTMLDivElement;
  private pending: { hint: InputHint | null; since: number } = { hint: null, since: 0 };
  private shown: InputHint | null = null;
  /** A one-off message stays until this time (performance.now()), unless a hint replaces it. */
  private messageUntil = 0;

  constructor(parent: HTMLElement) {
    this.banner = document.createElement('div');
    this.banner.setAttribute('role', 'status');
    this.banner.setAttribute('aria-live', 'polite');
    Object.assign(this.banner.style, {
      position: 'fixed',
      left: '50%',
      bottom: '48px',
      transform: 'translateX(-50%)',
      padding: '12px 22px',
      borderRadius: '999px',
      background: 'rgba(11, 22, 48, 0.85)',
      border: '1px solid rgba(255, 179, 71, 0.5)',
      color: '#f5e6c8',
      font: '18px/1.4 system-ui, sans-serif',
      pointerEvents: 'none',
      transition: 'opacity 0.3s',
      opacity: '0',
    });
    parent.appendChild(this.banner);
  }

  /** The hint currently on screen, if any. */
  get current(): InputHint | null {
    return this.shown;
  }

  /** True while a hint that makes the signal unreliable is showing. */
  get paused(): boolean {
    return this.shown !== null && HINTS[this.shown].pauses;
  }

  /** Call when the input reports a new hint (or null when all is fine). */
  set(hint: InputHint | null, nowMs: number): void {
    if (hint !== this.pending.hint) this.pending = { hint, since: nowMs };
  }

  /** Call every frame to apply the debounce. */
  update(nowMs: number): void {
    const { hint, since } = this.pending;
    if (hint !== this.shown) {
      const wait = hint === null ? CLEAR_AFTER_MS : SHOW_AFTER_MS;
      if (nowMs - since >= wait) {
        this.shown = hint;
        if (hint) {
          this.messageUntil = 0;
          this.banner.textContent = HINTS[hint].text;
        }
      }
    }
    const visible = this.shown !== null || nowMs < this.messageUntil;
    this.banner.style.opacity = visible ? '1' : '0';
  }

  /** Shows a message straight away, e.g. after a failed calibration. A real hint replaces it. */
  message(text: string, nowMs: number, durationMs = 6_000): void {
    if (this.shown) return;
    this.banner.textContent = text;
    this.messageUntil = nowMs + durationMs;
    this.banner.style.opacity = '1';
  }

  clear(): void {
    this.pending = { hint: null, since: 0 };
    this.shown = null;
    this.messageUntil = 0;
    this.banner.style.opacity = '0';
  }
}
