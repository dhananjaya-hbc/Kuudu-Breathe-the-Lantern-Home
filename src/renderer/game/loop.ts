// Game loop: calls `update` then `render` once per display frame (~60 fps).
//
// - Frame time is capped, so a stall (tab hidden, slow frame, debugger)
//   never makes the game jump forward.
// - The loop pauses itself while the window is hidden.

export interface LoopCallbacks {
  /** Advance the game. `dtMs` is the time since the last frame, capped. */
  update(dtMs: number, nowMs: number): void;
  /** Draw the current state. */
  render(nowMs: number): void;
}

/** Longest step a single frame may take. */
export const MAX_FRAME_MS = 100;

export class GameLoop {
  private frameId: number | null = null;
  private lastMs = 0;
  private readonly onVisibility = (): void => {
    if (document.hidden) this.halt();
    else if (this.wanted) this.resume();
  };
  /** True between start() and stop(), even while paused by a hidden window. */
  private wanted = false;

  constructor(private readonly callbacks: LoopCallbacks) {}

  get running(): boolean {
    return this.frameId !== null;
  }

  start(): void {
    if (this.wanted) return;
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    if (!document.hidden) this.resume();
  }

  stop(): void {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.halt();
  }

  private resume(): void {
    if (this.frameId !== null) return;
    this.lastMs = performance.now();
    this.frameId = requestAnimationFrame(this.tick);
  }

  private halt(): void {
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
  }

  private readonly tick = (nowMs: number): void => {
    const dtMs = Math.min(MAX_FRAME_MS, Math.max(0, nowMs - this.lastMs));
    this.lastMs = nowMs;
    this.callbacks.update(dtMs, nowMs);
    this.callbacks.render(nowMs);
    if (this.frameId !== null) this.frameId = requestAnimationFrame(this.tick);
  };
}
