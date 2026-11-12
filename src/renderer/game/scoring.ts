// Scoring: turns how the player breathes into glow, flicker, points and a
// run summary.
//
// - Glow (0–1): how closely the lantern follows the target wave over the
//   last breath (rolling correlation). The target is shifted by the
//   calibration delay, so signal lag never counts against the player.
// - Flicker (0–1): the lantern wavers when breathing is jerky, or when the
//   breath is held while the wave keeps moving.
// - Points: glow earns points continuously; each passed gate adds a bonus
//   that grows with the streak.
//
// Everything is sampled at a fixed 20 Hz, so results do not depend on frame rate.

import { pearson } from '../rhythm';
import type { GateResult } from './gates';

const SAMPLE_MS = 50;
/** Rhythm match window: one breath at the default pace. */
const MATCH_WINDOW_MS = 8_000;
/** Window for spotting a held breath. */
const HOLD_WINDOW_MS = 3_000;
/** Window for spotting jerky breathing. */
const JERK_WINDOW_MS = 2_000;

/** Correlation at or below this gives no glow; at or above GLOW_FULL gives full glow. */
const GLOW_ZERO = 0.2;
const GLOW_FULL = 0.85;

const POINTS_PER_SECOND_AT_FULL_GLOW = 10;
const GATE_POINTS = 100;
/** Each gate in a streak adds 10% to the gate bonus, up to double. */
const MAX_STREAK_BONUS = 1;

export interface RunSummary {
  score: number;
  gatesPassed: number;
  gatesMissed: number;
  bestStreak: number;
  /** Average rhythm match over the run, 0–1. */
  averageMatch: number;
  /** Share of the run spent glowing brightly (glow ≥ 0.6), 0–1. */
  timeInGlow: number;
  durationMs: number;
}

interface Sample {
  player: number;
  target: number;
}

export class Scoring {
  private readonly samples: Sample[] = [];
  private sinceSampleMs = 0;
  private glowValue = 0;
  private flickerValue = 0;
  private points = 0;
  private streakValue = 0;
  private bestStreakValue = 0;
  private passed = 0;
  private missed = 0;
  private durationMs = 0;
  private matchSum = 0;
  private matchCount = 0;
  private glowingMs = 0;

  get glow(): number {
    return this.glowValue;
  }

  get flicker(): number {
    return this.flickerValue;
  }

  get score(): number {
    return Math.round(this.points);
  }

  get streak(): number {
    return this.streakValue;
  }

  get bestStreak(): number {
    return this.bestStreakValue;
  }

  /**
   * Advances scoring by `dtMs`. `playerHeight` is the lantern height and
   * `targetHeight` the delay-shifted target, both 0–1 in the same units.
   */
  update(dtMs: number, playerHeight: number, targetHeight: number): void {
    if (dtMs <= 0) return;
    this.durationMs += dtMs;
    this.sinceSampleMs += dtMs;
    while (this.sinceSampleMs >= SAMPLE_MS) {
      this.sinceSampleMs -= SAMPLE_MS;
      this.samples.push({ player: playerHeight, target: targetHeight });
      if (this.samples.length > MATCH_WINDOW_MS / SAMPLE_MS) this.samples.shift();
    }

    const match = this.rhythmMatch();
    if (match !== null) {
      this.matchSum += match * dtMs;
      this.matchCount += dtMs;
    }
    const glowGoal = match === null ? this.glowValue : glowFromMatch(match);
    const flickerGoal = Math.max(this.holdAmount(), this.jerkAmount());

    // Ease toward the goals so the light changes gently.
    this.glowValue += (glowGoal - this.glowValue) * Math.min(1, dtMs / 600);
    this.flickerValue += (flickerGoal - this.flickerValue) * Math.min(1, dtMs / 300);

    // Flicker takes some of the glow's points away.
    const earning = this.glowValue * (1 - 0.5 * this.flickerValue);
    this.points += (earning * POINTS_PER_SECOND_AT_FULL_GLOW * dtMs) / 1000;
    if (this.glowValue >= 0.6) this.glowingMs += dtMs;
  }

  /** Records a gate result and returns the points it gave. */
  onGate(result: GateResult): number {
    if (result === 'missed') {
      this.missed++;
      this.streakValue = 0;
      return 0;
    }
    this.passed++;
    this.streakValue++;
    this.bestStreakValue = Math.max(this.bestStreakValue, this.streakValue);
    const bonus = Math.min(MAX_STREAK_BONUS, (this.streakValue - 1) * 0.1);
    const gained = Math.round(GATE_POINTS * (1 + bonus));
    this.points += gained;
    return gained;
  }

  summary(): RunSummary {
    return {
      score: this.score,
      gatesPassed: this.passed,
      gatesMissed: this.missed,
      bestStreak: this.bestStreakValue,
      averageMatch: this.matchCount > 0 ? this.matchSum / this.matchCount : 0,
      timeInGlow: this.durationMs > 0 ? this.glowingMs / this.durationMs : 0,
      durationMs: this.durationMs,
    };
  }

  /** Correlation between lantern and target over the last breath, or null until half a breath is recorded. */
  private rhythmMatch(): number | null {
    if (this.samples.length < MATCH_WINDOW_MS / SAMPLE_MS / 2) return null;
    const r = pearson(
      this.samples.map((s) => s.player),
      this.samples.map((s) => s.target),
    );
    return Math.max(0, r);
  }

  /** 0–1: how much the breath is being held while the target keeps moving. */
  private holdAmount(): number {
    const recent = this.samples.slice(-HOLD_WINDOW_MS / SAMPLE_MS);
    if (recent.length < HOLD_WINDOW_MS / SAMPLE_MS) return 0;
    const playerRange = range(recent.map((s) => s.player));
    const targetRange = range(recent.map((s) => s.target));
    if (targetRange < 0.3) return 0; // the target itself is near a turn; resting is fine
    return clamp01((0.12 - playerRange) / 0.08);
  }

  /** 0–1: how jerky the lantern's motion is (size of sudden changes in speed). */
  private jerkAmount(): number {
    const recent = this.samples.slice(-JERK_WINDOW_MS / SAMPLE_MS);
    if (recent.length < 3) return 0;
    let sum = 0;
    for (let i = 2; i < recent.length; i++) {
      sum += Math.abs(recent[i]!.player - 2 * recent[i - 1]!.player + recent[i - 2]!.player);
    }
    const jerk = sum / (recent.length - 2);
    return clamp01((jerk - 0.004) / 0.012);
  }
}

export function glowFromMatch(match: number): number {
  return clamp01((match - GLOW_ZERO) / (GLOW_FULL - GLOW_ZERO));
}

function range(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}
