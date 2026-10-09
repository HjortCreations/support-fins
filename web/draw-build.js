/** Worker-safe manual support generation. Placement order stays deterministic. */
import { applyTunables, FIN } from './fins.js';
import { PROP } from './prop.js';
import { drawnWall } from './draw.js';
import { swayAtFace } from './sway.js';
import { baseObstacle, reinforceBuiltBases } from './base-reinforcement.js';
import { seatedPartTris } from './fins/seating.js';

export function buildDrawn(topo, result, rot, requests, options, avoid = {}, partTris = null, candidates = null, external = []) {
  applyTunables(options.tunables);
  const tris = partTris ?? seatedPartTris(topo, rot, result.offset);
  const built = { triangles: [], fins: [] }, items = [];
  const braces = [...(avoid.braces ?? [])], walls = avoid.walls ?? [];
  for (let i = 0; i < requests.length; i++) {
    const w = requests[i];
    const r = w.kind === 'sway'
      ? swayAtFace(topo, result, rot, w.face, w.a,
        { ...options.sway, fitFeature: w.fitFeature === true }, { braces, walls })
      : candidates?.[i] ?? drawnWall(w.a, w.b, tris, 0, { ...options.draw, topo, rot, offset: result.offset });
    const item = { ok: r.ok, info: { ...r }, triStart: 0, triEnd: 0 };
    items.push(item);
    if (!r.ok) continue;
    if (w.kind === 'sway') braces.push(r);
    const start = built.triangles.length;
    for (const t of r.tris) built.triangles.push(t);
    // Draw's top is a contact line, not a base. Derive explicit floor stations
    // for ordinary walls; sway already supplies its plate-level foot line.
    const foot = r.foot ?? r.top.map(([x, y], i) => [x, y, r.floors?.[i] ?? 0]);
    built.fins.push({ line: foot, height: r.height,
      wallThickness: r.th, triRanges: [[start, built.triangles.length]] });
  }
  reinforceBuiltBases(built, topo, result, rot, FIN, PROP.th,
    Math.max(0.01, Math.min(PROP.gap, PROP.sideClear) * 0.95),
    external.length ? [baseObstacle(external)] : []);
  const triangles = [];
  let k = 0;
  for (const item of items) {
    if (!item.ok) continue;
    const rec = built.fins[k++];
    item.info.baseReinforcement = rec.baseReinforcement;
    item.triStart = triangles.length / 3;
    for (const [a, b] of rec.triRanges) for (let j = a; j < b; j++) triangles.push(built.triangles[j]);
    item.triEnd = triangles.length / 3;
    // The ranges own the geometry; don't clone each wall's triangle soup twice.
    delete item.info.tris;
  }
  return { items, triangles };
}
