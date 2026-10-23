// The new upstream anchor path must survive our optional Fit/Cross integration.
import { buildDrawn } from "../web/draw-build.js";
import { LatestWorker } from "../web/worker-queue.js";
import { analyze, assert, fins, isClosed, tiltedBlockTopo } from "./_util.js";
const ID = [1, 0, 0, 0, 1, 0, 0, 0, 1];
function anchor(deg) {
  const topo = tiltedBlockTopo(-25, 25, -6, 6, 0, 190, deg),
    result = analyze(topo, 45, ID);
  let face = -1;
  for (let f = 0; f < topo.nFaces; f++) {
    if (
      topo.nrm[f * 3 + 1] > .5 && (face < 0 || topo.area[f] > topo.area[face])
    ) face = f;
  }
  const c = [0, 1, 2].map((k) =>
    (topo.pos[face * 9 + k] + topo.pos[face * 9 + 3 + k] +
      topo.pos[face * 9 + 6 + k]) / 3
  );
  const ny = topo.nrm[face * 3 + 1], nz = topo.nrm[face * 3 + 2], z = 150;
  const a = [
    0,
    c[1] + result.offset.y - (z - c[2] - result.offset.z) * nz / ny,
    z,
  ];
  return { topo, result, request: { kind: "sway", face, a } };
}
function worstOverhang(tris) {
  let worst = 0;
  for (let i = 0; i < tris.length; i += 3) {
    const [a, b, c] = tris.slice(i, i + 3);
    if (Math.max(a[2], b[2], c[2]) < 0.01) continue;
    const u = b.map((v, k) => v - a[k]), v = c.map((v, k) => v - a[k]);
    const n = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ],
      len = Math.hypot(...n);
    if (len > 1e-9 && n[2] < 0) {
      worst = Math.max(
        worst,
        Math.asin(Math.min(1, -n[2] / len)) * 180 / Math.PI,
      );
    }
  }
  return worst;
}
Deno.test("Hjort anchor: Fit keeps a valid upstream anchor and Cross never adds an unprintable overhang", () => {
  try {
    for (const deg of [30, 40, 44]) {
      for (const reach of [20, 80]) {
        for (const baseThickness of [1, 4]) {
          const { topo, result, request } = anchor(deg);
          const options = {
            draw: { tines: false },
            sway: { tines: false, full: true, crossAbove: 100 },
            tunables: {
              tineDir: "horizontal",
              nozzle: 0.4,
              wallLines: 2,
              baseStyle: "cross",
              crossReach: reach,
              baseThickness,
            },
          };
          const b = buildDrawn(topo, result, ID, [{
            ...request,
            fitFeature: true,
          }], options);
          assert(b.items[0].ok, `${deg}: ${b.items[0].info.reason}`);
          assert(
            !b.items[0].info.fitted,
            "an ordinary upstream anchor must not take the Fit fallback",
          );
          assert(isClosed(b.triangles));
          const worst = worstOverhang(b.triangles);
          assert(
            worst <= 45.01,
            `${deg} degree back, reach ${reach}, base ${baseThickness}: ${
              worst.toFixed(1)
            } degree overhang`,
          );
        }
      }
    }
  } finally {
    fins.applyTunables({ tineDir: "horizontal", nozzle: 0.4, wallLines: 2 });
  }
});
Deno.test("Hjort anchor: a real worker retains upstream back-face placement and contact material", async () => {
  const { topo, result, request } = anchor(40),
    q = new LatestWorker(new URL("../web/geometryworker.js", import.meta.url));
  const options = {
    sway: { tines: true, layerHeight: 0.2, full: true, iface: 'all' },
    tunables: {
      tineDir: "horizontal",
      iface: "all",
      nozzle: 0.4,
      wallLines: 2,
    },
  };
  try {
    const reply = await q.run("build", topo, {
      kind: "build",
      rot: ID,
      result,
      requests: [request],
      options,
    });
    const b = reply.built;
    assert(b.items[0].ok && b.items[0].info.tines >= 10);
    assert(
      JSON.stringify(b) ===
        JSON.stringify(buildDrawn(topo, result, ID, [request], options)),
    );
    assert(
      b.triangles.some((p) => p[3] === 1),
      "interface contacts lost through the worker",
    );
  } finally {
    q.dispose();
    fins.applyTunables({
      tineDir: "horizontal",
      iface: false,
      nozzle: 0.4,
      wallLines: 2,
    });
  }
});
