import { assert, block, buildTopology, blockTopo, analyze } from './_util.js';
import { buildDrawn } from '../web/draw-build.js';
import { DrawPool } from '../web/draw-pool.js';
import { LatestWorker } from '../web/worker-queue.js';
import { applyNozzle } from '../web/nozzle.js';
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], result = { offset: { x: 0, y: 0, z: 0 } };
const model = () => blockTopo(-60, 60, -60, 60, 100, 110);
const jobFor = () => ({ kind: 'build', rot: ID, result,
  options: { tunables: { propGap: 0.2 }, draw: { tines: true, layerHeight: 0.2 }, sway: {} },
  requests: Array.from({ length: 8 }, (_, i) => ({ a: [-40, -35 + i * 10, 100], b: [40, -35 + i * 10, 100] })) });

Deno.test('upstream nozzle changes reach reused 1/2/4-worker Draw lanes and retain interfaces', async () => {
  const topo=model(), job=jobFor();
  try {
    for(const width of [1,2,4]) {
      const pool=new DrawPool(topo,{cores:8,memory:8});pool.policy.width=width;
      try {
        let previous;
        for(const nozzle of [0.4,0.8,1.2,0.4]) {
          job.options.tunables={nozzle,propGap:0.2,iface:'all'};
          const direct=buildDrawn(topo,result,ID,job.requests,job.options);
          assert(direct.items.every(i=>i.ok));
          const soup=JSON.stringify(direct.triangles);
          if(previous)assert(soup!==previous,'nozzle change did not resize supports');
          previous=soup;
          const reply=await pool.build(job,()=>buildDrawn(topo,result,ID,job.requests,job.options));
          assert(!reply.fallback,reply.fallback);
          const built=reply.built??buildDrawn(topo,result,ID,job.requests,job.options,{},null,reply.candidates);
          assert(JSON.stringify(built)===JSON.stringify(direct),'worker retains stale nozzle or loses tags/ranges');
        }
      } finally {pool.dispose();}
    }
  } finally {applyNozzle(0.4);}
});

Deno.test('cached coordinator preserves upstream full Sway depth and scaled thickness', async () => {
  const topo=blockTopo(-80,80,-60,60,0,1000), res=analyze(topo,45,ID);
  const queue=new LatestWorker(new URL('../web/drawworker.js',import.meta.url));
  const face=Array.from({length:topo.nFaces},(_,i)=>i).find(i=>topo.nrm[i*3+1]<-0.9);
  try {
    for(const uncappedDepth of [true,false,true]) {
      const options={tunables:{nozzle:0.8,iface:'all'},draw:{},sway:{tines:true,iface:'all',layerHeight:0.6,uncappedDepth:true}};
      options.sway.uncappedDepth=uncappedDepth;
      const job={kind:'build',hardware:{cores:8,memory:8},rot:ID,result:res,options,requests:[{kind:'sway',face,a:[0,-60,400]}]};
      const reply=await queue.run('build',topo,job), direct=buildDrawn(topo,res,ID,job.requests,options);
      assert(reply.built.items[0].ok,reply.built.items[0].info.reason);
      const r=reply.built.items[0].info;
      assert(Number.isFinite(r.th) && Math.abs(r.th-4.8)<1e-9);
      assert(Number.isFinite(r.depth) && Math.abs(r.depth-(uncappedDepth?r.height*0.15:60))<1e-6);
      assert(JSON.stringify(reply.built)===JSON.stringify(direct));
    }
  } finally {queue.dispose();applyNozzle(0.4);}
});

Deno.test('upstream interface tags survive serial/parallel Draw and 3MF session export', async () => {
  const { splitInterface } = await import('../web/prop.js');
  const { writeThreeMF, readThreeMF } = await import('../web/threemf.js');
  const topo = model(), job = jobFor();
  for (const iface of [false, 'flat', 'all', false]) {
    job.options.tunables.iface = iface;
    const direct = buildDrawn(topo, result, ID, job.requests, job.options);
    const split = splitInterface(direct.triangles);
    assert(!!split.iface.length === !!iface, 'interface mode was lost or stuck on');
    for (const width of [1, 2, 4]) {
      const pool = new DrawPool(topo, { cores: 8, memory: 8 });
      pool.policy.width = width;
      try {
        const reply = await pool.build(job, () => buildDrawn(topo, result, ID, job.requests, job.options));
        const built = reply.built ?? buildDrawn(topo, result, ID, job.requests, job.options, {}, null, reply.candidates);
        assert(JSON.stringify(built) === JSON.stringify(direct), 'worker count changed interface tags or ownership');
      } finally { pool.dispose(); }
    }
    const session = { v: 1, finMode: 'draw', walls: job.requests, form: { iface: iface || 'off' } };
    const blob = writeThreeMF([[0, 0, 0], [1, 0, 0], [0, 1, 0]], split.body, 'worker-interface',
      { separate: true, iface: split.iface, session });
    const loaded = await readThreeMF(new Uint8Array(await blob.arrayBuffer()));
    assert(JSON.stringify(loaded.session) === JSON.stringify(session), '3MF lost the Draw session');
    assert(loaded.objects[1].positions.length / 3 === direct.triangles.length, '3MF lost body or interface geometry');
  }
});

Deno.test('real 1/2/4-worker candidates preserve exact merged triangles, ownership and mixed Sway order', async () => {
  const topo = model(), job = jobFor();
  // A rejected Sway and rejected ordinary wall exercise ordered result slots too.
  job.requests.splice(2, 0, { kind: 'sway', face: 0, a: [0, 0, 100] });
  job.requests.push({ a: [200, 0, 100], b: [220, 0, 100] });
  const direct = buildDrawn(topo, result, ID, job.requests, job.options);
  for (const width of [1, 2, 4]) {
    const pool = new DrawPool(topo, { cores: 8, memory: 8 });
    pool.policy.width = width;
    try {
      for (let repeat = 0; repeat < 2; repeat++) {
        const reply = await pool.build(job, () => buildDrawn(topo, result, ID, job.requests, job.options));
        assert(!reply.fallback, reply.fallback);
        const built = reply.built ?? buildDrawn(topo, result, ID, job.requests, job.options, {}, null, reply.candidates);
        assert(JSON.stringify(built) === JSON.stringify(direct), 'worker count changed geometry or ranges');
        assert(built.items.at(-1).triEnd * 3 === built.triangles.length);
      }
    } finally { pool.dispose(); }
  }
});

Deno.test('cached coordinator handles model and pose changes, controls, Plate only and Auto before Draw', async () => {
  const topo = model(), job = jobFor();
  const queue = new LatestWorker(new URL('../web/drawworker.js', import.meta.url));
  try {
    queue.control({ restricted: true });
    const reply = await queue.run('build', topo, { ...job, hardware: { cores: 32, memory: 8 } });
    assert(reply.workers === 1);
    assert(JSON.stringify(reply.built) === JSON.stringify(buildDrawn(topo, result, ID, job.requests, job.options)));
    const shifted = { ...job, result: { offset: { x: 10, y: 0, z: 0 } },
      requests: job.requests.map((w) => ({ a: w.a.map((n, k) => k ? n : n + 10), b: w.b.map((n, k) => k ? n : n + 10) })) };
    const moved = await queue.run('build', topo, shifted);
    assert(JSON.stringify(moved.built) === JSON.stringify(buildDrawn(topo, shifted.result, ID, shifted.requests, job.options)));
    const auto = await queue.run('auto', topo, { kind: 'auto', rot: ID, result: analyze(topo, 45, ID),
      opts: { mode: 'draw', bedPad: false } });
    assert(auto.built.triangles.length === 0 && auto.workers === 1);
    const pos = new Float32Array([...block(-40, 40, -10, 10, 0, 5), ...block(-40, 40, -10, 10, 35, 39)]);
    const other = buildTopology({ getAttribute: () => ({ array: pos }) });
    const wall = { ...job, requests: [{ a: [-30, 0, 35], b: [30, 0, 35] }],
      options: { ...job.options, draw: { tines: false, plateOnly: true } } };
    const refused = await queue.run('build', other, wall);
    assert(!refused.built.items[0].ok && !refused.built.triangles.length);
    const attached = await queue.run('build', other, { ...wall,
      options: { ...wall.options, draw: { tines: false, plateOnly: false } } });
    assert(attached.built.items[0].ok && attached.built.items[0].info.partAttached);
  } finally { queue.dispose(); }
});

Deno.test('parallel wall candidates cannot reorder accepted and colliding Sway braces', async () => {
  const topo = blockTopo(-20, 20, -20, 20, 0, 200), job = jobFor();
  job.options.sway = { tines: true, gap: 0.2, tineSpacing: 6, layerHeight: 0.2 };
  const brace = { kind: 'sway', face: 4, a: [0, -20, 100] };
  job.requests.splice(0, 0, brace);
  job.requests.push({ ...brace });
  const direct = buildDrawn(topo, result, ID, job.requests, job.options);
  assert(direct.items[0].ok, direct.items[0].info.reason);
  assert(!direct.items.at(-1).ok, 'duplicate brace must be refused');
  const pool = new DrawPool(topo, { cores: 8, memory: 8 });
  pool.policy.width = 4;
  try {
    const reply = await pool.build(job, () => { throw new Error('unexpected serial'); });
    assert(!reply.fallback);
    const parallel = buildDrawn(topo, result, ID, job.requests, job.options, {}, null, reply.candidates);
    assert(JSON.stringify(parallel) === JSON.stringify(direct), 'Sway collision order changed');
  } finally { pool.dispose(); }
});
