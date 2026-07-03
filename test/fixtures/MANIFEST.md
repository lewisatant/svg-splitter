# SVG Fixture Battery

Test fixtures for the Figma-SVG -> After Effects converter. Every file mimics the
modern Figma exporter's output patterns exactly:

- Root tag: `<svg width="W" height="H" viewBox="0 0 W H" fill="none" xmlns="http://www.w3.org/2000/svg">`
- `<defs>` at the **end** of the document; generated ids in Figma's
  `clip0_402_1234` / `paint0_linear_402_1234` / `filter0_d_402_1234` style
- Solid fills as `fill="#RRGGBB"` with a separate `fill-opacity` attribute
- Compound paths carry paired `fill-rule="evenodd" clip-rule="evenodd"`
- Frame exports wrap content in `<g clip-path="url(#clip0_...)">` whose
  `<clipPath>` holds `<rect width height fill="white"/>` covering the viewBox
- One tag per line, no indentation (matching real Figma output)

"Expected layer count" below is for the default **toplevel** split mode of
`SVGSPLIT.scene.build(svgText, {})`. All numbers, warnings, and effect specs were
verified against the actual scene builder (`test/load-core.js` + `src/core/*`).
The viewBox-covering clip wrapper is recognized as a no-op and unwrapped, so its
children become the top-level layers (this is silent — no warning).

---

## 1. icons-holes.svg — 100x100

**Purpose:** Compound paths with holes (evenodd) under the standard Figma frame
clip wrapper, "Include id" export style (human-readable `id` attributes become
layer names).

**Inventory:**
- `<g clip-path="url(#clip0_402_1234)">` viewBox-covering wrapper (no-op)
- `<path id="Donut">` — red `#FF2D55` ring at (30,50): two same-direction circular
  subpaths (outer r=22, inner r=10), `fill-rule="evenodd" clip-rule="evenodd"`
- `<path id="LetterO">` — blue `#0066FF` letter-O at (70,50): outer ellipse
  rx=16/ry=22, inner ellipse rx=8/ry=14, evenodd
- `<defs>` with `clipPath#clip0_402_1234` (100x100 white rect)

**Expected (toplevel):** **2 layers** — `"Donut"`, `"LetterO"`. Each has 1 item
with 2 contours, `fillRule=evenodd`, solid fill, opacity 1, `clips=0` (wrapper
clip is a viewBox no-op and must be dropped). Correct conversion renders both
holes as transparent (donut hole and O counter punch through).

**Expected warnings:** none.

## 2. flat-no-ids.svg — 100x100

**Purpose:** Same two shapes as icons-holes.svg but exported with "Include id"
OFF: no ids, no groups, no clip wrapper — flat sibling `<path>` elements.
Pixel output must be identical to icons-holes.svg.

**Inventory:** two `<path fill-rule="evenodd" clip-rule="evenodd">` siblings
(`#FF2D55` donut, `#0066FF` letter-O), nothing else.

**Expected (toplevel):** **2 layers** with fallback names `"path 1"`, `"path 2"`
(no ids to use). Same geometry/fills as fixture 1.

**Expected warnings:** none.

## 3. groups-transforms.svg — 120x120

**Purpose:** Transform composition through a 3-deep named `<g>` hierarchy:
`translate`, `translate+scale` combo, 3-arg `rotate(15 cx cy)`, and Figma's
horizontal-flip idiom `matrix(-1 0 0 1 tx 0)`.

**Inventory:**
- `<g id="Scene">` (no transform)
  - `<g id="Widget" transform="translate(10 10)">`
    - `<g id="Dial" transform="translate(20 20) scale(0.5)">`
      - `<rect width="40" height="40" fill="#00C853" transform="rotate(15 20 20)"/>` — green, world center (40,40), 20x20 rotated 15deg
      - `<circle cx="60" cy="20" r="12" fill="#AA00FF"/>` — purple, world center (60,40), world r=6
    - `<path d="M60 10L90 40H60V10Z" fill="#FF6D00" transform="matrix(-1 0 0 1 160 0)"/>` — orange right triangle mirrored to world x 80..110
  - `<rect x="70" y="70" ... fill="#FFD600" transform="rotate(15 85 80)"/>` — yellow, rotated about (85,80)

**Expected (toplevel):** **1 layer** `"Scene"` with **4 items** (rect, circle,
path, rect) — all transforms baked into world-space contours. All transforms are
conformal (uniform scale / rotation / flip), so no approximation is needed.

**Expected warnings:** none.

## 4. strokes-dashes.svg — 100x100

**Purpose:** Figma center-stroke exports: every cap/join variant, miter limit,
both dash patterns, dash offset, stroke opacity, and an open stroked path with
no fill (fill suppressed by the root's `fill="none"` inheritance).

**Inventory (flat siblings, top to bottom):**
1. `<path d="M8 18L30 42L52 18L74 42L92 22">` open zigzag — `#E91E63`, width 4, `stroke-linecap="round" stroke-linejoin="round"`, no fill
2. `<path d="M8 56H92">` — `#00BCD4`, width 3, `stroke-linecap="butt"`, `stroke-dasharray="4 2"`
3. `<path d="M8 68H92">` — `#7C4DFF`, width 3, `stroke-opacity="0.7"`, `stroke-dasharray="8 4 2 4"`, `stroke-dashoffset="6"`
4. `<path d="M14 94L28 78L42 94H14Z">` closed triangle — `#FF9100`, width 3, `stroke-linejoin="miter" stroke-miterlimit="10"`
5. `<rect x="58" y="80" width="32" height="14">` — `#00E676`, width 3, `stroke-linejoin="bevel"`

**Expected (toplevel):** **5 layers** (`"path 1"`..`"path 4"`, `"rect 5"`). All
items fill=none, stroke specs verified: dashes `[4,2]` and `[8,4,2,4]`,
dashOffset 6, stroke opacity 0.7, miterLimit 10 on layer 4, join bevel on
layer 5, caps butt everywhere except round on layer 1.

**Expected warnings:** none.

## 5. gradients.svg — 100x100

**Purpose:** All three Figma gradient export forms, `userSpaceOnUse`, defs at end.

**Inventory:**
- `<rect width="100" height="40">` filled by `paint0_linear_402_1234`: diagonal
  linear x1=0 y1=0 x2=100 y2=40, 2 stops `#FF00A8` -> `#7000FF` with
  `stop-opacity="0.4"` on the second stop (first stop has no `offset` attr —
  Figma omits `offset="0"`)
- `<circle cx="30" cy="72" r="20">` filled by `paint1_radial_402_1234`: Figma
  radial canonical form `cx="0" cy="0" r="1"` +
  `gradientTransform="translate(30 72) rotate(90) scale(20)"`, stops
  `#FFE600` -> `#FF3D00`
- `<rect x="60" y="52" width="36" height="40" rx="6">` filled by
  `paint2_linear_402_1234`: vertical 3-stop linear `#00E5FF` / `#2979FF` (0.5) / `#651FFF`

**Expected (toplevel):** **3 layers** — `"rect 1"` (gradient/linear),
`"circle 2"` (gradient/radial: center (30,72), radius 20 — uniform scale, so
circular with no approximation), `"rect 3"` (gradient/linear, 3 stops). The
linear stops carry per-stop opacity (1.0 and 0.4).

**Expected warnings:** none (spreadMethod defaults to pad; radial is circular).

## 6. clip-nested.svg — 100x100

**Purpose:** A nested Figma frame: an inner clip whose rect (x=20 y=20 60x60)
does NOT cover the viewBox, so it must be baked as a real clip, while the outer
viewBox-covering wrapper is dropped. Content deliberately overflows the inner
clip on the left, top, and right.

**Inventory:**
- `<g clip-path="url(#clip0_402_77)">` — outer no-op wrapper
  - `<rect width="100" height="100" fill="#FFEB3B"/>` — yellow full-bleed background (NOT clipped by the inner frame)
  - `<g id="Frame 2" clip-path="url(#clip1_402_77)">` — nested frame
    - `<circle cx="20" cy="50" r="18" fill="#FF1744"/>` — red, overflows the clip's left edge (visible x 20..38 only)
    - `<rect x="55" y="10" width="35" height="35" fill="#00B0FF"/>` — blue, overflows the clip's top and right edges (visible 55..80 x, 20..45 y)
- `<defs>`: `clip0_402_77` (100x100 white rect), `clip1_402_77` (`<rect x="20" y="20" width="60" height="60" fill="white"/>`)

**Expected (toplevel):** **2 layers** — `"rect 1"` (background, `clips=0`) and
`"Frame 2"` (2 items, each with `clips=1` — the baked 60x60 rect contour set).
Correct conversion shows red only inside x>=20 and blue only inside the
20..80 square, over the full yellow background.

**Expected warnings:** none.

## 7. shadow-blur.svg — 100x100

**Purpose:** The two Figma effect-filter signatures: drop shadow (exact
`_d_` primitive chain) and layer/foreground blur (`_f_` chain with
`result="effect1_foregroundBlur_..."`).

**Inventory:**
- `<g filter="url(#filter0_d_402_88)">` wrapping
  `<rect x="25" y="18" width="50" height="50" rx="8" fill="#FF5722"/>` (orange)
- `<g filter="url(#filter1_f_402_88)">` wrapping
  `<circle cx="70" cy="78" r="14" fill="#00C2FF"/>` (cyan)
- `<defs>`:
  - `filter0_d_402_88` — `x="17" y="14" width="66" height="66"` (shape bounds
    padded by 2*stdDeviation and dy, as Figma computes),
    `filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB"`, chain:
    `feFlood(flood-opacity=0)` -> `feColorMatrix in="SourceAlpha"` (alpha 127) ->
    `feOffset dy="4"` -> `feGaussianBlur stdDeviation="4"` ->
    `feComposite operator="out"` -> `feColorMatrix` color matrix encoding
    rgba(0.321569, 0.0705882, 0.860784, 0.4) -> `feBlend` x2 with
    `result="effect1_dropShadow_402_88"` / `result="shape"`
  - `filter1_f_402_88` — `x="52" y="60" width="36" height="36"`, chain:
    `feFlood` -> `feBlend result="shape"` ->
    `feGaussianBlur stdDeviation="2" result="effect1_foregroundBlur_402_88"`

**Expected (toplevel):** **2 layers**:
- `"g 1"`: effects `[{type:'dropShadow', dx:0, dy:4, stdDeviation:4, color:{r:0.321569, g:0.0705882, b:0.860784}, opacity:0.4}]` (indigo shadow decoded from the second feColorMatrix, NOT from the SourceAlpha one)
- `"g 2"`: effects `[{type:'gaussianBlur', stdDeviation:2}]` (foreground blur converts; it must NOT be mistaken for background blur)

**Expected warnings:** none.

## 8. primitives.svg — 100x100

**Purpose:** Every drawable SVG primitive element in one flat document.

**Inventory:**
1. `<rect x="6" y="6" width="30" height="20" rx="5" fill="#F44336"/>` — rounded red
2. `<circle cx="70" cy="16" r="10" fill="#4CAF50"/>` — green
3. `<ellipse cx="24" cy="50" rx="16" ry="9" fill="#9C27B0"/>` — purple
4. `<line x1="50" y1="40" x2="92" y2="60" stroke="#FF9800" stroke-width="3"/>` — orange, stroke-only (open 2-point contour)
5. `<polyline points="8 90 24 72 40 90 56 72" stroke="#00BCD4" stroke-width="3"/>` — cyan, open, no fill (inherits root `fill="none"`)
6. `<polygon points="70 70 90 70 92 92 68 88" fill="#3F51B5"/>` — indigo, closed

**Expected (toplevel):** **6 layers** — `"rect 1"`, `"circle 2"`, `"ellipse 3"`,
`"line 4"`, `"polyline 5"`, `"polygon 6"`. Line and polyline are open stroked
contours with no fill; polygon is closed and filled.

**Expected warnings:** none.

## 9. text-real.svg — 120x40

**Purpose:** Figma "outline text" OFF export: a live `<text>` element in Figma's
exact attribute form.

**Inventory:**
- `<rect width="120" height="40" rx="8" fill="#FFD600"/>` — yellow pill backdrop
- `<text fill="#141414" xml:space="preserve" style="white-space: pre" font-family="Inter" font-size="14" font-weight="500" letter-spacing="0em"><tspan x="10" y="24.2">HELLO</tspan></text>`

**Expected (toplevel):** **2 layers** — `"rect 1"` (shape) and `"text 2"`
(kind=text) with one run: text "HELLO", pos (10, 24.2) (tspan x/y = baseline
position), font Inter, size 14, weight 500, color #141414, letterSpacing 0
(the `0em` unit is unsupported by parseLength and falls back to 0).

**Expected warnings:** on the text layer:
`"<text> converted to AE text layer(s); font metrics may differ (Figma usually outlines text on export)"`.

## 10. use-defs.svg — 100x40

**Purpose:** Old-exporter `<use xlink:href>` reuse of a defs path;
`xmlns:xlink` declared on root; fill set on `<use>` must inherit into the
referenced geometry; `x` attribute must translate each instance.

**Inventory:**
- `<use xlink:href="#star_402" fill="#FF3D00"/>` — orange star at x 6..34
- `<use xlink:href="#star_402" x="30" fill="#2962FF"/>` — blue star at x 36..64
- `<use xlink:href="#star_402" x="60" fill="#00C853"/>` — green star at x 66..94
- `<defs><path id="star_402" d="M20 4L24 14L34 14L26 21L29 31L20 25L11 31L14 21L6 14L16 14Z"/></defs>` — 10-point star outline, no fill of its own

**Expected (toplevel):** **3 layers** — `"use 1"`, `"use 2"`, `"use 3"`, each
with one item named `"star_402"`, identical geometry offset by 0/30/60 in x, and
three DIFFERENT solid fills (verified: #FF3D00, #2962FF, #00C853 — the `<use>`
fill wins because the defs path has none). The defs path itself must not
produce a fourth layer.

**Expected warnings:** none.

## 11. mask-alpha.svg — 100x100

**Purpose:** Figma alpha-mask export. Masks are NOT supported by the converter:
this fixture documents the required behavior — warn and import the content
unmasked. Pixel output will intentionally differ from a browser render (the
browser clips to the 70x70 `#D9D9D9` mask rect; the converter shows everything).

**Inventory:**
- `<mask id="mask0_402_55" style="mask-type:alpha" maskUnits="userSpaceOnUse" x="15" y="15" width="70" height="70">` containing Figma's canonical `#D9D9D9` mask rect (inline, before the content — where Figma puts it, not in defs)
- `<g mask="url(#mask0_402_55)">` containing:
  - `<circle cx="35" cy="50" r="30" fill="#FF1744"/>` — red (overflows the mask rect on the left)
  - `<rect x="45" y="30" width="50" height="45" fill="#651FFF"/>` — violet (overflows on the right)

**Expected (toplevel):** **1 layer** `"g 1"` with 2 items, `clips=0` (the mask is
ignored, content imported unmasked). The `<mask>` element itself is
non-rendered and must not become a layer or paint its gray rect.

**Expected warnings:** on the layer:
`"mask on <g> not supported; content imported unmasked"`.

## 12. opacity-blend.svg — 100x100

**Purpose:** Group opacity flattening, element-level `fill-opacity`, and Figma's
inline blend-mode style.

**Inventory:**
- `<rect x="10" y="35" width="55" height="30" fill="#FFD600"/>` — opaque yellow base
- `<g id="Ghost" opacity="0.5">` with two overlapping circles:
  `<circle cx="40" cy="40" r="22" fill="#D500F9"/>` (magenta) and
  `<circle cx="60" cy="40" r="22" fill="#00E676"/>` (green)
- `<rect x="30" y="55" width="45" height="30" fill="#FF6D00" fill-opacity="0.8" style="mix-blend-mode:multiply"/>` — orange, overlaps both the yellow rect and the circles

**Expected (toplevel):** **3 layers**:
- `"rect 1"`: opaque yellow, fill opacity 1
- `"Ghost"`: 2 items, each with fill opacity 0.5 (group opacity multiplied into
  children). Because the circles overlap, per-item opacity is only an
  approximation of true group opacity — hence the warning.
- `"rect 3"`: fill opacity 0.8, layer `blendMode = "multiply"`

**Expected warnings:** on the Ghost layer:
`"group opacity 0.5 on <g id=\"Ghost\"> flattened into children (overlap may differ)"`.

## 13. kitchen-sink.svg — 200x200

**Purpose:** The closest thing to a real Figma component export: viewBox clip
wrapper + three named component groups combining gradient fill, evenodd holes,
round-cap stroke, and a Figma drop shadow. Defs in Figma order:
filter, then paint, then clipPath.

**Inventory:**
- `<g clip-path="url(#clip0_402_999)">` — no-op wrapper
  - `<g id="Button">`: pill `<rect x="30" y="24" width="140" height="44" rx="22">`
    filled with diagonal linear gradient `paint0_linear_402_999`
    (`#FF00C7` -> `#5200FF`, userSpaceOnUse x1=30 y1=24 x2=170 y2=68), plus a
    gloss bar `<rect ... rx="7" fill="white" fill-opacity="0.25"/>`
  - `<g id="Icon">`: teal `#00BFA5` evenodd donut (two circular subpaths,
    center (60,130), outer r=26 / inner r=12) + yellow `#FFEA00` open check
    stroke `M50 130L58 138L72 122`, width 5, round cap/join
  - `<g id="Badge" filter="url(#filter0_d_402_999)">`: red `#FF1744` circle
    (140,130) r=24 + white rounded "minus" bar `<rect x="130" y="127" width="20" height="6" rx="3"/>`
- `<defs>`:
  - `filter0_d_402_999` — full Figma drop-shadow chain (identical structure to
    fixture 7), `x="108" y="102" width="64" height="64"`, dy=4, stdDeviation=4,
    black at 0.25 in the color feColorMatrix
  - `paint0_linear_402_999`, `clip0_402_999` (200x200 white rect)

**Render sanity (hand-traced):** Button pill spans x 30..170, y 24..68 with the
gloss bar inset in its upper half; Icon ring occupies x 34..86, y 104..156 with
the check crossing its hole; Badge circle occupies x 116..164, y 106..154 with
the minus bar centered; the three groups do not overlap and everything sits
inside the 200x200 viewBox (the shadow region 108..172 x, 102..166 y also fits).

**Expected (toplevel):** **3 layers**, first = bottom in AE:
1. `"Button"` — 2 items: gradient/linear fill rect + solid white rect at fill opacity 0.25
2. `"Icon"` — 2 items: evenodd 2-contour fill path + stroke-only path (w=5, round/round)
3. `"Badge"` — 2 items (solid fills), layer effects
   `[{type:'dropShadow', dx:0, dy:4, stdDeviation:4, color:{r:0,g:0,b:0}, opacity:0.25}]`

**Expected warnings:** none.

---

## Summary table (toplevel split mode)

| Fixture | Size | Layers | Warnings |
|---|---|---|---|
| icons-holes.svg | 100x100 | 2 | — |
| flat-no-ids.svg | 100x100 | 2 | — |
| groups-transforms.svg | 120x120 | 1 | — |
| strokes-dashes.svg | 100x100 | 5 | — |
| gradients.svg | 100x100 | 3 | — |
| clip-nested.svg | 100x100 | 2 | — |
| shadow-blur.svg | 100x100 | 2 | — |
| primitives.svg | 100x100 | 6 | — |
| text-real.svg | 120x40 | 2 | 1 (text conversion) |
| use-defs.svg | 100x40 | 3 | — |
| mask-alpha.svg | 100x100 | 1 | 1 (mask unsupported) |
| opacity-blend.svg | 100x100 | 3 | 1 (group opacity flattened) |
| kitchen-sink.svg | 200x200 | 3 | — |
