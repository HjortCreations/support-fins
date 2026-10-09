import { reinforceBase, baseObstacle } from '../web/base-reinforcement.js';
import { roundedPolygon, boxExtrude } from '../web/solids.js';
import { sweep, footFor } from '../web/prop/sweep.js';
import { sweepSquat } from '../web/prop/squat.js';
import { drawnWall } from '../web/draw.js';
import { PERP } from '../web/fins/wedges.js';
import { writeBinarySTL, readSTL } from '../web/stl.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
import { fins, prop, blockTopo, block, analyze, isClosed, isOriented, bbox, assert, assertClose } from './_util.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], ZERO = { x: 0, y: 0, z: 0 };
function profile(fn) {
  const objects = [fins.FIN, prop.PROP, PERP], saved = objects.map((o) => ({ ...o }));
  try { fins.applyTunables({ nozzle: 1.6, wallLines: 4 }); return fn(); }
  finally { objects.forEach((o, i) => Object.assign(o, saved[i])); }
}

Deno.test('rounded feet: inscribed arcs and curved perimeter make a closed outward slab', () => {
  const poly = roundedPolygon([[-50, -6], [50, -6], [50, 6], [-50, 6]], 6);
  assert(poly.length > 20);
  assert(poly.every(([x, y]) => Math.abs(x) <= 50 + 1e-6 && Math.abs(y) <= 6 + 1e-6));
  assert(!poly.some(([x, y]) => Math.abs(x) === 50 && Math.abs(y) === 6), 'square corner kept');
  const tris = [];
  boxExtrude(poly, 0, 0.6, (x, y, z) => [x, y, z], tris);
  assert(isClosed(tris) && isOriented(tris));
});

Deno.test('rounded feet: prop and squat feet lose square corners while retaining contact geometry', () => {
  profile(() => {
    const line = [[-50, 0, 100], [0, 0, 100], [50, 0, 100]];
    const square = [], rounded = [];
    prop.PROP.roundFeet = false; sweep(line, 0, square);
    prop.PROP.roundFeet = true; sweep(line, 0, rounded);
    assert(isClosed(rounded) && isOriented(rounded));
    assert(!rounded.some((p) => Math.abs(Math.abs(p[0]) - 50) < 1e-6 && Math.abs(Math.abs(p[1]) - footFor(100)) < 1e-6), 'rectangular flange corner');
    assert(JSON.stringify(rounded.filter((p) => p[2] > prop.PROP.baseH))
      === JSON.stringify(square.filter((p) => p[2] > prop.PROP.baseH)), 'wall contacts changed');
    const squat = [];
    assert(sweepSquat([[-30, 0, 1.5], [30, 0, 1.5]], 0, squat));
    assert(isClosed(squat) && isOriented(squat));
    assert(!squat.some((p) => Math.abs(Math.abs(p[0]) - 30) < 1e-6
      && Math.abs(Math.abs(p[1]) - prop.PROP.squatBrimW) < 1e-6));
  });
});

Deno.test('cross base: a perpendicular rib joins a drawn wall and narrows toward its top', () => {
  profile(() => {
    const wall = drawnWall([-50, 0, 100], [50, 0, 100], block(-80, 80, -80, 80, 100, 120), 0, { tines: false });
    assert(wall.ok, wall.reason);
    const r = reinforceBase(wall.tris, wall.top, wall.height, prop.PROP.th, null, ID, ZERO,
      { baseStyle: 'cross', baseThickness: 2, baseSpread: 20 });
    assert(r.cross && r.status === 'added', r.reason);
    assert(r.crossHeight > 97 && r.crossHeight < 100);
    assert(isClosed(r.tris) && isOriented(r.tris));
    const bottom = bbox(r.tris.filter((p) => p[2] === 0));
    const top = bbox(r.tris.filter((p) => Math.abs(p[2] - r.crossHeight) < 1e-6));
    assert(bottom.hi[1] - bottom.lo[1] > 45 && bottom.hi[1] - bottom.lo[1] < 55,
      'cross should use a modest fixed reach rather than scale with wall length');
    assertClose(top.hi[1] - top.lo[1], prop.PROP.th * 2, 1e-6, 'cross disappears inside wall before reaching top');
  });
});

Deno.test('cross base: blocked arms shorten and enclosed neighbours are never fused', () => {
  profile(() => {
    const line = [[-50, 0, 100], [50, 0, 100]], tris = []; sweep(line, 0, tris);
    const obstacle = blockTopo(-20, 20, 15, 100, 0, 100);
    const r = reinforceBase(tris, line, 100, prop.PROP.th, obstacle, ID, ZERO,
      { baseStyle: 'cross', baseThickness: 1, baseSpread: 20 });
    assert(r.cross && r.status === 'partial', r.reason);
    assert(r.crossLeft > r.crossRight, 'blocked arm not limited');
    const tiny = block(-2, 2, -2, 2, 3, 4);
    const mesh = Array.from({ length: tiny.length / 3 }, (_, i) => Array.from(tiny.slice(i * 3, i * 3 + 3)));
    const buried = reinforceBase(tris, line, 100, prop.PROP.th, null, ID, ZERO,
      { baseStyle: 'cross' }, [baseObstacle(mesh)]);
    assert(!buried.cross && buried.status === 'skipped', 'cross swallowed another support');
  });
});

Deno.test('cross base: low contacts do not cap a tall sloping fin', () => {
  profile(() => {
    const line = [[-50, 0, 100], [50, 0, 1000]], tris = [];
    assert(sweep(line, 0, tris));
    const r = reinforceBase(tris, line, 999.8, prop.PROP.th, null, ID, ZERO,
      { baseStyle: 'cross', baseThickness: 2, baseSpread: 20 });
    assert(r.cross && r.crossHeight > 990, r.reason);
    assert(isClosed(r.tris) && isOriented(r.tris));
  });
});

Deno.test('cross base: the extended top stays clear of geometry above the old 95% limit', () => {
  profile(() => {
    const line = [[-50, 0, 1000], [50, 0, 1000]], tris = []; sweep(line, 0, tris);
    const topo = blockTopo(-2, 2, 3.8, 6.5, 985, 1000);
    const r = reinforceBase(tris, line, 999.8, prop.PROP.th, topo, ID, ZERO,
      { baseStyle: 'cross', baseThickness: 1, baseSpread: 20 });
    assert(r.cross && r.status === 'partial', r.reason);
    assert(r.crossHeight > 990 && r.crossRight === 0 && r.crossLeft > 0, 'upper obstruction not respected');
  });
});

Deno.test('cross base: meter-high braces own rounded cross feet and retain their mesh during export', async () => {
  const b = profile(() => {
    const topo = blockTopo(-80, 80, -60, 60, 0, 1000), res = analyze(topo, 45, ID);
    return fins.buildFins(topo, res, ID, { tines: true, layerHeight: 0.6, sway: { on: true },
      tunables: { nozzle: 1.6, wallLines: 4, baseStyle: 'cross', baseThickness: 2, baseSpread: 20 } });
  });
  const cross = b.fins.filter((f) => f.baseReinforcement?.cross);
  assert(cross.length >= 2, JSON.stringify(b.fins.map((f) => f.baseReinforcement)));
  for (const f of cross) assertClose(f.height - f.baseReinforcement.crossHeight, 0.5, 1e-6,
    'metre-high cross must stop only 0.5mm below the rib top');
  assert(cross.every((f) => f.baseReinforcement.crossLeft <= 20 && f.baseReinforcement.crossRight <= 20),
    'tall fins should not inflate the cross footprint');
  assert(isClosed(b.triangles) && isOriented(b.triangles));
  const owned = b.fins.flatMap((f) => f.triRanges.flatMap(([a, z]) => b.triangles.slice(a, z)));
  assert(owned.length === b.triangles.length, 'cross triangles unowned');
  const stl = readSTL(new Uint8Array(await writeBinarySTL(owned).arrayBuffer()));
  assert(stl.length === owned.length * 3);
  const mf = await readThreeMF(new Uint8Array(await writeThreeMF([], owned, 'cross supports').arrayBuffer()));
  assert(mf.positions.length === owned.length * 3);
});
