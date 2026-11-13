// Settings: shows what Kuudu has saved and lets the player delete it.

import { MODES } from '../game/modes';
import type { HighScoreStore } from '../storage';
import { button, el, Overlay } from './dom';

export class SettingsScreen {
  private readonly overlay: Overlay;
  private onClose: () => void = () => {};

  constructor(
    parent: HTMLElement,
    private readonly store: HighScoreStore,
  ) {
    this.overlay = new Overlay(parent);
    this.overlay.root.setAttribute('role', 'dialog');
    this.overlay.root.setAttribute('aria-modal', 'true');
    this.overlay.root.setAttribute('aria-label', 'Settings');
  }

  get visible(): boolean {
    return this.overlay.visible;
  }

  show(onClose: () => void): void {
    this.onClose = onClose;
    this.render(null);
  }

  hide(): void {
    this.overlay.close();
  }

  private render(message: string | null, confirming = false): void {
    const scores = this.store.all();
    const saved = el('dl', 'k-facts');
    for (const mode of Object.values(MODES)) {
      const best = scores[mode.id];
      saved.append(
        el('dt', '', mode.name),
        el(
          'dd',
          '',
          best ? `Best score ${best.score.toLocaleString()} (${best.date})` : 'Nothing saved',
        ),
      );
    }

    const actions = confirming
      ? el(
          'div',
          'k-actions',
          el('p', 'k-note', 'This deletes your saved high scores. It cannot be undone.'),
          button(
            'Yes, delete',
            () => {
              this.store.reset();
              this.render('Your data has been deleted.');
            },
            'primary',
          ),
          button('Cancel', () => this.render(null)),
        )
      : el(
          'div',
          'k-actions',
          button('Reset data', () => this.render(null, true)),
          button(
            'Close',
            () => {
              this.hide();
              this.onClose();
            },
            'primary',
          ),
        );

    this.overlay.open(
      el(
        'div',
        'k-card',
        el('h2', '', 'Settings'),
        el(
          'p',
          'k-lead',
          'Kuudu saves only your best score and its date for each mode, on this computer. ' +
            'No video, images or breathing data are ever saved.',
        ),
        saved,
        message ? el('p', 'k-note', message) : null,
        actions,
      ),
    );
  }
}
