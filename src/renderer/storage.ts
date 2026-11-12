// Local high scores — the only thing Kuudu saves.
//
// For each mode: the best score and the date it was set. Nothing else is
// stored: no breathing data, no video, no images, no identifiers.
// "Reset data" in Settings calls `reset()`.

import type { ModeId } from './game/modes';

const KEY = 'kuudu.highScores.v1';

export interface HighScore {
  score: number;
  /** ISO date, e.g. 2026-11-12. */
  date: string;
}

export type HighScores = Partial<Record<ModeId, HighScore>>;

/** The parts of `Storage` this module needs, so tests can pass a fake. */
export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isHighScore(value: unknown): value is HighScore {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['score'] === 'number' &&
    Number.isFinite(v['score']) &&
    v['score'] >= 0 &&
    typeof v['date'] === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(v['date'])
  );
}

export class HighScoreStore {
  constructor(private readonly storage: StorageLike = window.localStorage) {}

  /** All saved high scores. Damaged or unexpected data is ignored. */
  all(): HighScores {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.storage.getItem(KEY) ?? '{}');
    } catch {
      return {};
    }
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: HighScores = {};
    for (const mode of ['drift', 'festival'] as const) {
      const entry = (parsed as Record<string, unknown>)[mode];
      if (isHighScore(entry)) out[mode] = { score: entry.score, date: entry.date };
    }
    return out;
  }

  best(mode: ModeId): HighScore | null {
    return this.all()[mode] ?? null;
  }

  /** Saves the score if it beats the current best. Returns true for a new best. */
  submit(mode: ModeId, score: number, when: Date = new Date()): boolean {
    if (!Number.isFinite(score) || score <= 0) return false;
    const scores = this.all();
    const current = scores[mode];
    if (current && current.score >= score) return false;
    scores[mode] = { score: Math.round(score), date: toLocalDate(when) };
    try {
      this.storage.setItem(KEY, JSON.stringify(scores));
    } catch {
      return false; // storage full or unavailable: the game still works
    }
    return true;
  }

  /** Deletes everything Kuudu has stored. */
  reset(): void {
    this.storage.removeItem(KEY);
  }
}

function toLocalDate(d: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
