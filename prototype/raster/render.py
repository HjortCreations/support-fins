"""SPIKE: main vs spike side by side, seen from below-front.
   python3 render.py main.json spike.json title out.png"""
import json, sys
import numpy as np
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

def panel(ax, d, label):
    part = np.array(d['part'])
    held = {f: h for f, h in d['ovh']}
    fc = np.tile([0.78, 0.78, 0.80, 0.35], (len(part), 1))
    for f, h in held.items(): fc[f] = [0.20, 0.65, 0.30, 0.9] if h else [0.90, 0.25, 0.20, 0.9]
    ax.add_collection3d(Poly3DCollection(part, facecolors=fc, edgecolors='none'))
    if d['walls']:
        w = [t[:3] for t in d['walls']]
        wc = [[0.95, 0.60, 0.10, 1] if t[3] else [0.15, 0.40, 0.90, 1] for t in d['walls']]
        ax.add_collection3d(Poly3DCollection(w, facecolors=wc, edgecolors='none'))
    lo, hi = part.reshape(-1, 3).min(0), part.reshape(-1, 3).max(0)
    c, r = (lo + hi) / 2, (hi - lo).max() / 2
    ax.set_xlim(c[0] - r, c[0] + r); ax.set_ylim(c[1] - r, c[1] + r); ax.set_zlim(0, 2 * r)
    ax.view_init(elev=-18, azim=-60); ax.set_axis_off()
    held = 'n/a' if d['held'] is None else f"{100 * d['held']:.0f}%"
    ax.set_title(f"{label}: {d['nWalls']} walls, {held} held", fontsize=11)

a, b = json.load(open(sys.argv[1])), json.load(open(sys.argv[2]))
fig = plt.figure(figsize=(12, 6), dpi=110)
panel(fig.add_subplot(121, projection='3d'), a, 'main')
panel(fig.add_subplot(122, projection='3d'), b, 'spike (race)')
fig.suptitle(sys.argv[3] + '   green = held overhang, red = unheld, blue = main-style wall, orange = raster wall', fontsize=10)
plt.tight_layout(); plt.savefig(sys.argv[4])
