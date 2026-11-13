// Camera input: wraps the SmartSpectra renderer SDK behind the shared
// `BreathInput` interface.
//
// Import only from the `/renderer` and `/messages` entry points. The package
// root loads the native (FFI) runtime, which only works in the main process.
//
// Privacy: breathing is computed on this device by the SDK. Only the two
// breathing metrics below are requested, and SDK telemetry is turned off.

import {
  MetricType,
  ProcessingStatus,
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

/**
 * Only what the game uses: the chest waveform (moves the lantern) and the
 * breathing rate (the pace shown at the end of a run).
 */
const REQUESTED_METRICS = [MetricType.CHEST_BREATHING, MetricType.BREATHING_RATE];

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
    'The free-trial usage limit has been reached for this API key.',
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
  private lastRateMs = 0;
  private lastHint: InputHint | null = null;
  /**
   * Frame timestamp (ms, SDK clock) → local time it was sent (performance.now()).
   * Sample timestamps use the same SDK clock as frames, so matching a sample to
   * its frame gives the real breath-to-screen delay. Insertion-ordered.
   */
  private readonly frameSentAt = new Map<number, number>();

  constructor(
    apiKey: string,
    private readonly video: HTMLVideoElement,
  ) {
    this.sdk = new SmartSpectraSDK({
      apiKey,
      requestedMetrics: REQUESTED_METRICS,
      // SDK telemetry is on by default. Kuudu turns it off: per Presage's
      // "SDK Telemetry & Privacy" doc, the SDK then starts no telemetry
      // session and transmits nothing.
      enableTelemetry: false,
    });

    this.sdk.on('streamAvailable', (stream) => {
      this.video.srcObject = stream;
    });
    this.sdk.on('frameSentThrough', (sent, timestampUs) => {
      if (!sent) return;
      this.frameSentAt.set(Math.round(timestampUs / 1000), performance.now());
      // Keep about 20 s of frames at 30 fps.
      if (this.frameSentAt.size > 600) {
        this.frameSentAt.delete(this.frameSentAt.keys().next().value!);
      }
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
    this.lastRateMs = 0;
    this.lastHint = null;
    this.frameSentAt.clear();
    // After an error (e.g. a dropped connection) the SDK must be reset before it can start again.
    if (this.sdk.processingStatus === ProcessingStatus.kError) await this.sdk.reset();
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
      const sentAt = this.findFrameSentAt(newest.timeMs);
      if (sentAt !== null) this.emitter.emit('latency', performance.now() - sentAt);
    }

    // Each packet repeats the latest rate; pass on only new readings.
    const rate = breathing.rate?.at(-1);
    const rateMs = rate ? toMs(rate.timestamp) : 0;
    if (rate && typeof rate.value === 'number' && rateMs > this.lastRateMs) {
      this.lastRateMs = rateMs;
      this.emitter.emit('rate', {
        timeMs: rateMs,
        breathsPerMinute: rate.value,
        confidence: rate.confidence ?? 0,
      });
    }
  }

  /** Local send time of the frame closest to `timeMs` (within one frame), or null. */
  private findFrameSentAt(timeMs: number): number | null {
    let best: number | null = null;
    let bestGap = 20; // ms; frames are ~33 ms apart at 30 fps
    for (const [frameMs, sentAt] of this.frameSentAt) {
      const gap = Math.abs(frameMs - timeMs);
      if (gap < bestGap) {
        bestGap = gap;
        best = sentAt;
      }
    }
    return best;
  }

  private handleValidation(code: ValidationCodeValue): void {
    const hint = code === ValidationCode.kOk ? null : (HINTS[code] ?? null);
    if (hint === this.lastHint) return;
    this.lastHint = hint;
    this.emitter.emit('hint', hint);
  }
}
