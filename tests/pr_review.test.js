import { buildSwayBraces } from '../web/sway.js';
import { printDimensions } from '../web/print-profile.js';
import { PERP } from '../web/fins/wedges.js';
import { roundedFlange } from '../web/solids.js';
import { buildDrawn } from '../web/draw-build.js';
import { insidePart } from '../web/inside.js';
import { block, blockTopo, analyze, fins, prop, assert, assertClose, isClosed, isOriented } from './_util.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], ZERO = { x: 0, y: 0, z: 0 };
function withState(fn) {
  const objects = [fins.FIN, prop.PROP, PERP], saved = objects.map((o) => ({ ...o }));
  try { return fn(); }
  finally { objects.forEach((o, i) => Object.assign(o, saved[i])); }
}

Deno.test('review: default nozzle sway preserves the height-based print-tested thickness floor', () => {
  for (const height of [50, 249, 1000]) {
    const topo = blockTopo(-60, 60, -30, 30, 0, height), result = analyze(topo, 45, ID);
    for (const nozzle of [0.4, 1.6]) {
      const profile = printDimensions(nozzle, 2);
      const built = buildSwayBraces(topo, result, ID, { ...profile, tines: false });
      assert(built.ribs.length > 0, 'no ribs');
      for (const rib of built.ribs) {
        assertClose(rib.th, Math.max(profile.wallThickness, Math.min(2.4, 1.2 + 0.004 * rib.height)), 1e-8);
      }
      assert(isClosed(built.triangles) && isOriented(built.triangles));
    }
  }
});

Deno.test('review: profile then legacy build matches a fresh legacy build in the same engine', () => withState(() => {
  const topo = blockTopo(-60, 60, -30, 30, 0, 249), result = analyze(topo, 45, ID);
  const opts = { mode: 'auto', tines: true, sway: { on: true } };
  const expected = fins.buildFins(topo, result, ID, opts);
  fins.buildFins(topo, result, ID, { ...opts, tunables: { nozzle: 1.6, wallLines: 8 } });
  const actual = fins.buildFins(topo, result, ID, opts);
  assert(JSON.stringify(actual.triangles) === JSON.stringify(expected.triangles), 'profile leaked into legacy output');
  assert(fins.FIN.nozzle === null && !fins.FIN.roundFeet && !prop.PROP.roundFeet && !PERP.roundFeet);
  assert(prop.PROP.th === 1 && PERP.th === 1.2);
  fins.applyTunables({ nozzle: 0.4, wallLines: 2 });
  fins.applyTunables({ propGap: 0.3 });
  assert(prop.PROP.th === 1 && prop.PROP.gap === 0.3, 'material-only request retained nozzle dimensions');
  fins.applyTunables({ nozzle: 1.6, wallLines: 8 });
  fins.applyTunables({ nozzle: null, wallLines: 2 });
  assert(fins.FIN.nozzle === null && !prop.PROP.roundFeet && prop.PROP.th === 1, 'explicit legacy profile did not reset');
}));

Deno.test('review: rounded flange joints overlap both adjoining solids inside the original contour', () => {
  const section = (x, w, h) => [[x, -w, 0], [x, -w, h], [x, w, h], [x, w, 0]];
  const out = [];
  roundedFlange([section(-20, 3, 0.6), section(0, 4, 0.4), section(20, 3, 0.6)], out);
  // Two 20-vertex polygons (rounded only at the outside ends), then the joint.
  const segmentVertices = (4 * 20 - 4) * 3;
  const parts = [out.slice(0, segmentVertices), out.slice(segmentVertices, 2 * segmentVertices),
    out.slice(2 * segmentVertices)];
  assert(parts.every((p) => p.length && isClosed(p) && isOriented(p)), 'invalid joint or segment');
  const contains = (tris, x) => insidePart({ pos: new Float64Array(tris.flat()), nFaces: tris.length / 3 },
    ID, ZERO, x, 0.37, 0.17);
  assert(contains(parts[0], -0.0075) && contains(parts[2], -0.0075), 'joint merely touches first segment');
  assert(contains(parts[1], 0.0075) && contains(parts[2], 0.0075), 'joint merely touches second segment');
  assert(!contains(parts[0], 0) && !contains(parts[1], 0) && contains(parts[2], 0),
    'segment faces still meet coplanar or the connecting joint is missing');
  for (const [x, y, z] of out) {
    assert(x >= -20 && x <= 20 && z >= 0 && z <= 0.6);
    assert(Math.abs(y) <= 4 - Math.abs(x) / 20 + 1e-8, 'joint expands the original foot contour');
  }
});

Deno.test('review: a Draw wall passes plate stations rather than contact heights to reinforcement', () => withState(() => {
  const pos = block(-60, 60, -30, 30, 100, 110);
  const topo = { pos, nFaces: pos.length / 9 };
  const result = { offset: ZERO };
  const built = buildDrawn(topo, result, ID,
    [{ a: [-25, 0, 100], b: [25, 0, 100] }],
    { draw: { tines: false }, tunables: { nozzle: 0.4, wallLines: 2, baseThickness: 2, baseSpread: 20 } });
  assert(built.items[0].ok, built.items[0].info.reason);
  assert(built.items[0].info.top.every((p) => p[2] > 99));
  assert(built.items[0].info.floors.every((z) => z === 0));
  assert(built.items[0].info.baseReinforcement.status === 'added');
  assert(isClosed(built.triangles) && isOriented(built.triangles));
}));
