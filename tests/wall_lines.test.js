import { applyNozzle, nozzle, wallLines } from '../web/nozzle.js';
import { PERP } from '../web/fins/wedges.js';
import { sweep } from '../web/prop/sweep.js';
import { SWAY, buildSwayBraces, swayAtFace, swayClashesWall } from '../web/sway.js';
import { drawnWall } from '../web/draw.js';
import { writeThreeMF, readThreeMF } from '../web/threemf.js';
import { writeBinarySTL } from '../web/stl.js';
import { block, blockTopo, tiltedBlockTopo, analyze, fins, prop, bbox, isClosed,
  isOriented, assert, assertClose, insideCount, readSTL } from './_util.js';
const ID = [1,0,0,0,1,0,0,0,1];
const post = () => blockTopo(-80,80,-60,60,0,1000);
const gauge = (d,n) => d*1.1*n;

Deno.test('wall lines: measured walls keep upstream structural and contact floors at every choice', () => {
  try {
    for (const d of [0.2,0.25,0.4,0.6,0.8,1,1.2,1.6,2,2.4,3]) for (const n of [2,4,6,8]) {
      applyNozzle(d,n);
      const grow=Math.max(1,d/0.4), out=[];
      assert(sweep([[-40,0,100],[40,0,100]],0,out));
      const body=out.filter(v=>v[2]>prop.PROP.baseH && v[2]<99);
      assertClose(bbox(body).hi[1]-bbox(body).lo[1],Math.max(grow,gauge(d,n)),1e-6);
      assertClose(PERP.th,Math.max(1.2*grow,gauge(d,n)),1e-9);
      assertClose(prop.PROP.tip,0.6*d/0.4,1e-9);
      assertClose(prop.PROP.tineW,0.5*d/0.4,1e-9);
      assertClose(SWAY.tineW,prop.PROP.tineW,1e-9);
      assertClose(SWAY.wallHalf,3.6+(PERP.th-1.2)/2,1e-9);
      assert(isClosed(out) && isOriented(out));
    }
  } finally { applyNozzle(0.4); }
});

Deno.test('wall lines: Sway minimum respects actual height and the scaled print-tested floor', () => {
  try {
    for (const d of [0.2,0.4,0.8,1.6,3]) for (const n of [2,4,6,8]) for (const h of [50,249,1000]) {
      applyNozzle(d,n);
      const topo=blockTopo(-80,80,-60,60,0,h), result=analyze(topo,45,ID);
      const b=buildSwayBraces(topo,result,ID,{tines:true,layerHeight:0.6});
      assert(b.count>=2, `${d}/${n}/${h}: no braces`);
      for (const r of b.ribs) {
        assertClose(r.th,Math.max(gauge(d,n),Math.min(2.4,1.2+0.004*r.height)*Math.max(1,d/0.4)),1e-8);
        assert(r.tines>=3 && r.depth<=60 && r.height<=h);
      }
    }
  } finally { applyNozzle(0.4); }
});

Deno.test('wall lines: invalid inputs leave state unchanged and two lines restore upstream dimensions', () => {
  try {
    applyNozzle(1.6,8);
    const state=()=>JSON.stringify([nozzle,wallLines,prop.PROP,PERP,SWAY]);
    const before=state();
    for(const [d,n] of [[NaN,2],[0,2],[3.1,2],['1.6',4],[1.6,3],[1.6,NaN]]) applyNozzle(d,n);
    assert(state()===before);
    applyNozzle(0.4);
    assert(prop.PROP.th===1 && PERP.th===1.2 && SWAY.thMin===1.2 && SWAY.thMax===2.4);
  } finally { applyNozzle(0.4); }
});

Deno.test('wall lines: reused engine resets only the optional line count, retaining nozzle and clearance', () => {
  try {
    for (const t of [undefined,null,{}, {nozzle:0.8}, {propGap:0.3}]) {
      fins.applyTunables({nozzle:0.8,wallLines:8,propGap:0.3});
      fins.applyTunables(t);
      assert(nozzle===0.8 && wallLines===2 && prop.PROP.th===2 && prop.PROP.gap===0.3);
    }
  } finally { applyNozzle(0.4); fins.applyTunables({propGap:0.2}); }
});

Deno.test('wall lines: Draw and flat-interface crests use the chosen body gauge with upstream contacts', () => {
  try {
    for (const iface of [false,'flat']) {
      fins.applyTunables({nozzle:1.6,wallLines:6,iface});
      const r=drawnWall([-40,0,100],[40,0,100],block(-60,60,-30,30,100,110),0,{tines:false,layerHeight:0.6});
      assert(r.ok,r.reason);
      const {body,iface:contact}=prop.splitInterface(r.tris);
      const wall=body.filter(v=>v[2]>1 && v[2]<100);
      assert(wall.length>0);
      assertClose(bbox(wall).hi[1]-bbox(wall).lo[1],gauge(1.6,6),1e-6);
      assert(isClosed(r.tris) && isOriented(r.tris));
      if(iface) {
        assert(contact.length>0 && isClosed(contact));
        const top=Math.max(...contact.map(v=>v[2])), edge=contact.filter(v=>Math.abs(v[2]-top)<1e-6);
        assertClose(bbox(edge).hi[1]-bbox(edge).lo[1],gauge(1.6,6),1e-6);
      }
    }
  } finally { applyNozzle(0.4); fins.applyTunables({iface:false}); }
});

Deno.test('wall lines: Auto and Full large-nozzle supports retain closed geometry and exact ownership', () => {
  try {
    const topo=tiltedBlockTopo(-80,80,-60,60,0,120,40), result=analyze(topo,45,ID);
    for(const mode of ['auto','full']) for(const d of [1.6,3]) {
      const b=fins.buildFins(topo,result,ID,{mode,tines:true,layerHeight:0.6,tunables:{nozzle:d,wallLines:8}});
      assert(b.triangles.length>0 && isClosed(b.triangles) && isOriented(b.triangles));
      assert(b.triangles.every(v=>v.every(Number.isFinite)));
      const claims=new Uint8Array(b.triangles.length);
      for(const f of b.fins) for(const [lo,hi] of f.triRanges) for(let i=lo;i<hi;i++)claims[i]++;
      assert(claims.every(n=>n===1),'unowned or multiply-owned geometry');
    }
  } finally { applyNozzle(0.4); }
});

Deno.test('wall lines: enlarged footprints still refuse neighbouring supports and clear the part', () => {
  try {
    applyNozzle(3,8);
    const topo=post(), result=analyze(topo,45,ID);
    const face=Array.from({length:topo.nFaces},(_,i)=>i).find(i=>topo.nrm[i*3+1]<-0.9);
    const opts={tines:true,layerHeight:0.6,iface:'all'}, r=swayAtFace(topo,result,ID,face,[0,-60,400],opts);
    assert(r.ok,r.reason);
    assert(insideCount(topo,ID,result.offset,prop.splitInterface(r.tris).body.map(v=>[v[0],v[1],Math.max(v[2],0.001)]))===0);
    const p=r.foot[0].map((v,i)=>v+0.5*(r.foot[1][i]-v)), walls=[[[p[0]-10,p[1],0],[p[0]+10,p[1],0]]];
    assert(swayClashesWall(r,walls));
    assert(!swayAtFace(topo,result,ID,face,[0,-60,400],opts,{walls}).ok);
  } finally { applyNozzle(0.4); }
});

Deno.test('wall lines: real Auto worker matches page gauge and resets across requests', async () => {
  const topology=post(), result=analyze(topology,45,ID);
  const worker=new Worker(new URL('../web/finworker.js',import.meta.url).href,{type:'module'});
  try {
    let id=0;
    for(const n of [8,2,6,undefined]) {
      const opts={mode:'auto',tines:true,layerHeight:0.6,sway:{on:true,uncappedDepth:true},tunables:{nozzle:1.6,wallLines:n,iface:'all'}};
      const wireTopo={...topology};delete wireTopo._insideGrid;
      const reply=await new Promise((resolve,reject)=>{
        worker.onmessage=({data})=>resolve(data);worker.onerror=e=>reject(new Error(e.message));
        worker.postMessage({id:++id,topology:wireTopo,result,rot:ID,opts});
      });
      assert(!reply.error,reply.error);
      assert(reply.built.sway.count>=2);
      for(const r of reply.built.sway.braces) {
        assert(Number.isFinite(r.th));assertClose(r.th,Math.max(9.6,gauge(1.6,n??2)),1e-8);
      }
      assert(JSON.stringify(reply.built.triangles)===JSON.stringify(fins.buildFins(topology,result,ID,opts).triangles));
    }
  } finally { worker.terminate(); applyNozzle(0.4); fins.applyTunables({iface:false}); }
});

Deno.test('wall lines: metre-high supports retain contacts, ownership and STL/component 3MF export', async () => {
  try {
    const topo=post(), result=analyze(topo,45,ID);
    const b=fins.buildFins(topo,result,ID,{mode:'auto',tines:true,layerHeight:0.6,sway:{on:true},tunables:{nozzle:3,wallLines:8,iface:'all'}});
    assert(b.sway.count>=2);
    const {body,iface}=prop.splitInterface(b.triangles);
    assert(isClosed(body) && isClosed(iface) && isOriented(body) && isOriented(iface));
    assert(iface.length/36===b.sway.tines);
    assert(insideCount(topo,ID,result.offset,body.map(v=>[v[0],v[1],Math.max(v[2],0.001)]))===0);
    const claims=new Uint8Array(b.triangles.length);
    for(const f of b.fins) for(const [lo,hi] of f.triRanges) {
      assert(isClosed(b.triangles.slice(lo,hi)));
      for(let i=lo;i<hi;i++)claims[i]++;
    }
    assert(claims.every(n=>n===1));
    assert(readSTL(new Uint8Array(await writeBinarySTL(b.triangles).arrayBuffer())).length===b.triangles.length*3);
    const part=Array.from({length:topo.pos.length/3},(_,i)=>Array.from(topo.pos.slice(i*3,i*3+3)));
    const data=new Uint8Array(await writeThreeMF(part,body,'synthetic-post',{separate:true,iface,session:{v:1,form:{'wall-lines':'8'}}}).arrayBuffer());
    const loaded=await readThreeMF(data);
    assert(loaded.session.form['wall-lines']==='8');
    assert(loaded.objects[1].positions.length===b.triangles.length*3);
  } finally { applyNozzle(0.4); fins.applyTunables({iface:false}); }
});
