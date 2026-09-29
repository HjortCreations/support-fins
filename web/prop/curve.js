/**
 * Curved fin paths (issue #121, PR 2b): the line, seen from above, that a fin
 * follows under an overhang that curves -- a ring round a hole, an arc round a
 * dome. A straight wall fits under a straight strut; under a ring it touches one
 * chord and leaves the rest bare, so the headset's rings stayed red after #124.
 *
 * From the region's plan footprint (plan.js) and each cell's distance to its edge:
 *   narrow (half-width <= NARROW): centre lines along its skeleton. The longest
 *     path first (tree diameter), then the longest through what is left, and so
 *     on -- a closed ring comes out as its two halves, a Y as its three arms;
 *   wider: fins PARALLEL TO THE EDGE -- iso-distance contours at EDGE_IN, then every
 *     PITCH inward (the outermost fin belongs at the free edge), plus centre lines if
 *     the middle is still over PITCH/2 from the last ring.
 * Each path is smoothed (Chaikin) so the foot can't fold on a tight bend, and
 * resampled at 1 mm. Ported from the curve spike (prototype/curve/spike.js on
 * curve-spike, local issue 008 session 20).
 */
import { PROP } from './config.js';
import { planFootprint, skeleton } from './plan.js';

export const CURVE = {
  cell: 0.5,          // mm, plan raster
  narrow: 4.0,        // half-width at or under this: centre lines only
  edgeIn: 1.0,        // outermost edge-parallel fin this far in from the edge
  minPath: 2.0,       // mm of path worth keeping (a run is judged again once topped)
};

/** Plan polylines ([x, y]) a curved fin can follow under the triangles `tri`. */
export function curvePaths(tri) {
  const plan = planFootprint(tri, CURVE.cell);
  if (!plan) return [];
  const { W, H, fp, dist, cell } = plan;
  // distance from a cell's centre to the footprint's edge (between cells)
  const D = new Float64Array(W * H);
  let maxD = 0;
  for (let k = 0; k < W * H; k++) if (fp[k]) { D[k] = Math.max(0, dist[k] - cell / 2); if (D[k] > maxD) maxD = D[k]; }
  const g = { ...plan, D, sk: skeleton(plan) };
  const paths = [];
  if (maxD <= CURVE.narrow) paths.push(...centreLines(g, 0));
  else {
    const pitch = PROP.maxUnsupportedSpan;
    let last = 0;
    for (let L = CURVE.edgeIn; L < maxD - 0.5; L += pitch) { paths.push(...contours(g, L)); last = L; }
    if (maxD - last > pitch / 2) paths.push(...centreLines(g, last + pitch / 2));
  }
  return paths.filter((p) => p.length >= 2 && arcLen(p) >= CURVE.minPath).map((p) => smoothResample(p));
}

export const arcLen = (l) => {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  return s;
};

/**
 * Centre lines along the footprint's skeleton (past `floor` from the edge): the
 * longest path, then the longest through what is left once that path and the
 * cells beside it are taken, until nothing long enough remains. The skeleton, not
 * "cells near the deepest": on a net the deepest cell is a wide node, and a share
 * of it cut every strut's middle into scraps (the curve spike's rule).
 */
function centreLines(g, floor) {
  const { x0, y0, W, H, D, sk, cell } = g;
  const ridge = new Uint8Array(W * H);
  let n = 0;
  for (let k = 0; k < W * H; k++) {
    if (sk[k] && D[k] >= floor) { ridge[k] = 1; n++; }
  }
  const minCells = CURVE.minPath / cell;
  const bfs = (s) => {
    const dist = new Map([[s, 0]]), prev = new Map(), q = [s];
    let far = s;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], i = k % W, j = (k - i) / W;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ii = i + di, jj = j + dj, m = jj * W + ii;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H || !ridge[m] || dist.has(m)) continue;
        dist.set(m, dist.get(k) + 1); prev.set(m, k); q.push(m);
        if (dist.get(m) > dist.get(far)) far = m;
      }
    }
    return { far, prev, dist, seen: q };
  };
  const lines = [];
  while (n > 0) {
    let deep = -1;
    for (let k = 0; k < W * H; k++) if (ridge[k] && (deep < 0 || D[k] > D[deep])) deep = k;
    const a = bfs(deep).far, { far: b, prev, dist, seen } = bfs(a);
    if (dist.get(b) < minCells) {                 // this piece is a speck: drop it
      for (const k of seen) { ridge[k] = 0; n--; }
      continue;
    }
    const path = [];
    for (let k = b; k !== undefined; k = prev.get(k)) {
      const i = k % W, j = (k - i) / W;
      path.push([x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell]);
      // take the path and the cells beside it, so the next line isn't its twin
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const m = (j + dj) * W + (i + di);
        if (ridge[m]) { ridge[m] = 0; n--; }
      }
    }
    lines.push(path);
  }
  return lines;
}

/** Iso-distance contours at level L (marching squares on cell centres), stitched into polylines. */
function contours(g, L) {
  const { x0, y0, W, H, D, cell } = g;
  const P = (i, j) => [x0 + (i + 0.5) * cell, y0 + (j + 0.5) * cell];
  const lerp = (i0, j0, i1, j1) => {
    const a = D[j0 * W + i0], b = D[j1 * W + i1], t = (L - a) / (b - a), p = P(i0, j0), q = P(i1, j1);
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  };
  const segs = [];      // [keyA, ptA, keyB, ptB], key = the grid edge the point sits on
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    const c = [D[j * W + i] > L, D[j * W + i + 1] > L, D[(j + 1) * W + i + 1] > L, D[(j + 1) * W + i] > L];
    const e = [[`h${i},${j}`, () => lerp(i, j, i + 1, j)], [`v${i + 1},${j}`, () => lerp(i + 1, j, i + 1, j + 1)],
      [`h${i},${j + 1}`, () => lerp(i, j + 1, i + 1, j + 1)], [`v${i},${j}`, () => lerp(i, j, i, j + 1)]];
    const cut = [0, 1, 2, 3].filter((k) => c[k] !== c[(k + 1) % 4]);
    if (cut.length === 2) segs.push([e[cut[0]][0], e[cut[0]][1](), e[cut[1]][0], e[cut[1]][1]()]);
    else if (cut.length === 4) {
      segs.push([e[0][0], e[0][1](), e[1][0], e[1][1]()]);
      segs.push([e[2][0], e[2][1](), e[3][0], e[3][1]()]);
    }
  }
  const at = new Map();
  segs.forEach((s, k) => { for (const key of [s[0], s[2]]) (at.get(key) ?? at.set(key, []).get(key)).push(k); });
  const used = new Uint8Array(segs.length), lines = [];
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue;
    used[k] = 1;
    const line = [segs[k][1], segs[k][3]];
    for (const dirn of [1, -1]) {                  // grow from the tail, then from the head
      let key = dirn === 1 ? segs[k][2] : segs[k][0];
      for (;;) {
        const nk = (at.get(key) ?? []).find((q) => !used[q]);
        if (nk === undefined) break;
        used[nk] = 1;
        const s = segs[nk], fwd = s[0] === key;
        const p = fwd ? s[3] : s[1];
        key = fwd ? s[2] : s[0];
        if (dirn === 1) line.push(p); else line.unshift(p);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Chaikin corner cutting (keeps the ends), then resample every `step` mm. */
function smoothResample(line, passes = 3, step = PROP.stationStep) {
  let p = line;
  for (let n = 0; n < passes && p.length > 2; n++) {
    const q = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const a = p[i], b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  const out = [p[0]];
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    let a = p[i - 1];
    const b = p[i];
    let seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (acc + seg >= step) {
      const t = (step - acc) / seg;
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(a);
      seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
      acc = 0;
    }
    acc += seg;
  }
  const e = p[p.length - 1], z = out[out.length - 1];
  if (Math.hypot(z[0] - e[0], z[1] - e[1]) > 0.3) out.push(e);
  return out;
}
