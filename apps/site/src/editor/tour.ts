/**
 * The guided tour.
 *
 * The editor's two hardest ideas are not visible from looking at it: that nodes
 * come from a menu you open on the canvas rather than from a list on screen,
 * and that an emitter can be born from another emitter's particles. Both used
 * to be discoverable only by being told. This tells you.
 *
 * Steps hang off `data-tour` attributes rather than class names or DOM shape,
 * so restyling the editor cannot silently break the tour — a missing anchor is
 * skipped instead of throwing.
 */
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';

const STEPS: { anchor?: string; title: string; text: string }[] = [
  {
    title: 'The editor, in two halves',
    text: 'On the left you wire the graph that describes an effect. On the right it runs, live, on every edit. Nothing here needs saving — the project follows you back.',
  },
  {
    anchor: 'emitters',
    title: 'Emitters',
    text: 'Each tab is one particle system with its own graph. A project starts with one, called “default”. Add more when an effect is really several things at once — a spark and the smoke it leaves.',
  },
  {
    anchor: 'graph',
    title: 'Nodes come from the canvas',
    text: 'Right-click anywhere here (or click empty space) for the node menu. Type to filter, Enter to drop — the node lands where you clicked. Comment frames, sticky notes and locking live in the same menu.',
  },
  {
    anchor: 'graph',
    title: 'Wiring',
    text: 'Drag from a node’s output dot to an input dot. Outputs are the sinks: what a graph writes to spawn position, velocity, colour or rotation is what the particle does.',
  },
  {
    anchor: 'project',
    title: 'Linking emitters',
    text: 'Open Project → Settings → Emitters. “Born from” makes this emitter spawn from another’s particles, on their deaths (debris where a projectile ends) or on their births (a flash the instant a spark appears).',
  },
  {
    anchor: 'preview-tools',
    title: 'Driving the preview',
    text: 'Follow the cursor, orbit the emitter, or click to burst. The scene reference — the artwork your effect has to sit on — is in Project → Settings → Preview.',
  },
  {
    anchor: 'undo',
    title: 'Undo covers everything',
    text: 'Every edit, including a deleted node or a removed emitter. Typing in a field is left to the browser, so the usual text undo still works there.',
  },
];

/** Start the tour, skipping any step whose anchor is not on screen. */
export function startTour(): void {
  const steps: DriveStep[] = [];
  for (const s of STEPS) {
    const el = s.anchor ? document.querySelector<HTMLElement>(`[data-tour="${s.anchor}"]`) : null;
    if (s.anchor !== undefined && el === null) continue;
    steps.push({
      ...(el ? { element: el } : {}),
      popover: { title: s.title, description: s.text },
    });
  }
  driver({
    showProgress: true,
    overlayColor: 'oklch(0.145 0 0)',
    overlayOpacity: 0.72,
    nextBtnText: 'Next',
    prevBtnText: 'Back',
    doneBtnText: 'Got it',
    steps,
  }).drive();
}
