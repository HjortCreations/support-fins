import { manualPatchAtFace } from '../web/planes.js';
import { swayAtFace, buildSwayBraces, swayClashes } from '../web/sway.js';
import { LatestWorker } from '../web/worker-queue.js';
import { printDimensions } from '../web/print-profile.js';
import { block, blockTopo, buildTopology, tiltedBlockTopo, analyze, assert, isClosed, isOriented, insideCount } from './_util.js';
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const opts = { ...printDimensions(1.6, 4), tines: true, layerHeight: 0.6, tineSpacing: 1, fitFeature: true };
const topoOf = (...parts) => {
  const pos = new Float32Array(parts.flatMap((p) => [...p]));
  return buildTopology({ getAttribute: (k) => k === 'position' ? { array: pos } : null });
};
const faceAt = (topo, axis, normal, value, minZ = -Infinity) => {
  for (let f = 0; f < topo.nFaces; f++) {
    if (topo.nrm[f * 3 + axis] * normal < 0.9) continue;
    if (Math.abs(topo.pos[f * 9 + axis] - value) < 1e-5 && topo.pos[f * 9 + 2] >= minZ) return f;
  }
  throw new Error('fixture face missing');
};
const wing = () => topoOf(block(-50, 50, -20, 20, 0, 30),
  block(-5, 5, -5, 5, 30, 78), block(-5, 40, -6, 6, 78, 81));

Deno.test('manual sway: a small wing over a broader body gets a larger plate-connected fin', () => {
  const topo = wing(), result = { offset: { x: 0, y: 0, z: 0 } };
  const face = faceAt(topo, 0, 1, 40, 78);
  const r = swayAtFace(topo, result, ID, face, [40, 0, 80], opts);
  assert(r.ok, r.reason);
  assert(r.fitted && r.baseOffset > 10, 'the fin did not clear the wider body below');
  assert(r.tines >= 3 && !r.limitedGrip, 'fitted fin undercut the three-tine floor');
  assert(r.height >= 80.9, 'fin was truncated below the wing');
  assert(isClosed(r.tris) && isOriented(r.tris), 'fitted fin is not a closed outward solid');
  assert(Math.min(...r.tris.map((p) => p[2])) === 0, 'fin does not reach the plate');
  const body = swayAtFace(topo, result, ID, face, [40, 0, 80], { ...opts, tines: false });
  assert(body.ok && insideCount(topo, ID, result.offset,
    body.tris.map((p) => [p[0], p[1], Math.max(0.001, p[2])])) === 0, 'rib crosses the model');
  const again = swayAtFace(topo, result, ID, face, [40, 0, 80], opts, [r]);
  assert(!again.ok && /another brace/.test(again.reason), 'fitted fins fused together');
  assert(!swayClashes(r, []));
});

Deno.test('manual sway: clicking the wing top uses its nearest side edge, not a two-point wall', () => {
  const topo = wing(), face = faceAt(topo, 2, 1, 81, 78);
  const r = swayAtFace(topo, { offset: { x: 0, y: 0, z: 0 } }, ID, face, [39, 0, 81], opts);
  assert(r.ok && r.tines > 0, r.reason);
  assert(Math.abs(r.edgeMove - 1) < 1e-5, 'moved away from the nearest wing edge');
  assert(r.baseOffset > 0 && r.fitted);
});

Deno.test('manual sway: a small low face can be chosen even though Auto does not brace it', () => {
  const topo = blockTopo(-10, 10, -10, 10, 0, 6), res = analyze(topo, 45, ID);
  const face = faceAt(topo, 0, 1, 10);
  const r = swayAtFace(topo, res, ID, face, [10, 0, 4], { tines: true, layerHeight: 0.2, tineSpacing: 1, fitFeature: true });
  assert(r.ok && r.fitted && r.tines > 0, r.reason);
  assert(buildSwayBraces(topo, res, ID, { tines: true }).count === 0, 'changed Auto rules');
});

Deno.test('manual sway: a 40-degree side gets a fin without the upright-side gate', () => {
  const topo = tiltedBlockTopo(-20, 20, -8, 8, 0, 80, 40), res = analyze(topo, 45, ID);
  const face = Array.from({ length: topo.nFaces }, (_, f) => f)
    .find((f) => topo.nrm[f * 3 + 1] < -0.7 && topo.nrm[f * 3 + 2] < -0.6);
  const p = [0, 0, 0];
  for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) p[j] += topo.pos[face * 9 + k * 3 + j] / 3;
  for (let j = 0; j < 3; j++) p[j] += res.offset[['x', 'y', 'z'][j]];
  const r = swayAtFace(topo, res, ID, face, p, opts);
  assert(r.ok && r.fitted && r.tines > 0, r.reason);
  assert(isClosed(r.tris) && isOriented(r.tris));
});

Deno.test('manual sway: a face without one printable grip layer still refuses, naming contact', () => {
  const topo = topoOf(block(-5, 5, -5, 5, 0, 78), block(-5, 40, -6, 6, 78, 78.1));
  const face = faceAt(topo, 0, 1, 40, 78);
  const r = swayAtFace(topo, { offset: { x: 0, y: 0, z: 0 } }, ID, face, [40, 0, 78.05], opts);
  assert(!r.ok && /tines|contact|grip/.test(r.reason), `invalid thin contact accepted: ${r.reason}`);
});

Deno.test('manual sway: worker exports the fitted wing fin with owned cross reinforcement', async () => {
  const topo = wing(), face = faceAt(topo, 0, 1, 40, 78);
  const queue = new LatestWorker(new URL('../web/drawworker.js', import.meta.url));
  try {
    const reply = await queue.run('build', topo, { kind: 'build', rot: ID,
      result: { offset: { x: 0, y: 0, z: 0 } }, requests: [{ kind: 'sway', face, fitFeature: true, a: [40, 0, 80] }],
      options: { sway: opts, draw: {}, tunables: { nozzle: 1.6, wallLines: 4,
        baseStyle: 'cross', baseThickness: 2, crossReach: 20 } } });
    const item = reply.built.items[0];
    assert(item.ok && item.info.baseOffset > 0, item.info.reason);
    assert(item.triStart === 0 && item.triEnd * 3 === reply.built.triangles.length, 'lost fin ownership');
    assert(isClosed(reply.built.triangles) && isOriented(reply.built.triangles));
  } finally { queue.dispose(); }
});

Deno.test('manual patches: a small seed keeps the selected face and original plane limits', () => {
  const topo = wing(), face = faceAt(topo, 0, 1, 40, 78);
  const found = manualPatchAtFace(topo, ID, { x: 0, y: 0, z: 0 }, face);
  assert(found.patch?.faces.includes(face), 'small selected face was discarded');
  assert(found.patch.flatness <= 1.2 + 1e-5, 'manual growth escaped the seed plane');
});

Deno.test('manual sway: one- and two-tine wing contacts refuse rather than report limited grip', () => {
  const topo = wing(), face = faceAt(topo, 0, 1, 40, 78);
  for (const tineSpacing of [6, 2]) {
    const r = swayAtFace(topo, { offset: { x: 0, y: 0, z: 0 } }, ID,
      face, [40, 0, 80], { ...opts, tineSpacing });
    assert(!r.ok && /at least 3/.test(r.reason), `weak fin accepted: ${r.reason}`);
  }
});

Deno.test('manual sway: fitting a small feature requires explicit opt-in', () => {
  const topo = wing(), face = faceAt(topo, 0, 1, 40, 78);
  const r = swayAtFace(topo, { offset: { x: 0, y: 0, z: 0 } }, ID,
    face, [40, 0, 80], { ...opts, fitFeature: false });
  assert(!r.ok && /Fit feature/.test(r.reason), 'ordinary tool silently fitted the wing');
});

Deno.test('manual sway: a valid ordinary brace shortened by a ledge stays ordinary', () => {
  const topo = topoOf(block(-20, 20, -15, 15, 0, 150), block(-25, 25, -30, -15, 80, 85));
  const face = faceAt(topo, 1, -1, -15);
  for (const fitFeature of [false, true]) {
    const r = swayAtFace(topo, { offset: { x: 0, y: 0, z: 0 } }, ID,
      face, [0, -15, 130], { tines: true, layerHeight: 0.2, fitFeature });
    assert(r.ok && r.height < 80 && r.tines >= 3, r.reason);
    assert(!r.fitted && !r.baseOffset, 'valid shortened brace entered the wide fitted search');
  }
});
