# Draw performance and CPU scheduling

## What changed

The browser now starts in **Draw**. Auto and Full coverage remain available under
Setup → Placement; engine/plugin defaults are unchanged. A browser that restores
the previously selected control value keeps that choice.

Previously the browser translated Draw into `mode: 'prop'`, computed automatic
walls, and then discarded them. Draw now computes only seating, floating-piece
status and the bed pad. Manual support generation starts when a support is placed.
Pad and seating output remain identical to the previous route.

Manual walls, sway braces, tines, base/cross reinforcement and ghost previews now
run in `drawworker.js`. The worker retains the imported topology, transformed
triangles and the surface grid for the current pose. The model is cloned once
per worker/model, rather than on every pointer move. A new pose invalidates the
posed triangles; a new model replaces the worker.

Draw's vertical surface queries use `gridHitsAt`, the existing XY triangle grid,
instead of scanning every triangle at each contact station. This preserves the
same intersection tests, original triangle order and contact resolution. It does
not simplify the mesh.

One active job and the newest pending job per channel bound the queue. Pending
committed builds take priority over pending previews. Superseded outputs are
ignored; an already-running job still finishes before the next job. Failed workers
report an error and can restart on the next settings change. Heavy generation
never falls back to the UI thread. Export waits for successful current geometry.

## Measurements

Recorded on 2026-10-09, Windows x64, Intel Core i9-14900KF (24 physical cores,
32 logical processors), approximately 64 GB RAM, Deno 2.9.7. These are synthetic
geometry timings, not measurements of a user's model or browser interaction latency.

The harness subdivides a 120 × 120 × 20 mm plate standing at Z100–120, with a small
stem reaching the bed. It tests a straight 80 mm drawn wall and eight independent
walls. The baseline is `web/draw.js` from commit
`eaa12cf8a4e0beca4e3ca1af23d09cea0064611b`, using the same current dependencies.
Before/after wall outputs are checked for exact equality.

Warm synchronous numbers below are the faster of two repeated runs after one
initial run. They show the size of the eliminated work, not a statistical estimate
or a promised speedup on every model.

| Triangles | Previous wall scan | Indexed wall query | Discarded automatic pass | Draw seating/status only |
|---:|---:|---:|---:|---:|
| 12,300 | 10.9 ms | 3.2 ms | 191.4 ms | 2.1 ms |
| 49,164 | 33.1 ms | 1.8 ms | 344.1 ms | 5.8 ms |
| 196,620 | 134.8 ms | 2.6 ms | 1,061.3 ms | 25.7 ms |

The last two columns use `bedPad: false` to isolate the discarded placement work.
They include seating and floating-piece checks; they do not measure pad geometry.
Wall timings exclude topology construction, model cloning and rendering. For the
largest mesh, topology construction alone took 161.5 ms.

## Can more cores help?

Yes, for independent work. The experimental harness dispatches eight independent
walls to persistent pools of 1, 2 and 4 workers. Each worker has its own model and
pose cache. Output is identical across worker counts. Largest-mesh results:

| Workers | First batch, including startup/cloning | Second batch, caches retained |
|---:|---:|---:|
| 1 | 72.3 ms | 26.2 ms |
| 2 | 76.5 ms | 17.9 ms |
| 4 | 101.9 ms | 13.5 ms |

Four workers nearly halve the warm batch time, but make the first batch slower.
This experiment does **not** merge the walls or perform inter-wall collision
resolution. It establishes that independent wall math can benefit from a pool;
it does not establish that an entire Auto build scales this way.

## Decisions and compromises

- **One persistent manual worker in production.** A normal Draw interaction places
  one support at a time. Reusing its cache and removing unnecessary work helps
  both the first interaction and repeated edits. Replicating a large topology and
  spatial grids across all available cores costs memory and startup time. The
  separate automatic/pad worker can run independently; this is not a pool that
  splits one placement among all cores.
- **Keep placement and reinforcement ordered.** A sway brace must avoid earlier
  accepted braces. Reinforcement sees all original supports and previously added
  reinforcement. Auto placement also maintains accepted/claimed coverage state.
  Blindly splitting these loops could change which support wins a collision or
  create fused supports. Parallel candidates require a deterministic acceptance
  stage using the original ordering and clearance rules.
- **Keep UI work small during generation.** Markers and rendering stay on the UI
  thread. Geometry runs in the worker, stale requests are discarded, and export
  waits. There is no reduced mesh precision or skipped clearance checking.
- **Report worker failures.** A browser unable to start a module worker must retry
  or use the app through HTTP. Running a large build synchronously would reintroduce
  the frozen page this change is intended to prevent.
- **No GPU rewrite yet.** The current engine combines irregular triangle queries,
  branching and ordered collision decisions. The measured first improvements
  fit the existing CPU geometry code. A GPU path would require a new data/algorithm
  implementation and equivalent geometry validation; this work does not claim
  that GPU acceleration is impossible.

## Remaining bottlenecks and viable next steps

Import/topology preparation, pose analysis, pointer raycasting, mesh upload/display
and export still include UI-thread work. Large models can therefore still cause
pauses outside support generation. This change does not guarantee that every app
operation is non-blocking.

The next useful profiling targets are the user's actual mesh size and station
counts, worker clone time, the collision/tine phases, and pointer raycasting.
Moving topology/analysis off-thread and adding a cached raycast acceleration
structure can improve responsiveness without changing printed geometry.

For batch rebuilds or automatic placement, a persistent, memory-bounded pool of
2–4 workers is a viable next experiment. Generate independent candidates in
parallel, then accept/certify them in the original order. Cap worker count by
available processors **and** model memory; do not use every logical processor
unconditionally. Packed transferable/shared mesh data would reduce copies, but
requires changing the current object-rich topology and deployment headers for
shared memory. Benchmark realistic parts and verify geometry before adopting it.

## Reproduce

From the repository root:

```sh
deno test -A
deno run -A prototype/performance/run.js
```

The harness writes `out/draw-performance.json`. The output directory is ignored.
Without a baseline, it measures current queries, Draw preparation and the worker
pool experiment. To compare the previous wall query, save the old `web/draw.js`
beside the current file as `web/draw-before.js` so its relative imports still work,
then run:

```sh
deno run -A prototype/performance/run.js --baseline=/absolute/path/to/web/draw-before.js
```

Remove the temporary baseline file afterwards. Timings are diagnostic and have
no pass/fail thresholds. The regression suite covers exact golden geometry,
pad/seating equivalence, real worker output, reinforcement ownership, queue
cancellation and worker failure recovery.
