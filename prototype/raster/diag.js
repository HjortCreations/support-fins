// SPIKE diag: part-attached per-station verdicts for one model/pose.
//   deno run -A --import-map import_map.json diag.js <stl> [xdeg]
const WEB = new URL('../../web/', import.meta.url).pathname;
const { buildTopology, analyze } = await import(`${WEB}overhangs.js`);
const { buildFins } = await import(`${WEB}fins.js`);
const { DIAG } = await import('./attached_spike.js');
const b = Deno.readFileSync(Deno.args[0]);
const dv = new DataView(b.buffer), n = dv.getUint32(80, true), pos = new Float32Array(n * 9);
for (let f = 0; f < n; f++) for (let i = 0; i < 9; i++) pos[f * 9 + i] = dv.getFloat32(84 + f * 50 + 12 + i * 4, true);
const d = Number(Deno.args[1] ?? 0) * Math.PI / 180, c = Math.cos(d), s = Math.sin(d);
const rot = [1, 0, 0, 0, c, s, 0, -s, c];
const topo = buildTopology({ getAttribute: (k) => (k === 'position' ? { array: pos } : null) });
const res = analyze(topo, 45, rot);
const r = buildFins(topo, res, rot, { mode: 'auto', bedPad: true, tines: true });
console.log(JSON.stringify(DIAG), 'walls', r.props.length, 'raster regions', r.rasterRegions ?? '-');
