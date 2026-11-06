import { describe, expect, it } from 'vitest';
import { displayHeight, GateTrack, type GateEvent } from '../src/renderer/game/gates';
import { TargetWave } from '../src/renderer/game/target-wave';

const FRAME_MS = 1000 / 60;

/** Runs a 30 s session with the lantern height given by `player(runMs)`. */
function run(player: (runMs: number, wave: TargetWave) => number): GateEvent[] {
  const wave = new TargetWave(7.5);
  const track = new GateTrack(wave);
  const events: GateEvent[] = [];
  for (let t = 0; t <= 30_000; t += FRAME_MS) events.push(...track.update(t, player(t, wave)));
  return events;
}

const perfect = (t: number, wave: TargetWave): number => displayHeight(wave.heightAt(t), 0.2);

describe('GateTrack', () => {
  it('keeps the first seconds free, then alternates trough and peak gates', () => {
    const events = run(perfect);
    expect(events[0]!.gate.atMs).toBe(8_000);
    expect(events.map((e) => e.gate.kind).slice(0, 4)).toEqual([
      'trough',
      'peak',
      'trough',
      'peak',
    ]);
  });

  it('passes every gate for a player who follows the wave', () => {
    const events = run(perfect);
    expect(events.length).toBeGreaterThanOrEqual(5);
    expect(events.every((e) => e.result === 'passed')).toBe(true);
  });

  it('misses every gate for a player who never moves', () => {
    const events = run(() => 0.5);
    expect(events.every((e) => e.result === 'missed')).toBe(true);
  });

  it('still passes when the player is 0.7 s late', () => {
    const events = run((t, wave) => perfect(t - 700, wave));
    expect(events.every((e) => e.result === 'passed')).toBe(true);
  });

  it('misses when the player is a whole half-breath out of step', () => {
    const events = run((t, wave) => perfect(t - 4_000, wave));
    expect(events.every((e) => e.result === 'missed')).toBe(true);
  });

  it('decides each gate exactly once', () => {
    const events = run(perfect);
    const times = events.map((e) => e.gate.atMs);
    expect(new Set(times).size).toBe(times.length);
  });

  it('insets the opening centres from the very top and bottom', () => {
    expect(displayHeight(0, 0.2)).toBeCloseTo(0.2);
    expect(displayHeight(1, 0.2)).toBeCloseTo(0.8);
    expect(displayHeight(0.5, 0.2)).toBeCloseTo(0.5);
  });
});
