import { LatestWorker } from '../web/worker-queue.js';
import { blockTopo, assert, isClosed, isOriented } from './_util.js';
const ID = [1,0,0,0,1,0,0,0,1];
Deno.test('Draw worker: Cross reach edits rebuild the cached model and its export triangles', async () => {
  const topo = blockTopo(-60, 60, -30, 30, 100, 110);
  const queue = new LatestWorker(new URL('../web/drawworker.js', import.meta.url));
  const job = { kind: 'build', rot: ID, result: { offset: { x: 0, y: 0, z: 0 } },
    requests: [{ a: [-40, 0, 100], b: [40, 0, 100] }], options: {
      tunables: { nozzle: 1.6, wallLines: 4, baseStyle: 'cross', baseThickness: 1, crossReach: 20 },
      draw: { tines: false }, sway: {} } };
  try {
    const a = (await queue.run('build', topo, job)).built;
    const b = (await queue.run('build', topo, { ...job, options: { ...job.options,
      tunables: { ...job.options.tunables, crossReach: 80 } } })).built;
    for (const [built, reach] of [[a, 20], [b, 80]]) {
      const r = built.items[0].info.baseReinforcement;
      assert(r.cross && r.crossRequested === reach && r.crossLeft === reach && r.crossRight === reach);
      const width = Math.max(...built.triangles.map((p) => p[1])) - Math.min(...built.triangles.map((p) => p[1]));
      assert(width > reach * 2, 'updated reach did not reach the exported mesh');
      assert(isClosed(built.triangles) && isOriented(built.triangles));
    }
    assert(JSON.stringify(a.triangles) !== JSON.stringify(b.triangles), 'cached worker ignored the new reach');
  } finally { queue.dispose(); }
});
