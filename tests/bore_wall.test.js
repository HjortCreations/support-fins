// A BORE RUNNING ALONG A WALL (bore_bracket, Sept 2026): the auto-placer stood a
// part-attached wall inside the bracket's 14 mm bore, from the bore's floor to its
// ceiling -- a support you can't reach to clean, which scars the bore
// ([[project_support_fin_quality_first]]: a hole is an orientation problem).
// enclosedFloor's compass count missed it: two of its eight rays look straight
// down the bore at open air, and the diagonals fell just past BORE.radius
// (3-4 walled of the 6 it needs). The fix also refuses a station with part
// within BORE.radius on BOTH sides of the wall.
//
// Model-free (web/dev-models/ is git-ignored): a block with a 14.5 mm square
// channel along X. From the channel's centre the side walls are 7.25 mm away,
// the diagonals 10.25 mm -- just past the 10 mm radius, as on bore_bracket.
import { buildTopology, analyze, fins, isClosed, assert } from './_util.js';

// Block x -30..30, y -20..20, z 0..40 with the channel at y -7.25..7.25, z 20..34:
// the (y, z) cross-section -- a square ring -- extruded along X.
function channelBlock() {
  const outer = [[-20, 0], [20, 0], [20, 40], [-20, 40]];
  const inner = [[-7.25, 20], [7.25, 20], [7.25, 34], [-7.25, 34]];
  const x0 = -30, x1 = 30, t = [];
  const quad = (a, b, c, d) => t.push(a, c, b, a, d, c);   // outward winding
  const at = (x, [y, z]) => [x, y, z];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    quad(at(x1, outer[i]), at(x1, outer[j]), at(x0, outer[j]), at(x0, outer[i]));   // outside
    quad(at(x0, inner[i]), at(x0, inner[j]), at(x1, inner[j]), at(x1, inner[i]));   // channel
    quad(at(x0, outer[j]), at(x0, outer[i]), at(x0, inner[i]), at(x0, inner[j]));   // -X end
    quad(at(x1, outer[i]), at(x1, outer[j]), at(x1, inner[j]), at(x1, inner[i]));   // +X end
  }
  return t;
}

Deno.test('a wall is not stood inside a 14.5 mm channel running along it', () => {
  const tris = channelBlock();
  assert(isClosed(tris), 'fixture is not closed');
  const pos = Float32Array.from(tris.flat());
  const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
  const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const res = analyze(topo, 45, ID);
  assert(res.regions.length === 1, `expected just the channel ceiling as overhang, got ${res.regions.length}`);
  const b = fins.buildFins(topo, res, ID, { mode: 'auto', bedPad: true, tines: true });
  // main stood a wall at y = 0 from the channel floor (z 20) to its ceiling (z 34)
  const inChannel = b.triangles.filter((v) => Math.abs(v[1]) < 7 && v[2] > 20.5 && v[2] < 33.5);
  assert(inChannel.length === 0, `${inChannel.length} support vertices inside the channel, e.g. ${inChannel[0]}`);
});
