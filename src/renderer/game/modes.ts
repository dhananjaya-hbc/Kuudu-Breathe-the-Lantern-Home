// Game modes.
//
// - Drift: one calm 2-minute run with wide gates. No way to fail.
// - Festival: three 1-minute levels. Each level asks for slower breathing
//   and has narrower gates.
//
// A run plan applies each level's pace and gate size at the right moment.

import type { GateTrack } from './gates';
import type { TargetWave } from './target-wave';

export type ModeId = 'drift' | 'festival';

export interface Level {
  name: string;
  /** Target pace, breaths per minute. */
  bpm: number;
  /** Gate opening size, lantern-height units (0–1). */
  gap: number;
  durationMs: number;
}

export interface Mode {
  id: ModeId;
  name: string;
  description: string;
  levels: readonly Level[];
}

export const MODES: Record<ModeId, Mode> = {
  drift: {
    id: 'drift',
    name: 'Drift',
    description: 'A calm two-minute float down the river. Breathe with the light.',
    levels: [{ name: 'Drift', bpm: 7.5, gap: 0.45, durationMs: 120_000 }],
  },
  festival: {
    id: 'festival',
    name: 'Festival',
    description:
      'Three short stretches of river. Each asks for a slower breath and has narrower gates.',
    levels: [
      { name: 'Lantern Lane', bpm: 7.5, gap: 0.45, durationMs: 60_000 },
      { name: 'River of Lights', bpm: 6.5, gap: 0.36, durationMs: 60_000 },
      { name: 'Vesak Night', bpm: 6, gap: 0.3, durationMs: 60_000 },
    ],
  },
};

export interface LevelPosition {
  index: number;
  level: Level;
  /** Run time when this level starts. */
  startMs: number;
}

export class RunPlan {
  readonly mode: Mode;
  readonly durationMs: number;
  private appliedIndex = -1;

  constructor(modeId: ModeId) {
    this.mode = MODES[modeId];
    this.durationMs = this.mode.levels.reduce((sum, l) => sum + l.durationMs, 0);
  }

  levelAt(runMs: number): LevelPosition {
    let startMs = 0;
    for (const [index, level] of this.mode.levels.entries()) {
      if (runMs < startMs + level.durationMs) return { index, level, startMs };
      startMs += level.durationMs;
    }
    const index = this.mode.levels.length - 1;
    const level = this.mode.levels[index]!;
    return { index, level, startMs: startMs - level.durationMs };
  }

  isFinished(runMs: number): boolean {
    return runMs >= this.durationMs;
  }

  /** Remaining time in the whole run, ms. */
  remainingMs(runMs: number): number {
    return Math.max(0, this.durationMs - runMs);
  }

  /**
   * Applies the level for `runMs` to the wave and gates when it changes.
   * Returns the new level when one has just started, otherwise null.
   */
  apply(runMs: number, wave: TargetWave, gates: GateTrack): LevelPosition | null {
    const position = this.levelAt(runMs);
    if (position.index === this.appliedIndex) return null;
    this.appliedIndex = position.index;
    wave.setPace(position.level.bpm, position.index === 0 ? 0 : position.startMs);
    gates.setGap(position.level.gap);
    return position;
  }
}
