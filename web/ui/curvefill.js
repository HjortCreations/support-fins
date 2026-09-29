/**
 * The Curved fill checkbox (fins/curvefill.js). Unset = auto: the engine turns the
 * fill on for a lattice net and reports it (built.curveFill), and the box shows
 * what auto chose. Ticking or unticking it overrides auto until a new model loads.
 */
import { el } from './dom.js';
import { refreshFins } from './finbuild.js';

let choice;                      // undefined = auto, else the user's true/false

/** For finOpts: the user's choice, or undefined to let the engine decide. */
export const curveFillOpt = () => choice;

/** A new model starts back on auto. */
export function resetCurveFill() { choice = undefined; }

/** Show what the build did: ticked when the fill ran, "auto" while auto chose. */
export function showCurveFill(built) {
  const s = built?.curveFill;
  if (!s) return;
  el('curve-fill').checked = s.on;
  el('curve-fill-note').textContent = s.auto ? (s.on ? 'auto: rings & struts found' : 'rings & arcs') : 'rings & arcs';
}

el('curve-fill').addEventListener('change', () => { choice = el('curve-fill').checked; refreshFins(); });
