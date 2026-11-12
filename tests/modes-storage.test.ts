import { describe, expect, it } from 'vitest';
import { MODES, RunPlan } from '../src/renderer/game/modes';
import { TargetWave } from '../src/renderer/game/target-wave';
import { GateTrack } from '../src/renderer/game/gates';
import { HighScoreStore, type StorageLike } from '../src/renderer/storage';

class MemoryStorage implements StorageLike {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

describe('modes', () => {
  it('Drift is one 2-minute level', () => {
    const plan = new RunPlan('drift');
    expect(plan.durationMs).toBe(120_000);
    expect(plan.levelAt(119_999).index).toBe(0);
    expect(plan.isFinished(119_999)).toBe(false);
    expect(plan.isFinished(120_000)).toBe(true);
  });

  it('Festival has three levels that slow the breath and narrow the gates', () => {
    const levels = MODES.festival.levels;
    expect(levels).toHaveLength(3);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]!.bpm).toBeLessThan(levels[i - 1]!.bpm);
      expect(levels[i]!.gap).toBeLessThan(levels[i - 1]!.gap);
    }
    const plan = new RunPlan('festival');
    expect(plan.durationMs).toBe(180_000);
    expect(plan.levelAt(59_999).index).toBe(0);
    expect(plan.levelAt(60_000)).toMatchObject({ index: 1, startMs: 60_000 });
    expect(plan.levelAt(179_999).index).toBe(2);
    expect(plan.remainingMs(170_000)).toBe(10_000);
  });

  it('applies each level once, setting the pace and gate size', () => {
    const plan = new RunPlan('festival');
    const wave = new TargetWave();
    const gates = new GateTrack(wave);
    expect(plan.apply(0, wave, gates)?.index).toBe(0);
    expect(plan.apply(30_000, wave, gates)).toBeNull();
    expect(plan.apply(60_000, wave, gates)?.level.name).toBe('River of Lights');
    expect(wave.bpmAt(60_000)).toBeCloseTo(6.5);
    expect(wave.bpmAt(59_000)).toBeCloseTo(7.5);
    expect(gates.options.gap).toBeCloseTo(0.36);
  });
});

describe('HighScoreStore', () => {
  it('starts empty and keeps the best score per mode with its date', () => {
    const store = new HighScoreStore(new MemoryStorage());
    expect(store.best('drift')).toBeNull();
    expect(store.submit('drift', 500, new Date(2026, 10, 12))).toBe(true);
    expect(store.submit('drift', 400, new Date(2026, 10, 13))).toBe(false);
    expect(store.submit('drift', 900, new Date(2026, 10, 14))).toBe(true);
    expect(store.best('drift')).toEqual({ score: 900, date: '2026-11-14' });
    expect(store.best('festival')).toBeNull();
  });

  it('stores only the score and date', () => {
    const storage = new MemoryStorage();
    new HighScoreStore(storage).submit('festival', 1234, new Date(2026, 10, 12));
    expect(JSON.parse(storage.items.get('kuudu.highScores.v1')!)).toEqual({
      festival: { score: 1234, date: '2026-11-12' },
    });
  });

  it('ignores zero, negative and invalid scores', () => {
    const store = new HighScoreStore(new MemoryStorage());
    expect(store.submit('drift', 0)).toBe(false);
    expect(store.submit('drift', -5)).toBe(false);
    expect(store.submit('drift', Number.NaN)).toBe(false);
    expect(store.best('drift')).toBeNull();
  });

  it('survives damaged or unexpected saved data', () => {
    const storage = new MemoryStorage();
    const store = new HighScoreStore(storage);
    storage.setItem('kuudu.highScores.v1', '{not json');
    expect(store.all()).toEqual({});
    storage.setItem('kuudu.highScores.v1', JSON.stringify({ drift: { score: 'x' }, other: 1 }));
    expect(store.all()).toEqual({});
    expect(store.submit('drift', 10, new Date(2026, 10, 12))).toBe(true);
  });

  it('reset deletes everything', () => {
    const storage = new MemoryStorage();
    const store = new HighScoreStore(storage);
    store.submit('drift', 100);
    store.reset();
    expect(storage.items.size).toBe(0);
    expect(store.best('drift')).toBeNull();
  });

  it('keeps working when storage is full', () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('QuotaExceededError');
    };
    expect(new HighScoreStore(storage).submit('drift', 100)).toBe(false);
  });
});
