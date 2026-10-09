/** Manual geometry and previews stay off the UI thread. Cache the imported mesh. */
import { buildDrawn } from './draw-build.js';
import { drawnWall } from './draw.js';
import { applyTunables } from './fins.js';
import { seatedPartTris } from './fins/seating.js';

let topology, poseKey, partTris;
self.onmessage = ({ data: { id, model, job } }) => {
  try {
    if (model) { topology = model; poseKey = null; partTris = null; }
    if (!topology) throw new Error('No model was sent to the Draw worker');
    const key = JSON.stringify([job.rot, job.result.offset]);
    if (key !== poseKey) {
      partTris = seatedPartTris(topology, job.rot, job.result.offset);
      poseKey = key;
    }
    const t0 = performance.now();
    applyTunables(job.options.tunables);
    const built = job.kind === 'preview'
      ? drawnWall(job.a, job.b, partTris, 0)
      : buildDrawn(topology, job.result, job.rot, job.requests, job.options,
        job.avoid, job.external, partTris);
    self.postMessage({ id, built, computeMs: performance.now() - t0 });
  } catch (err) { self.postMessage({ id, error: String(err?.stack ?? err) }); }
};
