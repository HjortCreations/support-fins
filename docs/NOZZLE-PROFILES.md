# Nozzle and minimum wall thickness

This extends the existing nozzle scaling. **Setup → Nozzle** keeps the upstream
sizes and adds 1.0, 1.2, 1.6, 2.0, 2.4 and 3.0 mm. The printer nozzle is
remembered across visits. **Walls → Wall lines** chooses 2/4/6/8, default 2.

The requested minimum is `nozzle × 1.1 × line count`. Set the slicer's intended
line width to `nozzle × 1.1`, then inspect the sliced paths. The model thickness
is not a guarantee of an exact extrusion-path count: slicer width adaptation,
gap filling and the structural safety floors can change it.

| Nozzle | Lines | Requested minimum | Ordinary wall | Metre-high Sway |
|---|---|---|---|---|
| 0.4 mm | 2 | 0.88 mm | 1.0 mm | 2.4 mm |
| 0.4 mm | 8 | 3.52 mm | 3.52 mm | 3.52 mm |
| 0.8 mm | 4 | 3.52 mm | 3.52 mm | 4.8 mm |
| 1.6 mm | 8 | 14.08 mm | 14.08 mm | 14.08 mm |
| 3.0 mm | 8 | 26.4 mm | 26.4 mm | 26.4 mm |

Walls and wedges use the larger of that minimum and their upstream nozzle-scaled
thickness. Sway additionally keeps its scaled, height-based safety floor,
recomputed from its actual height when a collision shortens it. Default two
lines reproduce upstream geometry at every previously supported nozzle size.
Increasing the line count leaves nozzle-scaled contact tips and tines alone.

Thickness and **Full brace depth** are separate. Depth retains the usual 60 mm
limit unless that existing option is selected; a thicker brace can still be
shortened or refused by collision checks. Foot padding, support ownership,
contact-material tags and STL/3MF export follow the existing paths. Layer height
remains bounded to 0.6 mm in the interface and plugin schema.

Line count is saved with the part's 3MF session and can be undone/redone.
Importing a saved session leaves the current printer nozzle alone, so check its
sliced supports again when moving between printers. Plugins retain their
upstream dialogs; this PR does not add a line-count option there. Engine callers
can send `tunables: { nozzle: 1.6, wallLines: 8 }`. Omitting `wallLines` resets
it to 2 in a reused engine while retaining its current nozzle and clearances.

The geometry is tested with synthetic metre-high models, real worker requests,
Draw, interface crests, collisions, ownership and exports. No physical adhesion,
breakaway or stability results are claimed for large nozzles or these line
counts. Wider contacts at large nozzles may leave larger marks; thick bodies use
more material and plate space. Inspect the slicer preview and print test pieces
before adopting a combination for a tall part.
