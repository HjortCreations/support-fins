# Hjort Creations working version

Based on upstream `c473b30` on 23 October 2026. The full upstream application is
present, including its recent import/export, multi-model and multi-plate work,
nozzle settings, material interface, geometry fixes and touch controls. See the
[upstream history](https://github.com/gittrahan/support-fins/commits/main/) for
individual changes. This fork's `main` and `codex/hjort-current` publish the same
working version. Future upstream contributions should branch from upstream main
and remain small, independently reviewable PRs.

## Start locally

With a recent Node.js installed, run this from the repository root:

```sh
node scripts/serve-local.mjs
```

Open http://127.0.0.1:8735. Another port can be selected with `--port 8736`.
The server binds to this computer only and serves `web/` and the tracked public
stress fixtures at `/models/`. Use HTTP: module workers cannot reliably run from
a file opened directly on disk. No build step or upload is required.

## Our browser controls

- **Draw starts selected.** Auto and Full coverage remain available. The plugin
  schema and plugin defaults stay upstream's: Auto, without these extra controls.
- **Base reinforcement** is in More settings → Hold part. Tapered base with
  thickness ×1 and spread 0 preserves the original footprint. Thickness ×1–4
  and spread 0–300 mm per end are independent. Full-height Cross adds arms with
  a separate 5–80 mm reach control; each side is checked independently.
- **Full-height Cross** keeps the body's actual printable gauge almost to its
  top, leaving its existing breakaway neck/contact intact. It does not reinterpret
  the upstream short tall-wall rib's height control. Optional rounded feet apply
  to its foot too. Every addition belongs to its support, including selection,
  removal, undo/redo and export.
- **Rounded feet** are optional and start off. Existing sessions that did not
  save the choice also reopen with it off.
- **Fit feature** is an explicit Draw/Sway choice and starts off. An ordinary
  valid, shortened brace is preferred. Only when that fails does Fit try a
  bounded local search for a brace on a small feature. The result needs at least
  three tines; otherwise placement is refused. A placed brace remembers its own
  Fit choice through undo/redo and a single-model 3MF session.

These additions apply to FDM. Resin retains its upstream geometry. Nozzle and wall
line settings follow the new upstream rules: 0.2–2 mm nozzles and 2/4/6/8 wall
lines, including the upstream wall-thickness cap and the Sway height-based floor.
The older local nozzle profile formula is not reapplied over those rules.

## Background work and failure handling

Live support generation, hand-placement previews, placement validation and manual
rebuilds use one cached geometry worker. Pending hover requests are replaced by
the latest one; committed builds have priority. The upstream parked-model worker
also rebuilds those models' hand placements. Orientation suggestions retain their
own worker and also retry once without falling back to synchronous ranking.
This is not the old adaptive worker
pool: there is no CPU-percentage target or automatic worker-count tuning.

Stale replies from a changed pose, model or settings cannot commit placements.
A failed calculation gets one retry in a fresh worker, then shows Retry. It never
falls back to heavy support generation on the UI thread. Export waits for builds
and is blocked after a calculation error, including a failed parked model, so
the failure cannot silently produce a partial plate. Loading, topology analysis,
rendering, messaging and file serialization still perform some work on the UI
thread; moving support generation does not promise a completely stall-free page.

## Geometric limits

Requested reinforcement is shortened or omitted when clearance from the model
or another support cannot be certified. The original support remains. The
readout reports limited additions; check them before printing. Full-height Cross
therefore describes the geometry of accepted arms, not a guarantee that every
support gets every requested arm. The part contact and breakaway tines are not
made thicker by the base multiplier.

A single-model 3MF preserves editable placements/settings, as in upstream.
Multi-model/plate exports preserve the printable geometry; upstream does not yet
save all their editable sessions. Older sessions missing our fields use neutral
reinforcement and Fit off. Reopening a file made by the older local geometry can
rebuild its placements differently under the current upstream engine.

No metre-high physical print or weak-computer performance has been measured for
this combined version. Geometric checks are not a physical stability guarantee.

## Validation on this version

- Full Deno suite on Windows: **797 passed, 0 failed, 3 ignored**. One existing
  ignored test remains; two symlink-specific tests are skipped only when Windows
  does not grant symlink creation. All other project/cache security tests run.
- Public Auto regression sweep: **621/621 meshes byte-identical** to the current
  upstream baseline with our neutral defaults; no blocking support loss.
- Added tests cover independent base controls, full Cross gauge, clearance,
  ownership, contact-material separation, STL/3MF geometry, worker/direct-engine
  parity and queue cancellation/retry.
- Chromium: real Fit placement, three-tine result, Cross, removal, undo/redo,
  single-model 3MF reopening, parked-model rebuild, model switching, two-model
  3MF export, rapid settings changes, all-plate ZIP export, injected live/parked
  worker failures and recovery, plus suggestion ranking and its failure/retry.
  Both exported plate files reopened as geometry.
  No page errors;
  injected failures log the expected diagnostic.
- A synthetic 196,632-face wing was queried through the cached worker in
  Chromium on the development computer: 213 ms request-to-result, 44 UI timer
  ticks and a largest observed timer gap of 7 ms, with no overlapping long-task
  entry in that sample. These are one-machine observations, not hardware-wide
  performance promises or an additional speedup over upstream's indexing.

Run `deno test -A` for the invariant/CLI suite. The public sweep procedure is in
`prototype/sweep/`; it must use public fixtures and an explicit upstream baseline.
Never include private input models in a fork commit or an upstream report.
