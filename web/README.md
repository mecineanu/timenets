# TimeNets — web port (2026)

A TypeScript + React + D3 port of Akinu's **TimeNets** visualization
(Nam Wook Kim, Stuart Card, Jeffrey Heer — *Tracing Genealogical Data with TimeNets*, AVI 2010).
The original code (Flex/ActionScript 3, 2010) lives in `../vis/genvis`; this folder replaces its
visualization part, with no Flash and no server.

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm test         # engine tests (Vitest)
npm run build    # static site in dist/
```

## What was ported

| Original (`vis/genvis/src/genvis`) | Here |
|---|---|
| `data/Person.as`, `Marriage.as`, `Event.as` | `src/model/genealogy.ts` |
| `data/DataEstimator.as` | `src/model/estimator.ts` |
| GEDCOM import (Rails, `lib/gedcom.rb`) | `src/model/io.ts` (+ a JSON format) |
| `vis/data/Data.as`, `NodeSprite`, `BlockSprite`, `EdgeSprite` | `src/engine/scene.ts` |
| `vis/operator/filter/FisheyeFilter.as` | `src/engine/fisheye.ts` |
| `vis/lifeline/Lifeline.as`, `LineSpline.as` | `src/engine/lifeline.ts` |
| `vis/operator/layout/LifelineLayout.as` | `src/engine/layout.ts` |
| `vis/data/render/LifelineRenderer.as`, `AttributeRenderer.as` | `src/engine/render.ts` → `src/ui/TimeNetView.tsx` |
| `GenVis.as` (controls) | `src/engine/timenet.ts`, `src/App.tsx` |

Features: lifelines on a real time axis; lines converge at marriage and diverge at divorce ("dating"
points 5 years before, "resting" points 5 years after); simultaneous marriages on separate lanes with
lane changes; dashed parent–child drop lines (including children born out of wedlock); hourglass
placement (ancestors above, descendants below); degree of interest (Furnas fisheye); greedy
simplification to fit the screen, with stubs for collapsed branches; estimated dates drawn as
gradients; a halo on estimated marriage dates; historical events (bands) and personal events (dots);
two styles (thick lines with the name inside / thin lines with the name above); curved or straight lines.

Interaction: click = focus, double-click = new root, Ctrl/⌘+click = pin a focus (DOI mode),
wheel = zoom, drag = pan, search by name, drag-and-drop import.

## Deliberate differences from the 2010 code

- **Estimation**: two bugs fixed — a birth inferred from the parents' marriage landed in year 0 or 28
  (operator precedence), and the "marriage = eldest child's birth" rule was always overwritten.
- **Block simplification**: the original sorted by DOI *descending* although its comment says
  "lowest first"; we follow the comment (and Figure 11 of the paper).
- **Vertical placement**: descendants are placed before the father's ancestors, which are then tested
  against every block already placed, not just the root (the original could overlap an ancestor with a
  descendant). Outside DOI mode, the chart is centered when it fits on screen.
- **`fitLayoutToScreen`**: guard against a possible infinite loop in the original.
- No data editing, accounts or collaboration (that was the Rails part of Akinu).

## Input formats

**GEDCOM 5.5**: `INDI` (`NAME`, `SEX`, `BIRT`/`CHR`, `DEAT`/`BURI` with `DATE`, qualifiers `ABT`,
`BEF`, `AFT`, `BET … AND …`) and `FAM` (`HUSB`, `WIFE`, `CHIL`, `MARR`, `DIV`).

**JSON** (modelled on Akinu's database tables) — see `src/samples/martin-family.json`:

```json
{
  "title": "…", "root": "claude",
  "people": [{ "id": "claude", "firstName": "Claude", "lastName": "Martin", "sex": "M",
               "birth": "1935-08-02", "death": "2015-06-19", "father": "jean", "mother": "helene",
               "birthUncertain": false }],
  "marriages": [{ "spouses": ["claude", "anne"], "start": "1958-09-13", "end": "1967-03-01", "divorced": true }],
  "events": [{ "name": "World War II", "start": "1939-09-01", "end": "1945-05-08", "historical": true },
             { "name": "Family reunion", "start": "2010-08-14", "people": ["claude", "anne"] }]
}
```

Dates can be `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Each family needs at least one real date: the others
are estimated (and shown as uncertain).

Both sample datasets (`martin-family.json`, `haddad-family.ged`) are fictional.
