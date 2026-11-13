// Camera consent, shown before the camera turns on for the first time in a
// session. The camera stays off until the player presses "Start camera".
//
// Every statement here must stay true. Sources: Presage's "SDK Telemetry &
// Privacy" doc and README (vitals computed on-device; enableTelemetry=false
// transmits nothing), and this app's code (storage.ts saves only a score
// and date; nothing else is stored or sent).

import { button, el, Overlay } from './dom';

export interface ConsentActions {
  onStartCamera(): void;
  onKeyboard(): void;
  onBack(): void;
}

const FACTS: [string, string][] = [
  ['What it measures', 'The rise and fall of your chest, and your breathing rate. Nothing else.'],
  ['Why', 'To move the lantern: breathe in to rise, breathe out to drift down.'],
  [
    'Where it happens',
    'On this computer. The Presage SmartSpectra SDK measures your breathing from the camera image. ' +
      'It connects to Presage to check the app’s access key and usage. ' +
      'Kuudu turns the SDK’s diagnostics (telemetry) off.',
  ],
  [
    'What is saved',
    'Video and images are never recorded or saved. Breathing data stays in memory during a run ' +
      'and is discarded afterwards. Only your best score and its date are saved on this computer. ' +
      'You can clear them in Settings.',
  ],
  [
    'You are in control',
    'A “Camera on” badge shows whenever the camera is on. Press Stop or Esc to turn it off at any time. ' +
      'It also turns off at the end of every run and when you close Kuudu.',
  ],
  [
    'Just a game',
    'Kuudu is a relaxing rhythm game. It is not a medical device and does not diagnose, treat or monitor anything.',
  ],
];

export class ConsentScreen {
  private readonly overlay: Overlay;

  constructor(parent: HTMLElement) {
    this.overlay = new Overlay(parent);
    this.overlay.root.setAttribute('role', 'dialog');
    this.overlay.root.setAttribute('aria-modal', 'true');
    this.overlay.root.setAttribute('aria-labelledby', 'k-consent-title');
  }

  get visible(): boolean {
    return this.overlay.visible;
  }

  show(actions: ConsentActions): void {
    const title = el('h2', '', 'Before the camera turns on');
    title.id = 'k-consent-title';

    const facts = el('dl', 'k-facts');
    for (const [term, detail] of FACTS) facts.append(el('dt', '', term), el('dd', '', detail));

    const close = (then: () => void) => () => {
      this.hide();
      then();
    };

    this.overlay.open(
      el(
        'div',
        'k-card',
        title,
        el(
          'p',
          'k-lead',
          'Kuudu uses your camera to follow your breathing, so the lantern can rise and fall with you.',
        ),
        facts,
        el(
          'p',
          'k-note',
          'Only the person who starts the game, sitting in front of the screen, should play.',
        ),
        el(
          'div',
          'k-actions',
          button('Start camera', close(actions.onStartCamera), 'primary'),
          button('Play with keyboard instead', close(actions.onKeyboard)),
          button('Back', close(actions.onBack), 'ghost'),
        ),
      ),
    );
  }

  hide(): void {
    this.overlay.close();
  }
}
