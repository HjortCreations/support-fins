/** Pure hand-placement engine. Used in workers by the live and parked models. */
import { applyTunables, FIN } from "./fins.js";
import { PROP } from "./prop.js";
import { drawnWall } from "./draw.js";
import { swayAtFace } from "./sway.js";
import { planGrid } from "./fins/tall.js";
import { baseObstacle, reinforceBuiltBases } from "./base-reinforcement.js";

export function printTriangles(topo, rot, offset) {
  const out = new Float64Array(topo.pos.length), p = topo.pos;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    out[i] = rot[0] * x + rot[3] * y + rot[6] * z + offset.x;
    out[i + 1] = rot[1] * x + rot[4] * y + rot[7] * z + offset.y;
    out[i + 2] = rot[2] * x + rot[5] * y + rot[8] * z + offset.z;
  }
  return out;
}
export function autoSupports(built, gone = []) {
  const removed = new Set(gone),
    braces = [],
    walls = [],
    outlines = built?.sway?.braces ?? [];
  let k = 0;
  for (const rec of built?.fins ?? []) {
    if (rec.kind === "sway") {
      const r = outlines[k++];
      if (r && !removed.has(rec.id)) braces.push(r);
    } else if (!removed.has(rec.id) && rec.line?.length) walls.push(rec.line);
  }
  return { braces, walls };
}

export function buildDrawn(
  topo,
  result,
  rot,
  requests,
  options = {},
  avoid = {},
  partTris = null,
  _candidates = null,
  external = [],
) {
  applyTunables(options.tunables);
  const tris = partTris ?? printTriangles(topo, rot, result.offset);
  const built = { triangles: [], fins: [] },
    items = [],
    auto = options.auto ?? null,
    gone = new Set(options.gone ?? []);
  const automatic = autoSupports(auto, gone);
  const avoided = {
    braces: [...automatic.braces, ...(avoid.braces ?? [])],
    walls: [...automatic.walls, ...(avoid.walls ?? [])],
  };
  const braces = [...(avoided.braces ?? [])],
    walls = [...(avoided.walls ?? [])],
    grid = planGrid(),
    outside = [...external];
  for (const rec of auto?.fins ?? []) {
    if (!gone.has(rec.id)) {
      for (const [a, b] of rec.triRanges ?? []) {
        const t = auto.triangles.slice(a, b);
        grid.add(t, "auto");
        outside.push(...t);
      }
    }
  }
  if (auto?.padTriangles?.length) {
    grid.add(auto.padTriangles, "auto");
    outside.push(...auto.padTriangles);
  }
  if (external.length) grid.add(external, "drawn");
  const drawOpts = {
    ...options.draw,
    topo,
    rot,
    offset: result.offset,
    braceTall: !!options.draw?.braceTall &&
      (FIN.baseStyle !== "cross" || PROP.tineDir === "vertical"),
  };
  let gridded = 0;
  drawOpts.braceClear = (t) => {
    grid.add(built.triangles.slice(gridded));
    gridded = built.triangles.length;
    return !grid.hits(t);
  };
  for (const w of requests) {
    const r = w.kind === "sway"
      ? swayAtFace(topo, result, rot, w.face, w.a, {
        ...options.sway,
        full: !w.capped,
        fitFeature: w.fitFeature === true && PROP.tineDir !== "vertical",
        crossAbove: FIN.baseStyle === "cross" && PROP.tineDir !== "vertical"
          ? Infinity
          : options.sway?.crossAbove,
      }, { braces, walls })
      : drawnWall(w.a, w.b, tris, 0, drawOpts);
    if (w.kind === "sway" && r.ok) {
      grid.add(built.triangles.slice(gridded));
      gridded = built.triangles.length;
      if (grid.hits(r.tris)) {
        r.ok = false;
        r.reason = "another support blocks this brace";
      }
    }
    const item = { ok: r.ok, info: { ...r }, triStart: 0, triEnd: 0 };
    items.push(item);
    if (!r.ok) continue;
    if (w.kind === "sway") braces.push(r);
    else if (r.top?.length) walls.push(r.top);
    const start = built.triangles.length;
    for (const t of r.tris) built.triangles.push(t);
    const foot = r.foot ?? r.top.map(([x, y], i) => [x, y, r.floors?.[i] ?? 0]);
    built.fins.push({
      line: foot,
      height: r.height,
      wallThickness: r.th ?? PROP.th,
      triRanges: [[start, built.triangles.length]],
    });
  }
  if (PROP.tineDir !== "vertical") {
    reinforceBuiltBases(
      built,
      topo,
      result,
      rot,
      FIN,
      PROP.th,
      Math.max(0.01, Math.min(PROP.gap, PROP.sideClear) * 0.95),
      outside.length ? [baseObstacle(outside)] : [],
    );
  }
  const triangles = [];
  let k = 0;
  for (const item of items) {
    if (!item.ok) continue;
    const rec = built.fins[k++];
    item.info.baseReinforcement = rec.baseReinforcement;
    item.triStart = triangles.length / 3;
    for (const [a, b] of rec.triRanges) {
      for (let j = a; j < b; j++) triangles.push(built.triangles[j]);
    }
    item.triEnd = triangles.length / 3;
    delete item.info.tris;
  }
  return { items, triangles };
}
