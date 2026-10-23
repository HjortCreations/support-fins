/**
 * Building the supports: the request options, the background Worker,
 * and turning a finished buildFins result into the fin and pad meshes
 * on screen. Owns the last build and the triangles the export reads.
 */
import * as THREE from 'three';
import { FIN, PAD } from '../fins.js';
import { BRACE, PROP } from '../prop.js';
import { CUT } from '../cutout.js';
import { nozzle, wallLines } from '../nozzle.js';
import { el } from './dom.js';
import { t } from './i18n.js';
import {geometryQueue,reportTask,backgroundError} from './background.js';
export {backgroundError};
import { scene, meshFrom, ifaceMaterial, clip, requestRender } from './scene.js';
import {
  removeMode, syncRemoveUI, cancelRemove, clearFinHover, adoptFins, forgetFins,
} from './remove.js';
import { updateReadout } from './readout.js';
import { islands } from './islands.js';
import {
  drawnTris, drawnMesh, drawMaterial, drawShown, clearPreview, rebuildDrawn, manualPending,
} from './walls.js';
import { finsVisible, finMode, autoLike, baseTunables } from './settings.js';
import { topology, rotM3, lastResult, updateFit } from './part.js';
import { scheduleParked } from './parkedbuild.js';

export let finMesh = null;
export let padMesh = null;
export let finTris = [];
export let padTris = [];

/** Show `tris` as the auto fin mesh, replacing the one on screen (used by per-fin
 *  removal, which re-filters the last build without a worker round-trip). */
export function setFinTris(tris) {
  if (finMesh) { scene.remove(finMesh); finMesh.geometry.dispose(); }
  finTris = tris;
  finMesh = meshFrom(finTris, finMaterial, ifaceMaterial);
}

export const finMaterial = new THREE.MeshStandardMaterial({
  color: 0x59d98e, roughness: 0.7, metalness: 0.0, side: THREE.DoubleSide,
  clippingPlanes: clip,
});
// The pad is not a fin -- it is a modification to how the part meets the plate,
// and the user has to be able to see at a glance which is which before they
// commit to an export.
export const padMaterial = new THREE.MeshStandardMaterial({
  color: 0xe8b64c, roughness: 0.8, metalness: 0.0, side: THREE.DoubleSide,
  clippingPlanes: clip,
});

export let lastBuilt = null;       // last buildFins result, kept for the bed pad + seating readout
/** The walls + pad the CURRENT mode contributes to the export and the fit check. */
export function activeAdded() {
  return [...activeWalls(), ...padTris];
}

/** The walls alone (activeAdded without the pad). */
export function activeWalls() {
  // Both auto modes bake their geometry into finTris (refreshFins' else branch):
  // Suggest → gripping fins + fallback props, Combined fin → gripping fins only.
  // Only Draw leaves it empty and exports the hand-drawn walls instead.
  const auto = finMode === 'draw' ? [] : finTris;
  const drawn = drawShown() ? drawnTris : [];
  return [...auto, ...drawn];
}

/**
 * Regenerate the fins for the current orientation. Fins live in PRINT space
 * (already rotated and seated), not in the part's local frame, so they are added
 * to the scene rather than parented to the part.
 */
// Support generation used to run inline on the main thread, which froze the whole
// page (orbit, buttons, sliders) for however long a build took -- a couple of
// seconds on a large or badly-posed part. buildFins is pure mesh math with no
// DOM/three.js dependency, so it runs in a Worker instead (web/finworker.js): the
// current fins stay on screen, greyed, while the new ones compute, and the UI
// stays live. A generation counter drops the reply from a pose that has since
// been superseded. A failure retries in a fresh worker, then offers Retry.
let finGen = 0;              // bumped per request; a reply with a stale id is ignored
let finT0 = 0;               // start time of the in-flight build, for the readout timing
let lastOpts = null;
let finSpinnerTimer = null;  // shows the spinner only if a build runs past ~1s
let finBusy = false;         // a worker build is outstanding (used to supersede it)
/** A worker build is outstanding: the fins on screen are the last settings', not
 *  the current ones -- Export waits, so a file never carries the wrong ones (#279). */
export const buildPending = () => finBusy || manualPending();

// Reveal the spinner only for builds that actually run long, so a sub-second
// rebuild never flashes it. Cleared the moment the build lands (applyBuilt).
function armSpinner() {
  clearTimeout(finSpinnerTimer);
  // Short delay so a quick build never shows it at all; the 0.5s CSS fade-in (the
  // .show class) then eases it on rather than snapping. The spinner is always in
  // the layout, so toggling the class transitions reliably every time -- the
  // earlier display:none/hidden toggle skipped the fade unpredictably.
  finSpinnerTimer = setTimeout(() => el('spinner').classList.add('show'), 300);
}
function clearSpinner() {
  clearTimeout(finSpinnerTimer);
  finSpinnerTimer = null;
  el('spinner').classList.remove('show');
}

/** The build request for the settings on the page; `isl`, the Full coverage island
 *  starts of the model built (the live one's by default: ui/parkedbuild.js has its
 *  own). */
export function finOpts(isl = islands) {
  return { mode: finMode,
           bedPad: el('bed-pad').value !== 'off',
           plateOnly: el('plate-only').checked,
           longWalls: el('long-walls').checked,   // Full coverage only (fins/rows.js)
           separateWalls: el('separate-walls').checked,   // Full coverage only (#309)
           tallRibs: el('tall-ribs').checked,     // face ribs on tall walls (fins/tall.js)
           // Curved walls (prop/curved.js): Auto and Full only, like sway
           curvedWalls: autoLike() && el('curved-walls').checked ? true : undefined,
           tines: el('tines').checked,
           tineDensity: el('tine-density').valueAsNumber / 100,
           layerHeight: el('layer-height').valueAsNumber,
           // Full coverage walls the island starts too (fins/fill.js): found here, on
           // the page, since the Worker's topology has no vertex ids (deleted below)
           islands: finMode === 'full' ? isl : undefined,
           // Full coverage aims at every reachable overhang: the slider is Auto's
           coverage: finMode === 'full' ? FIN.coverDefault : el('coverage').valueAsNumber / 100,
           // Auto places sway braces itself; in Draw they are clicked on by hand.
           sway: autoLike() && el('sway').checked ? { on: true, ...swayOpts() } : undefined,
           // The clearances have to travel WITH the request: the build runs in a
           // Worker with its own copy of fins.js / prop.js, which never sees what
           // the gap and pad fields set on this page's copy (fins.js
           // applyTunables). Without this, Auto mode always built the defaults.
           tunables: { ...baseTunables(), roundFeet: FIN.roundFeet, padH: FIN.padH,
                       padGrab: PAD.grab, padStyle: PAD.style, padCustom: { ...PAD.custom },
                       propGap: PROP.gap,
                       tallRibsHeight: BRACE.tallH,
                       cutout: CUT.pattern,
                       iface: PROP.iface,
                       // tine direction (#309): resin pins instead of the comb
                       tineDir: PROP.tineDir, pinDepth: PROP.pinDepth,
                       nozzle, wallLines } };
}

/** The engine settings a Worker needs to build what this page would: the same
 *  ones an Auto build sends (Suggest's Worker scores poses with them). */
export function supportTunables() { return finOpts().tunables; }

/** The Sway braces settings. The gap is passed explicitly -- sway.js takes the
 *  clearance (PROP.gap) as an option instead of reading FIN/PROP itself. */
export function swayOpts() {
  const num = (id, d) => (Number.isFinite(el(id).valueAsNumber) ? el(id).valueAsNumber : d);
  return { fitFeature: el('sway-fit').checked, roundFeet: FIN.roundFeet, uncappedDepth: el('full-brace-depth').checked,
           gripFrom: num('sway-from', 0),
           tineSpacing: num('sway-spacing', 6),
           reach: num('sway-depth', 15) / 100,
           crossRise: Math.max(10, Math.min(90, num('sway-cross-height', 50))) / 100,
           gap: PROP.gap,
           tines: el('tines').checked,
           iface: PROP.iface,
           layerHeight: el('layer-height').valueAsNumber,
           // "Brace tall walls" cross-ribs a brace over its start height, the same
           // threshold the drawn walls use; unticked leaves the brace plain.
           crossAbove: el('tall-ribs').checked ? BRACE.tallH : Infinity };
}

function supersedeBuild() {
  if(finBusy)geometryQueue.dispose();
  geometryQueue.cancel('auto');finBusy=false;
}
export async function refreshFins() {
  scheduleParked();
  if(!finsVisible||!lastResult||!topology){
    finGen++;supersedeBuild();if(!topology){geometryQueue.dispose();geometryQueue.model=null;}clearSpinner();reportTask('auto',false);
    for(const m of [finMesh,padMesh])if(m){scene.remove(m);m.geometry.dispose();}
    finMesh=padMesh=null;finTris=padTris=[];clearFinHover();forgetFins();
    if(removeMode)cancelRemove();clearPreview();rebuildDrawn();updateReadout(null);return;
  }
  finT0=performance.now();lastOpts=finOpts();supersedeBuild();
  const generation=++finGen,model=topology;
  finBusy=true;reportTask('auto',true);markFinsStale();armSpinner();
  try{
    const reply=await geometryQueue.run('auto',model,{kind:'auto',result:lastResult,rot:[...rotM3.elements],opts:lastOpts});
    if(!reply||generation!==finGen||topology!==model)return;
    reportTask('auto',false);applyBuilt(reply.built);
  }catch(error){
    if(generation!==finGen||topology!==model)return;
    console.error('Background support calculation failed',error);finBusy=false;clearSpinner();
    reportTask('auto',false,error);
    for(const m of [finMesh,padMesh])if(m){scene.remove(m);m.geometry.dispose();}
    finMesh=padMesh=null;finTris=padTris=[];lastBuilt=null;forgetFins();
    el('s-fins').textContent='Support calculation failed — retry';updateFit();
  }
}

/** `topo` as a Worker build takes it: without the page's caches (see refreshFins). */
export function workerTopology(topo) {
  const msg = { ...topo };
  delete msg._insideGrid;
  delete msg.vid;         // islands.js's too: the engine never reads it (19 MB at 1.5M faces)
  delete msg._vgraph;     // islands.js's vertex graph: the page's, and big (6 ints a face)
  return msg;
}

// Turn a finished buildFins result into meshes + readout. Shared by the worker
// reply. buildFins runs in BOTH modes: in Suggest it
// places the walls; in Draw it is called only for the bed pad + seating verdict
// (a tilted part rests on an edge and needs a pad however its walls are placed,
// and that logic lives in fins/pad.js + fins/seating.js), so Draw ignores the
// suggested walls and shows the hand-drawn ones instead.
function applyBuilt(built) {
  requestRender();      // a worker build lands outside any input event
  finBusy = false;
  clearSpinner();
  for (const m of [finMesh, padMesh]) { if (m) { scene.remove(m); m.geometry.dispose(); } }
  finMesh = padMesh = null;
  clearFinHover();
  finTris = padTris = [];
  // Undo the grey markFinsStale applied to the shared materials.
  finMaterial.transparent = padMaterial.transparent = ifaceMaterial.transparent = false;
  finMaterial.opacity = padMaterial.opacity = ifaceMaterial.opacity = 1;

  lastBuilt = built;
  padTris = built.padTriangles;
  padMesh = meshFrom(padTris, padMaterial);

  if (finMode === 'draw') {
    // Draw exports the hand-placed walls, not auto fins -- no per-fin records.
    forgetFins();
    rebuildDrawn();
  } else {
    clearPreview();
    // Per-fin records are rebuilt and the removals re-applied (ui/remove.js), so a
    // removal survives a same-orientation rebuild. The fin mesh is the FILTERED
    // triangle set; exporters read finTris unchanged.
    finTris = adoptFins(built);
    finMesh = meshFrom(finTris, finMaterial, ifaceMaterial);
    // In Suggest, also (re)build any hand-drawn walls layered on top. rebuildDrawn
    // self-gates on drawShown(), so it clears them when none apply.
    rebuildDrawn();
  }
  updateReadout(built, performance.now() - finT0);
  updateFit();
  // Restore-all visibility keys off removedIds (this orientation's removals), which
  // is only known after the reconcile above -- refresh it once the build lands.
  syncRemoveUI();
}

/**
 * Stabilize mode does NOT claim to serve every overhang -- it claims to keep a
 * tilted part standing. So the readout reports the fins AND what is still red,
 * rather than implying the red went away. Overstating this is how a tool loses
 * someone on their first print.
 */
/** Grey the fins while a drag is in flight, so nothing on screen is a lie. */
export function markFinsStale() {
  for (const m of [finMesh, padMesh, drawnMesh]) if (m) for (const mat of [m.material].flat()) mat.opacity = 0.25;
  finMaterial.transparent = padMaterial.transparent = drawMaterial.transparent = ifaceMaterial.transparent = true;
  el('s-fins').textContent = t('generating supports…');
}
