'use strict';

// Regression tests for the bugs found by the code-review pass.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadCore } = require('./load-core.js');

const S = loadCore();

function svg(body, size) {
  const s = size || 100;
  return `<svg width="${s}" height="${s}" viewBox="0 0 ${s} ${s}" fill="none" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}

const SHADOW_FILTER = `<filter id="f1" x="0" y="0" width="100" height="100" filterUnits="userSpaceOnUse">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="4"/><feGaussianBlur stdDeviation="2"/><feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_f1"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_f1" result="shape"/>
</filter>`;

test('leaf mode: filter/blend stay scoped to their subtree (no leak onto siblings)', () => {
  const doc = svg(`<g id="grp">
    <rect id="a" width="10" height="10" fill="#f00" filter="url(#f1)" style="mix-blend-mode:multiply"/>
    <circle id="b" cx="30" cy="30" r="5" fill="#0f0"/>
    <rect id="c" x="50" width="10" height="10" fill="#00f" filter="url(#f1)"/>
  </g><defs>${SHADOW_FILTER}</defs>`);
  const out = S.scene.build(doc, { splitMode: 'leaf' });
  assert.strictEqual(out.layers.length, 3);
  const [a, b, c] = out.layers;
  assert.strictEqual(a.effects.length, 1, 'filtered rect has its shadow');
  assert.strictEqual(a.blendMode, 'multiply');
  assert.strictEqual(b.effects.length, 0, 'unfiltered circle must not inherit the shadow');
  assert.strictEqual(b.blendMode, null, 'unfiltered circle must not inherit blend mode');
  assert.strictEqual(c.effects.length, 1, 'second filtered rect has exactly one shadow (not doubled)');
  assert.strictEqual(c.blendMode, null);
});

test('leaf mode: group-level filter applies to every leaf inside the group', () => {
  const doc = svg(`<g id="grp" filter="url(#f1)">
    <rect width="10" height="10" fill="#f00"/>
    <circle cx="30" cy="30" r="5" fill="#0f0"/>
  </g><defs>${SHADOW_FILTER}</defs>`);
  const out = S.scene.build(doc, { splitMode: 'leaf' });
  assert.strictEqual(out.layers.length, 2);
  assert.strictEqual(out.layers[0].effects.length, 1);
  assert.strictEqual(out.layers[1].effects.length, 1);
});

test('mixed shape + text group keeps its shape items (kind stays shape)', () => {
  // sibling element keeps #card from being unwrapped as a solo frame wrapper
  const doc = svg(`<rect id="bg" width="100" height="100" fill="#eee"/><g id="card">
    <rect width="50" height="50" fill="#f00"/>
    <text x="20" y="40" font-size="12" fill="#000"><tspan x="20" y="40">Hi</tspan></text>
  </g>`);
  const out = S.scene.build(doc, { splitMode: 'toplevel' });
  assert.strictEqual(out.layers.length, 2);
  const card = out.layers[1];
  assert.strictEqual(card.kind, 'shape');
  assert.strictEqual(card.items.length, 1, 'rect survives');
  assert.strictEqual(card.textRuns.length, 1, 'text run captured');
});

test('pure text group still has kind text', () => {
  const doc = svg(`<text x="20" y="40" font-size="12" fill="#000">Hi</text>`);
  const out = S.scene.build(doc, {});
  assert.strictEqual(out.layers.length, 1);
  assert.strictEqual(out.layers[0].kind, 'text');
});

test('multi-shadow Figma filter (_dd_) decodes to two dropShadow effects', () => {
  const doc = svg(`<g filter="url(#filter0_dd_1_2)"><rect width="20" height="20" fill="#f00"/></g>
<defs><filter id="filter0_dd_1_2" x="0" y="0" width="60" height="60" filterUnits="userSpaceOnUse">
<feFlood flood-opacity="0" result="BackgroundImageFix"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="1"/><feGaussianBlur stdDeviation="1"/><feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0"/>
<feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_2"/>
<feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
<feOffset dy="8"/><feGaussianBlur stdDeviation="4"/><feComposite in2="hardAlpha" operator="out"/>
<feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 0 0 0.25 0"/>
<feBlend mode="normal" in2="effect1_dropShadow_1_2" result="effect2_dropShadow_1_2"/>
<feBlend mode="normal" in="SourceGraphic" in2="effect2_dropShadow_1_2" result="shape"/>
</filter></defs>`);
  const out = S.scene.build(doc, {});
  const fx = out.layers[0].effects;
  assert.strictEqual(fx.length, 2);
  assert.strictEqual(fx[0].dy, 1);
  assert.strictEqual(fx[0].opacity, 0.5);
  assert.strictEqual(fx[1].dy, 8);
  assert.strictEqual(fx[1].stdDeviation, 4);
  assert.strictEqual(fx[1].color.r, 1, 'second shadow keeps its own color');
});

test('visibility:hidden hides text and image elements too', () => {
  const doc = svg(`<text x="10" y="20" visibility="hidden">Hi</text>
    <image x="0" y="0" width="10" height="10" visibility="hidden" href="data:image/png;base64,x"/>
    <rect width="10" height="10" fill="#f00"/>`);
  const out = S.scene.build(doc, {});
  assert.strictEqual(out.layers.length, 1, 'only the rect renders');
  assert.strictEqual(out.layers[0].items[0].fill.paint.type, 'solid');
});

test('visibility can be restored by a child inside a hidden group', () => {
  const doc = svg(`<g visibility="hidden"><rect width="10" height="10" fill="#f00" visibility="visible"/><rect x="20" width="10" height="10" fill="#0f0"/></g>`);
  const out = S.scene.build(doc, {});
  assert.strictEqual(out.layers.length, 1);
  assert.strictEqual(out.layers[0].items.length, 1);
});

test('userSpaceOnUse gradient defaults follow the spec (x2=100%, r=50%)', () => {
  const doc = svg(`<rect width="200" height="100" fill="url(#g1)"/><rect y="120" width="200" height="60" fill="url(#g2)"/>
<defs>
<linearGradient id="g1" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></linearGradient>
<radialGradient id="g2" gradientUnits="userSpaceOnUse"><stop stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>
</defs>`, 200);
  const out = S.scene.build(doc, {});
  const lin = out.layers[0].items[0].fill.paint;
  assert.deepStrictEqual([lin.start[0], lin.start[1]], [0, 0]);
  assert.deepStrictEqual([lin.end[0], lin.end[1]], [200, 0], 'x2 defaults to 100% of viewport');
  const rad = out.layers[1].items[0].fill.paint;
  assert.deepStrictEqual([rad.start[0], rad.start[1]], [100, 100], 'cx/cy default to 50%');
  const radius = Math.hypot(rad.end[0] - rad.start[0], rad.end[1] - rad.start[1]);
  assert.ok(Math.abs(radius - 100) < 1e-6, `r defaults to 50% of normalized diagonal (got ${radius})`);
});

test('percentage lengths on shape primitives resolve against the viewport', () => {
  const doc = svg(`<rect x="10%" y="0" width="50%" height="25%" fill="#f00"/>`, 200);
  const out = S.scene.build(doc, {});
  const bb = out.layers[0].bbox;
  assert.strictEqual(bb.minX, 20);
  assert.strictEqual(bb.maxX, 120);
  assert.strictEqual(bb.maxY, 50);
});

test('transform on the clipPath element itself is honored', () => {
  const doc = svg(`<rect width="100" height="100" fill="#f00" clip-path="url(#c1)"/>
<defs><clipPath id="c1" transform="translate(30 0)"><rect width="20" height="100"/></clipPath></defs>`);
  const out = S.scene.build(doc, {});
  const clip = out.layers[0].items[0].clips[0];
  const xs = clip[0].points.map((p) => p.x);
  assert.strictEqual(Math.min(...xs), 30, 'clip rect shifted by the clipPath transform');
  assert.strictEqual(Math.max(...xs), 50);
});

test('cyclic <use> inside clipPath warns instead of overflowing the stack', () => {
  const doc = svg(`<rect width="100" height="100" fill="#f00" clip-path="url(#c1)"/>
<defs><clipPath id="c1"><use href="#loop"/></clipPath>
<g id="loop"><use href="#loop"/><rect width="10" height="10"/></g></defs>`);
  const out = S.scene.build(doc, {}); // must not throw/hang
  const all = out.warnings.concat(out.layers.length ? out.layers[0].warnings : []);
  assert.ok(all.some((w) => /too deeply|cycle/.test(w)), `expected cycle warning, got: ${all.join('; ')}`);
});

test('matrix.parse handles SVGO-packed arguments', () => {
  const m1 = S.matrix.parse('translate(10-5)');
  assert.deepStrictEqual([m1[4], m1[5]], [10, -5]);
  const m2 = S.matrix.parse('scale(.5.25)');
  assert.strictEqual(m2[0], 0.5);
  assert.strictEqual(m2[3], 0.25);
});

test('letter-spacing scales with the CTM like font-size does', () => {
  const doc = `<svg width="200" height="200" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
<text x="10" y="20" font-size="10" letter-spacing="2" fill="#000">Hi</text></svg>`;
  const out = S.scene.build(doc, {});
  const run = out.layers[0].textRuns[0];
  assert.strictEqual(run.fontSize, 20);
  assert.strictEqual(run.letterSpacing, 4);
});

test('resampleStops clamps outside the stop range instead of extrapolating', () => {
  const ctx = vm.createContext({ File: function () {}, Folder: { temp: { fsName: '/tmp' } } });
  vm.runInContext('var SVGSPLIT = {};', ctx);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'src', 'ae', 'gradients.jsx'), 'utf8'),
    ctx, { filename: 'gradients.jsx' }
  );
  const mk = (offset) => ({ offset, color: { r: offset, g: 0, b: 0 }, opacity: 1 });
  const stops = [];
  for (let i = 0; i < 40; i++) stops.push(mk(0.4 + (i / 39) * 0.2)); // offsets 0.4..0.6
  const out = ctx.SVGSPLIT.aegrad.resampleStops(stops, 8);
  assert.strictEqual(out.length, 8);
  for (const s of out) {
    assert.ok(s.color.r >= 0.4 - 1e-9 && s.color.r <= 0.6 + 1e-9,
      `resampled color must stay in source range, got ${s.color.r}`);
  }
});

test('solo frame wrapper group (Figma Include-id export) is unwrapped for splitting', () => {
  const doc = svg(`<g id="Slide 16:9 - 1">
    <rect width="100" height="100" fill="#fff"/>
    <g id="Title"><rect width="10" height="10" fill="#f00"/></g>
    <g id="Body"><circle cx="50" cy="50" r="10" fill="#00f"/></g>
  </g>`);
  const out = S.scene.build(doc, { splitMode: 'toplevel' });
  assert.strictEqual(out.layers.length, 3, 'children of the frame wrapper become layers');
  assert.strictEqual(JSON.stringify(out.layers.map((l) => l.name).slice(1)), '["Title","Body"]');
});

test('a wrapper with a transform is NOT unwrapped', () => {
  const doc = svg(`<g id="W" transform="translate(5 0)"><rect width="10" height="10" fill="#f00"/><rect x="20" width="10" height="10" fill="#00f"/></g>`);
  const out = S.scene.build(doc, { splitMode: 'toplevel' });
  assert.strictEqual(out.layers.length, 1, 'transformed group stays one layer');
});
