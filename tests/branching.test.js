// Branching (web/fins/branching.js, experimental): tall neighbouring walls regrouped
// onto one trunk with leaning arms. Built on the stress torus and tube at X30, the
// committed models where it fires (the curved figures it was printed on are not in git).
//   - off by default: buildFins without the option is unchanged;
//   - every fin's triangle ranges still cover the build exactly (per-fin removal);
//   - the arms keep the walls' top lines, so the tine count is unchanged;
//   - trunk and arms never fuse into the part -- only the tines bite in;
//   - a plate trunk stands on a one-layer pad;
//   - a group can carry more than one wall (the tube's two bore-side walls).

import { loadModel, analyze, fins, insideCount, rotX, assert } from './_util.js';

function build(name, rot, opts = {}) {
  const topo = loadModel(name);
  const res = analyze(topo, 45, rot);
  const built = fins.buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, ...opts });
  return { topo, res, built };
}
const R30 = rotX(30);
const branches = (b) => b.fins.filter((f) => f.kind === 'branch');
const trisOf = (b, f) => f.triRanges.flatMap(([s, e]) => b.triangles.slice(s, e));

Deno.test('branching: off by default -- the build is unchanged', () => {
  const a = build('torus', R30).built, b = build('torus', R30, { branching: false }).built;
  assert(a.branching === undefined, 'no branching report when the option is off');
  assert(a.triangles.length === b.triangles.length, 'same triangles with the option off');
  assert(!branches(a).length, 'no branch fins');
});

Deno.test('branching: draw/prop mode ignores the option', () => {
  const { built } = build('torus', R30, { mode: 'prop', branching: true });
  assert(!branches(built).length && built.branching === undefined, 'prop mode must not branch');
});

for (const name of ['torus', 'tube']) {
  Deno.test(`branching ${name}/X30: fin ranges cover the build exactly`, () => {
    const { built } = build(name, R30, { branching: true });
    assert(built.branching.groups > 0, `${name} X30 should branch (got ${JSON.stringify(built.branching)})`);
    const n = built.triangles.length, seen = new Uint8Array(n);
    for (const f of built.fins) for (const [s, e] of f.triRanges) {
      assert(s >= 0 && e <= n && s <= e && (e - s) % 3 === 0, `fin ${f.id} range [${s},${e}) out of bounds`);
      for (let i = s; i < e; i++) { assert(!seen[i], `vertex ${i} claimed twice`); seen[i] = 1; }
    }
    assert(seen.every((v) => v), 'every vertex belongs to some fin');
    assert(new Set(built.fins.map((f) => f.id)).size === built.fins.length, 'fin ids unique');
  });

  Deno.test(`branching ${name}/X30: the grip is unchanged (same tines)`, () => {
    const plain = build(name, R30).built, br = build(name, R30, { branching: true }).built;
    assert(br.tines === plain.tines, `tines ${plain.tines} -> ${br.tines}: arms keep the walls' top lines`);
  });

  Deno.test(`branching ${name}/X30: trunk and arms never fuse into the part`, () => {
    const { topo, res, built } = build(name, R30, { branching: true, tines: false });
    for (const f of branches(built)) {
      const inside = insideCount(topo, R30, res.offset, trisOf(built, f));
      assert(inside === 0, `branch ${f.id}: ${inside} verts inside the part`);
    }
  });
}

Deno.test('branching: a plate trunk stands on a one-layer pad', () => {
  const { built } = build('torus', R30, { branching: true, tines: false, layerHeight: 0.2 });
  const plate = branches(built).filter((f) => !f.onPart);
  assert(plate.length, 'torus X30 has a plate trunk');
  for (const f of plate) {
    const pad = trisOf(built, f).filter((v) => v[2] <= 0.2 + 1e-9);
    assert(pad.some((v) => Math.abs(v[2] - 0.2) < 1e-9) && pad.some((v) => Math.abs(v[2]) < 1e-9),
      `branch ${f.id}: no one-layer pad at z 0..0.2`);
  }
});

Deno.test('branching: the tube groups two walls onto one trunk', () => {
  const { built } = build('tube', R30, { branching: true });
  assert(branches(built).some((f) => f.arms >= 2), 'expected a trunk carrying two arms');
});
