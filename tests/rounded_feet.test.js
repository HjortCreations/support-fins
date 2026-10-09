import { roundedFlange } from '../web/solids.js';
import { insidePart } from '../web/inside.js';
import { assert, isClosed, isOriented } from './_util.js';
const ID = [1,0,0,0,1,0,0,0,1], ZERO = {x:0,y:0,z:0};
Deno.test('review: rounded flange joints overlap both adjoining solids inside the original contour', () => {
  const section = (x, w, h) => [[x, -w, 0], [x, -w, h], [x, w, h], [x, w, 0]];
  const out = [];
  roundedFlange([section(-20, 3, 0.6), section(0, 4, 0.4), section(20, 3, 0.6)], out);
  // Two 20-vertex polygons (rounded only at the outside ends), then the joint.
  const segmentVertices = (4 * 20 - 4) * 3;
  const parts = [out.slice(0, segmentVertices), out.slice(segmentVertices, 2 * segmentVertices),
    out.slice(2 * segmentVertices)];
  assert(parts.every((p) => p.length && isClosed(p) && isOriented(p)), 'invalid joint or segment');
  const contains = (tris, x) => insidePart({ pos: new Float64Array(tris.flat()), nFaces: tris.length / 3 },
    ID, ZERO, x, 0.37, 0.17);
  assert(contains(parts[0], -0.0075) && contains(parts[2], -0.0075), 'joint merely touches first segment');
  assert(contains(parts[1], 0.0075) && contains(parts[2], 0.0075), 'joint merely touches second segment');
  assert(!contains(parts[0], 0) && !contains(parts[1], 0) && contains(parts[2], 0),
    'segment faces still meet coplanar or the connecting joint is missing');
  for (const [x, y, z] of out) {
    assert(x >= -20 && x <= 20 && z >= 0 && z <= 0.6);
    assert(Math.abs(y) <= 4 - Math.abs(x) / 20 + 1e-8, 'joint expands the original foot contour');
  }
});

