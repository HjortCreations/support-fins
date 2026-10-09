import { buildSwayBraces } from '../web/sway.js';
import { LatestWorker } from '../web/worker-queue.js';
import { blockTopo, analyze, assert, assertClose, isClosed } from './_util.js';
const ID = [1,0,0,0,1,0,0,0,1];

Deno.test('full Sway depth is opt-in and uses the selected percentage for metre-high ribs', () => {
  const topo = blockTopo(-80,80,-60,60,0,1000), res = analyze(topo,45,ID);
  for (const uncappedDepth of [false,true]) {
    const b = buildSwayBraces(topo,res,ID,{ tines:true, layerHeight:0.6, reach:0.15, uncappedDepth });
    assert(b.count >= 2 && isClosed(b.triangles));
    for (const r of b.ribs) {
      assertClose(r.depth,uncappedDepth ? r.height*0.15 : 60,1e-6);
      assert(r.tines >= 3 && r.th >= 2.4);
    }
  }
});

Deno.test('full Sway depth reaches the cached background Auto worker', async () => {
  const topo=blockTopo(-80,80,-60,60,0,1000), result=analyze(topo,45,ID);
  const queue=new LatestWorker(new URL('../web/drawworker.js',import.meta.url));
  try {
    for (const uncappedDepth of [true,false]) {
      const reply=await queue.run('auto',topo,{kind:'auto',rot:ID,result,
        opts:{mode:'auto',tines:true,layerHeight:0.6,sway:{on:true,reach:0.15,uncappedDepth}}});
      assert(reply.built.sway.count>=2);
      for (const r of reply.built.sway.braces) assertClose(r.depth,uncappedDepth ? r.height*0.15 : 60,1e-6);
    }
  } finally {queue.dispose();}
});
