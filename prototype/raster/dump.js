// SPIKE: dump a model's seated part, support walls and overhang held/unheld to
// JSON for render.py. Run once plain (main) and once with the import map (spike).
//   deno run -A [--import-map import_map.json] dump.js <stl> <xdeg> <out.json> [off]
// (engine: 4th arg off = buildProps raster:false)
const WEB = new URL('../../web/', import.meta.url).pathname;
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { buildFins } = await import(`${WEB}fins.js`);
const { PROP } = await import(`${WEB}prop.js`);
const [file, xdeg, outPath] = Deno.args;
const b = Deno.readFileSync(file);
const dv = new DataView(b.buffer), n = dv.getUint32(80, true), pos = new Float32Array(n * 9);
for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
const d = Number(xdeg) * Math.PI / 180, c = Math.cos(d), s = Math.sin(d);
const rot = [1, 0, 0, 0, c, s, 0, -s, c];
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const res = analyze(topo, 45, rot);
const r = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true, raster: Deno.args[3] !== 'off' });
const off = res.offset;
const seat = (i) => [rot[0] * pos[i] + rot[3] * pos[i + 1] + rot[6] * pos[i + 2] + off.x,
  rot[1] * pos[i] + rot[4] * pos[i + 1] + rot[7] * pos[i + 2] + off.y,
  rot[2] * pos[i] + rot[5] * pos[i + 1] + rot[8] * pos[i + 2] + off.z];
const part = [];
for (let f = 0; f < topo.nFaces; f++) part.push([seat(f * 9), seat(f * 9 + 3), seat(f * 9 + 6)]);
// walls: the prop triangles by fin, tagged raster/main (race build only tags)
const walls = [];
for (const q of r.props) for (const [a, e] of q.triRanges) for (let i = a; i < e; i += 3)
  walls.push([r.triangles[i], r.triangles[i + 1], r.triangles[i + 2], q.raster ? 1 : 0]);
// held = probe.js's rule (wall-top point within span/2 in plan, 0..1.5 mm below)
const tops = r.props.flatMap((q) => q.line ?? []);
const R = PROP.maxUnsupportedSpan / 2, ovh = [];
let area = 0, held = 0;
for (const g of res.regions) for (const f of g.faces) {
  const t = part[f], cx = (t[0][0] + t[1][0] + t[2][0]) / 3, cy = (t[0][1] + t[1][1] + t[2][1]) / 3, cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
  const h = cz < 0.6 || tops.some((p) => { const dz = cz - p[2]; return dz >= -0.05 && dz <= 1.5 && Math.hypot(cx - p[0], cy - p[1]) <= R; });
  area += topo.area[f]; if (h) held += topo.area[f];
  ovh.push([f, h ? 1 : 0]);
}
Deno.writeTextFileSync(outPath, JSON.stringify({ part, walls, ovh, held: area ? held / area : null, nWalls: r.props.length }));
