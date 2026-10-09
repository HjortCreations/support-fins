import { buildSwayBraces } from '../web/sway.js';
import { printDimensions } from '../web/print-profile.js';
import { reinforceBase, baseObstacle } from '../web/base-reinforcement.js';
import { solidClearance } from '../web/inside.js';
import { writeBinarySTL, readSTL } from '../web/stl.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
import { blockTopo, analyze, bbox, assert, assertClose, isClosed, isOriented, insideCount } from './_util.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function fixture(lines, multiplier = 1) {
  const topo = blockTopo(-80, 80, -60, 60, 0, 1000), result = analyze(topo, 45, ID);
  const dimensions = printDimensions(1.6, lines);
  const sw = buildSwayBraces(topo, result, ID, { ...dimensions, tines: false });
  const rib = sw.ribs[0], tris = sw.triangles.slice(...rib.triRange);
  const settings = { baseStyle: 'cross', baseThickness: multiplier, crossReach: 20 };
  const cross = reinforceBase(tris, rib.foot, rib.height, rib.th, topo, ID, result.offset, settings);
  assert(cross.cross, cross.reason);
  return { topo, result, rib, tris, cross, settings, dimensions };
}

const vertices = (pos) => Array.from({ length: pos.length / 3 }, (_, i) => Array.from(pos.slice(i * 3, i * 3 + 3)));

/** Intersect triangles with a horizontal layer, in the fin's local XY frame. */
function layerSegments(tris, foot, z) {
  const [a, b] = [foot[0], foot.at(-1)];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const segs = [];
  for (let i = 0; i < tris.length; i += 3) {
    const pts = [];
    for (let j = 0; j < 3; j++) {
      const p = tris[i + j], q = tris[i + (j + 1) % 3];
      if ((p[2] < z) === (q[2] < z)) continue;
      const f = (z - p[2]) / (q[2] - p[2]);
      const x = p[0] + f * (q[0] - p[0]) - a[0], y = p[1] + f * (q[1] - p[1]) - a[1];
      pts.push([x * ux + y * uy, -x * uy + y * ux]);
    }
    if (pts.length === 2) segs.push(pts);
  }
  return segs;
}

function gaugeAt(tris, foot, z) {
  const segs = layerSegments(tris, foot, z);
  const w = segs.flat().map((p) => p[1]);
  assert(w.length, `rib disappeared at z=${z}`);
  // Cut across an arm near its outer edge, away from the original fin plane.
  const cut = Math.min(...w) + 0.13 * (Math.max(...w) - Math.min(...w));
  const crossings = [];
  for (const [p, q] of segs) {
    if ((p[1] < cut) === (q[1] < cut)) continue;
    crossings.push(p[0] + (cut - p[1]) / (q[1] - p[1]) * (q[0] - p[0]));
  }
  assert(crossings.length >= 2, `no printable rib section at z=${z}`);
  return Math.max(...crossings) - Math.min(...crossings);
}

Deno.test('Cross thickness: every 0.6mm layer retains 2/4/6/8 nozzle lines on a metre-high sway fin', () => {
  for (const lines of [2, 4, 6, 8]) {
    const { cross, rib, topo, result, dimensions } = fixture(lines);
    assertClose(cross.crossThickness, dimensions.wallThickness, 1e-8);
    for (let z = 0.9; z < cross.crossHeight; z += 0.6) {
      assertClose(gaugeAt(cross.tris, rib.foot, z), dimensions.wallThickness, 1e-5, `${lines} lines at ${z}mm`);
    }
    assertClose(gaugeAt(cross.tris, rib.foot, cross.crossHeight - 0.01), dimensions.wallThickness, 1e-5);
    assert(isClosed(cross.tris) && isOriented(cross.tris));
    assert(!solidClearance(topo, ID, result.offset, cross.tris, 0.19), 'wide top hits the part');
    assert(insideCount(topo, ID, result.offset, cross.tris) === 0, 'wide top enters the part');
  }
});

Deno.test('Cross thickness: STL and 3MF preserve the selected gauge through the last rib layers', async () => {
  for (const lines of [2, 4, 6, 8]) {
    const { cross, rib, dimensions } = fixture(lines);
    const stl = vertices(readSTL(new Uint8Array(await writeBinarySTL(cross.tris).arrayBuffer())));
    const mf = await readThreeMF(new Uint8Array(await writeThreeMF([], cross.tris, 'full-width cross').arrayBuffer()));
    const exported = vertices(mf.positions);
    // 3MF can translate the object onto the plate; restore its frame for slicing.
    const sourceBox = bbox(cross.tris), exportBox = bbox(exported);
    for (const p of exported) for (let k = 0; k < 3; k++) p[k] += sourceBox.lo[k] - exportBox.lo[k];
    for (const tris of [stl, exported]) for (const fraction of [0.01, 0.5, 0.9, 0.99, 0.9999]) {
      assertClose(gaugeAt(tris, rib.foot, fraction * cross.crossHeight), dimensions.wallThickness, 1e-3);
    }
  }
});

Deno.test('Cross thickness: extra base thickness tapers down to the full wall gauge, never below it', () => {
  const { cross, rib, dimensions } = fixture(4, 3);
  for (const fraction of [0.5, 0.9, 0.99, 0.9999]) {
    const thickness = gaugeAt(cross.tris, rib.foot, fraction * cross.crossHeight);
    assert(thickness >= dimensions.wallThickness, 'base multiplier pinched the upper rib');
    assertClose(thickness, dimensions.wallThickness * (3 - 2 * fraction), 1e-5);
  }
});

Deno.test('Cross thickness: a neighbour enclosing all full-width top positions causes refusal rather than thinning', () => {
  const { cross, rib, topo, result, tris, settings } = fixture(4);
  const obstacle = blockTopo(-500, 500, -500, 500, cross.crossHeight - 1, cross.crossHeight + 1);
  const blocked = reinforceBase(tris, rib.foot, rib.height, rib.th, topo, ID, result.offset,
    settings, [baseObstacle(vertices(obstacle.pos))]);
  assert(!blocked.cross && blocked.status === 'skipped' && !blocked.tris.length, 'blocked rib was silently made thinner');
});
