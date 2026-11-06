import { describe, expect, it } from 'vitest';
import { cycleMsFromBpm, DEFAULT_BPM, TargetWave } from '../src/renderer/game/target-wave';

describe('TargetWave', () => {
  it('starts empty at 7.5 breaths per minute and peaks halfway through a breath', () => {
    const wave = new TargetWave();
    expect(DEFAULT_BPM).toBe(7.5);
    expect(cycleMsFromBpm(7.5)).toBe(8_000);
    expect(wave.heightAt(0)).toBeCloseTo(0);
    expect(wave.heightAt(4_000)).toBeCloseTo(1);
    expect(wave.heightAt(8_000)).toBeCloseTo(0);
    expect(wave.isInhaleAt(1_000)).toBe(true);
    expect(wave.isInhaleAt(5_000)).toBe(false);
  });

  it('changes pace without a jump in height', () => {
    const wave = new TargetWave(7.5);
    const before = wave.heightAt(10_000);
    wave.setPace(5, 10_000);
    expect(wave.heightAt(10_000)).toBeCloseTo(before, 10);
    expect(wave.bpmAt(9_999)).toBeCloseTo(7.5);
    expect(wave.bpmAt(10_000)).toBeCloseTo(5);
    // Smooth: tiny steps give tiny changes.
    expect(Math.abs(wave.heightAt(10_001) - wave.heightAt(9_999))).toBeLessThan(0.01);
  });

  it('places gates on every peak and trough, alternating', () => {
    const wave = new TargetWave(7.5);
    const gates = wave.gatesBetween(0, 20_000);
    expect(gates.map((g) => g.atMs)).toEqual([0, 4_000, 8_000, 12_000, 16_000]);
    expect(gates.map((g) => g.kind)).toEqual(['trough', 'peak', 'trough', 'peak', 'trough']);
    expect(gates.map((g) => g.height)).toEqual([0, 1, 0, 1, 0]);
  });

  it('keeps the start of the run free of gates when asked', () => {
    const wave = new TargetWave(7.5);
    const gates = wave.gatesBetween(0, 20_000, 6_000);
    expect(gates[0]!.atMs).toBe(8_000);
  });

  it('spaces gates by the new pace after a change', () => {
    const wave = new TargetWave(7.5);
    wave.setPace(6, 8_000); // 10 s per breath from 8 s on
    const times = wave.gatesBetween(0, 30_000).map((g) => g.atMs);
    expect(times).toEqual([0, 4_000, 8_000, 13_000, 18_000, 23_000, 28_000]);
  });

  it('creates each gate exactly once when asked for in small frame-sized chunks', () => {
    const wave = new TargetWave(7.5);
    wave.setPace(6, 10_000);
    const times: number[] = [];
    let from = 0;
    for (let to = 1000 / 60; to <= 60_000; to += 1000 / 60) {
      times.push(...wave.gatesBetween(from, to).map((g) => g.atMs));
      from = to;
    }
    const all = wave.gatesBetween(0, from).map((g) => g.atMs);
    expect(times).toEqual(all);
    expect(new Set(times).size).toBe(times.length);
  });

  it('returns no gates for an empty range', () => {
    expect(new TargetWave().gatesBetween(5_000, 5_000)).toEqual([]);
  });
});
