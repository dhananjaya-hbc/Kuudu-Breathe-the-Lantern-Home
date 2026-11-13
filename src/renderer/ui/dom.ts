// Tiny DOM helpers for the UI screens. Text is always set with
// `textContent`, never parsed as HTML.

type Child = Node | string | null | undefined | false;

/** Creates an element with optional class names and children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

/** Creates a button that calls `onClick`. */
export function button(
  label: string,
  onClick: () => void,
  variant: 'primary' | 'ghost' | 'plain' = 'plain',
): HTMLButtonElement {
  const b = el('button', `k-btn k-btn--${variant}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A full-screen overlay that can be shown and hidden. */
export class Overlay {
  readonly root: HTMLDivElement;

  constructor(parent: HTMLElement, className = '') {
    this.root = el('div', `k-overlay ${className}`.trim());
    this.root.hidden = true;
    parent.appendChild(this.root);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  /**
   * Replaces the overlay's content and shows it, scrolled to the top.
   * Focuses the first button without scrolling, so a tall card never opens
   * scrolled to the bottom with its title hidden.
   */
  open(...children: Child[]): void {
    this.root.replaceChildren();
    for (const child of children) {
      if (child === null || child === undefined || child === false) continue;
      this.root.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    this.root.hidden = false;
    this.root.scrollTop = 0;
    for (const card of this.root.querySelectorAll<HTMLElement>('.k-card')) card.scrollTop = 0;
    this.root
      .querySelector<HTMLButtonElement>('button:not([disabled])')
      ?.focus({ preventScroll: true });
  }

  close(): void {
    this.root.hidden = true;
    this.root.replaceChildren();
  }
}
