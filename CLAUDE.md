# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An After Effects dockable ScriptUI panel that reads a Figma-exported SVG and rebuilds it as native AE **shape layers** (one layer per Figma layer), or, when Figma's "Outline text" is off, as editable **text layers**. The shipping artifact is a single self-contained ExtendScript file, `dist/SVG Splitter.jsx`, generated from `src/`.

## Commands

```bash
node build.js            # lint gate + concatenate src/ into dist/ (run after ANY src change)
npm test                 # all unit tests (node --test)
node --test test/scene.test.js          # a single test file
node --test test/scene.test.js --test-name-pattern "gradient"   # a single test by name
npm run e2e              # full end-to-end suite (requires macOS + AE 2026 + Chrome — see below)
node test/e2e/run.js gradients strokes  # run E2E for matching fixtures only
```

**`node build.js` runs ESLint first and aborts the build on any error** — there is no separate lint script. Edit `src/`, never `dist/`; the two `dist/*.jsx` files are generated and must be rebuilt and committed together with the source.

## The ES3 constraint (most important thing to know)

Everything under `src/` runs inside After Effects' **ExtendScript engine, which is ES3**. `eslint.config.js` parses with `ecmaVersion: 3`, so the following fail the build gate at parse time: `const`/`let`, arrow functions, getters/setters, trailing commas, and reserved words as bare property names. Write `var`, function expressions, and classic loops.

Two project-specific rules beyond plain ES3:
- **No `for...in`** — banned via `no-restricted-syntax` because the AE engine is shared across scripts and prototypes may be polluted. Iterate arrays with indexed `for` loops; for keyed lookups use an array of pairs, not object enumeration.
- ExtendScript host globals (`app`, `File`, `CompItem`, `BlendingMode`, etc.) and ES3 built-ins are whitelisted in `eslint.config.js`. Add new host globals there rather than disabling `no-undef`.

## Architecture

The code is two layers glued by one data contract, then concatenated in a fixed order into a single IIFE by `build.js`.

### `src/core/` — pure, host-free geometry & parsing
Plain JS with **no AE API calls**, so it's unit-testable in Node via a `vm` sandbox (`test/load-core.js` concatenates the same core files the way ExtendScript sees them). Each file hangs a namespace off the global `SVGSPLIT` object and depends on earlier ones — **order matters** (`matrix → color → xml → path → shapes → style → scene`). The pipeline: `xml` tokenizes, `path`/`shapes` produce contours, `style` computes inherited/cascaded properties, `matrix` bakes transforms into geometry, and `scene.js` orchestrates all of it.

`SVGSPLIT.scene.build(svgText, opts)` is the entry point and the seam between the two layers. It returns a **serializable scene spec** — `{ width, height, layers: [layerSpec], warnings }` — with no AE objects in it. The full shape of `layerSpec`, `item`, and `paint` is documented in the header comment of `src/core/scene.js`; read it before touching scene output or the builder. Key conventions baked into the contract: document order = paint order (first layer is bottom in AE), transforms are already applied to coordinates, and clips arrive as pre-baked contour sets meant to be merge-intersected.

### `src/ae/` — the AE-only side
Consumes the scene spec and talks to the live AE API.
- `builder.jsx` (`SVGSPLIT.ae`) — `importFile(path, opts)` reads the file and calls `scene.build`, then `buildComp(scene, opts)` creates the comp and turns each `layerSpec` into a shape or text layer, adds effects (Drop Shadow, Gaussian Blur) and blend modes. This is where AE enum values (fill rule, caps/joins, merge modes) and empirical render-match factors live — several are annotated as "verified by the E2E probe."
- `panel.jsx` (`SVGSPLIT.ui`) — the ScriptUI panel; `run(thisObj)` builds the UI and calls `SVGSPLIT.ae.importFile`. `build.js` appends `SVGSPLIT.ui.run(thisObj)` as the bundle's entry point.
- `gradients.jsx` / `grad-canonical.jsx` — gradient color stops **cannot** be set through the AE scripting API, so stops are injected via a temporary `.ffx` animation preset (technique adapted from Google AEUX). This requires the AE preference "Allow Scripts to Write Files and Access Network." See the memory note on AE ExtendScript quirks for details.

### Two build outputs
`build.js` emits two flavors from the same source: `dist/SVG Splitter.jsx` (ends with `SVGSPLIT.ui.run(thisObj)` — the installable panel) and `dist/svg-splitter-lib.jsx` (no UI; exposes `SVGSPLIT` on `$.global` so the E2E harness can drive `SVGSPLIT.ae.importFile()` headlessly).

## Testing model

Unit tests cover `src/core/` only (the host-free layer) and are the fast feedback loop. The AE-side code (`src/ae/`) has no unit coverage because it needs a live host — it's verified exclusively by the **E2E suite**, which is the project's correctness bar:

`test/e2e/run.js` drives a real **After Effects 2026** over each `test/fixtures/*.svg` (via AppleScript `DoScriptFile` on the lib bundle + a generated harness), renders the resulting comp to PNG, renders the same SVG in headless **Chrome** as ground truth, and pixel-compares. Per-fixture tolerance and intentional-divergence exceptions live in the `POLICY` map at the top of `run.js` (e.g. `text-real.svg` skips pixel comparison because font rasterization isn't comparable; `mask-alpha.svg` imports unmasked by design). E2E is **macOS-only** and needs the AE scripting-write preference enabled plus a one-time Automation permission prompt.

When you change `src/ae/` you generally **cannot verify it in this environment** (no AE) — say so explicitly and flag that an E2E/live-AE run is still needed, rather than claiming it works.

## Fixtures

`test/fixtures/` holds hand-built Figma-style SVGs, each targeting a feature area (`gradients`, `strokes-dashes`, `clip-compound`, `text-real`, `kitchen-sink`, etc.); `MANIFEST.md` describes what each exercises. Add a fixture when adding a feature and wire any needed tolerance into the `POLICY` map.
