import { SWAY } from '../web/sway.js';
import { baseSettings, baseObstacle, reinforceBase, reinforceBuiltBases } from '../web/base-reinforcement.js';
import { sweep } from '../web/prop/sweep.js';
import { solidClearance } from '../web/inside.js';
import { writeBinarySTL, readSTL } from '../web/stl.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
import { fins, prop, block, blockTopo, analyze, bbox, isClosed, isOriented, assert, assertClose } from './_util.js';
import { PERP } from '../web/fins/wedges.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], ZERO = { x: 0, y: 0, z: 0 };
const line = [[-25, 0, 100], [25, 0, 100]];
function wall() { const tris = []; sweep(line, 0, tris); return tris; }
function reinforce(settings, topo = null, obstacles = []) {
  return reinforceBase(wall(), line, 100, prop.PROP.th, topo, ID, ZERO, settings, obstacles);
}

Deno.test('base reinforcement: independent controls produce closed outward tapered solids', () => {
  for (const [baseThickness, baseSpread] of [[2, 0], [1, 30], [3, 40]]) {
    const r = reinforce({ baseThickness, baseSpread });
    assert(r.status === 'added', r.reason);
    assert(isClosed(r.tris) && isOriented(r.tris), 'invalid mesh');
    const bottom = bbox(r.tris.filter((v) => v[2] === 0));
    const top = bbox(r.tris.filter((v) => v[2] === 20));
    assertClose(bottom.hi[0] - bottom.lo[0], 50 + 2 * baseSpread, 1e-6);
    assertClose(bottom.hi[1] - bottom.lo[1], prop.PROP.th * baseThickness, 1e-6);
    assertClose(top.hi[0] - top.lo[0], 50, 1e-6);
    assertClose(top.hi[1] - top.lo[1], prop.PROP.th, 1e-6);
  }
  assert(reinforce({ baseThickness: 1, baseSpread: 0 }).status === 'off');
  assert(baseSettings(NaN, Infinity).baseThickness === 1);
  assert(baseSettings(20, 400).baseSpread === 300);
});

Deno.test('base reinforcement: keep an obstructed end short without losing the outward foot', () => {
  const topo = blockTopo(-80, -26, -15, 15, 0, 100);
  const r = reinforce({ baseThickness: 2, baseSpread: 30 }, topo);
  assert(r.status === 'partial', r.reason);
  assert(r.leftSpread === 0 && r.rightSpread === 30, 'wrong end extended');
  assert(!solidClearance(topo, ID, ZERO, r.tris, 0.19), 'base touches the part');
});

Deno.test('base reinforcement: never bury a base inside part or another support', () => {
  const settings = { baseThickness: 3, baseSpread: 0 };
  const buried = reinforce(settings, blockTopo(-100, 100, -100, 100, 0, 80));
  assert(buried.status === 'skipped' && !buried.tris.length);
  const tiny = block(-3, 3, 0.7, 1, 3, 5);
  const tinyTris = Array.from({ length: tiny.length / 3 }, (_, i) => Array.from(tiny.slice(i * 3, i * 3 + 3)));
  assert(reinforce(settings, null, [baseObstacle(tinyTris)]).status === 'skipped', 'enclosed neighbour ignored');
  const topo = { pos: tiny, nFaces: tiny.length / 9 };
  assert(reinforce(settings, topo).status === 'skipped', 'enclosed part ignored');
});

Deno.test('base reinforcement: part-mounted, curved and disconnected bases remain unchanged', () => {
  const settings = { baseThickness: 2, baseSpread: 25 };
  const tris = wall();
  assert(reinforceBase(tris.map((v) => [v[0], v[1], v[2] + 10]), line, 100, prop.PROP.th,
    null, ID, ZERO, settings).status === 'skipped');
  assert(reinforceBase(tris, [line[0], [0, 10, 100], line[1]], 100, prop.PROP.th,
    null, ID, ZERO, settings).status === 'skipped');
  assert(reinforceBase(tris, line.map((v) => [v[0], 80, v[2]]), 100, prop.PROP.th,
    null, ID, ZERO, settings).status === 'skipped');
});

Deno.test('base reinforcement: records own the added ranges, contact geometry and export stay intact', async () => {
  const tris = wall(), original = structuredClone(tris);
  const built = { triangles: tris, fins: [{ line, height: 100, triRanges: [[0, tris.length]] }] };
  const topo = blockTopo(-80, 80, -50, 50, 100, 120);
  reinforceBuiltBases(built, topo, { offset: ZERO }, ID, { baseThickness: 2, baseSpread: 30 }, prop.PROP.th, 0.19);
  assert(built.baseReinforcement.added === 1);
  assert(JSON.stringify(built.triangles.slice(0, original.length)) === JSON.stringify(original), 'contacts altered');
  const owned = built.fins[0].triRanges.flatMap(([a, b]) => built.triangles.slice(a, b));
  assert(owned.length === built.triangles.length, 'unowned triangles cannot be removed');
  const stl = readSTL(new Uint8Array(await writeBinarySTL(owned).arrayBuffer()));
  assert(stl.length === owned.length * 3);
  const mf = await readThreeMF(new Uint8Array(await writeThreeMF([], owned, 'reinforced support').arrayBuffer()));
  assert(mf.positions.length === owned.length * 3, '3MF lost base triangles');
});

Deno.test('base reinforcement: meter-high automatic braces use thickness and outward spread', () => {
  const saved = [fins.FIN, prop.PROP, PERP].map((o) => ({ ...o }));
  try {
    const topo = blockTopo(-80, 80, -60, 60, 0, 1000), res = analyze(topo, 45, ID);
    const b = fins.buildFins(topo, res, ID, { tines: true, layerHeight: 0.6, sway: { on: true, reach: 0.15 },
      tunables: { nozzle: 1.6, wallLines: 8, baseThickness: 2, baseSpread: 40 } });
    assert(b.sway.count >= 2);
    const bases = b.fins.filter((f) => f.kind === 'sway').map((f) => f.baseReinforcement);
    assert(bases.every((r) => r.status === 'partial' && Math.max(r.leftSpread, r.rightSpread) === 40), JSON.stringify(bases));
    assert(bases.every((r) => r.height > 190));
    for (const r of bases) assertClose(r.thickness, 28.16, 1e-6);
    for (const f of b.fins.filter((f) => f.kind === 'sway')) {
      const r = f.baseReinforcement, [start, end] = f.triRanges.at(-1);
      const top = b.triangles.slice(start, end).filter((v) => Math.abs(v[2] - r.height) < 1e-6);
      const a = f.line[0], z = f.line.at(-1), len = Math.hypot(z[0] - a[0], z[1] - a[1]);
      const s = top.map((p) => ((p[0] - a[0]) * (z[0] - a[0]) + (p[1] - a[1]) * (z[1] - a[1])) / len);
      assertClose(Math.max(...s) - Math.min(...s), 0.8 * (len - SWAY.footPad) + 0.2 * SWAY.topDepth, 1e-5,
        'base top must join the tapered rib without a shelf');
    }
    assert(isClosed(b.triangles), 'open automatic base');
  } finally {
    [fins.FIN, prop.PROP, PERP].forEach((o, i) => Object.assign(o, saved[i]));
  }
});

Deno.test('base reinforcement: Draw uses floor stations rather than contact heights', async () => {
  const { buildDrawn } = await import('../web/draw-build.js');
  const saved = [fins.FIN, prop.PROP, PERP].map((o) => ({ ...o }));
  try {
    const topo = blockTopo(-60, 60, -30, 30, 100, 110);
    const b = buildDrawn(topo, { offset: ZERO }, ID,
      [{ a: [-25, 0, 100], b: [25, 0, 100] }],
      { draw: { tines: false }, tunables: { nozzle: 0.4, wallLines: 2, baseThickness: 2, baseSpread: 20 } });
    assert(b.items[0].ok, b.items[0].info.reason);
    assert(b.items[0].info.top.every((p) => p[2] > 99));
    assert(b.items[0].info.floors.every((z) => z === 0));
    assert(b.items[0].info.baseReinforcement.status === 'added');
    assert(isClosed(b.triangles) && isOriented(b.triangles));
  } finally { [fins.FIN, prop.PROP, PERP].forEach((o, i) => Object.assign(o, saved[i])); }
});
