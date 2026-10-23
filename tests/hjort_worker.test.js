import { LatestWorker } from "../web/worker-queue.js";
import { buildDrawn } from "../web/draw-build.js";
import {
  analyze,
  assert,
  block,
  blockTopo,
  fins,
  isClosed,
  isOriented,
  prop,
} from "./_util.js";
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1], ZERO = { x: 0, y: 0, z: 0 };
Deno.test("Hjort FDM controls cannot suppress upstream resin ribs or change resin meshes", () => {
  const pos = Float32Array.from([
    ...block(0, 10, 0, 20, 0, 112),
    ...block(10, 70, 0, 20, 110, 112),
  ]);
  // Build a real tall shelf so this checks native ribs, not an empty no-op scene.
  const t = fins;
  return import("../web/overhangs.js").then(({ buildTopology }) => {
    const model = buildTopology({ getAttribute: () => ({ array: pos }) }),
      result = analyze(model, 45, ID);
    const base = {
      tineDir: "vertical",
      nozzle: 0.4,
      wallLines: 2,
      iface: false,
    };
    try {
      const neutral = t.buildFins(model, result, ID, {
        mode: "auto",
        tines: true,
        tallRibs: true,
        tunables: base,
      });
      const extra = t.buildFins(model, result, ID, {
        mode: "auto",
        tines: true,
        tallRibs: true,
        tunables: {
          ...base,
          baseStyle: "cross",
          baseThickness: 4,
          baseSpread: 300,
          crossReach: 80,
          roundFeet: true,
        },
      });
      assert(
        neutral.tallRibs > 0,
        "the reference must actually exercise upstream tall-wall ribs",
      );
      assert(
        JSON.stringify(extra.triangles) === JSON.stringify(neutral.triangles),
      );
      const o = result.offset,
        requests = [{
          a: [20 + o.x, 10 + o.y, 110 + o.z],
          b: [60 + o.x, 10 + o.y, 110 + o.z],
        }];
      const run = (more) =>
        buildDrawn(model, result, ID, requests, {
          draw: { braceTall: true, tines: true },
          tunables: { ...base, ...more },
        });
      const plain = run({}),
        cross = run({ baseStyle: "cross", baseThickness: 4, roundFeet: true });
      assert(plain.items[0].ok && plain.items[0].info.braces > 0);
      assert(
        JSON.stringify(cross.triangles) === JSON.stringify(plain.triangles),
      );
    } finally {
      t.applyTunables({ tineDir: "horizontal", nozzle: 0.4, wallLines: 2 });
    }
  });
});
class FakeWorker {
  messages = [];
  postMessage(m) {
    this.messages.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(error) {
    const last = this.messages.at(-1);
    this.onmessage({ data: { id: last.id, error, built: { ok: true } } });
  }
}
Deno.test("Hjort queue: one pending preview, committed work first, model caches omitted", async () => {
  const worker = new FakeWorker(),
    q = new LatestWorker("", () => worker),
    model = { pos: [], vid: [1], _vgraph: [1], _insideGrid: { cell: () => 0 } };
  const active = q.run("preview", model, { n: 1 }),
    dropped = q.run("preview", model, { n: 2 }),
    latest = q.run("preview", model, { n: 3 });
  const build = q.run("build", model, { n: 4 }),
    place = q.run("place", model, { n: 5 }),
    auto = q.run("auto", model, { n: 6 });
  assert(await dropped === null);
  assert(
    !("_insideGrid" in worker.messages[0].model) &&
      !("vid" in worker.messages[0].model),
  );
  worker.reply();
  assert(await active === null);
  for (
    const [expected, promise] of [[6, auto], [5, place], [4, build], [
      3,
      latest,
    ]]
  ) {
    assert(worker.messages.at(-1).job.n === expected);
    assert(!worker.messages.at(-1).model);
    worker.reply();
    assert(await promise);
  }
  q.dispose();
});
Deno.test("Hjort queue: replaced models, cancellation and late errors cannot change a fresh build", async () => {
  const workers = [],
    q = new LatestWorker("", () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    });
  const old = q.run("build", { pos: [1] }, {}),
    fresh = q.run("build", { pos: [2] }, {});
  assert(await old === null && workers[0].terminated);
  workers[0].onerror({ preventDefault() {} });
  assert(!workers[1].terminated);
  q.cancel("build");
  workers[1].reply();
  assert(await fresh === null);
  q.dispose();
});
Deno.test("Hjort queue: one fresh-worker retry, then actionable rejection without inline work", async () => {
  const workers = [],
    q = new LatestWorker("", () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    }),
    model = { pos: [] };
  const promise = q.run("place", model, {});
  workers[0].reply("first failed");
  assert(workers.length === 2 && workers[0].terminated);
  workers[1].reply("retry failed");
  let error;
  try {
    await promise;
  } catch (e) {
    error = e;
  }
  assert(error && workers.length === 2 && !q.active && !q.pending.size);
  const next = q.run("place", model, {});
  workers[2].reply();
  assert(await next);
  q.dispose();
});
Deno.test("Hjort queue: unavailable workers settle after exactly two creation attempts", async () => {
  let attempts = 0;
  const q = new LatestWorker("", () => {
    attempts++;
    throw Error("not available");
  });
  let failed = false;
  try {
    await q.run("build", { pos: [] }, {});
  } catch {
    failed = true;
  }
  assert(failed && attempts === 2 && !q.active);
  q.dispose();
});
Deno.test("Hjort worker: Fit, Cross, contacts and on/off options match the current direct engine", async () => {
  const pos = Float32Array.from([
    ...block(-50, 50, -20, 20, 0, 30),
    ...block(-5, 5, -5, 5, 30, 78),
    ...block(-5, 40, -6, 6, 78, 81),
  ]);
  const topology = (await import("../web/overhangs.js")).buildTopology({
    getAttribute: () => ({ array: pos }),
  });
  const face = Array.from({ length: topology.nFaces }, (_, f) => f).find((f) =>
    topology.nrm[f * 3] > .9 && topology.pos[f * 9] === 40
  );
  const result = { offset: ZERO },
    q = new LatestWorker(new URL("../web/geometryworker.js", import.meta.url));
  try {
    for (const baseStyle of ["taper", "cross", "taper"]) {
      const requests = [{
          kind: "sway",
          face,
          a: [40, 0, 80],
          fitFeature: true,
        }],
        options = {
          sway: {
            tines: true,
            layerHeight: 0.6,
            tineSpacing: 1,
            full: true,
            iface: "all",
          },
          tunables: {
            iface: "all",
            nozzle: 0.8,
            wallLines: 2,
            baseStyle,
            roundFeet: true,
          },
        };
      const reply = await q.run("build", topology, {
        kind: "build",
        rot: ID,
        result,
        requests,
        options,
      });
      assert(reply?.built.items[0].ok, reply?.built.items[0].info.reason);
      const b = reply.built;
      assert(
        JSON.stringify(b) ===
          JSON.stringify(buildDrawn(topology, result, ID, requests, options)),
      );
      assert(
        b.items[0].info.tines >= 3 && b.items[0].triStart === 0 &&
          b.items[0].triEnd * 3 === b.triangles.length,
      );
      assert(isClosed(b.triangles) && isOriented(b.triangles));
      const { body, iface } = prop.splitInterface(b.triangles);
      assert(isClosed(body) && isClosed(iface));
    }
  } finally {
    q.dispose();
    fins.applyTunables({ iface: false, nozzle: 0.4, wallLines: 2 });
  }
});
Deno.test("Hjort worker: Auto ownership includes full-height bases and worker matches direct output", async () => {
  const topo = blockTopo(-80, 80, -60, 60, 0, 1000),
    result = analyze(topo, 45, ID),
    q = new LatestWorker(new URL("../web/geometryworker.js", import.meta.url));
  const opts = {
    mode: "auto",
    bedPad: false,
    tines: true,
    layerHeight: 0.6,
    sway: { on: true, uncappedDepth: true },
    tunables: {
      nozzle: 1.6,
      wallLines: 2,
      baseStyle: "cross",
      crossReach: 20,
      iface: "all",
    },
  };
  try {
    const reply = await q.run("auto", topo, {
        kind: "auto",
        rot: ID,
        result,
        opts,
      }),
      b = reply.built;
    assert(
      JSON.stringify(b.triangles) ===
        JSON.stringify(fins.buildFins(topo, result, ID, opts).triangles),
    );
    const records = b.fins.filter((f) => f.kind === "sway");
    assert(
      records.length > 0 && records.some((f) => f.baseReinforcement.cross) &&
        records.every((f) =>
          f.baseReinforcement.cross || f.baseReinforcement.reason
        ),
      JSON.stringify(records.map((f) => f.baseReinforcement)),
    );
    const claimed = new Uint8Array(b.triangles.length);
    for (const f of b.fins) {
      for (const [a, z] of f.triRanges) {
        assert(isClosed(b.triangles.slice(a, z)));
        for (let i = a; i < z; i++) claimed[i]++;
      }
    }
    assert(claimed.every((n) => n === 1));
  } finally {
    q.dispose();
    fins.applyTunables({ nozzle: 0.4, wallLines: 2, iface: false });
  }
});
