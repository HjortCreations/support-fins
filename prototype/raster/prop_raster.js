/**
 * PROP mode -- a breakaway wall that stands UNDER an overhang.
 *
 * This is a different support from the fin in fins.js, not a variant of it, and
 * the difference is what it leans on:
 *
 *   Stabilize  a wall BESIDE the part, gripping a face with horizontal tines.
 *              Needs a face to grip, so it cannot serve a cone or a sphere.
 *   Prop       a wall UNDER the overhang, rising from the plate and stopping
 *              `gap` short. The part bridges that last layer, so the wall never
 *              fuses and it snaps off. Needs only an underside contact line,
 *              which every shape has.
 *
 * A prop has no tines, deliberately. Tine-less supports were rejected early in
 * this project on Slant3D's demo of a cube falling away from one -- but that is
 * a part balanced on an EDGE with the support as its only restraint. A part
 * sitting down on the plate with an overhang above it has no such failure mode:
 * gravity holds it onto the prop. `tools/support/breakaway.py` in the video repo
 * works exactly this way, has no tines anywhere in it, and produced good fins on
 * real printed shelter hubs -- the parts Stabilize could not touch.
 *
 * The geometry is M3's, which was validated (34/36 regions served, every wall
 * watertight) and then retired for the wrong reason. What is new here is the
 * judgement around it: a prop is only emitted where the wall can actually reach
 * the plate through open air.
 *
 * LAYOUT. This file is the entry point: `buildProps` (the auto-placer's whole
 * pass over a part), `noProps`, `coverRowSpan`, and re-exports of everything
 * fins.js, draw.js, ui/ and the tests import. The pieces live in web/prop/:
 *
 *   config.js     PROP, every number a wall is built from
 *   surface.js    seat a vertex; part surface height(s) above (x, y)
 *   contact.js    the contact line under an overhang, settled to exactly `gap`
 *   sweep.js      the wall solid: the upside-down T, and a part-attached wall
 *   clearance.js  which stations can carry a wall (reach, certification, runs)
 *   tines.js      the grip comb along a wall's top
 *   tracks.js     where Suggest puts walls: straight patches, tracks, tube line
 *   attached.js   walls that stand on the part instead of the plate
 *   squat.js      brimmed squat walls for the near-bed band
 *   rival.js      a small tube against the patch path: the region keeps the better
 *
 * Each module imports only modules above it in this list and never prop.js.
 */
import { solidClearance } from '../../web/inside.js';
import { MIN_REGION_AREA } from '../../web/overhangs.js';
import { buildPartAttached } from './attached_spike.js';
import { bodyMask, insertFloorStations, longestRun, stationCertified, stationIsClear, tallBody, tallSpan, withLowTails } from '../../web/prop/clearance.js';
import { PROP } from '../../web/prop/config.js';
import { contourTop, lowerSag, settleTop, straightness } from '../../web/prop/contact.js';
import { tubeRivalry } from '../../web/prop/rival.js';
import { buildSquatBed } from '../../web/prop/squat.js';
import { seat } from '../../web/prop/surface.js';
import { sweep } from '../../web/prop/sweep.js';
import { emitTines, tineStepFor } from '../../web/prop/tines.js';
import { patchTracks, splitRegion, tubeLine } from '../../web/prop/tracks.js';
import { floorLine } from './attached_spike.js';

// SPIKE switches (env): RASTER=0 runs main's placement through this copy (must
// match main exactly -- the harness check), RASTER=only raster placement alone,
// anything else races the two per region (raceRegions). RASTER_MINSPAN overrides
// PROP.minSpan.
const env = (k) => globalThis.Deno?.env.get(k);
const MODE = env('RASTER') ?? 'race';
if (env('RASTER_MINSPAN')) PROP.minSpan = Number(env('RASTER_MINSPAN'));

/**
 * SPIKE: cut each track where the floor under it changes class -- plate (nothing
 * of the part below) vs part (a surface to stand on) -- so a track that runs off
 * a ledge onto open air becomes a part-attached piece and a plate piece, instead
 * of buildPartAttached's majority vote giving the whole track to one of them.
 */
function splitByFloor(tracks, partTris) {
  const out = [];
  for (const t of tracks) {
    const floor = floorLine(t, partTris);
    let cur = [], cls = null;
    for (let k = 0; k < t.length; k++) {
      const c = floor[k][2] > PROP.gap + 0.5;
      if (cls !== null && c !== cls) { if (cur.length >= PROP.minStations) out.push(cur); cur = []; }
      cls = c;
      cur.push(t[k]);
    }
    if (cur.length >= PROP.minStations) out.push(cur);
  }
  return out;
}

// Re-exported so fins.js, draw.js, ui/ and the tests import from prop.js alone.
export { PROP } from '../../web/prop/config.js';
export { splitRegion, tubeLine, patchTracks } from '../../web/prop/tracks.js';
export { straightness, contactLine, lowerSag, contourTop, settleTop } from '../../web/prop/contact.js';
export { footFor, profileHalf, sweep, sweepBetween } from '../../web/prop/sweep.js';
export { surfaceZAt, surfaceZsAt } from '../../web/prop/surface.js';
export { stationIsClear, stationCertified, pathToPlateIsClear, longestRun,
  withLowTails, insertFloorStations } from '../../web/prop/clearance.js';
export { tineStepFor, emitTines } from '../../web/prop/tines.js';
export { floorLine, PART_BAND } from './attached_spike.js';
export { sweepSquat, buildSquatBed } from '../../web/prop/squat.js';

/**
 * What buildProps returns when it builds nothing -- kept here so the callers
 * that refuse to build (a part seated on a point) return the same shape.
 */
export function noProps() {
  return {
    triangles: [], props: [], served: 0, volume: 0,
    skipped: { noLine: 0, wanders: 0, stub: 0, blocked: 0,
               degenerate: 0, buried: 0, weld: 0, sliver: 0, bore: 0 },
  };
}

// mm row pitch at the sparsest coverage (0). This is DELIBERATELY wider than
// maxUnsupportedSpan: the mid-slider (0.5) is the structural anti-sag cap, and
// dragging left of it trades sag safety for fewer supports -- the tool warns when
// a part actually lands a row wider than the cap (buildProps.sagRisk). Matthew
// asked for this: a small part was floored at 3 fins by the hard cap.
export const COVER_SPARSE_SPAN = 30.0;

/**
 * Wide-face row pitch for a coverage setting. 0.5 is the neutral default and maps
 * to the structural cap (maxUnsupportedSpan) -- the old sparse behaviour, so a part
 * built at the slider's default is byte-identical to before. Left of centre loosens
 * past the cap toward COVER_SPARSE_SPAN (fewer supports, may sag); right of centre
 * tightens to half the cap (denser). Monotonic, so tests/coverage.test.js holds.
 */
export function coverRowSpan(coverage) {
  const c = Math.max(0, Math.min(1, coverage));
  const cap = PROP.maxUnsupportedSpan;
  return c <= 0.5
    ? cap + ((0.5 - c) / 0.5) * (COVER_SPARSE_SPAN - cap)   // 30 .. 12
    : cap - ((c - 0.5) / 0.5) * (cap / 2);                  // 12 .. 6
}

/**
 * Build a breakaway prop under every overhang region that can take one.
 *
 * @returns {{triangles, props, skipped, served, sagRisk}}
 */
function buildOnce(topo, result, rot, opts, RASTER) {
  const { pos } = topo;
  const step = opts.step ?? PROP.stationStep;
  // Wide-face coverage (0 sparse .. 1 dense) sets the row spacing via coverRowSpan:
  // 0.5 is the anti-sag cap (the default), left of it loosens past the cap (fewer
  // supports, flagged as sagRisk when a row actually lands wider than the cap),
  // right of it tightens. Pinned by tests/coverage.test.js.
  const coverage = Math.max(0, Math.min(1, opts.coverage ?? 0.5));
  const rowSpan = coverRowSpan(coverage);
  // sagRisk warns ONLY when the user dragged coverage below centre, asking for row
  // pitch wider than the anti-sag cap. It is NOT enough that the placed spacing
  // exceeds the cap: rounding vExt/rowSpan down routinely lands a hair over the cap
  // even at the neutral default (a 53mm face / 12mm cap -> 4 rows at 13.25mm), and
  // warning there is just noise. So gate on the REQUESTED pitch, not the rounded
  // result.
  const wantSparse = rowSpan > PROP.maxUnsupportedSpan + 0.5;
  const zBed = 0;
  const off = result.offset;
  const withTines = opts.tines === true;
  // tines emitted; sagRisk: the user chose sub-cap spacing AND a real row landed wide
  const tally = { tines: 0, sagRisk: false };

  const out = [];
  const props = [];
  // Per-fin identity, assigned in build order. The id is only used to map a
  // raycast hit back to its fin WITHIN one build (the UI tracks removals across
  // rebuilds by a spatial signature, not this id). Sequential keeps it stable
  // within a generation.
  let nextId = 0;
  const skipped = { noLine: 0, wanders: 0, stub: 0, blocked: 0,
                    degenerate: 0, buried: 0, weld: 0, sliver: 0, bore: 0 };
  const v = [0, 0, 0];

  // The whole part, seated once, for the part-attached floor probe: the floor a
  // support lands on is usually a DIFFERENT region than the overhang, so it must
  // raycast the full mesh. Cheap next to the per-region work below.
  const partTris = new Float64Array(pos.length);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity,
      minZ = Infinity, maxZ = -Infinity;
  for (let f = 0; f < topo.nFaces; f++) {
    for (let i = 0; i < 3; i++) {
      seat(pos, f * 9 + i * 3, rot, off, v);
      partTris[f * 9 + i * 3] = v[0];
      partTris[f * 9 + i * 3 + 1] = v[1];
      partTris[f * 9 + i * 3 + 2] = v[2];
      if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
      if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
      if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
    }
  }

  // DENSE grip comb, uniform along every grippable wall. A tip-over-risk scale
  // (commit c0fcf8e) once let "stable" parts fall back to a sparse 9mm comb -- which
  // starved shallow parts down to a few nubs that read as "laying on the face"
  // instead of a gripping comb (regression Matthew caught). The cube-detach that
  // scale was reacting to was actually the bed pad's fault (fixed separately in the
  // pad commits), not the tines'. So the comb is uniformly dense again (Slant3D's
  // "7-8 low down, spreading with height"); density DEFAULTS to PROP.tineStep and
  // tests/tines_realparts.test.js pins that real parts get a full comb. The user's
  // "Tine grip" slider (opts.tineDensity) can loosen it toward tineStepSparse for a
  // surface-critical face, never silently -- see tineStepFor / tests/tine_density.test.js.
  const tineStepEff = tineStepFor(opts.tineDensity);
  // A tine MUST be exactly one slicer layer tall or it stops printing as one clean
  // continuous bead and tears on removal (welts) instead of bending off. So it
  // tracks the user's real layer height (default 0.2mm) -- see the UI's Layer height.
  const tineHeight = opts.layerHeight ?? PROP.tineH;

  // The support unit is the locally-straight sub-patch, not the connected
  // region -- see splitRegion. Fragments too small to be worth a wall are
  // counted, not silently dropped: absence of output recorded as success is
  // exactly how M5's scoreboard lied.
  const patches = [];
  for (let ri = 0; ri < result.regions.length; ri++) {
    const rFaces = result.regions[ri].faces;
    // Seat the WHOLE region's triangles once, shared by all its sub-patches.
    // The polyline each wall follows comes from its own sub-patch, but the
    // surface its top must CLEAR is the whole region's: a wall near a patch
    // boundary can run under a sibling patch's faces, and measuring against
    // patch-only triangles welded it to geometry it could not see -- gap
    // 0.003 mm and flank 0.011 mm on hub_corner, measured the first time this
    // split shipped with per-patch triangles.
    const regionTris = new Float64Array(rFaces.length * 9);
    const regionPts = [];
    let regionArea = 0;
    for (let k = 0; k < rFaces.length; k++) {
      regionArea += topo.area[rFaces[k]];
      let gx = 0, gy = 0, gz = 0;
      for (let i = 0; i < 3; i++) {
        seat(pos, rFaces[k] * 9 + i * 3, rot, off, v);
        regionTris[k * 9 + i * 3] = v[0];
        regionTris[k * 9 + i * 3 + 1] = v[1];
        regionTris[k * 9 + i * 3 + 2] = v[2];
        regionPts.push([v[0], v[1], v[2]]);
        gx += v[0]; gy += v[1]; gz += v[2];
      }
      regionPts.push([gx / 3, gy / 3, gz / 3]);
    }

    // Curved region whose lowest line is straight = a tube: ONE wall under
    // that line, the way breakaway.py props the shelter hubs. Only when the
    // region is flat, or its lowest points form a ring, does it go to
    // splitRegion for rows of tracks. See tubeLine.
    // A SMALL tube (under tubeMinArea, see tubeLine) is a new claim on a region
    // the patch path used to own, so it keeps the region's split too: the tube is
    // built first, the patches then compete for the same region, and the one that
    // holds more of it stays (see web/prop/rival.js).
    // SPIKE (raster): no tube route, no split. The WHOLE region's footprint gets
    // parallel straight tracks at the row pitch -- a grid support's walls -- each
    // top following the underside (contourTop below). A track splits where the
    // region has no face above it (patchTracks) and where the floor under it
    // changes between plate and part (splitByFloor), so each piece goes down the
    // plate path or the part-attached path whole.
    if (RASTER) {
      const lines = splitByFloor(
        patchTracks(regionPts, regionTris, step, { topo, rot, offset: off }, rowSpan), partTris);
      if (lines.length) patches.push({ faces: rFaces, area: regionArea, region: ri, tris: regionTris, lines });
      else skipped.noLine++;
      continue;
    }
    const tube = tubeLine(topo, rFaces, rot, regionPts, regionTris, step);
    const small = regionArea < PROP.tubeMinArea;
    const split = small || !tube?.length ? splitRegion(topo, rFaces, rot) : null;
    if (tube && tube.length) {
      patches.push({ faces: rFaces, area: regionArea, region: ri,
                     tris: regionTris, lines: tube, smallTube: small ? split : null });
      continue;
    }

    for (const p of split) {
      if (p.area < MIN_REGION_AREA) { skipped.sliver++; continue; }
      p.region = ri;
      p.tris = regionTris;
      patches.push(p);
    }
  }
  const servedRegions = new Set();

  // A small tube competes with its region's patches: see web/prop/rival.js.
  const rivalry = tubeRivalry({ out, props, skipped, served: servedRegions, tally },
                              topo, result, partTris);

  for (const patch of patches) {
    const regionTris = patch.tris;
    const mark = rivalry.begin(patch);  // a small tube undoes to here
    let lines;
    if (patch.lines) {
      // A tube's lowest-line track(s), fitted and resampled by tubeLine.
      lines = patch.lines;
    } else {
      // The patch's own geometry: vertices plus face centroids for the frame
      // fit, and its triangles for asking "does the patch cover this station".
      const pts = [];
      const patchTris = new Float64Array(patch.faces.length * 9);
      for (let k = 0; k < patch.faces.length; k++) {
        const f = patch.faces[k];
        let gx = 0, gy = 0, gz = 0;
        for (let i = 0; i < 3; i++) {
          seat(pos, f * 9 + i * 3, rot, off, v);
          pts.push([v[0], v[1], v[2]]);
          patchTris[k * 9 + i * 3] = v[0];
          patchTris[k * 9 + i * 3 + 1] = v[1];
          patchTris[k * 9 + i * 3 + 2] = v[2];
          gx += v[0]; gy += v[1]; gz += v[2];
        }
        pts.push([gx / 3, gy / 3, gz / 3]);
      }
      lines = patchTracks(pts, patchTris, step, { topo, rot, offset: off }, rowSpan);
      // The user chose sub-cap spacing (wantSparse) AND this face actually landed a
      // multi-row gap wider than the cap. Flag it so the UI can warn (never blocks;
      // Matthew's call). Single-row faces (spacing 0) can't sag, so they don't warn.
      if (wantSparse && lines.length && lines.spacing > PROP.maxUnsupportedSpan) tally.sagRisk = true;
    }
    if (!lines.length) { skipped.noLine++; continue; }

    // SPIKE: a queue, not a fixed list -- a track that crosses an obstacle
    // leaves pieces either side of its longest run, and each gets its own try.
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li];
      // PART-ATTACHED first: if solid part sits below this overhang, a support
      // must stand on THAT floor, not stilt to the plate through the part (the
      // bug Matthew hit on a real hub). buildPartAttached declines on an ordinary
      // bed overhang (floorLine ~0), so the plate path below is reached unchanged
      // for the flagship parts. When there IS a floor but no safe wall fits (a
      // bore, or side walls in the way) it says `floored` -- counted and skipped,
      // never stilted through the part or scarred into a bore. Works on a COPY so
      // the plate path's own `line` is untouched.
      const tri0 = out.length;
      const pa = buildPartAttached(line, partTris, topo, rot, off, out);
      if (pa.ok && patch.smallTube) {
        // A small tube's line is new to this path, so hold its wall to the same
        // measured clearance the plate path demands (see the sweep below): on
        // 3DBenchy at Y35 an unchecked one fused 0.09 mm into the cabin roof.
        const hit = solidClearance(topo, rot, off, out.slice(tri0), 0.25);
        if (hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205)) {
          out.length = tri0;
          skipped.weld++;
          continue;
        }
      }
      if (pa.ok) {
        servedRegions.add(patch.region);
        // pa.prop.line already carries the wall top (surface minus gap); add the
        // gap back so emitTines reads it as the surface, like the plate path does.
        if (withTines) {
          const topLine = pa.prop.line.map((p) => [p[0], p[1], p[2] + PROP.gap]);
          tally.tines += emitTines(topLine, partTris, topo, rot, off, out, tineStepEff, undefined, tineHeight);
        }
        // buildPartAttached pushed the wall starting at tri0; emitTines above pushed
        // its tines right after, so wall + tines are contiguous -> one segment.
        props.push({ ...pa.prop, area: patch.area, region: patch.region,
                     trimmed: line.length - pa.prop.stations,
                     id: nextId++, kind: 'prop',
                     triRanges: [[tri0, out.length]] });
        continue;
      }
      if (pa.floored) { skipped.bore++; continue; }

      // Finish the top against the WHOLE region, not just this patch: a track
      // near a patch boundary can run under a sibling patch's faces, and
      // clearance measured against patch-only triangles welded walls to
      // geometry they could not see (gap 0.003mm, flank 0.011mm, hub_corner).
      contourTop(line, regionTris);
      lowerSag(line, regionTris);
      // pin the wall's low end to the squat floor, not the nearest 1mm station
      if (insertFloorStations(line).length) contourTop(line, regionTris);

      // SQUAT BED PASS: hold the near-bed stations too low for the flanged wall
      // below (which discards everything under minHeight as stub/blocked). It runs
      // AFTER the tall wall (runSquat, on every exit path) so it can skip exactly
      // the stations that wall's low tail covered (`claimed`) and nothing more.
      // squatLine is a deep copy taken now, before the tall path's settleTop
      // mutates the shared points, so the squat pass sees the contoured line.
      const squatLine = line.map((p) => [p[0], p[1], p[2]]);
      const claimed = line.map(() => false);
      const runSquat = () => {
        for (const sq of buildSquatBed(squatLine, regionTris, topo, rot, off, out, claimed)) {
          // a squat wall's base is the thin brim, not the tall flange, so tines
          // attach from squatBrimH up (the default minTop would skip every one).
          const t0 = out.length;
          if (withTines) tally.tines += emitTines(
            sq.line.map((p) => [p[0], p[1], p[2] + PROP.gap]),
            regionTris, topo, rot, off, out, tineStepEff, PROP.squatBrimH, tineHeight);
          servedRegions.add(patch.region);
          // buildSquatBed pushed this wall (sq.triRange) BEFORE every squat wall's
          // tines, so a fin's wall and its tines are NON-contiguous in `out` --
          // track both segments so removing the fin takes wall AND tines together.
          const segs = [sq.triRange];
          if (out.length > t0) segs.push([t0, out.length]);
          props.push({ ...sq, area: patch.area, region: patch.region, id: nextId++, kind: 'prop', triRanges: segs });
        }
      };

      // A track is straight in XY by construction, so this gate is a tripwire
      // rather than the bowl-refusal it was for bucketed polylines -- bowls are
      // now refused by their holes (see patchTracks). Keep it: anything that
      // trips it means the frame fit itself went wrong.
      if (straightness(line) > PROP.maxWander) { skipped.wanders++; runSquat(); continue; }

      // Trim to the longest run that can actually carry a wall, rather than
      // discarding the track over a local problem. See `longestRun`.
      const clear = line.map((p, k) =>
        p[2] - PROP.gap >= PROP.minHeightSquat && stationIsClear(line, k, topo, rot, off));
      const usable = withLowTails(
        line.map((p, k) => clear[k] && p[2] - PROP.gap >= PROP.minHeight), clear);
      const run = longestRun(usable);
      if (!run || run[1] - run[0] < PROP.minStations) { if (!line.rest) skipped.blocked++; runSquat(); continue; }
      if (RASTER) {
        for (const rest of [line.slice(0, run[0]), line.slice(run[1])]) {
          if (rest.length >= PROP.minStations) { rest.rest = true; lines.push(rest); }
        }
      }
      const sub = line.slice(run[0], run[1]);

      const body = bodyMask(sub);               // before settleTop -- see bodyMask
      if (tallSpan(sub, body) < (patch.smallTube ? PROP.minSpanTube : PROP.minSpan)) { skipped.stub++; runSquat(); continue; }

      // Last, on the trimmed run only: put the closest approach exactly on spec.
      // It runs here rather than earlier because trimming changes which part of
      // the edge is closest, so settling before the trim settles the wrong
      // thing.
      settleTop(sub, regionTris);

      // Settling can push a station that was only just tall enough below the
      // floor, and `sweep` would then throw away the whole wall -- the same
      // all-or-nothing failure the trim exists to prevent, reintroduced one step
      // later. Re-trim against the settled line: on height, and on the measured
      // clearance to everything settleTop could not see (stationCertified).
      // Tall stations carry the wall; low ones may only extend it as its tail.
      const lowA = sub.map((p, k) =>
        p[2] - PROP.gap >= PROP.minHeightSquat && stationCertified(sub, k, topo, rot, off));
      const tallA = sub.map((p, k) => lowA[k] && p[2] - PROP.gap >= PROP.minHeight);

      // Sweep, then MEASURE the finished solid -- exact triangle-to-triangle
      // clearance against the whole part (solidClearance), because the last
      // welds this pipeline shipped sat between stations, where no per-station
      // probe would ever look. A contact is a local problem like every other:
      // trim the station that owns it and try again, up to a few rounds,
      // rather than discarding a 90mm wall over one rib. A wall that cannot be
      // cut clear is dropped -- "no prop" is a fixable disappointment, a fused
      // prop is a ruined print.
      let placed = false, reason = null;
      for (let tries = 0; tries < 4 && !placed; tries++) {
        const run2 = longestRun(withLowTails(tallA, lowA));
        if (!run2 || run2[1] - run2[0] < PROP.minStations) { reason = 'blocked'; break; }
        const settled = sub.slice(run2[0], run2[1]);
        const span2 = Math.hypot(settled[settled.length - 1][0] - settled[0][0],
                                 settled[settled.length - 1][1] - settled[0][1]);
        const settledBody = body.slice(run2[0], run2[1]);
        if (tallSpan(settled, settledBody) < (patch.smallTube ? PROP.minSpanTube : PROP.minSpan)) { reason = 'stub'; break; }

        const before = out.length;
        if (!sweep(settled, zBed, out, PROP.minHeightSquat)) {
          out.length = before;
          reason = 'degenerate';
          break;
        }

        // 0.25 reach: the tightest threshold below is 0.205, and every extra
        // tenth of reach widens the broad phase for nothing
        const hit = solidClearance(topo, rot, off, out.slice(before), 0.25);
        // Same acceptance as stationCertified: an approach from above is the
        // breakaway interface, anything else is a flank. Interpenetration
        // measures 0 and fails the flank test, which is what retires the old
        // vertex-containment `buried` check -- crossing surfaces have
        // distance 0 long before any vertex is inside.
        if (hit && (hit.cosUp > 0.7 ? hit.d < PROP.gap - 0.065 : hit.d < 0.205)) {
          out.length = before;
          let kBest = 0, dBest = Infinity;
          for (let k = 0; k < settled.length; k++) {
            const dx = settled[k][0] - hit.x, dy = settled[k][1] - hit.y;
            if (dx * dx + dy * dy < dBest) { dBest = dx * dx + dy * dy; kBest = k; }
          }
          const at = run2[0] + kBest;
          for (const k of [Math.max(0, at - 1), at, Math.min(lowA.length - 1, at + 1)]) {
            lowA[k] = false;
            tallA[k] = false;
          }
          reason = 'weld';
          continue;
        }

        // The TALLEST point, not the lowest: this is what the wall costs to
        // print and how far it has to stand up on its own. `line` is
        // deliberately not used here -- the wall only exists over `sub`.
        const top = Math.max(...settled.map((p) => p[2])) - PROP.gap;
        // signed volume of the emitted solid (divergence theorem over its
        // triangles): the plastic this wall costs, which is the number the
        // "less material than slicer supports" claim has to be measured against
        let vol = 0;
        for (let i = before; i < out.length; i += 3) {
          const a = out[i], b = out[i + 1], c = out[i + 2];
          vol += (a[0] * (b[1] * c[2] - b[2] * c[1])
                + a[1] * (b[2] * c[0] - b[0] * c[2])
                + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
        }
        servedRegions.add(patch.region);
        // The grip comb: nubs along this wall's settled top that bite into the
        // part. `settled` carries the surface z; emitTines subtracts the gap.
        if (withTines) tally.tines += emitTines(settled, regionTris, topo, rot, off, out, tineStepEff, undefined, tineHeight,
                                              tallBody(settledBody));
        props.push({
          region: patch.region,
          span: span2, height: top - zBed, area: patch.area,
          stations: settled.length, trimmed: line.length - settled.length,
          volume: Math.abs(vol),
          // the centreline, so a coverage check can ask what this wall reaches
          line: settled.map((p) => [p[0], p[1], p[2] - PROP.gap]),
          id: nextId++, kind: 'prop',
          // `before` (captured at the start of THIS try, line ~2129) marks where
          // this wall's triangles begin in `out`; failed weld retries roll back to
          // it, so on the successful try it points at this wall. emitTines just
          // pushed its tines right after, so wall + tines are one contiguous segment.
          triRanges: [[before, out.length]],
        });
        for (let k = run[0] + run2[0]; k < run[0] + run2[1]; k++) claimed[k] = true;
        placed = true;
      }
      if (!placed && reason) skipped[reason]++;
      runSquat();
    }
    if (patch.smallTube) rivalry.tubeDone(patch, mark, patches);
  }
  rivalry.finish();

  // `served` counts REGIONS with at least one wall, because a region can now
  // yield several -- subtracting a prop count from a region count would say a
  // part with one region and three walls had "-2 unserved".
  return { triangles: out, props, skipped, served: servedRegions.size,
           servedRegions: [...servedRegions],
           tines: tally.tines, sagRisk: tally.sagRisk,
           volume: props.reduce((s, q) => s + q.volume, 0) };
}

/**
 * SPIKE entry, same signature as main's buildProps. RASTER=0 -> main placement,
 * RASTER=only -> raster placement, default -> both, and each region keeps the
 * build that holds more overhang area (a tie keeps main's).
 */
export function buildProps(topo, result, rot, opts = {}) {
  if (MODE === '0') return buildOnce(topo, result, rot, opts, false);
  if (MODE === 'only') return buildOnce(topo, result, rot, opts, true);
  const a = buildOnce(topo, result, rot, opts, false);
  const b = buildOnce(topo, result, rot, opts, true);
  return raceRegions(topo, result, rot, a, b);
}

/**
 * Per region, the build whose walls hold more overhang area. Held = the rule
 * rival.js uses: a support vertex within maxUnsupportedSpan in plan and 0-3 mm
 * below an overhang face, over EVERY overhang face near the region (a wall under
 * one region holds its neighbours too).
 */
function raceRegions(topo, result, rot, a, b) {
  const { pos } = topo, off = result.offset, v = [0, 0, 0];
  const faces = [];                       // [cx, cy, cz, area, region]
  result.regions.forEach((g, ri) => {
    for (const f of g.faces) {
      let cx = 0, cy = 0, cz = 0;
      for (let i = 0; i < 3; i++) { seat(pos, f * 9 + i * 3, rot, off, v); cx += v[0] / 3; cy += v[1] / 3; cz += v[2] / 3; }
      faces.push([cx, cy, cz, topo.area[f], ri]);
    }
  });
  const span = PROP.maxUnsupportedSpan;
  const byRegion = (build) => {
    const m = new Map();
    for (const q of build.props) {
      if (!m.has(q.region)) m.set(q.region, []);
      m.get(q.region).push(q);
    }
    return m;
  };
  const held = (build, qs, ri) => {
    const own = faces.filter((f) => f[4] === ri);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of own) { x0 = Math.min(x0, f[0]); x1 = Math.max(x1, f[0]); y0 = Math.min(y0, f[1]); y1 = Math.max(y1, f[1]); }
    const verts = [];
    for (const q of qs) for (const [s, e] of q.triRanges) for (let i = s; i < e; i++) verts.push(build.triangles[i]);
    let h = 0;
    for (const [cx, cy, cz, ar] of faces) {
      if (cx < x0 - 2 * span || cx > x1 + 2 * span || cy < y0 - 2 * span || cy > y1 + 2 * span) continue;
      for (const p of verts) {
        if (p[2] > cz - 3 && p[2] < cz + 0.5 && Math.hypot(p[0] - cx, p[1] - cy) <= span) { h += ar; break; }
      }
    }
    return h;
  };
  const A = byRegion(a), B = byRegion(b);
  const out = [], props = [], served = new Set();
  let nextId = 0, raster = 0, volume = 0;
  const take = (build, q) => {
    const t0 = out.length, ranges = [];
    for (const [s, e] of q.triRanges) { const r0 = out.length; for (let i = s; i < e; i++) out.push(build.triangles[i]); ranges.push([r0, out.length]); }
    props.push({ ...q, id: nextId++, triRanges: ranges, raster: build === b });
    served.add(q.region);
    volume += q.volume ?? 0;
    return t0;
  };
  for (let ri = 0; ri < result.regions.length; ri++) {
    const qa = A.get(ri) ?? [], qb = B.get(ri) ?? [];
    const useB = qb.length && (!qa.length || held(b, qb, ri) > held(a, qa, ri) + 1e-6);
    if (useB) raster++;
    for (const q of useB ? qb : qa) take(useB ? b : a, q);
  }
  return { triangles: out, props, skipped: a.skipped, served: served.size, servedRegions: [...served],
           tines: a.tines, sagRisk: a.sagRisk || b.sagRisk, volume, rasterRegions: raster };
}
