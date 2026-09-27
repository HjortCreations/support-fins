"""
Spike: CORBEL supports for small pegs sticking out of a vertical face
(local issue 008, ssdMounts-Chamfer.stl stood on end).

A corbel is a bracket grown off the upright face UNDER a peg, instead of a wall
up from the bed: the top pegs sit straight above the bottom pegs, so nothing can
stand on the bed under them. Each corbel is a heightfield solid:

  top     follows the peg's own underside, `gap` below it (the peg is round, so a
          flat top would only touch its middle); across the peg's slit, the top
          carries on from the neighbouring columns
  bottom  a line at `angle` from horizontal, from the back face up to the peg tip
          (never thinner than `tipMin`)
  back    `gap` off the plate face, tied to it by one-layer horizontal tines
          (bite into the part, overlap back into the corbel) -- every other layer for
          the first `denseH` mm, where the corbel is a sliver, then every `step`

Writes the part + corbels as one STL and as separate STLs, plus a short coupon
(the part cut at `couponZ`, bottom pegs only) to test before the full print.

  python3 prototype/spike_corbel.py [model.stl] [outdir]
"""
import sys, os
import numpy as np
import trimesh

SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser('~/Downloads/ssdMounts-Chamfer.stl')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser('~/Downloads/corbel-test')

C = dict(
    gap=0.2,        # breakaway clearance, top and back (PROP.gap)
    angle=55.0,     # deg from horizontal for the corbel's underside
    width=4.4,      # across the peg: spans the slit straight down its underside, and
                    # stops where the round underside turns steeper than 45 deg (+-2.2)
    tipMin=0.6,     # thinnest the corbel gets at the peg tip
    layerH=0.2,     # tines are exactly one layer
    tineW=0.5, bite=0.3, overlap=0.3,
    tineXs=(-1.8, 0.0, 1.8),   # tines across the corbel's back, relative to its centre
    denseH=1.0,     # tie every OTHER layer over the first mm (the corbel's thin start);
                    # every layer would stack into a solid post, not one-layer tines
    step=1.0,       # then every mm
    grid=0.25,      # heightfield sampling
    couponZ=25.0,
)

# --- the pose: stood on end (app: Rotate 90 X), centred, seated on z = 0 ---
m = trimesh.load(SRC)
R = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float)
v = m.vertices @ R.T
v[:, 0] -= (v[:, 0].min() + v[:, 0].max()) / 2
v[:, 1] -= (v[:, 1].min() + v[:, 1].max()) / 2
v[:, 2] -= v[:, 2].min()
part = trimesh.Trimesh(v, m.faces, process=True)
assert part.is_watertight

# --- find the pegs: whatever sticks out past the plate face on +y ---
ys = part.vertices[:, 1]
tipY = ys.max()
# the plate face is the most common vertex y below the peg tips (a big flat face)
cand = np.round(ys[ys < tipY - 0.5], 3)
vals, counts = np.unique(cand, return_counts=True)
faceY = float(vals[np.argmax(counts * (vals > 0))])
print(f'plate face y={faceY:.2f}, peg tips y={tipY:.2f}')

pv = part.vertices[part.vertices[:, 1] > faceY + 0.5]
pegs = []
for p in pv:
    for q in pegs:
        if abs(q[0] - p[0]) < 8 and abs(q[1] - p[2]) < 8:
            q[2].append(p); break
    else:
        pegs.append([p[0], p[2], [p]])
centres = []
for q in pegs:
    P = np.array(q[2])
    centres.append(((P[:, 0].min() + P[:, 0].max()) / 2, (P[:, 2].min() + P[:, 2].max()) / 2,
                    (P[:, 0].max() - P[:, 0].min()) / 2))
print('pegs (x, z, r):', [tuple(round(c, 2) for c in cc) for cc in centres])

ray = part.ray


def underside(x, y, zc):
    """Lowest part surface above (x, y) starting from below the peg, or None."""
    locs, _, _ = ray.intersects_location([[x, y, zc - 20]], [[0, 0, 1]])
    hs = [p[2] for p in locs if zc - 10 < p[2] < zc + 1]
    return min(hs) if hs else None


def corbel(xc, zc):
    g = C['gap']
    y0, y1 = faceY + g, tipY
    xs = np.arange(xc - C['width'] / 2, xc + C['width'] / 2 + 1e-9, C['grid'])
    ysg = np.linspace(y0, y1, max(3, int(round((y1 - y0) / C['grid'])) + 1))
    top = np.full((len(xs), len(ysg)), np.nan)
    for i, x in enumerate(xs):
        for j, y in enumerate(ysg):
            h = underside(x, y, zc)
            if h is not None:
                top[i, j] = h - g
    # the slit (and any other miss): carry on from the nearest column that hit
    for i in range(len(xs)):
        if np.isnan(top[i]).all():
            k = min((k for k in range(len(xs)) if not np.isnan(top[k]).all()), key=lambda k: abs(k - i))
            top[i] = top[k]
        for j in range(len(ysg)):
            if np.isnan(top[i, j]):
                top[i, j] = np.nanmin(top[i])
    # hold the gap SQUARE to the surface, not just vertically: on the peg's
    # curving flanks a vertical 0.2 mm is much less, so each top point takes the
    # lowest of its neighbours (one grid step covers slopes to 45 deg)
    pad = np.pad(top, 1, mode='edge')
    top = np.min([pad[1 + di:1 + di + nxT, 1 + dj:1 + dj + nyT]
                  for di in (-1, 0, 1) for dj in (-1, 0, 1)
                  for nxT, nyT in [top.shape]], axis=0)
    reach = y1 - y0
    drop = reach * np.tan(np.radians(C['angle']))
    zRef = top.min()                      # the underside line, level across the corbel
    bot = np.empty_like(top)
    for j, y in enumerate(ysg):
        bot[:, j] = np.minimum(top[:, j] - C['tipMin'], zRef - drop * (y1 - y) / reach)
    # heightfield solid: top + bottom grids, four sides
    nx, ny = len(xs), len(ysg)
    V = [[x, y, top[i, j]] for i, x in enumerate(xs) for j, y in enumerate(ysg)]
    V += [[x, y, bot[i, j]] for i, x in enumerate(xs) for j, y in enumerate(ysg)]
    T, B = (lambda i, j: i * ny + j), (lambda i, j: nx * ny + i * ny + j)
    F = []
    for i in range(nx - 1):
        for j in range(ny - 1):
            F += [[T(i, j), T(i + 1, j), T(i + 1, j + 1)], [T(i, j), T(i + 1, j + 1), T(i, j + 1)]]
            F += [[B(i, j), B(i + 1, j + 1), B(i + 1, j)], [B(i, j), B(i, j + 1), B(i + 1, j + 1)]]
    for i in range(nx - 1):
        for j, s in ((0, 1), (ny - 1, -1)):
            a, b, c, d = T(i, j), T(i + 1, j), B(i + 1, j), B(i, j)
            F += [[a, d, c], [a, c, b]] if s > 0 else [[a, b, c], [a, c, d]]
    for j in range(ny - 1):
        for i, s in ((0, 1), (nx - 1, -1)):
            a, b, c, d = T(i, j), T(i, j + 1), B(i, j + 1), B(i, j)
            F += [[a, b, c], [a, c, d]] if s > 0 else [[a, d, c], [a, c, b]]
    body = trimesh.Trimesh(np.array(V), np.array(F), process=True)
    if body.volume < 0:
        body.invert()
    assert body.is_watertight and len(body.split(only_watertight=False)) == 1, 'corbel not one closed body'
    # tines: one layer each, from `bite` inside the face back into the corbel
    parts = [body]
    zBot, zTop = bot[:, 0].min(), top[:, 0].min()
    layer = C['layerH']
    z = np.ceil(zBot / layer) * layer
    n = 0
    while z + layer <= zTop - 0.4:
        for dx in C['tineXs']:
            box = trimesh.creation.box(
                extents=[C['tineW'], (y0 + C['overlap']) - (faceY - C['bite']), layer],
                transform=trimesh.transformations.translation_matrix(
                    [xc + dx, ((y0 + C['overlap']) + (faceY - C['bite'])) / 2, z + layer / 2]))
            parts.append(box); n += 1
        z += 2 * layer if z - zBot < C['denseH'] else C['step']
    return parts, dict(xc=round(xc, 2), top=round(zTop, 2), drop=round(zTop - zBot, 2),
                       vol=round(body.volume, 1), tines=n)


supports = []
for xc, zc, r in sorted(centres, key=lambda c: (c[1], c[0])):
    parts, info = corbel(xc, zc)
    print('corbel', info)
    supports += parts

sup = trimesh.util.concatenate(supports)
grams = sum(p.volume for p in supports) * 1.24 / 1000
print(f'corbels + tines: {grams:.3f} g PLA')

os.makedirs(OUT, exist_ok=True)
part.export(f'{OUT}/ssdMounts-onEnd-part.stl')
sup.export(f'{OUT}/ssdMounts-onEnd-corbels.stl')
trimesh.util.concatenate([part, sup]).export(f'{OUT}/ssdMounts-onEnd-with-corbels.stl')

# coupon: the bottom `couponZ` mm (bottom pegs + their corbels), capped
cz = C['couponZ']
cp = part.slice_plane([0, 0, cz], [0, 0, -1], cap=True)
cs = [s for s in supports if s.bounds[1][2] < cz]
coupon = trimesh.util.concatenate([cp] + cs)
coupon.export(f'{OUT}/coupon-bottom-{int(cz)}mm-with-corbels.stl')
print('coupon part watertight:', cp.is_watertight, ' corbels in coupon:', sum(1 for s in cs if s.volume > 10))
print('wrote', OUT)
