# SVG Splitter

An After Effects ScriptUI panel that takes an SVG exported from Figma and
splits it into individual AE **shape layers** — preserving position, fills,
strokes, gradients, and layer structure — so you can animate your Figma
designs without retracing anything.

Verified end-to-end: the automated test suite drives a real After Effects
2026 instance over 13 Figma-style fixture SVGs and pixel-compares AE's render
against headless Chrome — 9 of 11 comparable fixtures match **pixel-perfect
(0.00% diff)**, the rest are within small documented tolerances.

## Install

1. Run `node build.js` (or grab `dist/SVG Splitter.jsx`).
2. Copy `dist/SVG Splitter.jsx` into After Effects' ScriptUI Panels folder:
   - macOS (app-wide, needs admin): `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`
   - macOS (per-user): `~/Documents/Adobe/After Effects 2026/Scripts/ScriptUI Panels/`
   - Windows: `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\`
3. Restart AE. The panel appears under **Window > SVG Splitter.jsx**.

Alternatively run it once via **File > Scripts > Run Script File…** (floating
palette, no install).

For full gradient support, enable
**Preferences > Scripting & Expressions > Allow Scripts to Write Files and
Access Network** (the gradient color stops are injected via a temporary
`.ffx` preset — an After Effects scripting-API limitation).

## Exporting from Figma

- Turn **"Include id attribute"** ON in Figma's SVG export options. Figma then
  keeps your layer names and group hierarchy; without it you get anonymous
  flat paths (the import still works, but layers are named `path 1`, `path 2`, …).
- Text: Figma outlines text by default (imports as shapes). Untick
  "Outline text" to get real editable AE text layers (font matching is
  best-effort).
- The default **"Simplify stroke"** export option is fine — inside/outside
  strokes arrive as center strokes.

## Usage

1. **Choose SVG…** — pick the exported file.
2. Split mode:
   - **One layer per top-level group** (default): each top-level Figma
     layer/group becomes one AE shape layer with its inner paths grouped inside.
   - **One layer per shape**: fully exploded; every path/rect/ellipse becomes
     its own layer (named by its hierarchy breadcrumb).
3. **Create Layers.** A comp sized to the SVG viewBox is created (or layers are
   added to the active comp if "Create new composition" is off). Warnings for
   anything that couldn't be converted 1:1 appear in the log list.

Every layer gets its anchor point at its visual center and sits exactly where
it was in the design — position, scale and rotation are immediately animatable.

## What converts

| SVG | After Effects |
|---|---|
| `path` (all commands, arcs, holes) | Shape paths (multi-contour, correct fill rule) |
| `rect`/`circle`/`ellipse`/`line`/`polyline`/`polygon` | Shape paths |
| transforms (nested, `rotate(a cx cy)`, `matrix`) | Baked into geometry (pixel-exact) |
| fills + `fill-opacity` + `fill-rule` | Fill (Even-Odd supported) |
| strokes: width, cap, join, miter, dashes, offset | Stroke (dash pairs capped at 3 by AE) |
| linear/radial gradients incl. per-stop alpha | Gradient Fill/Stroke with real stops (.ffx injection) |
| group/element `opacity` | Flattened into fill/stroke opacity |
| `mix-blend-mode` | Layer blending mode |
| Figma drop shadow filter | native AE **Drop Shadow** effect |
| Figma layer blur filter | native AE **Gaussian Blur** effect |
| `clipPath` (Figma frame clips) | ignored when it equals the canvas; otherwise Merge Paths ∩ |
| `<text>` (non-outlined) | AE text layer (baseline-aligned; font best-effort) |
| `<use>`/`defs` | resolved inline |

**Warned & skipped (v1):** masks (imported unmasked), inner shadows,
background blur, image/pattern fills (gray placeholder), angular gradients
(Figma exports these incorrectly as radial anyway).

## Development

```
npm install
npm test          # 221 unit tests over the ES3 core (Node)
node build.js     # lint (ES3 gate) + bundle dist/
npm run e2e       # full pipeline: drives AE 2026 via AppleScript, renders
                  # each fixture, pixel-diffs against headless-Chrome ground truth
```

The core (`src/core/`) is dependency-free ES3 JavaScript that runs unmodified
in both Node and ExtendScript. The AE side lives in `src/ae/`; `build.js`
concatenates everything into the single distributable `.jsx`.

### How gradients work (the .ffx trick)

AE has never exposed shape-layer gradient color stops to scripting
(`ADBE Vector Grad Colors` is `NO_VALUE` through AE 26.x). The tool applies
them by generating a temporary animation preset: a canonical AE 2026-authored
G-Fill preset (`tools/probe-canonical.ffx`) is used as the container, the
`Gradient Color Data` XML inside its RIFX `Utf8` chunk is regenerated for the
actual stops, ancestor chunk sizes are patched by the length delta, and the
preset is applied with the target property selected. Slot fidelity is verified
by round-tripping through a saved project. (The classic AEUX-era template
approach silently corrupts stop colors on AE 2026 because its RIFX sizes are
stale — AE truncates the XML mid-parse.) To regenerate the container from a
new AE version: build any shape-layer Gradient Fill, select the property,
Animation > Save Animation Preset…, then
`node tools/gen-grad-template.js path/to/preset.ffx`.

Technique lineage: [Google AEUX](https://github.com/google/AEUX) (Apache-2.0).
