import { LatestWorker } from '../web/worker-queue.js';
import { buildDrawn } from '../web/draw-build.js';
import { PERP } from '../web/fins/wedges.js';
import { loadModel, analyze, fins, prop, block, buildTopology, blockTopo, assert, isClosed, isOriented, rotX } from './_util.js';
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function settings(fn) {
  const objects = [fins.FIN, prop.PROP, PERP], saved = objects.map((o) => ({ ...o }));
  try { return fn(); } finally { objects.forEach((o, i) => Object.assign(o, saved[i])); }
}

Deno.test('Draw builds only the pad and seating, identical to the legacy prop path', () => settings(() => {
  for (const [name, angle] of [['cube', 40], ['sphere', 0], ['cone', 180]]) {
    const topo = loadModel(name), rot = rotX(angle), result = analyze(topo, 45, rot);
    for (const bedPad of [true, false]) {
      const opts = { bedPad, tines: true, layerHeight: 0.2, tunables: { padStyle: 'auto' } };
      const old = fins.buildFins(topo, result, rot, { ...opts, mode: 'prop' });
      const draw = fins.buildFins(topo, result, rot, { ...opts, mode: 'draw', sway: { on: true } });
      assert(!draw.triangles.length && !draw.fins.length && !draw.sway, 'Draw placed automatic supports');
      for (const key of ['padTriangles', 'pad', 'seating', 'floating']) {
        assert(JSON.stringify(draw[key]) === JSON.stringify(old[key]), `${name}: ${key} changed`);
      }
    }
  }
}));

Deno.test('Draw worker forwards Plate only and refuses supports standing on the part', async () => {
  const pos = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
  const topo = buildTopology({ getAttribute: (k) => k === 'position' ? { array: pos } : null });
  const options = { tunables: { nozzle: 0.4, wallLines: 2, baseThickness: 1, baseSpread: 0, baseStyle: 'taper' },
    draw: { tines: false, plateOnly: false }, sway: {} };
  const queue = new LatestWorker(new URL('../web/drawworker.js', import.meta.url));
  try {
    const job = { kind: 'build', rot: ID, result: { offset: { x: 0, y: 0, z: 0 } }, options,
      requests: [{ a: [-30, 0, 35], b: [30, 0, 35] }] };
    const off = await queue.run('build', topo, job);
    assert(off.built.items[0].ok && off.built.items[0].info.partAttached);
    const on = await queue.run('build', topo, { ...job,
      options: { ...options, draw: { ...options.draw, plateOnly: true } } });
    assert(!on.built.items[0].ok && /Plate only/.test(on.built.items[0].info.reason));
    assert(!on.built.triangles.length, 'refused support leaked into export geometry');
  } finally { queue.dispose(); }
});

class FakeWorker {
  messages = [];
  postMessage(data) { this.messages.push(data); }
  terminate() { this.terminated = true; }
  reply(data = {}) { this.onmessage({ data: { id: this.messages.at(-1).id, built: data } }); }
}

Deno.test('worker queue keeps latest preview, prioritizes builds and sends each model once', async () => {
  const worker = new FakeWorker(), queue = new LatestWorker('', () => worker), model = { pos: [], _insideGrid: { cell: () => 0 } };
  const active = queue.run('preview', model, { n: 1 });
  const dropped = queue.run('preview', model, { n: 2 });
  const latest = queue.run('preview', model, { n: 3 });
  const build = queue.run('build', model, { n: 4 });
  assert(await dropped === null);
  assert(!('_insideGrid' in worker.messages[0].model), 'sent a non-cloneable cache');
  worker.reply();
  assert(await active === null, 'stale preview was applied');
  assert(worker.messages[1].job.n === 4, 'preview delayed a committed build');
  assert(worker.messages[1].model === undefined, 'cloned the mesh again');
  worker.reply(); assert(await build !== null);
  assert(worker.messages[2].job.n === 3);
  worker.reply(); assert(await latest !== null);
  queue.dispose();
});

Deno.test('worker queue invalidates cancelled and replaced models, and restarts after failure', async () => {
  const workers = [], queue = new LatestWorker('', () => { const w = new FakeWorker(); workers.push(w); return w; });
  const old = queue.run('build', { pos: [1] }, {});
  const model = { pos: [2] }, fresh = queue.run('build', model, {});
  assert(await old === null && workers[0].terminated);
  workers[0].onerror();
  assert(!workers[1].terminated, 'late error from a retired worker killed the new model');
  queue.cancel('build'); workers[1].reply(); assert(await fresh === null);
  const failed = queue.run('build', model, {});
  workers[1].onerror();
  let caught = false;
  try { await failed; } catch { caught = true; }
  assert(caught && workers[1].terminated, 'worker failure hung or ran an inline fallback');
  const retry = queue.run('build', model, {});
  assert(workers.length === 3 && workers[2].messages[0].model.pos[0] === 2);
  workers[2].reply(); assert(await retry !== null);
  queue.dispose();
});

Deno.test('real Draw worker matches direct geometry, caches poses and owns closed reinforced ranges', async () => {
  const topo = blockTopo(-60, 60, -30, 30, 100, 110);
  const result = { offset: { x: 0, y: 0, z: 0 } };
  const requests = [{ a: [-40, 0, 100], b: [40, 0, 100] }];
  const options = { tunables: { nozzle: 1.6, wallLines: 4, baseStyle: 'cross', baseThickness: 2, crossReach: 20 },
    draw: { tines: false, layerHeight: 0.6 }, sway: {} };
  const direct = settings(() => buildDrawn(topo, result, ID, requests, options));
  const queue = new LatestWorker(new URL('../web/drawworker.js', import.meta.url));
  try {
    const job = { kind: 'build', rot: ID, result, requests, options };
    const reply = await queue.run('build', topo, job);
    assert(JSON.stringify(reply.built) === JSON.stringify(direct), 'worker changed manual geometry');
    assert(reply.built.items[0].ok && reply.built.items[0].info.baseReinforcement.cross);
    assert(isClosed(reply.built.triangles) && isOriented(reply.built.triangles));
    assert(reply.built.items[0].triEnd * 3 === reply.built.triangles.length, 'reinforcement has no owner');
    const second = await queue.run('build', topo, job);
    assert(JSON.stringify(second.built) === JSON.stringify(reply.built), 'cached build changed geometry');
    const preview = await queue.run('preview', topo, { ...job, kind: 'preview', ...requests[0] });
    assert(preview.built.ok && isClosed(preview.built.tris));
    const moved = await queue.run('build', topo, { ...job, result: { offset: { x: 10, y: 0, z: 0 } },
      requests: [{ a: [-30, 0, 100], b: [50, 0, 100] }] });
    assert(moved.built.items[0].ok, 'pose cache did not update');
  } finally { queue.dispose(); }
});
