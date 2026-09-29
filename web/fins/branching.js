/**
 * BRANCHING (experimental, local issue 008 / #8): "walls off walls". Take the tall
 * walls the Auto pass placed, group near neighbours, and rebuild each group as ONE
 * trunk wall with leaning ARMS -- one solid, far less bed and usually less plastic.
 *
 * An arm is a ruled sheet from the original wall's top line (unchanged, so the held
 * area and the tines are the same) down to the trunk's top line J, leaning at most
 * LEAN from vertical at every station. The trunk is a normal wall under J (plate:
 * sweep with its foot plus a one-layer pad; part: sweepBetween). A group of one
 * whose trunk comes out shorter than its wall is the FAN wall.
 *
 * Opt-in (opts.branching, Auto only). Ported from prototype/branch/spike.js after
 * the bunny X30 reprint held (2026-09-29); print 1 fell off the plate, which is why
 * the footprint answers to the whole group (TOTAL_SLENDER) and plate trunks get a pad.
 *
 * Imports only the prop pieces, solids and inside -- never fins.js.
 */
import { PROP } from '../prop.js';
import { sweep, sweepBetween } from '../prop/sweep.js';
import { floorLine } from '../prop/attached.js';
import { emitTines, tineStepFor } from '../prop/tines.js';
import { ribbon } from '../solids.js';
import { solidClearance } from '../inside.js';
import { seatedPartTris } from './seating.js';

export const BRANCH = {
  lean: 30,            // deg from vertical an arm may lean (Matthew: err safe -- 90%+ of printers)
  minH: 15,            // only walls this tall are worth a trunk
  minTrunk: 5,         // trunk height above its floor
  reach: 25,           // plan distance to consider a neighbour
  minJ: 3,             // shortest trunk line (mm)
  trunkSlender: 5,     // trunk height <= 5 x its length (coupon: 7:1 stood, err safe)
  totalSlender: 5,     // floor to highest arm top <= 5 x trunk length (print 1 fell over)
  padEnd: 3,           // plate pad runs this far past each trunk end
  padMinHalf: 4,       // pad half-width floor (the foot flange is <= 3)
  tries: 12,           // cheapest trunk placements tried before a group gives up
};

const planDist = (A, B) => Math.min(...A.flatMap((p) => B.map((q) => Math.hypot(p[0] - q[0], p[1] - q[1]))));

/**
 * Where each arm station lands on the trunk line: the arm's own extent along u
 * mapped linearly onto [a0, a1], so no two stations share a bottom point --
 * clamping pinned every station past J's end to one point and the arm folded flat
 * (zero-volume scraps). An arm square to J spreads by station index instead.
 */
function armBottoms(line, J) {
  const proj = line.map((p) => (p[0] - J.cx) * J.u[0] + (p[1] - J.cy) * J.u[1]);
  const lo = Math.min(...proj), hi = Math.max(...proj);
  return line.map((p, i) => {
    const f = hi - lo > 0.5 ? (proj[i] - lo) / (hi - lo) : i / Math.max(1, line.length - 1);
    const t = J.a0 + (J.a1 - J.a0) * f;
    return [J.cx + J.u[0] * t, J.cy + J.u[1] * t];
  });
}

/** Trunk lines J for arms `walls`, cheapest first: a few directions x lengths. */
function solveJ(walls, floorZ) {
  const tan = Math.tan(BRANCH.lean * Math.PI / 180), cosL = Math.cos(BRANCH.lean * Math.PI / 180);
  const pts = walls.flatMap((w) => w.line);
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  // candidate directions: each wall's run, the PCA axis, and their perpendiculars
  const dirs = [];
  for (const w of walls) {
    const a = w.line[0], b = w.line[w.line.length - 1], n = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (n > 1e-6) dirs.push([(b[0] - a[0]) / n, (b[1] - a[1]) / n]);
  }
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { const x = p[0] - cx, y = p[1] - cy; sxx += x * x; sxy += x * y; syy += y * y; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  dirs.push([Math.cos(th), Math.sin(th)]);
  for (const d of [...dirs]) dirs.push([-d[1], d[0]]);

  const cands = [];
  const topZ = Math.max(...pts.map((p) => p[2]));
  const minL = (topZ - floorZ) / BRANCH.totalSlender;
  for (const u of dirs) {
    const proj = pts.map((p) => (p[0] - cx) * u[0] + (p[1] - cy) * u[1]);
    const lo = Math.min(...proj), hi = Math.max(...proj);
    // side reach: how far the arm tops sit off the trunk's line, for the pad's width
    const side = Math.max(...pts.map((p) => Math.abs((p[0] - cx) * -u[1] + (p[1] - cy) * u[0])));
    for (const f of [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1, 0]) {
      const L = Math.max(BRANCH.minJ, minL, (hi - lo) * f), mid = (lo + hi) / 2;
      const a0 = mid - L / 2, a1 = mid + L / 2;
      let zJ = Infinity, armArea = 0;
      for (const w of walls) {
        const bot = armBottoms(w.line, { u, cx, cy, a0, a1 });
        w.line.forEach((p, i) => { zJ = Math.min(zJ, p[2] - Math.hypot(p[0] - bot[i][0], p[1] - bot[i][1]) / tan); });
      }
      if (zJ - floorZ < BRANCH.minTrunk) continue;
      if (zJ - floorZ > BRANCH.trunkSlender * L) continue;
      for (const w of walls) {
        for (let i = 0; i + 1 < w.line.length; i++) {
          const p = w.line[i], q = w.line[i + 1];
          armArea += Math.hypot(q[0] - p[0], q[1] - p[1]) * ((p[2] + q[2]) / 2 - zJ);
        }
      }
      // sheet area is what costs plastic; arms lean, so 1/cos(lean) bounds their length
      const cost = armArea / cosL + L * (zJ - floorZ);
      cands.push({ u, cx, cy, a0, a1, L, zJ, cost, side });
    }
  }
  return cands.sort((a, b) => a.cost - b.cost);
}

/** Arm solid: one ribbon from the wall's top line down to J, tip-wide at top, th-wide at J. */
function buildArm(line, J, out) {
  const secs = [], bot = armBottoms(line, J);
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
    let rx = b[0] - a[0], ry = b[1] - a[1];
    const rn = Math.hypot(rx, ry) || 1; rx /= rn; ry /= rn;
    const sx = ry, sy = -rx;
    const j = [bot[i][0], bot[i][1], J.zJ];
    const tw = PROP.tip / 2, bw = PROP.th / 2;
    secs.push([
      [p[0] + sx * tw, p[1] + sy * tw, p[2]], [p[0] - sx * tw, p[1] - sy * tw, p[2]],
      [j[0] - sx * bw, j[1] - sy * bw, j[2] - 0.5], [j[0] + sx * bw, j[1] + sy * bw, j[2] - 0.5],
    ]);
  }
  ribbon(secs, out);
}

/** One-layer pad under a plate trunk: grips the bed, snaps off like a brim. */
function buildPad(J, padH, out) {
  const W = Math.max(BRANCH.padMinHalf, J.side), sx = J.u[1], sy = -J.u[0];
  const sec = (t) => { const x = J.cx + J.u[0] * t, y = J.cy + J.u[1] * t;
    return [[x + sx * W, y + sy * W, padH], [x - sx * W, y - sy * W, padH], [x - sx * W, y - sy * W, 0], [x + sx * W, y + sy * W, 0]]; };
  ribbon([sec(J.a0 - BRANCH.padEnd), sec(J.a1 + BRANCH.padEnd)], out);
}

/** Trunk (+ pad) then arms into `out`; returns the trunk's triangle count, 0 if it failed. */
function buildGroup(g, J, out, ctx) {
  const n = Math.max(PROP.minStations, Math.round(J.L / PROP.stationStep) + 1);
  const jl = [];
  for (let k = 0; k < n; k++) {
    const t = J.a0 + (J.a1 - J.a0) * k / (n - 1);
    jl.push([J.cx + J.u[0] * t, J.cy + J.u[1] * t, J.zJ + PROP.gap]);   // "surface" line: top = z - gap
  }
  const before = out.length;
  const ok = g.onPart ? sweepBetween(jl, floorLine(jl, ctx.partTris), out) : sweep(jl, 0, out);
  if (!ok) { out.length = before; return 0; }
  if (!g.onPart) buildPad(J, ctx.padH, out);
  const nTrunk = out.length - before;
  for (const w of g.walls) buildArm(w.line, J, out);
  return nTrunk;
}

/** The cheapest trunk placement whose trunk + arms clear the part, or null. */
function placeGroup(g, ctx) {
  for (const J of solveJ(g.walls, g.floorZ).slice(0, BRANCH.tries)) {
    const tris = [];
    const nTrunk = buildGroup(g, J, tris, ctx);
    if (!nTrunk) continue;
    // solidClearance reports only the CLOSEST contact. A part trunk is welded at its
    // foot by design, so checking trunk + arms together always returned that foot and
    // hid an arm 0.07 mm off the part: arms are checked on their own.
    const clash = (t) => {
      const hit = t.length ? solidClearance(ctx.topo, ctx.rot, ctx.off, t, 0.25) : null;
      return hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205);
    };
    if (clash(tris.slice(nTrunk)) || (!g.onPart && clash(tris.slice(0, nTrunk)))) continue;
    return { J, tris };
  }
  return null;
}

/**
 * Rebuild `built` (buildFinsCore's Auto result) with tall neighbouring walls
 * grouped onto trunks. Walls left alone keep their triangles; each group becomes
 * one fin record of kind 'branch' whose triangles are trunk + pad + arms + tines.
 * Returns `built` unchanged when nothing groups.
 */
export function branchWalls(topo, result, rot, built, opts = {}) {
  const off = result.offset;
  const partTris = seatedPartTris(topo, rot, off);
  const ctx = { topo, rot, off, partTris, padH: opts.layerHeight ?? PROP.tineH };
  const fins = built.fins ?? [];
  const sheet = (ws) => ws.reduce((s, w) => s + w.f.span * w.f.height, 0);
  const walls = [];
  (built.props ?? []).forEach((q, i) => {
    if (q.squat || (q.height ?? 0) < BRANCH.minH || !(q.line?.length >= 2)) return;
    const f = fins[i];
    if (!f || f.kind !== 'prop') return;
    const floorZ = q.partAttached
      ? Math.min(...floorLine(q.line.map((p) => [p[0], p[1], p[2] + PROP.gap]), partTris).map((p) => p[2])) : 0;
    walls.push({ f, q, line: q.line, onPart: !!q.partAttached, floorZ });
  });
  walls.sort((a, b) => b.f.height - a.f.height);

  const used = new Set(), groups = [];
  let rejected = 0;
  for (const seed of walls) {
    if (used.has(seed)) continue;
    let g = { walls: [seed], onPart: seed.onPart, floorZ: seed.floorZ };
    let placed = placeGroup(g, ctx);
    const near = walls.filter((w) => w !== seed && !used.has(w) && w.onPart === seed.onPart
      && Math.abs(w.floorZ - seed.floorZ) < 2 && planDist(w.line, seed.line) <= BRANCH.reach)
      .sort((a, c) => planDist(a.line, seed.line) - planDist(c.line, seed.line));
    for (const w of near) {
      const g2 = { walls: [...g.walls, w], onPart: g.onPart, floorZ: Math.max(g.floorZ, w.floorZ) };
      const p2 = placeGroup(g2, ctx);
      // join only if one trunk costs less than this group + w on its own
      if (p2 && p2.J.cost < (placed?.J.cost ?? sheet(g.walls)) + w.f.span * w.f.height) { g = g2; placed = p2; }
    }
    if (!placed) { rejected++; continue; }
    if (placed.J.cost >= sheet(g.walls) * 0.95) continue;       // not worth it
    for (const w of g.walls) used.add(w);
    groups.push({ ...g, ...placed });
  }
  if (!groups.length) return { ...built, branching: { groups: 0, walls: 0, rejected } };

  // Drop the grouped walls' triangles (their ranges hold wall AND tines) and
  // shift every other fin's ranges down to match.
  const dropFins = new Set(groups.flatMap((g) => g.walls.map((w) => w.f)));
  const drop = new Uint8Array(built.triangles.length);
  for (const f of dropFins) for (const [s, e] of f.triRanges) drop.fill(1, s, e);
  const shift = new Int32Array(built.triangles.length + 1);
  const triangles = [];
  for (let i = 0; i < built.triangles.length; i++) {
    shift[i] = triangles.length;
    if (!drop[i]) triangles.push(built.triangles[i]);
  }
  shift[built.triangles.length] = triangles.length;
  const kept = fins.filter((f) => !dropFins.has(f))
    .map((f) => ({ ...f, triRanges: f.triRanges.map(([s, e]) => [shift[s], shift[s] + (e - s)]) }));

  // Each group: trunk + arms, then each wall's own tines. An arm keeps its wall's
  // top line, so the wall's tines grip it unchanged; they are copied, not re-emitted
  // (re-emitting against the whole part lost 6 of 54 on the torus). A wall without
  // a recorded tine offset gets a fresh comb on the same line.
  const withTines = opts.tines ?? true;
  const step = tineStepFor(opts.tineDensity), tineH = opts.layerHeight ?? PROP.tineH;
  let id = fins.reduce((m, f) => Math.max(m, (f.id ?? -1) + 1), fins.length);
  // the wall's own tine count lives on its prop (the fin record carries 0)
  let tines = (built.tines ?? 0) - groups.flatMap((g) => g.walls).reduce((s, w) => s + (w.q.tines ?? 0), 0);
  const recs = groups.map((g) => {
    const s = triangles.length;
    triangles.push(...g.tris);
    let nT = 0;
    if (withTines) for (const w of g.walls) {
      const r = w.q.triRanges;
      if (Number.isInteger(w.q.tineOff) && r.length === 1) {
        for (let i = r[0][0] + w.q.tineOff; i < r[0][1]; i++) triangles.push(built.triangles[i]);
        nT += w.q.tines ?? 0;
      } else {
        const top = w.line.map((p) => [p[0], p[1], p[2] + PROP.gap]);
        nT += emitTines(top, partTris, topo, rot, off, triangles, step, undefined, tineH);
      }
    }
    tines += nT;
    const J = g.J, t = (a) => [J.cx + J.u[0] * a, J.cy + J.u[1] * a, J.zJ];
    return {
      height: Math.max(...g.walls.map((w) => w.f.height)), length: J.L, tines: nT, rows: 0,
      stilt: 0, lean: 0, bearing: 0, site: null,
      id: id++, kind: 'branch', arms: g.walls.length, onPart: g.onPart,
      triRanges: [[s, triangles.length]], line: [t(J.a0), t(J.a1)], span: J.L,
    };
  });
  const all = [...kept, ...recs];
  return {
    ...built, triangles, fins: all, tines,
    braceCount: withTines ? all.length : built.braceCount,
    branching: { groups: groups.length, walls: dropFins.size, rejected },
  };
}
