# Raster-fins spike (issue 008, 2026-09-27)

Question: can walls cover curved / organic overhangs the way a slicer's grid
support does? A grid support is thin walls at a fixed pitch across the
overhang's footprint, each rising to whatever surface is above it. Our walls
already follow the surface (contourTop / settleTop); what held them back is
the PLACEMENT: a curved region got one wall under its lowest line (tubeLine),
everything else was split into 15-degree patches and patches under 12 mm2 were
dropped.

The spike changes placement only, in a copy of web/prop.js; every wall still
goes through the engine's own clearance, weld and settle checks.

- `prop_raster.js`   buildProps copy. Raster = patchTracks over the WHOLE region,
                     tracks cut where the floor changes plate/part (splitByFloor),
                     and every usable run of a track kept, not just the longest.
                     Default = race: build main and raster, each region keeps the
                     one holding more overhang area (rival.js's rule).
- `attached_spike.js` attached.js copy with a DIAG counter and SPIKE_BORES=1.
- `import_map.json`  swaps web/prop.js for the copy, so any harness runs it.

    cd prototype/examples
    RASTER=0|only|race deno run -A --import-map ../raster/import_map.json probe.js [--real]
    # RASTER=0 must print exactly what plain probe.js prints (checked)

    cd prototype/raster
    deno run -A [--import-map import_map.json] dump.js <stl> <xdeg> out.json
    python3 render.py main.json spike.json title out.png

The import map holds an absolute path: regenerate it on another checkout.
Results: local-issues/008-branching-curved-minis.md, "Raster spike".
