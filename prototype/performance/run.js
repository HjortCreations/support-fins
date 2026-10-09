// Reproducible geometry benchmark. Synthetic inputs only; no user's model is read.
// deno run -A prototype/performance/run.js [--baseline=/path/to/old-draw.js]
import { block, buildTopology, analyze, fins } from '../../tests/_util.js';
import { drawnWall } from '../../web/draw.js';
import { LatestWorker } from '../../web/worker-queue.js';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], ZERO = { x: 0, y: 0, z: 0 };
const baselinePath = Deno.args.find((a) => a.startsWith('--baseline='))?.slice(11);
const before = baselinePath ? (await import(pathToFileURL(baselinePath).href)).drawnWall : null;
const round = (n) => Math.round(n * 10) / 10;
// Compare geometry and shared placement fields; newer engines may add metadata.
const geometry = (r) => JSON.stringify([r.ok, r.tris, r.top, r.length, r.height, r.partAttached, r.tines]);
function densePlate(n) {
  const coarse = block(-60, 60, -60, 60, 100, 120), out = [];
  const p = (a, b, c, u, v) => a.map((x, k) => x + (b[k] - x) * u / n + (c[k] - x) * v / n);
  for (let f = 0; f < coarse.length; f += 9) {
    const a = Array.from(coarse.slice(f, f + 3)), b = Array.from(coarse.slice(f + 3, f + 6)), c = Array.from(coarse.slice(f + 6, f + 9));
    for (let u = 0; u < n; u++) for (let v = 0; v < n - u; v++) {
      out.push(...p(a, b, c, u, v), ...p(a, b, c, u + 1, v), ...p(a, b, c, u, v + 1));
      if (u + v + 1 < n) out.push(...p(a, b, c, u + 1, v), ...p(a, b, c, u + 1, v + 1), ...p(a, b, c, u, v + 1));
    }
  }
  out.push(...block(50, 60, 50, 60, 0, 100));
  return new Float32Array(out);
}
function measure(fn, runs = 3) {
  let out;
  const times = [];
  for (let i = 0; i < runs; i++) { const t = performance.now(); out = fn(); times.push(performance.now() - t); }
  return { out, coldMs: round(times[0]), warmMs: round(Math.min(...times.slice(1))) };
}

const rows = [];
for (const n of [32, 64, 128]) {
  const pos = densePlate(n), tris = Float64Array.from(pos);
  const t0 = performance.now();
  const topo = buildTopology({ getAttribute: (k) => k === 'position' ? { array: pos } : null });
  const topologyMs = round(performance.now() - t0);
  const a = [-40, 0, 100], b = [40, 0, 100];
  const legacy = before ? measure(() => before(a, b, tris, 0)) : null;
  const indexed = measure(() => drawnWall(a, b, tris, 0));
  if (!indexed.out.ok || (legacy && geometry(legacy.out) !== geometry(indexed.out))) {
    throw new Error('Indexed Draw changed the benchmark geometry');
  }
  const result = analyze(topo, 45, ID);
  const prop = measure(() => fins.buildFins(topo, result, ID, { mode: 'prop', bedPad: false }));
  const draw = measure(() => fins.buildFins(topo, result, ID, { mode: 'draw', bedPad: false }));
  const options = { tunables: { nozzle: 0.6, wallLines: 2, baseStyle: 'taper', baseThickness: 1, baseSpread: 0 },
    draw: { tines: false, layerHeight: 0.2 }, sway: {} };
  const jobs = Array.from({ length: 8 }, (_, i) => ({ kind: 'build', rot: ID, result: { offset: ZERO }, options,
    requests: [{ a: [-40, -35 + 10 * i, 100], b: [40, -35 + 10 * i, 100] }] }));
  const pools = [];
  let reference;
  for (const size of [1, 2, 4]) {
    const pool = Array.from({ length: size }, () => new LatestWorker(new URL('../../web/drawworker.js', import.meta.url)));
    try {
      const runPool = async () => {
        const outputs = new Array(jobs.length);
        await Promise.all(pool.map(async (queue, worker) => {
          for (let i = worker; i < jobs.length; i += size) {
            outputs[i] = (await queue.run('build', topo, jobs[i])).built;
          }
        }));
        return outputs;
      };
      let started = performance.now();
      const output = await runPool(), coldMs = round(performance.now() - started);
      started = performance.now();
      await runPool();
      const warmMs = round(performance.now() - started);
      const signature = JSON.stringify(output);
      if (reference && reference !== signature) throw new Error('Worker count changed independent outputs');
      reference = signature;
      pools.push({ workers: size, coldMs, warmMs });
    } finally { pool.forEach((q) => q.dispose()); }
  }
  rows.push({ faces: topo.nFaces, topologyMs, legacy: legacy && { coldMs: legacy.coldMs, warmMs: legacy.warmMs },
    indexed: { coldMs: indexed.coldMs, warmMs: indexed.warmMs },
    discardedPropMs: prop.warmMs, drawPadOnlyMs: draw.warmMs, pools });
  console.log(JSON.stringify(rows.at(-1)));
}
Deno.mkdirSync(new URL('../../out/', import.meta.url), { recursive: true });
Deno.writeTextFileSync(new URL('../../out/draw-performance.json', import.meta.url), JSON.stringify({
  runtime: Deno.version, platform: Deno.build, baseline: baselinePath ? fileURLToPath(pathToFileURL(baselinePath)).split(/[\\/]/).at(-1) : null,
  workload: 'Dense 120mm square cantilever plate; eight independent walls. Pool trial does not merge or resolve inter-wall collisions.', rows,
}, null, 2) + '\n');
