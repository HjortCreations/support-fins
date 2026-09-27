"""
What is UNDER the small overhangs the tool drops? (local issue 008, step 2 vs branching)

analyze() drops every overhang piece under 12 mm2 (MIN_REGION_AREA). For each
model and pose this takes those pieces, groups the ones within GROUP_GAP of each
other (what step 2 would do), and asks what is straight below each group's
lowest point:

  clear   air all the way to the bed        -> a wall from the bed can reach it
          (split by how tall that wall would be: short / mid / tall)
  part    part below, with room for a wall  -> a part-attached wall
  tight   part below, closer than MIN_H     -> nothing fits; orientation or nothing

Everything is area-weighted. `grouped` is how much of the dropped area ends up in
a group that reaches 12 mm2 once pieces are merged.

  python3 prototype/examples/probe_small.py [--poses up,x30,x60] [model.stl ...]
"""
import sys, os, glob
import numpy as np
import trimesh
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
THRESH = 45.0          # analyze(topo, 45, rot)
MIN_AREA = 12.0        # MIN_REGION_AREA
BED_EPS = 0.05
GROUP_GAP = 1.0        # mm; pieces this close become one group
MIN_H = 1.5            # PROP.minHeight: less headroom than this and no wall fits
SHORT, TALL = 10.0, 30.0

args = sys.argv[1:]
poses_arg = 'up,x30,x60'
if '--poses' in args:
    i = args.index('--poses'); poses_arg = args[i + 1]; del args[i:i + 2]
files = args or (sorted(glob.glob(f'{HERE}/models/*.stl')) + sorted(glob.glob(f'{HERE}/real/*.stl'))
                 + [os.path.expanduser('~/Downloads/ssdMounts-Chamfer.stl')])


def rot_x(d):
    a = np.radians(d); c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


POSES = {'up': np.eye(3), 'x30': rot_x(30), 'x60': rot_x(60), 'x90': rot_x(90)}
CATS = ['clear-short', 'clear-mid', 'clear-tall', 'part', 'tight']


def probe(mesh, R):
    v = mesh.vertices @ R.T
    v[:, 2] -= v[:, 2].min()
    m = trimesh.Trimesh(v, mesh.faces, process=False)
    n = m.face_normals
    fz = m.triangles[:, :, 2]
    over = (n[:, 2] < -np.cos(np.radians(THRESH))) & (fz.max(1) > BED_EPS)
    # overhang pieces: connected overhang faces (union-find over face adjacency)
    idx = np.where(over)[0]
    parent = {f: f for f in idx}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]; x = parent[x]
        return x
    for a, b in m.face_adjacency:
        if over[a] and over[b]:
            ra, rb = find(a), find(b)
            if ra != rb: parent[ra] = rb
    pieces = {}
    for f in idx:
        pieces.setdefault(find(f), []).append(f)
    area = m.area_faces
    small = [np.array(fs) for fs in pieces.values() if area[fs].sum() < MIN_AREA]
    if not small:
        return None
    # group small pieces whose vertices come within GROUP_GAP of each other
    pts, owner = [], []
    for k, fs in enumerate(small):
        vs = np.unique(m.faces[fs].ravel())
        pts.append(m.vertices[vs]); owner += [k] * len(vs)
    pts = np.vstack(pts); owner = np.array(owner)
    gp = list(range(len(small)))

    def gfind(x):
        while gp[x] != x:
            gp[x] = gp[gp[x]]; x = gp[x]
        return x
    for i, j in cKDTree(pts).query_pairs(GROUP_GAP):
        a, b = gfind(owner[i]), gfind(owner[j])
        if a != b: gp[a] = b
    groups = {}
    for k in range(len(small)):
        groups.setdefault(gfind(k), []).append(k)
    out = {c: 0.0 for c in CATS}
    total = grouped = 0.0
    for ks in groups.values():
        fs = np.concatenate([small[k] for k in ks])
        a = area[fs].sum(); total += a
        if a >= MIN_AREA: grouped += a
        tri = m.triangles[fs]
        lo = tri.reshape(-1, 3)[np.argmin(tri[:, :, 2].ravel())]
        # look down from just under the group's lowest point
        o = np.array([[lo[0], lo[1], lo[2] - 0.05]])
        locs, _, _ = m.ray.intersects_location(o, np.array([[0, 0, -1]]))
        below = [p[2] for p in locs if p[2] < lo[2] - 0.05]
        if below:
            gap = lo[2] - max(below)
            out['tight' if gap < MIN_H else 'part'] += a
        else:
            h = lo[2]
            out['clear-short' if h < SHORT else 'clear-tall' if h > TALL else 'clear-mid'] += a
    return total, grouped, len(small), len(groups), out


rows, tot = [], {c: 0.0 for c in CATS}
tot_all = tot_grouped = 0.0
print(f"{'model':34} {'pose':4} {'pcs':>5} {'grp':>4} {'mm2':>7} {'grp12%':>6}  " + '  '.join(f'{c:>11}' for c in CATS))
for f in files:
    try:
        mesh = trimesh.load(f, force='mesh')
    except Exception as e:
        print('skip', f, e); continue
    if len(mesh.faces) > 400000:
        print('skip (too big)', os.path.basename(f)); continue
    for pn in poses_arg.split(','):
        r = probe(mesh, POSES[pn])
        if not r: continue
        total, grouped, npc, ngr, out = r
        tot_all += total; tot_grouped += grouped
        for c in CATS: tot[c] += out[c]
        print(f"{os.path.basename(f)[:34]:34} {pn:4} {npc:5d} {ngr:4d} {total:7.0f} {100 * grouped / total:6.0f}  "
              + '  '.join(f'{100 * out[c] / total:10.0f}%' for c in CATS))
print()
print(f'ALL: {tot_all:.0f} mm2 dropped; {100 * tot_grouped / tot_all:.0f}% sits in a group >= {MIN_AREA:.0f} mm2 once pieces within {GROUP_GAP} mm merge')
print('   ' + '  '.join(f'{c} {100 * tot[c] / tot_all:.0f}%' for c in CATS))
