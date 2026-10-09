/** Closed, tapered reinforcement at the plate. Original breakaway contacts stay intact. */
import { loftExtrude, boxExtrude, roundedPolygon } from './solids.js';
import { insidePart, solidClearance } from './inside.js';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const ZERO = { x: 0, y: 0, z: 0 };

export function baseSettings(thickness = 1, spread = 0) {
  return {
    baseThickness: Number.isFinite(thickness) ? Math.max(1, Math.min(4, thickness)) : 1,
    baseSpread: Number.isFinite(spread) ? Math.max(0, Math.min(300, spread)) : 0,
  };
}

function bounds(verts) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of verts) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]);
  }
  return { lo, hi };
}

function overlaps(a, b, gap) {
  return a.lo.every((v, k) => v <= b.hi[k] + gap && a.hi[k] >= b.lo[k] - gap);
}

/** A neighbour's grid is lazy and shared across candidates; no topology welding needed. */
export function baseObstacle(tris) {
  return { tris, box: bounds(tris), topo: null };
}

function clearOf(candidate, obstacle, gap, contains) {
  if (!obstacle.tris.length || !overlaps(bounds(candidate), obstacle.box, gap)) return true;
  obstacle.topo ??= { pos: new Float64Array(obstacle.tris.flat()), nFaces: obstacle.tris.length / 3 };
  return !solidClearance(obstacle.topo, ID, ZERO, candidate, gap)
    && !candidate.some((p) => insidePart(obstacle.topo, ID, ZERO, p[0], p[1], Math.max(1e-5, p[2])))
    && !obstacle.tris.some(contains);
}

function outlineAt(tris, a, ux, uy, half, h) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < tris.length; i += 3) for (let j = 0; j < 3; j++) {
    const p = tris[i + j], q = tris[i + (j + 1) % 3];
    if (Math.abs(q[2] - p[2]) < 1e-8) continue;
    const t = (h - p[2]) / (q[2] - p[2]);
    if (t < 0 || t > 1) continue;
    const x = p[0] + t * (q[0] - p[0]) - a[0], y = p[1] + t * (q[1] - p[1]) - a[1];
    const w = -x * uy + y * ux;
    if (Math.abs(Math.abs(w) - half) > Math.max(1e-4, half * 0.02)) continue;
    const s = x * ux + y * uy;
    lo = Math.min(lo, s); hi = Math.max(hi, s);
  }
  return [lo, hi];
}

function additionBlocked(extra, contains, topo, rot, offset, obstacles, gap) {
  if (topo) {
    if (solidClearance(topo, rot, offset, extra, gap)) return 'part blocks the base';
    // Plate vertices lie on the part's bottom plane, where ray parity is
    // ambiguous. Test just above it; surface crossings are checked separately.
    if (extra.some((p) => insidePart(topo, rot, offset, p[0], p[1], Math.max(1e-5, p[2])))) return 'part encloses the base';
    for (let i = 0; i < topo.pos.length; i += 3) {
      const x = topo.pos[i], y = topo.pos[i + 1], z = topo.pos[i + 2];
      if (contains([rot[0] * x + rot[3] * y + rot[6] * z + offset.x,
        rot[1] * x + rot[4] * y + rot[7] * z + offset.y,
        rot[2] * x + rot[5] * y + rot[8] * z + offset.z])) return 'base encloses part of the model';
    }
  }
  return obstacles.some((o) => !clearOf(extra, o, gap, contains)) ? 'another support blocks the base' : '';
}

/** Perpendicular rib, broad at the plate and narrowing near the original wall's top. */
function reinforceCross(tris, line, height, th, topo, rot, offset, settings, obstacles, gap) {
  const reach = Number.isFinite(settings.crossReach) ? Math.max(5, Math.min(80, settings.crossReach)) : 20;
  const base = reinforceBase(tris, line, height, th, topo, rot, offset,
    { ...settings, baseStyle: 'taper', baseSpread: 0 }, obstacles, gap);
  const skip = (reason) => base.tris.length
    ? { ...base, status: 'partial', style: 'cross', cross: false, crossRequested: reach, reason }
    : { status: 'skipped', style: 'cross', cross: false, crossRequested: reach, reason, tris: [] };
  if (!tris.length || !line?.length || bounds(tris).lo[2] > 1e-5) return skip('support starts on the part');
  const a = line[0], b = line.at(-1), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1 || !(height > 2)) return skip('support too low or narrow');
  const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length, half = th / 2;
  if (line.some((p) => Math.abs(-(p[0] - a[0]) * uy + (p[1] - a[1]) * ux) > th / 4)) return skip('curved base');
  // End just below the full-width wall, leaving its breakaway neck intact.
  // A percentage left 50mm bare on a metre-high fin; low contact tails also
  // incorrectly capped the whole cross. Read the highest body station instead.
  let stemTop = 0;
  for (const p of tris) {
    const w = -(p[0] - a[0]) * uy + (p[1] - a[1]) * ux;
    if (Math.abs(Math.abs(w) - half) < Math.max(1e-4, half * 0.02)) stemTop = Math.max(stemTop, p[2]);
  }
  const h = Math.min(height, stemTop) - 0.5;
  if (h <= 1) return skip('contact too close to the plate');
  const [lo, hi] = outlineAt(tris, a, ux, uy, half, h);
  if (!(hi - lo > 1e-4)) return skip('no matching wall near the top');
  // Taper reach, never the printable wall gauge. A narrow original body's
  // top used to pinch this rib below its selected nozzle/line-count thickness.
  const upperHalf = half;
  const centre = length / 2, middle = (lo + hi) / 2;
  // A sway body's 4mm-deep top can be narrower than a large-nozzle rib.
  // Try either end-aligned position rather than thinning the rib to fit.
  // Exact part/neighbour checks decide which side has room.
  const upperCentres = hi - lo < th ? [middle, lo + half, hi - half] : [middle];
  const P = (s, w, z) => [a[0] + ux * s - uy * w, a[1] + uy * s + ux * w, z];
  const own = { pos: new Float64Array(tris.flat()), nFaces: tris.length / 3 };
  const { baseThickness } = baseSettings(settings.baseThickness);
  const wide = half * baseThickness;
  const footH = Math.min(0.6, h / 4), footMargin = Math.max(1, th / 8);
  const attempts = [1, 0.75, 0.5, 0.25].flatMap((f) => [[reach * f, reach * f], [0, reach * f], [reach * f, 0]]);
  let reason = 'cross arms blocked';
  const levels = [Math.min(h / 4, Math.max(1.1, h / 10)), h / 2, h * 0.9, h];
  const outlines = levels.map((z) => outlineAt(tris, a, ux, uy, half, z));
  for (const upperCentre of upperCentres) {
    // Certify the overlap, not the rib's centre: a full-width rib may extend
    // out past a narrow body while still joining it along its whole height.
    const joined = levels.every((z, i) => {
      const f = z / h, s = centre + (upperCentre - centre) * f;
      const w = wide + (upperHalf - wide) * f;
      const left = Math.max(outlines[i][0], s - w), right = Math.min(outlines[i][1], s + w);
      return right - left > 1e-4 && insidePart(own, ID, ZERO, ...P((left + right) / 2, 0, z));
    });
    if (!joined) { reason = 'cross would not join the original support along its height'; continue; }
    for (const [left, right] of attempts) {
      const w0 = -half - left, w1 = half + right;
      // Keep the cross visible at the top, rather than burying its tip inside
      // the original wall. An omitted arm stays flush, never flaring outward.
      const topLeft = -Math.min(th, half + left), topRight = Math.min(th, half + right);
      const bottom = [[centre - wide, w0], [centre + wide, w0], [centre + wide, w1], [centre - wide, w1]];
      const top = [[upperCentre - upperHalf, topLeft], [upperCentre + upperHalf, topLeft],
        [upperCentre + upperHalf, topRight], [upperCentre - upperHalf, topRight]];
      const extra = [];
      loftExtrude(bottom, top, 0, h, P, extra);
      const foot = roundedPolygon([[centre - wide - footMargin, w0 - footMargin],
        [centre + wide + footMargin, w0 - footMargin], [centre + wide + footMargin, w1 + footMargin],
        [centre - wide - footMargin, w1 + footMargin]], wide + footMargin);
      boxExtrude(foot, 0, footH, P, extra);
      const contains = ([px, py, z]) => {
        if (z < -1e-6 || z > h) return false;
        const x = px - a[0], y = py - a[1], s = x * ux + y * uy, w = -x * uy + y * ux, f = z / h;
        if (Math.abs(s - (centre + (upperCentre - centre) * f)) < wide + (upperHalf - wide) * f
          && w > w0 + (topLeft - w0) * f && w < w1 + (topRight - w1) * f) return true;
        return z <= footH && foot.every((p, i) => {
          const q = foot[(i + 1) % foot.length];
          return (q[0] - p[0]) * (w - p[1]) - (q[1] - p[1]) * (s - p[0]) > 1e-9;
        });
      };
      reason = additionBlocked(extra, contains, topo, rot, offset, obstacles, gap);
      if (reason) continue;
      const partial = (base.status !== 'off' && base.status !== 'added') || left !== reach || right !== reach;
      return { ...base, status: partial ? 'partial' : 'added', style: 'cross', cross: true,
        tris: [...base.tris, ...extra], crossHeight: h, crossThickness: th,
        crossRequested: reach, crossLeft: left, crossRight: right,
        reason: partial ? 'one or more base arms limited' : '' };
    }
  }
  return skip(reason);
}

/**
 * Returns only the extra solid, with a reason if it cannot fit. Spread is per end;
 * an obstructed end can stay unextended while the other gets the requested spread.
 * Never fills a curved centreline with a bounding box or reinforces a part-mounted wall.
 */
export function reinforceBase(tris, line, height, wallThickness, topo, rot, offset,
  settings = {}, obstacles = [], gap = 0.19) {
  if (settings.baseStyle === 'cross') return reinforceCross(tris, line, height, wallThickness, topo, rot, offset, settings, obstacles, gap);
  const { baseThickness, baseSpread } = baseSettings(settings.baseThickness, settings.baseSpread);
  if (baseThickness === 1 && baseSpread === 0) return { status: 'off', tris: [] };
  const skip = (reason) => ({ status: 'skipped', reason, tris: [] });
  if (!tris.length || !line?.length || bounds(tris).lo[2] > 1e-5) return skip('support starts on the part');
  if (!(height > 1) || !(wallThickness > 0)) return skip('support too low');
  const a = line[0], b = line.at(-1), length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (length < 1) return skip('no straight base');
  const ux = (b[0] - a[0]) / length, uy = (b[1] - a[1]) / length;
  if (line.some((p) => Math.abs(-(p[0] - a[0]) * uy + (p[1] - a[1]) * ux) > wallThickness / 4)) {
    return skip('curved base');
  }
  let h = height * 0.2;
  for (const p of line) if (p[2] > 1e-5) h = Math.min(h, p[2] - gap - 0.5);
  if (h <= 0.5) return skip('contact too close to the plate');
  const P = (s, w, z) => [a[0] + ux * s - uy * w, a[1] + uy * s + ux * w, z];
  const own = { pos: new Float64Array(tris.flat()), nFaces: tris.length / 3 };
  if (![0.25, 0.5, 0.75].some((s) => [0.1, h / 4].some((z) => insidePart(own, ID, ZERO, ...P(length * s, 0, z))))) {
    return skip('reinforcement would not join the original support');
  }
  const half = wallThickness / 2;
  // Match the actual body at the taper's top: sway ribs already narrow with
  // height. Using the bed outline here would leave an abrupt shelf at this seam.
  const [topLo, topHi] = outlineAt(tris, a, ux, uy, half, h);
  if (!(topHi - topLo > 0.1)) return skip('no matching straight wall at taper height');
  const topRect = [[topLo, -half], [topHi, -half], [topHi, half], [topLo, half]];
  const rect = (left, right, w) => [[-left, -w], [length + right, -w], [length + right, w], [-left, w]];
  const attempts = baseSpread > 0
    ? [[baseSpread, baseSpread], [0, baseSpread], [baseSpread, 0]] : [[0, 0]];
  // Thickness alone remains useful when neither end has room.
  if (baseSpread > 0 && baseThickness > 1) attempts.push([0, 0]);
  let reason = 'part blocks the base';
  for (const [left, right] of attempts) {
    const extra = [];
    if (settings.roundFeet) {
      const bottom = roundedPolygon(rect(left, right, half * baseThickness), half * baseThickness);
      const upper = bottom.map(([s, w]) => [topLo + (s + left) / (length + left + right) * (topHi - topLo), w / baseThickness]);
      loftExtrude(bottom, upper, 0, h, P, extra);
    } else loftExtrude(rect(left, right, half * baseThickness), topRect, 0, h, P, extra);
    const contains = ([px, py, pz]) => {
      if (pz < -1e-6 || pz > h) return false;
      const dx = px - a[0], dy = py - a[1];
      const s = dx * ux + dy * uy, w = -dx * uy + dy * ux, f = 1 - pz / h;
      return s > -left * f + topLo * (1 - f) && s < (length + right) * f + topHi * (1 - f)
        && Math.abs(w) < half * (1 + (baseThickness - 1) * f);
    };
    reason = additionBlocked(extra, contains, topo, rot, offset, obstacles, gap);
    if (reason) continue;
    const partial = left !== baseSpread || right !== baseSpread;
    return { status: partial ? 'partial' : 'added', tris: extra, height: h,
      thickness: wallThickness * baseThickness, leftSpread: left, rightSpread: right,
      reason: partial ? 'one or both ends blocked' : '' };
  }
  return skip(reason);
}

/** Append a range to the same fin record so selection/removal/export include its base. */
export function reinforceBuiltBases(built, topo, result, rot, settings, wallThickness, gap, external = []) {
  const fins = built.fins ?? [];
  const { baseThickness, baseSpread } = baseSettings(settings.baseThickness, settings.baseSpread);
  if (baseThickness === 1 && baseSpread === 0 && settings.baseStyle !== 'cross') return built;
  const meshes = fins.map((f) => f.triRanges.flatMap(([a, b]) => built.triangles.slice(a, b)));
  const obstacles = meshes.map(baseObstacle);
  const report = { added: 0, partial: 0, skipped: 0 };
  fins.forEach((f, i) => {
    const r = reinforceBase(meshes[i], f.line, f.height, f.wallThickness ?? wallThickness, topo, rot, result.offset,
      settings, [...external, ...obstacles.filter((_, j) => i !== j)], gap);
    f.baseReinforcement = r;
    // Geometry already belongs to built.triangles; don't duplicate it in the worker reply.
    if (r.tris.length) {
      const start = built.triangles.length;
      built.triangles.push(...r.tris);
      f.triRanges.push([start, built.triangles.length]);
      obstacles[i] = baseObstacle([...meshes[i], ...r.tris]);
    }
    delete r.tris;
    report[r.status] = (report[r.status] ?? 0) + 1;
  });
  built.baseReinforcement = report;
  return built;
}
