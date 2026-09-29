/**
 * A region's footprint in plan: its seated triangles rasterised on a `cell` grid,
 * each inside cell's distance to the footprint's edge, and its skeleton. Shared by lattice.js
 * (is this region a net of narrow struts, and where are they) and curve.js (the
 * path a curved fin follows through it).
 */

/**
 * `tri` is an array of seated triangles, each [a, b, c] with a = [x, y, z].
 * Returns { x0, y0, W, H, cell, fp, dist, idx, cellOf }: fp[k] 1 inside, dist[k]
 * the chamfer (3-4) distance in mm from cell k's centre to the nearest outside
 * cell's, 0 outside. null when the grid would pass `maxCells`.
 */
export function planFootprint(tri, cell, maxCells = 4e6) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of tri) for (const v of t) {
    if (v[0] < x0) x0 = v[0]; if (v[0] > x1) x1 = v[0];
    if (v[1] < y0) y0 = v[1]; if (v[1] > y1) y1 = v[1];
  }
  x0 -= 2 * cell; y0 -= 2 * cell;
  const W = Math.ceil((x1 - x0) / cell) + 3, H = Math.ceil((y1 - y0) / cell) + 3;
  if (!(W * H <= maxCells)) return null;
  const idx = (i, j) => j * W + i;
  const cellOf = (x, y) => [Math.floor((x - x0) / cell), Math.floor((y - y0) / cell)];
  const fp = new Uint8Array(W * H);
  for (const [a, b, c] of tri) {
    const [i0, j0] = cellOf(Math.min(a[0], b[0], c[0]), Math.min(a[1], b[1], c[1]));
    const [i1, j1] = cellOf(Math.max(a[0], b[0], c[0]), Math.max(a[1], b[1], c[1]));
    const d = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * cell, py = y0 + (j + 0.5) * cell;
      if (Math.abs(d) < 1e-12) { fp[idx(i, j)] = 1; continue; }   // edge-on: its box is a sliver anyway
      const u = ((b[0] - px) * (c[1] - py) - (c[0] - px) * (b[1] - py)) / d;
      const v = ((c[0] - px) * (a[1] - py) - (a[0] - px) * (c[1] - py)) / d;
      const tol = cell / Math.sqrt(Math.abs(d));    // a half-cell grace, so thin strips stay connected
      if (u >= -tol && v >= -tol && 1 - u - v >= -tol) fp[idx(i, j)] = 1;
    }
  }

  // distance to the footprint's edge, chamfer 3-4
  const dist = new Float64Array(W * H);
  for (let k = 0; k < W * H; k++) dist[k] = fp[k] ? 1e9 : 0;
  const relax = (k, n, w) => { if (dist[n] + w < dist[k]) dist[k] = dist[n] + w; };
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const k = idx(i, j); if (!fp[k]) continue;
    relax(k, k - 1, 3); relax(k, k - W, 3); relax(k, k - W - 1, 4); relax(k, k - W + 1, 4);
  }
  for (let j = H - 2; j > 0; j--) for (let i = W - 2; i > 0; i--) {
    const k = idx(i, j); if (!fp[k]) continue;
    relax(k, k + 1, 3); relax(k, k + W, 3); relax(k, k + W + 1, 4); relax(k, k + W - 1, 4);
  }
  for (let k = 0; k < W * H; k++) if (fp[k]) dist[k] = (dist[k] / 3) * cell;
  return { x0, y0, W, H, cell, fp, dist, idx, cellOf };
}

/** The footprint thinned to a one-cell skeleton (Zhang-Suen): 1 on the skeleton. */
export function skeleton(plan) {
  const { W, H, fp, idx } = plan;
  const sk = fp.slice();
  const nb = (k) => [sk[k - W], sk[k - W + 1], sk[k + 1], sk[k + W + 1], sk[k + W], sk[k + W - 1], sk[k - 1], sk[k - W - 1]];
  for (let changed = true; changed;) {
    changed = false;
    for (const pass of [0, 1]) {
      const del = [];
      for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
        const k = idx(i, j); if (!sk[k]) continue;
        const p = nb(k);                              // p2..p9, clockwise from north
        const B = p.reduce((s, q) => s + q, 0);
        if (B < 2 || B > 6) continue;
        let A = 0; for (let q = 0; q < 8; q++) if (!p[q] && p[(q + 1) % 8]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        del.push(k);
      }
      for (const k of del) sk[k] = 0;
      if (del.length) changed = true;
    }
  }
  return sk;
}
