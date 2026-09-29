// CURVED FILL (issue #121, PR 2b): after #124 the headset's straight struts had
// walls but its rings stayed bare -- no straight wall fits under a curve.
// fins/curvefill.js adds curved fins under the overhang still bare, as a mode:
// on by itself for a lattice net, off elsewhere unless asked. Pinned on a voxel
// strut net with a ring in every hole (the headset's crown in miniature).
import { analyze, fins, prop, assert, blockTopo, voxelTopo } from './_util.js';
import { curvePaths, arcLen } from '../web/prop/curve.js';

// A 64 mm net of 3 mm struts at a 20 mm pitch, 24 mm up on corner posts, with a
// 3 mm wide ring (radius 5-8 mm) in each hole, tied to the struts by 2 mm spokes.
const N = 64, bar = (u) => u % 20 < 3;
const ring = (i, j) => {
  const ci = Math.floor(i / 20) * 20 + 12, cj = Math.floor(j / 20) * 20 + 12;
  const r = Math.hypot(i + 0.5 - ci, j + 0.5 - cj);
  const spoke = (Math.abs(i + 0.5 - ci) < 1 || Math.abs(j + 0.5 - cj) < 1) && r >= 5;
  return (r >= 5 && r < 8) || spoke;
};
const net = () => voxelTopo((i, j, k) =>
  (k >= 24 && k < 28 && (bar(i) || bar(j) || ring(i, j))) ||
  (k < 24 && bar(i) && bar(j) && (i < 3 || i >= 60) && (j < 3 || j >= 60)), N, N, 28, 1);
const rotX = (d) => { const r = (d * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return [1, 0, 0, 0, c, s, 0, -s, c]; };

// probe.js's rule: an overhang face is held when a wall top sits within half the
// max unsupported span of it in plan, 0-1.5 mm below
function heldPct(topo, res, rot, built) {
  const R = prop.PROP.maxUnsupportedSpan / 2, o = res.offset, tops = built.fins.flatMap((w) => w.line ?? []);
  const seat = (x, y, z) => [rot[0] * x + rot[3] * y + rot[6] * z + o.x, rot[1] * x + rot[4] * y + rot[7] * z + o.y,
                             rot[2] * x + rot[5] * y + rot[8] * z + o.z];
  let area = 0, held = 0;
  for (const r of res.regions) for (const f of r.faces) {
    const p = topo.pos, c = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = seat(p[f * 9 + k * 3], p[f * 9 + k * 3 + 1], p[f * 9 + k * 3 + 2]);
      for (let i = 0; i < 3; i++) c[i] += v[i] / 3;
    }
    area += topo.area[f];
    if (c[2] < 0.6 || tops.some((q) => { const dz = c[2] - q[2]; return dz >= -0.05 && dz <= 1.5 && Math.hypot(c[0] - q[0], c[1] - q[1]) <= R; })) held += topo.area[f];
  }
  return (100 * held) / area;
}

Deno.test('curve: a ring gives centre lines round the whole of it, not one half', () => {
  const tri = [];
  const n = 72, r0 = 6, r1 = 9;
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n, b = (2 * Math.PI * (k + 1)) / n;
    const p = (r, t) => [r * Math.cos(t), r * Math.sin(t), 10];
    tri.push([p(r0, a), p(r1, a), p(r1, b)], [p(r0, a), p(r1, b), p(r0, b)]);
  }
  const paths = curvePaths(tri);
  const len = paths.reduce((s, p) => s + arcLen(p), 0);
  assert(paths.length >= 2, `a ring should come out in pieces round it: ${paths.length}`);
  assert(len > 0.8 * 2 * Math.PI * 7.5, `centre lines cover ${len.toFixed(1)} of ${(2 * Math.PI * 7.5).toFixed(1)} mm`);
});

Deno.test('curve fill: a ringed net turns it on and holds the rings the walls missed', () => {
  const topo = net(), rot = rotX(20), res = analyze(topo, 45, rot);
  const off = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, curveFill: false });
  const on = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true });
  assert(on.curveFill.on && on.curveFill.auto, `auto should choose the fill on a net: ${JSON.stringify(on.curveFill)}`);
  const curved = on.fins.filter((f) => f.curved);
  assert(curved.length >= 4, `curved fins: ${curved.length}`);
  const before = heldPct(topo, res, rot, off), after = heldPct(topo, res, rot, on);
  assert(after >= before + 10, `held ${before.toFixed(0)}% -> ${after.toFixed(0)}%`);
  // it only adds: everything the fill-off build made is still there, first
  assert(on.triangles.length > off.triangles.length, 'the fill added nothing');
  for (let i = 0; i < off.triangles.length; i += 97) {
    assert(off.triangles[i].every((v, k) => v === on.triangles[i][k]), `the fill changed an existing support (vertex ${i})`);
  }
});

Deno.test('curve fill: a curved fin keeps sideClear from every other support', () => {
  const topo = net(), rot = rotX(20), res = analyze(topo, 45, rot);
  const on = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true });
  const box = (f) => {
    const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const [a, z] of f.triRanges) for (let i = a; i < z; i++) {
      const v = on.triangles[i];
      for (let k = 0; k < 3; k++) { b[k] = Math.min(b[k], v[k]); b[k + 3] = Math.max(b[k + 3], v[k]); }
    }
    return b;
  };
  // triangle-level, as the fill checks it: a curved fin's box spans a whole arc
  const tris = (f) => f.triRanges.flatMap(([a, z]) => {
    const out = [];
    for (let i = a; i + 2 < z; i += 3) out.push(on.triangles.slice(i, i + 3));
    return out;
  });
  const tbox = (t) => [0, 1, 2].map((k) => Math.min(...t.map((v) => v[k]))).concat([0, 1, 2].map((k) => Math.max(...t.map((v) => v[k]))));
  const pad = prop.PROP.sideClear - 1e-6;
  const near = (a, b) => a[0] - pad <= b[3] && b[0] <= a[3] + pad && a[1] - pad <= b[4] && b[1] <= a[4] + pad && a[2] - pad <= b[5] && b[2] <= a[5] + pad;
  const walls = on.fins.filter((f) => !f.curved).flatMap(tris).map(tbox);
  for (const f of on.fins.filter((q) => q.curved)) {
    const fb = box(f);
    const mine = tris(f).map(tbox);
    for (const w of walls) {
      if (!near(fb, w)) continue;
      // the fin's own tines are emitted after the check, so judge its body: all but tine-sized triangles
      assert(!mine.some((m) => m[5] - m[2] > 0.5 && near(m, w)), 'a curved fin runs into another support');
    }
  }
});

Deno.test('curve fill: a plain part leaves it off, and ticking it is honoured', () => {
  const topo = blockTopo(0, 40, 0, 20, 10, 14), rot = rotX(0), res = analyze(topo, 45, rot);
  const auto = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true });
  assert(!auto.curveFill.on && auto.curveFill.auto, `a plain slab is not a net: ${JSON.stringify(auto.curveFill)}`);
  const ticked = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, curveFill: true });
  assert(ticked.curveFill.on && !ticked.curveFill.auto, `ticked: ${JSON.stringify(ticked.curveFill)}`);
});
