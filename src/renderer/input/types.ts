// Shared input contract. The camera (SmartSpectra) and the keyboard fallback
// both implement `BreathInput`, so the signal module and the game never need
// to know which one is active.

/** One raw breathing-waveform sample. Units are undocumented, so values are only compared to each other. */
export interface BreathSample {
  /** Sample time in milliseconds (Unix epoch). */
  timeMs: number;
  /** Raw waveform value. Higher means more air in (chest raised). */
  value: number;
  /** True once the SDK's breathing-rate confidence is >= 45. Not needed to move the lantern. */
  stable: boolean;
}

/** Breathing-rate estimate. Arrives slowly: it is a ~30 s average. */
export interface BreathRate {
  timeMs: number;
  /** Breaths per minute. */
  breathsPerMinute: number;
  /** 0–100. The SDK treats >= 45 as reliable. */
  confidence: number;
}

/**
 * A friendly reason the signal is not usable right now, e.g. no face or too dark.
 * `null` means everything is fine.
 */
export type InputHint =
  | 'no-face'
  | 'multiple-faces'
  | 'not-centered'
  | 'too-close'
  | 'too-far'
  | 'too-high'
  | 'too-low'
  | 'not-facing'
  | 'too-dark'
  | 'too-bright'
  | 'chest-not-visible'
  | 'too-much-motion'
  | 'low-frame-rate'
  | 'camera-tuning';

/** A problem that stops the input from working, shown to the player. */
export interface InputError {
  message: string;
  /** True if trying again may help (e.g. a network hiccup). */
  retryable: boolean;
}

export interface BreathInputEvents {
  /** New waveform samples, oldest first. */
  samples: (samples: BreathSample[]) => void;
  rate: (rate: BreathRate) => void;
  /** Breathing amplitude, used for auto-scaling shallow and deep breathers. */
  amplitude: (value: number, timeMs: number) => void;
  hint: (hint: InputHint | null) => void;
  error: (error: InputError) => void;
}

export interface BreathInput {
  readonly kind: 'camera' | 'keyboard';
  /** Starts the input. For the camera this turns the camera on. */
  start(): Promise<void>;
  /** Stops the input. For the camera this turns the camera off. */
  stop(): Promise<void>;
  /** Subscribes to an event. Returns a function that unsubscribes. */
  on<E extends keyof BreathInputEvents>(event: E, listener: BreathInputEvents[E]): () => void;
}

/** Small typed event emitter shared by both inputs. */
export class InputEmitter {
  // Typed at the public methods; stored loosely inside.
  private readonly listeners = new Map<keyof BreathInputEvents, Set<(...args: never[]) => void>>();

  on<E extends keyof BreathInputEvents>(event: E, listener: BreathInputEvents[E]): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set.delete(listener);
  }

  emit<E extends keyof BreathInputEvents>(
    event: E,
    ...args: Parameters<BreathInputEvents[E]>
  ): void {
    this.listeners.get(event)?.forEach((listener) => {
      (listener as unknown as (...a: Parameters<BreathInputEvents[E]>) => void)(...args);
    });
  }
}
