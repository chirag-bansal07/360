# SunCraft3D

Solar plant layout planner. Runs on this computer; all projects are saved in `data/db.json`.

## Start

Double-click **Start SunCraft3D.bat**, or run:

    npx next start -p 3600

then open http://localhost:3600. After changing any code, run `npx next build` first.

## Workflow

1. **Projects > Create new project**: paste a Google Maps link (or coordinates, or a place name), press Find, drag the pin onto the roof.
2. **Edit design**: Add panel block, then type rows, columns, gaps, tilt, facing direction and height. Drag blocks to place them.
3. **Add / remove panels**: click single panels to take them out or put them back (in the editor or in the 3D view).
4. **Calculate generation**, then open the **3D view** or the **Report** and press Download PDF.

Company name, logo, your own module models and loss values are in **Settings**.

## Where things are

- `lib/geometry.ts` panel positions from rows / columns / gaps
- `lib/energy.ts` shading and generation model
- `lib/engine.ts` 3D scene (three.js)
- `app/` screens and the local API
- `docs/arka-walkthrough-notes.md` notes on the workflow this was modelled on

## Data sources

- Satellite imagery: Esri World Imagery (tiles are cached in `data/tiles`). Check Esri's terms before commercial use.
- Weather: NASA POWER monthly climatology, downloaded once per project.
- Place search: OpenStreetMap Nominatim.
