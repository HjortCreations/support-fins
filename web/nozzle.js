// Nozzle size: every support width was tuned for a 0.4 mm nozzle -- a 1.0 mm wall
// (two 0.5 mm lines), a 0.6 mm contact tip, 0.5 mm tines (one line). On a 0.6 or
// 0.8 nozzle the slicer drops a tine that thin or lays a wall as one weak line, so
// the widths scale by nozzle / 0.4. Heights don't: tine height, the gaps and the
// pad follow the layer height, which has its own field.
//
// Two rules. The one-line features (tines, contact tip) scale both ways: a finer
// nozzle prints a finer tine and leaves a smaller mark. The STRUCTURAL widths (the
// wall, the wedge, the sway brace rib) only grow: a 0.2 nozzle doesn't make a
// free-standing wall any stiffer, so they never go below their 0.4 numbers.
//
// The page sets this once per change; the Worker gets it in opts.tunables.nozzle
// (fins.js applyTunables), like the gap. 0.4 with two lines leaves every
// geometric width as it was. More lines impose a minimum body gauge, below.
import { PROP } from './prop/config.js';
import { SWAY } from './sway.js';
import { PERP } from './fins/wedges.js';

export const NOZZLE_REF = 0.4;
export const WALL_LINES = Object.freeze([2, 4, 6, 8]);

// The 0.4 numbers, captured before anything scales them.
const BASE = Object.freeze({
  th: PROP.th, tip: PROP.tip, tineW: PROP.tineW,
  perpTh: PERP.th,
  swayTineW: SWAY.tineW, swayThMin: SWAY.thMin, swayThMax: SWAY.thMax, swayThPerMm: SWAY.thPerMm,
  wallHalf: SWAY.wallHalf,
});

export let nozzle = NOZZLE_REF;
export let wallLines = 2;

/** Scale widths for this nozzle (mm) and optional minimum wall-line count.
 * Contacts retain upstream scaling. Junk leaves both settings unchanged. */
export function applyNozzle(d, lines = 2) {
  if (!Number.isFinite(d) || d < 0.1 || d > 3 || !WALL_LINES.includes(lines)) return;
  nozzle = d;
  wallLines = lines;
  const k = d / NOZZLE_REF, grow = Math.max(1, k);
  // A requested gauge is a minimum, never permission to thin upstream's
  // print-tested structure. In particular a tall Sway keeps its scaled floor.
  const gauge = d * 1.1 * lines;
  PROP.tip = BASE.tip * k;
  PROP.tineW = BASE.tineW * k;
  SWAY.tineW = BASE.swayTineW * k;
  PROP.th = Math.max(BASE.th * grow, gauge);
  PERP.th = Math.max(BASE.perpTh * grow, gauge);
  SWAY.thMin = BASE.swayThMin * grow;
  SWAY.thMax = BASE.swayThMax * grow;
  SWAY.thPerMm = BASE.swayThPerMm * grow;   // same height to reach thMax
  SWAY.wallThickness = gauge;
  // The braces' keep-clear half-width assumes the widest wall's half (PERP's):
  // a wider wedge needs the braces that much further off.
  SWAY.wallHalf = BASE.wallHalf + (PERP.th - BASE.perpTh) / 2;
}
