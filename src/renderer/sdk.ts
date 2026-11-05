// Camera input: wraps the SmartSpectra renderer SDK behind the shared
// `BreathInput` interface.
//
// Import only from the `/renderer` and `/messages` entry points. The package
// root loads the native (FFI) runtime, which only works in the main process.

import {
  MetricType,
  SmartSpectraErrorCode,
  SmartSpectraSDK,
  ValidationCode,
  type SmartSpectraErrorCodeValue,
  type ValidationCodeValue,
} from '@smartspectra/node-sdk/renderer';
import { decodeMetrics } from '@smartspectra/node-sdk/messages';
import {
  InputEmitter,
  type BreathInput,
  type BreathInputEvents,
  type BreathSample,
  type InputHint,
} from './input/types';

/** Only what the game uses: chest waveform, breathing rate, amplitude. */
const REQUESTED_METRICS = [
  MetricType.CHEST_BREATHING,
  MetricType.BREATHING_RATE,
  MetricType.BREATHING_AMPLITUDE,
];

const HINTS: Partial<Record<ValidationCodeValue, InputHint>> = {
  [ValidationCode.kNoFaceFound]: 'no-face',
  [ValidationCode.kMultipleFacesFound]: 'multiple-faces',
  [ValidationCode.kFaceNotCentered]: 'not-centered',
  [ValidationCode.kFaceSizeOutOfRange]: 'too-far',
  [ValidationCode.kTooDark]: 'too-dark',
  [ValidationCode.kTooBright]: 'too-bright',
  [ValidationCode.kChestNotVisible]: 'chest-not-visible',
  [ValidationCode.kCameraTuning]: 'camera-tuning',
  [ValidationCode.kFrameRateTooLow]: 'low-frame-rate',
  [ValidationCode.kExcessiveMotion]: 'too-much-motion',
  [ValidationCode.kFaceTooClose]: 'too-close',
  [ValidationCode.kFaceTooFar]: 'too-far',
  [ValidationCode.kFaceTooHigh]: 'too-high',
  [ValidationCode.kFaceTooLow]: 'too-low',
  [ValidationCode.kFaceNotForward]: 'not-facing',
};

const ERROR_MESSAGES: Partial<Record<SmartSpectraErrorCodeValue, string>> = {
  [SmartSpectraErrorCode.kAuthenticationFailed]:
    'The SmartSpectra API key was not accepted. Check the key in your .env file.',
  [SmartSpectraErrorCode.kCreditExhausted]:
    'The free-trial usage limit has been reached. You can still play in keyboard mode.',
  [SmartSpectraErrorCode.kNetworkError]:
    'Could not reach the SmartSpectra service. Check your internet connection.',
  [SmartSpectraErrorCode.kServerError]: 'The SmartSpectra service had a problem. Please try again.',
  [SmartSpectraErrorCode.kInputUnavailable]:
    'The camera is not available. Close other apps that use it, then try again.',
};

/** Protobuf timestamps may arrive as a number or a Long-like object. Returns ms. */
function toMs(timestampUs: number | { toNumber(): number } | null | undefined): number {
  if (timestampUs == null) return Date.now();
  const us = typeof timestampUs === 'number' ? timestampUs : timestampUs.toNumber();
  return us / 1000;
}

export class CameraBreathInput implements BreathInput {
  readonly kind = 'camera' as const;

  private readonly emitter = new InputEmitter();
  private readonly sdk: SmartSpectraSDK;
  private lastSampleMs = 0;
  private lastHint: InputHint | null = null;

  constructor(
    apiKey: string,
    private readonly video: HTMLVideoElement,
  ) {
    this.sdk = new SmartSpectraSDK({ apiKey, requestedMetrics: REQUESTED_METRICS });

    this.sdk.on('streamAvailable', (stream) => {
      this.video.srcObject = stream;
    });
    this.sdk.on('metrics', (buf) => this.handleMetrics(buf));
    this.sdk.on('validationStatus', (code) => this.handleValidation(code));
    this.sdk.on('error', (code, message, retryable) => {
      this.emitter.emit('error', { message: ERROR_MESSAGES[code] ?? message, retryable });
    });
  }

  on<E extends keyof BreathInputEvents>(event: E, listener: BreathInputEvents[E]): () => void {
    return this.emitter.on(event, listener);
  }

  async start(): Promise<void> {
    this.lastSampleMs = 0;
    this.lastHint = null;
    await this.sdk.start();
  }

  async stop(): Promise<void> {
    await this.sdk.stop();
    this.video.srcObject = null;
  }

  /** Releases the SDK for good (window closing). */
  destroy(): void {
    this.sdk.destroy();
    this.video.srcObject = null;
  }

  private handleMetrics(buf: Uint8Array): void {
    const breathing = decodeMetrics(buf).breathing;
    if (!breathing) return;

    // Keep only samples newer than the last one we sent, in case packets overlap.
    const samples: BreathSample[] = [];
    for (const m of breathing.upperTrace ?? []) {
      const timeMs = toMs(m.timestamp);
      if (timeMs <= this.lastSampleMs || typeof m.value !== 'number') continue;
      samples.push({ timeMs, value: m.value, stable: !!m.stable });
    }
    samples.sort((a, b) => a.timeMs - b.timeMs);
    const newest = samples.at(-1);
    if (newest) {
      this.lastSampleMs = newest.timeMs;
      this.emitter.emit('samples', samples);
    }

    const rate = breathing.rate?.at(-1);
    if (rate && typeof rate.value === 'number') {
      this.emitter.emit('rate', {
        timeMs: toMs(rate.timestamp),
        breathsPerMinute: rate.value,
        confidence: rate.confidence ?? 0,
      });
    }

    const amplitude = breathing.amplitude?.at(-1);
    if (amplitude && typeof amplitude.value === 'number') {
      this.emitter.emit('amplitude', amplitude.value, toMs(amplitude.timestamp));
    }
  }

  private handleValidation(code: ValidationCodeValue): void {
    const hint = code === ValidationCode.kOk ? null : (HINTS[code] ?? null);
    if (hint === this.lastHint) return;
    this.lastHint = hint;
    this.emitter.emit('hint', hint);
  }
}
