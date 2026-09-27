// A BORE RUNNING ALONG A WALL (bore_bracket, Sept 2026): the auto-placer stood a
// part-attached wall inside the bracket's 14 mm bore, from the bore's floor to its
// ceiling -- a support you can't reach to clean, which scars the bore
// ([[project_support_fin_quality_first]]: a hole is an orientation problem).
// enclosedFloor's compass count missed it: two of its eight rays look straight
// down the bore at open air, and with the wall a hair off the axis the diagonals
// on one side fall short (3-4 walled of the 6 it needs). The fix also refuses a
// station with part within BORE.radius on BOTH sides of the wall.
import { buildTopology, analyze, fins, readSTL, WEB, assert } from './_util.js';

const pos = readSTL(Deno.readFileSync(`${WEB}dev-models/bore_bracket.stl`));
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

Deno.test('bore_bracket flat: no wall stands inside the 14 mm bore', () => {
  const res = analyze(topo, 45, ID);
  const b = fins.buildFins(topo, res, ID, { mode: 'auto', bedPad: true, tines: true });
  // The bore runs along X over x -23..0, its walls at y ~ -7.2 and +7.3, floor
  // z ~23, ceiling z ~37. Main put a 24 mm wall at y -0.7 right down the middle.
  const inBore = b.triangles.filter((v) => v[0] > -22 && v[0] < -1 && Math.abs(v[1]) < 6 &&
                                           v[2] > 24 && v[2] < 36);
  assert(inBore.length === 0, `${inBore.length} support vertices inside the bore, e.g. ${inBore[0]}`);
  // ...and the bracket's other overhang (the boss underside) keeps its wall.
  assert(b.triangles.length > 0, 'the rest of the bracket lost its support');
});
