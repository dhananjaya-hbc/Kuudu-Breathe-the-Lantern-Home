import { describe, expect, it } from 'vitest';
import { glowFromMatch, Scoring } from '../src/renderer/game/scoring';
import { displayHeight } from '../src/renderer/game/gates';
import { TargetWave } from '../src/renderer/game/target-wave';

const FRAME_MS = 1000 / 60;

/** Plays `durationMs` with the lantern at `player(t)` against the default target wave. */
function play(player: (t: number, target: number) => number, durationMs = 30_000): Scoring {
  const wave = new TargetWave();
  const scoring = new Scoring();
  for (let t = 0; t < durationMs; t += FRAME_MS) {
    const target = displayHeight(wave.heightAt(t), 0.2);
    scoring.update(FRAME_MS, player(t, target), target);
  }
  return scoring;
}

/** Deterministic noise, -1 to 1. */
function noiseAt(t: number): number {
  const x = Math.sin(t * 12.9898) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

describe('glowFromMatch', () => {
  it('maps weak matches to no glow and strong matches to full glow', () => {
    expect(glowFromMatch(0)).toBe(0);
    expect(glowFromMatch(0.2)).toBe(0);
    expect(glowFromMatch(0.85)).toBe(1);
    expect(glowFromMatch(1)).toBe(1);
    expect(glowFromMatch(0.525)).toBeCloseTo(0.5);
  });
});

describe('Scoring', () => {
  it('glows brightly and steadily when following the wave', () => {
    const s = play((_t, target) => target);
    expect(s.glow).toBeGreaterThan(0.9);
    expect(s.flicker).toBeLessThan(0.05);
    expect(s.summary().averageMatch).toBeGreaterThan(0.9);
  });

  it('still glows when following a little late', () => {
    const wave = new TargetWave();
    const s = play((t) => displayHeight(wave.heightAt(t - 500), 0.2));
    expect(s.glow).toBeGreaterThan(0.7);
  });

  it('does not glow when breathing against the wave', () => {
    const s = play((_t, target) => 1 - target);
    expect(s.glow).toBeLessThan(0.05);
  });

  it('flickers when the breath is held while the wave moves', () => {
    const s = play((t, target) => (t > 20_000 ? 0.5 : target), 24_000);
    expect(s.flicker).toBeGreaterThan(0.6);
  });

  it('flickers for jerky breathing', () => {
    const s = play((t, target) => Math.min(1, Math.max(0, target + 0.15 * noiseAt(t))));
    expect(s.flicker).toBeGreaterThan(0.6);
  });

  it('earns more points for following than for not following', () => {
    const good = play((_t, target) => target);
    const still = play(() => 0.5);
    expect(good.score).toBeGreaterThan(200);
    expect(still.score).toBeLessThan(good.score / 4);
  });

  it('gives gate bonuses that grow with the streak, and resets on a miss', () => {
    const s = new Scoring();
    expect(s.onGate('passed')).toBe(100);
    expect(s.onGate('passed')).toBe(110);
    expect(s.onGate('passed')).toBe(120);
    expect(s.streak).toBe(3);
    expect(s.onGate('missed')).toBe(0);
    expect(s.streak).toBe(0);
    expect(s.bestStreak).toBe(3);
    expect(s.score).toBe(330);
  });

  it('caps the streak bonus at double', () => {
    const s = new Scoring();
    let last = 0;
    for (let i = 0; i < 30; i++) last = s.onGate('passed');
    expect(last).toBe(200);
  });

  it('summarises the run', () => {
    const s = play((_t, target) => target, 20_000);
    s.onGate('passed');
    s.onGate('missed');
    const summary = s.summary();
    expect(summary.gatesPassed).toBe(1);
    expect(summary.gatesMissed).toBe(1);
    expect(summary.bestStreak).toBe(1);
    expect(summary.durationMs).toBeCloseTo(20_000, -2);
    expect(summary.timeInGlow).toBeGreaterThan(0.5);
  });

  it('gives the same result at 30 fps and 120 fps', () => {
    const at = (frameMs: number): number => {
      const wave = new TargetWave();
      const s = new Scoring();
      for (let t = 0; t < 20_000; t += frameMs) {
        const target = displayHeight(wave.heightAt(t), 0.2);
        s.update(frameMs, target, target);
      }
      return s.summary().averageMatch;
    };
    expect(at(1000 / 30)).toBeCloseTo(at(1000 / 120), 1);
  });
});
