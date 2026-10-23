/**
 * The parked models' fins (ui/models.js), kept to the plate's settings. The settings
 * are the plate's, so a change made on the live model is a change to every model on
 * it: each parked one is rebuilt here, one at a time in a Worker of its own (the live
 * model's build has finbuild.js's), without being made live -- the panels and the
 * view stay on the model being edited. A parked model's fins stay on screen, greyed,
 * until its new ones land.
 *
 * A build is what the live model's would be in its place: its pose analysed at the
 * plate's threshold, Auto's walls less the fins it had removed (finkeys.js), its
 * hand-placed supports re-stood (walls.js sweepDrawn), and its pad. A plate's 3MF
 * writes them as they stand (`added`, ui/export.js), once parkedSettled.
 */
import * as THREE from 'three';
import { analyze } from '../overhangs.js';
import { findIslands } from '../islands.js';
import {reportTask} from './background.js';
import { assignKeys, matchRemoved } from './finkeys.js';
import { finOpts, workerTopology, buildPending } from './finbuild.js';
import {requestsFor,manualOptions,applyDrawItems} from './walls.js';
import { threshold } from './part.js';
import { finMode, finsVisible, autoLike } from './settings.js';
import { settingsKey } from './history.js';
import { ghostFins, ghostLook } from './plateview.js';
import { currentPlate, isBusy, redraw } from './plates.js';

let worker;          // undefined = not tried yet, null = unavailable, else a Worker
let job = null;      // the build in flight: { id, m, s (its stash), key, topo, res, rot, mesh, opts }
let gen = 0;         // per request: a reply for another one is dropped
let timer = null;

/** The plate's settings may have changed (a support build was asked for): grey the
 *  parked fins built under others, and rebuild them once the edits settle. */
export function scheduleParked() {
  clearTimeout(timer);
  timer = setTimeout(next, 150);
}

const parked = (m) => {
  const plate = currentPlate();
  return m.stash && plate.models.includes(m) && plate.models[plate.live] !== m;
};
// still parked as it was when its build began: not made live and parked again since,
// in another pose
const current = (j) => parked(j.m) && j.m.stash === j.s;

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until every parked model of the plate being edited has fins built under
 *  its settings, and the live one's build is in (an export writes them as they
 *  are). False when that takes past `ms`: the caller makes each live instead. */
export async function parkedSettled(ms = 120000) {
  const t0 = performance.now();
  for (;;) {
    const key = settingsKey(), plate = currentPlate();
    if (!job && !buildPending() && plate.models.every((m) => !parked(m) || m.stash.finsKey === key)) return true;
    if (performance.now() - t0 > ms) return false;
    if (!job && !timer) scheduleParked();
    await tick(50);
  }
}

function next() {
  timer = null;
  // an export makes each model live and parks it built: wait for it
  if (isBusy()) { scheduleParked(); return; }
  const key = settingsKey(), plate = currentPlate();
  for (const m of plate.models) if (m.stash?.fins && parked(m)) ghostLook(m.stash.fins, m.stash.finsKey === key);
  if (job) {
    if (job.key === key && current(job)) return;      // its reply calls next
    worker?.terminate();                              // built for settings since changed
    worker = undefined;
    job = null;
  }
  const m = plate.models.find((s) => parked(s) && s.stash.finsKey !== key);
  if (m) build(m, key);
  else reportTask('parked',false,plate.models.some(m=>parked(m)&&m.stash.buildError)?new Error('A parked model needs retry'):null);
}

addEventListener('retry-supports',()=>{for(const m of currentPlate().models)if(m.stash){m.stash.finsKey=null;m.stash.buildError=false;}
  reportTask('parked',false);scheduleParked();});
function build(m,key){
  const s=m.stash,mesh=s.part.mesh,topo=s.part.topology;
  s.buildError=false;
  if(!finsVisible){land({m,s,key},null);return;}
  const rot=new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(mesh.quaternion)).elements;
  const res=analyze(topo,threshold,rot),opts=finOpts(finMode==='full'?findIslands(topo,res,rot):undefined);
  const at=new THREE.Vector3(res.offset.x,res.offset.y,res.offset.z);
  const manual={requests:requestsFor(s.state.walls,(v,out)=>out.copy(v).applyQuaternion(mesh.quaternion).add(at)),
    options:manualOptions(),removed:s.state.removedSigs};
  job={id:++gen,m,s,key,topo,res,rot,mesh,opts,manual,attempt:0};reportTask('parked',true);send(job);
}
function send(j){
  try{getWorker().postMessage({id:j.id,topology:workerTopology(j.topo),result:j.res,rot:j.rot,opts:j.opts,manual:j.manual});}
  catch(error){failed(j,error);}
}
function failed(j,error){
  worker?.terminate();worker=undefined;
  if(!current(j)||settingsKey()!==j.key){job=null;reportTask('parked',false);scheduleParked();return;}
  if(j.attempt++<1){send(j);return;}
  console.error('Background parked model calculation failed',error);j.s.buildError=true;reportTask('parked',false,error);land(j,null);
}
function getWorker(){
  if(worker)return worker;
  worker=new Worker(new URL('../finworker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data})=>{const j=job;if(!j||data.id!==j.id)return;
    if(data.error){failed(j,new Error(data.error));return;}reportTask('parked',false);land(j,data.built);};
  worker.onerror=e=>{e.preventDefault();if(job)failed(job,new Error('Background parked model worker failed'));};
  return worker;
}

/** `built` (null: fins off) becomes `j.m`'s parked fins, unless it was made live,
 *  taken off, or the settings changed meanwhile. */
function land(j, built) {
  job = null;
  const { m, key } = j;
  if (!current(j) || settingsKey() !== key) { scheduleParked(); return; }
  const s = m.stash, tris = [];
  if (built) {
    // Auto's walls, less the fins this model had removed (ui/remove.js adoptFins)
    let gone = new Set();
    if (finMode !== 'draw') {
      const records = assignKeys((built.fins ?? []).map((f) => ({ ...f })));
      gone = new Set(matchRemoved(records, new Set(s.state.removedSigs)).keys());
      for (const r of records) {
        if (gone.has(r.id)) continue;
        for (const [lo, hi] of r.triRanges ?? []) for (let t = lo; t < hi; t++) tris.push(built.triangles[t]);
      }
    }
    // its hand-placed supports where walls.js drawShown would show them
    const walls = s.state.walls;
    if (walls.length && (finMode === 'draw' || autoLike())) {
      if(built.manual){applyDrawItems(walls,built.manual.items);for(const t of built.manual.triangles)tris.push(t);}
    }
    for (const t of built.padTriangles ?? []) tris.push(t);
  }
  if (s.fins) { s.fins.removeFromParent(); s.fins.geometry.dispose(); }
  s.fins = tris.length ? ghostFins(tris) : null;
  s.added = tris;
  s.finsKey = key;
  redraw();
  scheduleParked();
}
