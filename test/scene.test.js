'use strict';

// Tests for src/core/scene.js -- SVGSPLIT.scene.build(svgText, opts)

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./load-core.js');

const S = loadCore();

function build(svgText, opts) {
  return S.scene.build(svgText, opts);
}

// Default viewport wrapper: 100x100, viewBox 0 0 100 100.
function svg(inner, rootAttrs) {
  const attrs = rootAttrs !== undefined ? rootAttrs : 'width="100" height="100" viewBox="0 0 100 100"';
  return '<svg ' + attrs + '>' + inner + '</svg>';
}

function assertClose(actual, expected, eps, msg) {
  if (eps === undefined) eps = 1e-9;
  assert.ok(
    Math.abs(actual - expected) <= eps,
    (msg || 'value') + ': expected ' + expected + ' +/- ' + eps + ', got ' + actual
  );
}

// Objects built inside the vm sandbox have a foreign Object.prototype, which
// deepStrictEqual rejects; JSON round-trip re-creates them in this realm.
function norm(value) {
  return JSON.parse(JSON.stringify(value));
}

function xyOf(points) {
  return norm(points).map((p) => [p.x, p.y]);
}

function hasWarning(list, re) {
  return list.some((w) => re.test(w));
}

// ---------------------------------------------------------------- wrapper unwrap

test('Figma no-op clip wrapper is unwrapped into top-level layers with no clips', () => {
  const scene = build(
    '<svg width="100" height="100" viewBox="0 0 100 100" fill="none">' +
      '<g clip-path="url(#c)">' +
      '<rect id="A" width="100" height="100" fill="#f00"/>' +
      '<path id="B" d="M10 10L20 20" stroke="#000"/>' +
      '</g>' +
      '<defs><clipPath id="c"><rect width="100" height="100" fill="white"/></clipPath></defs>' +
      '</svg>'
  );
  assert.strictEqual(scene.width, 100);
  assert.strictEqual(scene.height, 100);
  assert.strictEqual(scene.layers.length, 2);
  assert.strictEqual(scene.layers[0].name, 'A');
  assert.strictEqual(scene.layers[1].name, 'B');
  assert.strictEqual(scene.layers[0].items.length, 1);
  assert.strictEqual(scene.layers[1].items.length, 1);
  // The viewBox-covering clip is a no-op: nothing gets a baked clip.
  assert.strictEqual(scene.layers[0].items[0].clips.length, 0);
  assert.strictEqual(scene.layers[1].items[0].clips.length, 0);
  // Root fill="none" is inherited: path B has stroke only.
  assert.strictEqual(scene.layers[1].items[0].fill, null);
  assert.ok(scene.layers[1].items[0].stroke);
});

// ---------------------------------------------------------------- clipping

test('non-noop clip (50x50 clip over 100x100 content) attaches one baked clip set', () => {
  const scene = build(
    svg(
      '<rect id="R" x="0" y="0" width="100" height="100" fill="#f00" clip-path="url(#c)"/>' +
        '<defs><clipPath id="c"><rect width="50" height="50"/></clipPath></defs>'
    )
  );
  assert.strictEqual(scene.layers.length, 1);
  const item = scene.layers[0].items[0];
  assert.strictEqual(item.clips.length, 1);
  const cb = S.path.bounds(item.clips[0]);
  assert.deepStrictEqual(norm(cb), { minX: 0, minY: 0, maxX: 50, maxY: 50 });
});

test('clip attaches even when content bbox is fully inside the clip (only viewBox-covering clips are dropped)', () => {
  // scene.js only checks clipIsViewBoxNoop (clip rect covering the whole
  // viewBox); it does NOT compare the clip against the content bbox. So a
  // 50x50 clip around a 20x20 rect at (10,10) still attaches.
  const scene = build(
    svg(
      '<rect x="10" y="10" width="20" height="20" fill="#f00" clip-path="url(#c)"/>' +
        '<defs><clipPath id="c"><rect width="50" height="50"/></clipPath></defs>'
    )
  );
  const item = scene.layers[0].items[0];
  assert.strictEqual(item.clips.length, 1);
});

// ---------------------------------------------------------------- split modes

const SPLIT_DOC = svg(
  '<g id="G">' +
    '<rect id="r1" x="0" y="0" width="10" height="10" fill="#f00"/>' +
    '<rect id="r2" x="20" y="0" width="10" height="10" fill="#0f0"/>' +
    '</g>'
);

test('splitMode toplevel: one layer per top-level candidate, items merged', () => {
  const scene = build(SPLIT_DOC, { splitMode: 'toplevel' });
  assert.strictEqual(scene.layers.length, 1);
  assert.strictEqual(scene.layers[0].name, 'G');
  assert.strictEqual(scene.layers[0].items.length, 2);
  assert.strictEqual(scene.layers[0].items[0].name, 'r1');
  assert.strictEqual(scene.layers[0].items[1].name, 'r2');
});

test('splitMode leaf: every item becomes its own layer', () => {
  const scene = build(SPLIT_DOC, { splitMode: 'leaf' });
  assert.strictEqual(scene.layers.length, 2);
  assert.strictEqual(scene.layers[0].items.length, 1);
  assert.strictEqual(scene.layers[1].items.length, 1);
  assert.match(scene.layers[0].name, /r1/);
  assert.match(scene.layers[1].name, /r2/);
});

// ---------------------------------------------------------------- CTM baking

test('nested transforms bake into vertices; stroke width and dashes scale', () => {
  const scene = build(
    svg(
      '<g transform="translate(10,0)"><g transform="scale(2)">' +
        '<rect x="5" width="10" height="10" fill="none" stroke="#000" stroke-width="3" stroke-dasharray="4 2"/>' +
        '</g></g>'
    )
  );
  assert.strictEqual(scene.layers.length, 1);
  const item = scene.layers[0].items[0];
  const pts = xyOf(item.contours[0].points);
  assert.deepStrictEqual(pts, [
    [20, 0],
    [40, 0],
    [40, 20],
    [20, 20],
  ]);
  assertClose(item.stroke.width, 6, 1e-9, 'stroke width under scale(2)');
  assert.strictEqual(item.stroke.dashes.length, 2);
  assertClose(item.stroke.dashes[0], 8, 1e-9, 'dash on');
  assertClose(item.stroke.dashes[1], 4, 1e-9, 'dash off');
});

// ---------------------------------------------------------------- viewBox handling

test('viewBox min-x/min-y offset is subtracted', () => {
  const scene = build(
    '<svg viewBox="10 10 100 100"><rect x="10" y="10" width="20" height="20" fill="#f00"/></svg>'
  );
  assert.strictEqual(scene.width, 100);
  assert.strictEqual(scene.height, 100);
  const p0 = scene.layers[0].items[0].contours[0].points[0];
  assertClose(p0.x, 0, 1e-9, 'x after viewBox offset');
  assertClose(p0.y, 0, 1e-9, 'y after viewBox offset');
});

test('width attribute 200 with viewBox 0 0 100 100 scales geometry by 2', () => {
  const scene = build(
    '<svg width="200" height="200" viewBox="0 0 100 100">' +
      '<rect x="10" y="10" width="10" height="10" fill="#f00"/></svg>'
  );
  assert.strictEqual(scene.width, 200);
  assert.strictEqual(scene.height, 200);
  const p0 = scene.layers[0].items[0].contours[0].points[0];
  assertClose(p0.x, 20, 1e-9);
  assertClose(p0.y, 20, 1e-9);
});

// ---------------------------------------------------------------- opacity math

test('fill opacity = group opacity x fill-opacity x paint alpha; stroke-opacity independent', () => {
  const scene = build(
    svg(
      '<g opacity="0.5">' +
        '<rect x="0" y="0" width="10" height="10" fill="rgba(255,0,0,0.5)" fill-opacity="0.5"' +
        ' stroke="#00f" stroke-opacity="0.4"/>' +
        '</g>'
    )
  );
  const item = scene.layers[0].items[0];
  assertClose(item.fill.opacity, 0.125, 1e-9, 'fill opacity product');
  // stroke: 0.5 (group) * 0.4 (stroke-opacity) * 1 (stroke paint alpha);
  // fill-opacity and fill alpha must NOT leak in.
  assertClose(item.stroke.opacity, 0.2, 1e-9, 'stroke opacity product');
});

// ---------------------------------------------------------------- fill rules & defaults

test('fill-rule evenodd propagates to item.fillRule; default is nonzero', () => {
  const scene = build(
    svg(
      '<rect x="0" y="0" width="10" height="10" fill="#f00" fill-rule="evenodd"/>' +
        '<rect x="20" y="0" width="10" height="10" fill="#f00"/>'
    )
  );
  assert.strictEqual(scene.layers[0].items[0].fillRule, 'evenodd');
  assert.strictEqual(scene.layers[1].items[0].fillRule, 'nonzero');
});

test('missing fill defaults to opaque black per SVG spec', () => {
  const scene = build(svg('<rect x="0" y="0" width="10" height="10"/>'));
  const fill = scene.layers[0].items[0].fill;
  assert.ok(fill, 'fill spec present');
  assert.strictEqual(fill.paint.type, 'solid');
  assert.deepStrictEqual(norm(fill.paint.color), { r: 0, g: 0, b: 0 });
  assertClose(fill.opacity, 1);
});

test('root fill="none" is inherited: element without own fill gets null fill', () => {
  const scene = build(
    '<svg width="100" height="100" viewBox="0 0 100 100" fill="none">' +
      '<rect x="0" y="0" width="10" height="10" stroke="#000"/></svg>'
  );
  assert.strictEqual(scene.layers[0].items[0].fill, null);
  assert.ok(scene.layers[0].items[0].stroke);
});

// ---------------------------------------------------------------- gradients

test('userSpaceOnUse linear gradient bakes element CTM into start/end', () => {
  const scene = build(
    svg(
      '<g transform="translate(10,0)"><rect x="0" y="0" width="80" height="80" fill="url(#lg)"/></g>' +
        '<defs><linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0">' +
        '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>' +
        '</linearGradient></defs>'
    )
  );
  const paint = scene.layers[0].items[0].fill.paint;
  assert.strictEqual(paint.type, 'gradient');
  assert.strictEqual(paint.kind, 'linear');
  assertClose(paint.start[0], 10, 1e-9, 'start x translated');
  assertClose(paint.start[1], 0, 1e-9, 'start y');
  assertClose(paint.end[0], 110, 1e-9, 'end x translated');
  assertClose(paint.end[1], 0, 1e-9, 'end y');
});

test('Figma unit-circle radial gradient: center from gradientTransform, radius from scale', () => {
  const scene = build(
    svg(
      '<rect x="10" y="10" width="80" height="80" fill="url(#rg)"/>' +
        '<defs><radialGradient id="rg" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse"' +
        ' gradientTransform="translate(50 50) rotate(45) scale(40)">' +
        '<stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/>' +
        '</radialGradient></defs>'
    )
  );
  const paint = scene.layers[0].items[0].fill.paint;
  assert.strictEqual(paint.type, 'gradient');
  assert.strictEqual(paint.kind, 'radial');
  assertClose(paint.start[0], 50, 1e-6, 'center x');
  assertClose(paint.start[1], 50, 1e-6, 'center y');
  const radius = Math.hypot(paint.end[0] - paint.start[0], paint.end[1] - paint.start[1]);
  assertClose(radius, 40, 1e-6, 'radius = |end - start|');
  assert.strictEqual(paint.hilite, null);
});

test('gradient stops parse numeric and percentage offsets and stop-opacity', () => {
  const scene = build(
    svg(
      '<rect x="0" y="0" width="10" height="10" fill="url(#lg)"/>' +
        '<defs><linearGradient id="lg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0">' +
        '<stop offset="0" stop-color="#ff0000"/>' +
        '<stop offset="50%" stop-color="#00ff00" stop-opacity="0.5"/>' +
        '<stop offset="1" stop-color="#0000ff"/>' +
        '</linearGradient></defs>'
    )
  );
  const stops = scene.layers[0].items[0].fill.paint.stops;
  assert.strictEqual(stops.length, 3);
  assertClose(stops[0].offset, 0);
  assertClose(stops[1].offset, 0.5, 1e-9, 'percentage offset');
  assertClose(stops[2].offset, 1);
  assertClose(stops[1].opacity, 0.5, 1e-9, 'stop-opacity');
  assert.deepStrictEqual(norm(stops[1].color), { r: 0, g: 1, b: 0 });
});

test('single-stop gradient collapses to a solid paint', () => {
  const scene = build(
    svg(
      '<rect x="0" y="0" width="10" height="10" fill="url(#lg)"/>' +
        '<defs><linearGradient id="lg"><stop stop-color="#ff0000" stop-opacity="0.5"/></linearGradient></defs>'
    )
  );
  const fill = scene.layers[0].items[0].fill;
  assert.strictEqual(fill.paint.type, 'solid');
  assert.deepStrictEqual(norm(fill.paint.color), { r: 1, g: 0, b: 0 });
  assertClose(fill.opacity, 0.5, 1e-9, 'stop opacity carried into solid');
});

test('gradient with no own stops falls back to href-referenced gradient stops', () => {
  const scene = build(
    svg(
      '<rect x="0" y="0" width="10" height="10" fill="url(#derived)"/>' +
        '<defs>' +
        '<linearGradient id="base">' +
        '<stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/>' +
        '</linearGradient>' +
        '<linearGradient id="derived" href="#base" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0"/>' +
        '</defs>'
    )
  );
  const paint = scene.layers[0].items[0].fill.paint;
  assert.strictEqual(paint.type, 'gradient');
  assert.strictEqual(paint.stops.length, 2);
  assert.deepStrictEqual(norm(paint.stops[0].color), { r: 1, g: 0, b: 0 });
  assert.deepStrictEqual(norm(paint.stops[1].color), { r: 0, g: 0, b: 1 });
});

// ---------------------------------------------------------------- currentColor

test('currentColor fill resolves through the color property', () => {
  const scene = build(
    svg('<rect x="0" y="0" width="10" height="10" color="#00ff00" fill="currentColor"/>')
  );
  const paint = scene.layers[0].items[0].fill.paint;
  assert.strictEqual(paint.type, 'solid');
  assert.deepStrictEqual(norm(paint.color), { r: 0, g: 1, b: 0 });
});

// ---------------------------------------------------------------- visibility / display

test('display:none subtree is pruned entirely (no layer)', () => {
  const scene = build(
    svg('<g display="none"><rect x="0" y="0" width="10" height="10" fill="#f00"/></g>')
  );
  assert.strictEqual(scene.layers.length, 0);
});

test('visibility:hidden leaf is skipped (no layer)', () => {
  const scene = build(
    svg('<rect x="0" y="0" width="10" height="10" fill="#f00" visibility="hidden"/>')
  );
  assert.strictEqual(scene.layers.length, 0);
});

// ---------------------------------------------------------------- <use>

test('<use x y> translates the referenced geometry', () => {
  const scene = build(
    svg(
      '<use href="#tpl" x="10" y="5"/>' +
        '<defs><rect id="tpl" x="0" y="0" width="10" height="10" fill="#f00"/></defs>'
    )
  );
  assert.strictEqual(scene.layers.length, 1);
  const pts = xyOf(scene.layers[0].items[0].contours[0].points);
  assert.deepStrictEqual(pts, [
    [10, 5],
    [20, 5],
    [20, 15],
    [10, 15],
  ]);
});

test('<use> with a missing target warns and emits no layer', () => {
  const scene = build(svg('<use href="#nope" x="10" y="5"/>'));
  assert.strictEqual(scene.layers.length, 0);
  assert.ok(
    hasWarning(scene.warnings, /<use> target "#nope" not found/),
    'expected missing-target warning, got: ' + JSON.stringify(scene.warnings)
  );
});

// ---------------------------------------------------------------- filters

test('Figma drop-shadow filter decodes to a dropShadow effect', () => {
  const scene = build(
    svg(
      '<g filter="url(#f1)"><rect x="10" y="10" width="50" height="50" fill="#f00"/></g>' +
        '<defs><filter id="f1" x="0" y="0" width="100" height="110" filterUnits="userSpaceOnUse">' +
        '<feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
        '<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>' +
        '<feOffset dy="4"/>' +
        '<feGaussianBlur stdDeviation="2"/>' +
        '<feComposite in2="hardAlpha" operator="out"/>' +
        '<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>' +
        '<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_2"/>' +
        '<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_2" result="shape"/>' +
        '</filter></defs>'
    )
  );
  assert.strictEqual(scene.layers.length, 1);
  const effects = scene.layers[0].effects;
  assert.strictEqual(effects.length, 1);
  assert.strictEqual(effects[0].type, 'dropShadow');
  assert.strictEqual(effects[0].dx, 0);
  assert.strictEqual(effects[0].dy, 4);
  assert.strictEqual(effects[0].stdDeviation, 2);
  assertClose(effects[0].opacity, 0.25, 1e-9, 'shadow opacity from feColorMatrix a-row');
});

test('Figma foreground blur filter (_f_ id, bare feGaussianBlur) decodes to gaussianBlur', () => {
  const scene = build(
    svg(
      '<g filter="url(#filter0_f_1_2)"><circle cx="50" cy="50" r="20" fill="#f00"/></g>' +
        '<defs><filter id="filter0_f_1_2" x="24" y="24" width="52" height="52" filterUnits="userSpaceOnUse">' +
        '<feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
        '<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>' +
        '<feGaussianBlur stdDeviation="3" result="effect1_foregroundBlur_1_2"/>' +
        '</filter></defs>'
    )
  );
  const effects = scene.layers[0].effects;
  assert.strictEqual(effects.length, 1);
  assert.strictEqual(effects[0].type, 'gaussianBlur');
  assert.strictEqual(effects[0].stdDeviation, 3);
});

test('Figma inner-shadow filter (feComposite arithmetic k2=-1 k3=1) warns and adds no effect', () => {
  const scene = build(
    svg(
      '<g filter="url(#f2)"><rect x="10" y="10" width="50" height="50" fill="#f00"/></g>' +
        '<defs><filter id="f2" x="10" y="10" width="50" height="54" filterUnits="userSpaceOnUse">' +
        '<feFlood flood-opacity="0" result="BackgroundImageFix"/>' +
        '<feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>' +
        '<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>' +
        '<feOffset dy="4"/>' +
        '<feGaussianBlur stdDeviation="2"/>' +
        '<feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>' +
        '<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>' +
        '<feBlend mode="normal" in2="shape" result="effect1_innerShadow_1_2"/>' +
        '</filter></defs>'
    )
  );
  assert.strictEqual(scene.layers.length, 1);
  assert.strictEqual(scene.layers[0].effects.length, 0);
  assert.ok(
    hasWarning(scene.layers[0].warnings, /inner shadow/),
    'expected inner-shadow warning, got: ' + JSON.stringify(scene.layers[0].warnings)
  );
});

// ---------------------------------------------------------------- mask / image / pattern

test('mask attribute warns but content is still imported', () => {
  const scene = build(
    svg(
      '<g mask="url(#m)"><rect x="0" y="0" width="10" height="10" fill="#f00"/></g>' +
        '<defs><mask id="m"><rect width="100" height="100" fill="#fff"/></mask></defs>'
    )
  );
  assert.strictEqual(scene.layers.length, 1);
  assert.strictEqual(scene.layers[0].items.length, 1);
  assert.ok(hasWarning(scene.layers[0].warnings, /mask on <g.*not supported/));
});

test('<image> becomes a placeholder rect item plus a warning', () => {
  const scene = build(svg('<image href="photo.png" x="5" y="5" width="50" height="30"/>'));
  assert.strictEqual(scene.layers.length, 1);
  const item = scene.layers[0].items[0];
  assert.strictEqual(item.fill.paint.type, 'placeholder');
  assert.deepStrictEqual(norm(S.path.bounds(item.contours)), { minX: 5, minY: 5, maxX: 55, maxY: 35 });
  assert.ok(hasWarning(scene.layers[0].warnings, /<image> not supported/));
});

test('pattern fill becomes a placeholder paint plus a warning', () => {
  const scene = build(
    svg(
      '<rect x="0" y="0" width="10" height="10" fill="url(#pat)"/>' +
        '<defs><pattern id="pat" width="4" height="4"><rect width="4" height="4" fill="#f00"/></pattern></defs>'
    )
  );
  const item = scene.layers[0].items[0];
  assert.strictEqual(item.fill.paint.type, 'placeholder');
  assert.ok(hasWarning(scene.layers[0].warnings, /pattern fill #pat not supported/));
});

// ---------------------------------------------------------------- text

test('<text> with tspan becomes a text layer with positioned run', () => {
  const scene = build(
    svg(
      '<text fill="#141414" font-family="Inter" font-size="14">' +
        '<tspan x="10" y="20">Hi</tspan></text>'
    )
  );
  assert.strictEqual(scene.layers.length, 1);
  const layer = scene.layers[0];
  assert.strictEqual(layer.kind, 'text');
  assert.strictEqual(layer.textRuns.length, 1);
  const run = layer.textRuns[0];
  assert.strictEqual(run.text, 'Hi');
  assertClose(run.pos[0], 10);
  assertClose(run.pos[1], 20);
  assertClose(run.fontSize, 14);
  assert.strictEqual(run.fontFamily, 'Inter');
  assertClose(run.color.r, 0x14 / 255, 1e-9);
  assertClose(run.color.g, 0x14 / 255, 1e-9);
  assertClose(run.color.b, 0x14 / 255, 1e-9);
  assertClose(run.opacity, 1);
});

// ---------------------------------------------------------------- blend mode

test('mix-blend-mode in a style attribute sets layer.blendMode', () => {
  const scene = build(
    svg('<rect x="0" y="0" width="10" height="10" fill="#f00" style="mix-blend-mode:multiply"/>')
  );
  assert.strictEqual(scene.layers[0].blendMode, 'multiply');
});

// ---------------------------------------------------------------- bbox / empties / dims

test('layer bbox expands by half the stroke width', () => {
  const scene = build(
    svg('<rect x="10" y="10" width="20" height="20" fill="none" stroke="#000" stroke-width="4"/>')
  );
  const bb = scene.layers[0].bbox;
  assertClose(bb.minX, 8);
  assertClose(bb.minY, 8);
  assertClose(bb.maxX, 32);
  assertClose(bb.maxY, 32);
});

test('empty group emits no layer', () => {
  const scene = build(svg('<g id="empty"></g>'));
  assert.strictEqual(scene.layers.length, 0);
});

test('comp dimensions are Math.ceil of the fractional viewBox size', () => {
  const scene = build('<svg viewBox="0 0 100.4 50.2"></svg>');
  assert.strictEqual(scene.width, 101);
  assert.strictEqual(scene.height, 51);
});
