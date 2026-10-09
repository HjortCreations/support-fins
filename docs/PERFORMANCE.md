# Draw responsiveness and adaptive CPU use

Large models previously paid for automatic walls that Draw immediately discarded.
Manual walls, Sway braces, tine combs and hover previews also computed on the UI
thread. This change skips the unused placement pass and moves manual geometry into
a persistent worker. Cached posed triangles reuse the existing XY spatial index
instead of scanning every triangle at every wall station.

## Queue, status and export

The browser defaults to Draw; Auto and Full coverage remain explicit options.
One shared coordinator queue serves automatic/seating work, committed Draw builds
and previews, with that priority order. It retains one active job and at most the
latest pending job per channel, discards superseded results and sends each model
once. A running obsolete job finishes before the newest one starts: this avoids
repeated model clones and preserves caches, but cancellation is not instantaneous.
Changing the model terminates the old worker and its descendants.

The non-blocking busy notice appears after 150 ms and lasts until all current
settings, Auto/seating, Draw and preview stages finish. Old geometry may remain
visible while computing. Export checks the current committed geometry and pending
settings; a worker failure reports an error and requires a successful retry.
Heavy geometry never falls back to the UI thread.

## Automatic CPU policy

- Begin with one heavy geometry worker. A single wall or preview cannot fan out.
- Ceiling: half the browser-reported logical processors, rounded down, minimum one,
  maximum four. Unknown hardware falls back to one. These are logical processor
  hints, not physical cores or a promise to reserve CPU capacity for Windows.
  The ceiling counts heavy geometry jobs. The coordinator waits during child
  computations; its Worker instance exists in addition to the child instances.
- Ordinary Draw walls are independent in the existing engine. Their candidates
  may fan out, then are assembled in original request order. Auto coverage decisions
  and Sway collision/acceptance remain sequential. Auto and Draw do not compute
  heavy geometry simultaneously. Precision, clearance thresholds and output
  triangles are unchanged.
- A batch needs at least four ordinary walls and 40 ms of serial work before trying
  two workers. A new pool receives one cold batch and one warm observation before
  judging speed. Each successful warm batch may add one worker. No promotion
  follows a cold batch.
- Keep parallelism only when summed child computation divided by batch elapsed
  time is at least 1.15. Worker startup, cloning and reply transfers are visible in
  elapsed time; final ordered assembly/rendering is outside that comparison.
  A failed warm trial returns to one worker for 30 seconds.
- The page samples a 250 ms heartbeat while jobs run. A visible-page tick delayed
  by over 100 ms reduces further dispatch to one worker and holds recovery for
  10 seconds. Already running jobs finish. Hidden pages restrict parallelism;
  their timer throttling is not used as evidence of CPU overload.
- Before creating extra workers, estimate each model/cache copy as typed-array
  bytes plus 232 bytes per face and 1 MiB overhead. Reserve three copies for
  coordinator/UI/automatic scratch. Additional copies fit within one sixteenth
  of the optional device-memory hint, bounded to 64–512 MiB; without that hint,
  use 256 MiB. This is an admission heuristic, not a measured limit on total
  browser RAM or output geometry. Very large models still work with one worker,
  without extra topology copies.
- Child workers cache models and poses. Pressure/backoff releases unused workers;
  30 seconds without geometry work releases all child copies. A failed child pool
  retries sequentially inside the coordinator worker. A coordinator failure
  blocks export and permits retry; it never runs geometry inline on the page.

The ceiling of four is deliberate: extra workers copy meshes, build their own
spatial grids and transfer results. Faster processors do not remove those costs.
Cold starts can be slower, especially for a one-off edit. Larger batches benefit
more; a Sway-only job stays sequential. The browser cannot read global CPU load,
free RAM or the scheduler's assignments. This policy responds to the page's own
delay and measured throughput, so it does not promise a CPU percentage.

Browser API context:
[hardwareConcurrency](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency)
can report fewer logical processors than physically available;
[deviceMemory](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory)
is an approximate, optional hint.

## Reproducing measurements

Synthetic fixture only: a subdivided 120 mm cantilever plate and a small stem.
No user's part is included.

~~~sh
deno run -A prototype/performance/run.js
deno test -A tests/
~~~

For an old-query comparison, save upstream web/draw.js beside the current module
under another filename, then pass its absolute path with --baseline=....
The benchmark checks identical wall geometry and writes out/draw-performance.json.
The standalone 1/2/4-worker trial and production adaptive trace are separate
measurements.

For real browser workers, serve the repository root:

~~~sh
python -m http.server 8733 --bind 127.0.0.1
~~~

Open http://localhost:8733/prototype/performance/browser.html, then run the eight
rebuilds. The CPU hint selector tests admission limits; it does not emulate a slower
processor. The click counter remains usable during worker computation. Actual
physical low-end hardware has not been benchmarked here.

## Measured on the development machine

Windows, i9-14900KF, 32 reported logical processors; Deno 2.9.7. Numbers below
are examples, not guarantees for real models, other hardware or UI latency.

| Synthetic faces | Old warm wall query | Indexed warm query | Discarded prop pass | Draw seating/status |
| --- | ---: | ---: | ---: | ---: |
| 12,300 | 10.5 ms | 3.0 ms | 198.4 ms | 2.1 ms |
| 49,164 | 35.1 ms | 1.8 ms | 357.4 ms | 6.0 ms |
| 196,620 | 136.1 ms | 2.7 ms | 1,098.5 ms | 24.9 ms |

The eight-independent-wall benchmark on 196,620 faces took 24.7 / 15.9 / 12.5 ms
with 1 / 2 / 4 warm workers. Cold startup was 76.0 / 83.2 / 99.7 ms.

In the actual Chromium browser, the production adaptive queue rebuilt **32 walls**
with worker counts 1, 2, 2, 3, 3, 4, 4, 4. Times were
291.0, 249.8, 98.0, 105.4, 81.1, 116.9, 67.9 and 59.1 ms, including startup and
transfers. Exact output stayed identical; the click counter responded during work.
The first one-worker result is cold and is not a fair warm speedup denominator.
Deno's nested-worker cold starts were much slower (around one second when adding
a new lane), reinforcing why browser measurements and warm observations matter.

Browser admission tests with hints of two and four logical processors used at most
one and two workers, respectively. All eight rebuilds preserved exact geometry.
Two-processor-hint warm runs were approximately 99–118 ms on the same physical
machine; this checks the ceiling, not the performance of a weak physical CPU.

## Remaining costs and scope

Import/topology welding, pose analysis, pointer raycasting, mesh transfer/rendering
and export still contain UI-thread work. Moving geometry workers does not make
all of those free. Auto/Sway parallelization requires a separate design for ordered
placement and collision state; it is intentionally outside this change.

This work contains no nozzle sizing, Cross, taper or rounded-foot changes from
PR #210. Basic Draw/background improvements already present there overlap with
this independent upstream-based PR. The adaptive CPU implementation is separate;
after either PR merges, rebase the other to reconcile those shared changes.
