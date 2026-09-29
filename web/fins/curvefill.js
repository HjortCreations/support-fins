/**
 * Curved fill (issue #121, PR 2b): curved fins under the overhang every other
 * pass left bare. After #124 the headset's straight struts had walls, but its
 * rings and the arcs round the dome stayed red: no straight wall fits under a
 * curve. A curved fin alone holds less than the walls do (41% vs 50% as
 * imported), but they hold DIFFERENT overhang -- together 71%. So this is a fill,
 * run last, not a rival: it only adds.
 *
 * Per overhang region with bare area: the paths prop/curve.js finds through its
 * footprint, each topped the way draw.js tops a drawn wall (the region's own
 * surface, settled against the whole part within PART_BAND). Each station stands
 * on the PLATE (clear path down) or on the PART below it (a ring over the strut
 * under it); runs split where that changes, and each is its own fin. A fin
 * standing on the part is welded at the foot, by design -- Matthew's call for
 * this part (a shell whose rings sit over its own struts), which is why the fill
 * is a mode, not always on.
 *
 * A fin is cut back where it comes too close to the part or to any support
 * already built (the #124 node worry: walls meeting at a node were checked
 * against the part, not each other), and kept only while it holds at least
 * MIN_HELD mm2 of overhang nothing held before it. Tines only round the low
 * points of its top: a curved fin braces itself, and the rest sits at the gap.
 */
import { PROP, contourTop, lowerSag, settleTop, sweep, sweepBetween, emitTines, tineStepFor,
         surfaceZAt, floorLine, PART_BAND, stationIsClear } from '../prop.js';
import { curvePaths, arcLen } from '../prop/curve.js';
import { latticeStruts } from '../prop/lattice.js';
import { solidClearance } from '../inside.js';
import { seatedPartTris } from './seating.js';

export const FILL = {
  minArea: 3.0,      // mm2: a region under this has nothing a fin could hold
  minRun: 4.0,       // mm of fin worth building (a curved fin braces itself)
  minHeld: 2.0,      // mm2 of still-bare overhang a fin must hold to be kept
  tineHalf: 2,       // stations each side of a low point that get tines
  tries: 6,          // cut-and-retry rounds per run before it is dropped
};
const R = PROP.maxUnsupportedSpan / 2;   // a face within this of a fin top is held (probe.js rule)

/**
 * Auto: is this the kind of part the fill is for? A lattice net (prop/lattice.js)
 * -- a shell of rings and struts. Elsewhere the fill's cost (60+ g on the octopus
 * and the castle in the spike) is not the user's to pay unasked, so the fill is off
 * unless they tick it.
 */
export function wantsCurveFill(topo, result, rot) {
  const T = seatedPartTris(topo, rot, result.offset);
  const seated = (f) => [0, 1, 2].map((k) => [T[f * 9 + k * 3], T[f * 9 + k * 3 + 1], T[f * 9 + k * 3 + 2]]);
  return result.regions.some((r) => latticeStruts(topo, r.faces, seated) !== null);
}

/** Centroid [x, y, z] and area of every overhang face, from the seated part. */
function overFaces(topo, result, T) {
  const faces = [];
  for (const r of result.regions) {
    for (const f of r.faces) {
      const i = f * 9;
      faces.push({ f, a: topo.area[f], c: [(T[i] + T[i + 3] + T[i + 6]) / 3, (T[i + 1] + T[i + 4] + T[i + 7]) / 3,
                                          (T[i + 2] + T[i + 5] + T[i + 8]) / 3] });
    }
  }
  return faces;
}

/** A plan grid of points (wall tops) for "is any within R of this face, just under it". */
function topGrid() {
  const cells = new Map(), key = (i, j) => `${i},${j}`;
  return {
    add(p) {
      const k = key(Math.floor(p[0] / R), Math.floor(p[1] / R));
      (cells.get(k) ?? cells.set(k, []).get(k)).push(p);
    },
    holds(c) {
      const i0 = Math.floor(c[0] / R), j0 = Math.floor(c[1] / R);
      for (let j = j0 - 1; j <= j0 + 1; j++) for (let i = i0 - 1; i <= i0 + 1; i++) {
        for (const p of cells.get(key(i, j)) ?? []) {
          const dz = c[2] - p[2];
          if (dz >= -0.05 && dz <= 1.5 && Math.hypot(c[0] - p[0], c[1] - p[1]) <= R) return true;
        }
      }
      return false;
    },
  };
}

/** Boxes of existing support triangles on a plan grid, for "does this new triangle come within `pad`". */
function boxGrid(tris, pad) {
  const S = 5, cells = new Map(), key = (i, j) => `${i},${j}`;
  const boxOf = (a, b, c) => [Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]), Math.min(a[2], b[2], c[2]),
                              Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]), Math.max(a[2], b[2], c[2])];
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const b = boxOf(tris[t], tris[t + 1], tris[t + 2]);
    for (let j = Math.floor(b[1] / S); j <= Math.floor(b[4] / S); j++) {
      for (let i = Math.floor(b[0] / S); i <= Math.floor(b[3] / S); i++) {
        (cells.get(key(i, j)) ?? cells.set(key(i, j), []).get(key(i, j))).push(b);
      }
    }
  }
  return {
    /** The first new triangle (from out[from..]) within `pad` of an existing one: its centre, or null. */
    hit(out, from) {
      for (let t = from; t + 2 < out.length; t += 3) {
        const b = boxOf(out[t], out[t + 1], out[t + 2]);
        for (let j = Math.floor((b[1] - pad) / S); j <= Math.floor((b[4] + pad) / S); j++) {
          for (let i = Math.floor((b[0] - pad) / S); i <= Math.floor((b[3] + pad) / S); i++) {
            for (const o of cells.get(key(i, j)) ?? []) {
              if (b[0] - pad <= o[3] && o[0] <= b[3] + pad && b[1] - pad <= o[4] && o[1] <= b[4] + pad &&
                  b[2] - pad <= o[5] && o[2] <= b[5] + pad) {
                return [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2];
              }
            }
          }
        }
      }
      return null;
    },
  };
}

/**
 * Curved fins for the overhang `tops` (every existing wall top, [x, y, z]) leaves
 * bare. `existing` is every support triangle already built (vertex list). Returns
 * { triangles, props, tines, skipped }, props with triRanges into those triangles;
 * `skipped` counts the runs dropped and why (part/crowd count each cut, not each fin).
 */
export function curveFill(topo, result, rot, opts, tops, existing) {
  const skipped = { noTop: 0, short: 0, part: 0, crowd: 0, noGain: 0 };
  const none = { triangles: [], props: [], tines: 0, skipped };
  const off = result.offset;
  const T = seatedPartTris(topo, rot, off);
  const held = topGrid();
  for (const p of tops) held.add(p);
  const faces = overFaces(topo, result, T);
  const bare = new Set(faces.filter((o) => o.c[2] >= 0.6 && !held.holds(o.c)).map((o) => o.f));
  if (!bare.size) return none;
  const byFace = new Map(faces.map((o) => [o.f, o]));
  const others = boxGrid(existing, PROP.sideClear);
  const withTines = opts.tines ?? true;
  const tineStep = tineStepFor(opts.tineDensity), tineH = opts.layerHeight ?? PROP.tineH;

  const out = [], props = [];
  let tines = 0;
  for (const r of result.regions) {
    let area = 0, bareArea = 0;
    for (const f of r.faces) { area += topo.area[f]; if (bare.has(f)) bareArea += topo.area[f]; }
    if (area < FILL.minArea || bareArea < FILL.minHeld) continue;
    const tri = r.faces.map((f) => [0, 1, 2].map((k) => [T[f * 9 + k * 3], T[f * 9 + k * 3 + 1], T[f * 9 + k * 3 + 2]]));
    const RT = new Float64Array(r.faces.length * 9);
    r.faces.forEach((f, k) => RT.set(T.subarray(f * 9, f * 9 + 9), k * 9));

    for (const path of curvePaths(tri)) {
      // top: the region's own surface over each station, then the three settle
      // passes against the whole part within PART_BAND of it, as draw.js does
      const line = path.map(([x, y]) => [x, y, surfaceZAt(RT, x, y) ?? -Infinity]);
      if (!line.some((p) => isFinite(p[2]))) { skipped.noTop++; continue; }
      contourTop(line, T, PART_BAND); lowerSag(line, T, PART_BAND); settleTop(line, T, 0.25, PART_BAND);
      const floor = floorLine(line.map((p) => (isFinite(p[2]) ? p : [p[0], p[1], 0])), T);
      // 1: stands on the plate, 2: on the part below, 0: neither
      const cls = line.map((p, k) => {
        if (!isFinite(p[2])) return 0;
        if (p[2] - PROP.gap >= PROP.minHeight && stationIsClear(line, k, topo, rot, off)) return 1;
        if (floor[k][2] > PROP.gap + 0.5 && p[2] - PROP.gap - floor[k][2] >= PROP.minHeight) return 2;
        return 0;
      });
      const queue = [];
      for (let a = 0, k = 1; k <= line.length; k++) {
        if (k < line.length && cls[k] === cls[a]) continue;
        if (cls[a]) queue.push({ from: a, to: k, onPart: cls[a] === 2 });
        a = k;
      }
      for (let tries = 0; queue.length;) {
        const run = queue.shift();
        const st = line.slice(run.from, run.to);
        if (st.length < PROP.minStations || arcLen(st) < FILL.minRun) { skipped.short++; continue; }
        const bot = floor.slice(run.from, run.to);
        const t0 = out.length;
        if (!(run.onPart ? sweepBetween(st, bot, out) : sweep(st, 0, out))) { out.length = t0; continue; }
        // too close to the part (a foot on the part is welded by design) or to a support already built
        let at = null;
        const hit = solidClearance(topo, rot, off, out.slice(t0), 0.45);
        const footTop = run.onPart ? Math.max(...bot.map((p) => p[2])) + 0.8 : -Infinity;
        if (hit && hit.z >= footTop && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.03 : hit.d < 0.18)) { at = [hit.x, hit.y]; skipped.part++; }
        if (!at && (at = others.hit(out, t0))) skipped.crowd++;
        if (at) {
          out.length = t0;
          if (++tries > FILL.tries * 8) continue;       // a runaway path: give up on its pieces
          let kBest = 0, dBest = Infinity;
          st.forEach((p, k) => { const d = Math.hypot(p[0] - at[0], p[1] - at[1]); if (d < dBest) { dBest = d; kBest = k; } });
          const cut = run.from + kBest;
          queue.push({ ...run, to: Math.max(run.from, cut - 1) }, { ...run, from: Math.min(run.to, cut + 2) });
          continue;
        }
        // kept only while it holds overhang nothing held before it
        const topLine = st.map((p) => [p[0], p[1], p[2] - PROP.gap]);
        const mine = topGrid();
        for (const p of topLine) mine.add(p);
        let gain = 0;
        const gained = [];
        for (const f of bare) { const o = byFace.get(f); if (mine.holds(o.c)) { gain += o.a; gained.push(f); } }
        if (gain < FILL.minHeld) { out.length = t0; skipped.noGain++; continue; }
        for (const f of gained) bare.delete(f);

        // tines only round the low points of the top
        let nT = 0;
        if (withTines) {
          for (let k = 0; k < st.length; k++) {
            let lowest = true;
            for (let m = Math.max(0, k - 3); m <= Math.min(st.length - 1, k + 3); m++) {
              if (st[m][2] < st[k][2] - 1e-6) { lowest = false; break; }
            }
            if (!lowest) continue;
            const lo = Math.max(0, k - FILL.tineHalf), hi = Math.min(st.length, k + FILL.tineHalf + 1);
            if (hi - lo >= 2) nT += emitTines(st.slice(lo, hi), T, topo, rot, off, out, tineStep, undefined, tineH);
            k += 3;
          }
        }
        tines += nT;
        const top = Math.max(...topLine.map((p) => p[2]));
        props.push({ region: result.regions.indexOf(r), tines: nT, curved: true, onPart: run.onPart,
                     span: arcLen(st), height: top - (run.onPart ? Math.min(...bot.map((p) => p[2])) : 0),
                     area, stations: st.length, line: topLine, kind: 'prop', triRanges: [[t0, out.length]] });
      }
    }
  }
  return { triangles: out, props, tines, skipped };
}
