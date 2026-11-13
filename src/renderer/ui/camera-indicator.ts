// "Camera on" badge with a Stop button. Visible for the whole time the
// camera is on, on every screen, so the player always knows and can stop it.

import { button, el } from './dom';

export class CameraIndicator {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, onStop: () => void) {
    const label = el('span', '', 'Camera on');
    this.root = el('div', 'k-camera', el('span', 'k-dot'), label, button('Stop (Esc)', onStop));
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  set on(value: boolean) {
    this.root.hidden = !value;
  }

  get on(): boolean {
    return !this.root.hidden;
  }
}
