'use strict';

// Tests for src/core/color.js (SVGSPLIT.color.parse).
// Contract: {r,g,b,a} in 0..1 | {none:true} | {currentColor:true} | null.

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./load-core.js');

const S = loadCore();
const parse = S.color.parse;

const EPS = 1e-9;

function assertColor(actual, r, g, b, a, eps) {
  eps = eps === undefined ? EPS : eps;
  assert.ok(actual !== null && typeof actual === 'object', 'expected a color object, got ' + JSON.stringify(actual));
  assert.ok(!actual.none && !actual.currentColor, 'expected rgba object, got ' + JSON.stringify(actual));
  assert.ok(Math.abs(actual.r - r) < eps, 'r: expected ' + r + ', got ' + actual.r);
  assert.ok(Math.abs(actual.g - g) < eps, 'g: expected ' + g + ', got ' + actual.g);
  assert.ok(Math.abs(actual.b - b) < eps, 'b: expected ' + b + ', got ' + actual.b);
  assert.ok(Math.abs(actual.a - a) < eps, 'a: expected ' + a + ', got ' + actual.a);
}

// ---------------------------------------------------------------------------
// Hex notation
// ---------------------------------------------------------------------------

test('#rgb short hex expands each digit (e.g. #f80)', () => {
  assertColor(parse('#f00'), 1, 0, 0, 1);
  // #f80 -> ff, 88, 00 -> 255, 136, 0
  assertColor(parse('#f80'), 1, 136 / 255, 0, 1);
  assertColor(parse('#000'), 0, 0, 0, 1);
  assertColor(parse('#fff'), 1, 1, 1, 1);
});

test('#rgba short hex carries alpha (4th digit doubled)', () => {
  assertColor(parse('#f008'), 1, 0, 0, 136 / 255);
  assertColor(parse('#000f'), 0, 0, 0, 1);
  assertColor(parse('#0000'), 0, 0, 0, 0);
});

test('#rrggbb component math: #ff8000 -> r=1, g~0.502, b=0', () => {
  const c = parse('#ff8000');
  assertColor(c, 1, 128 / 255, 0, 1);
  assert.ok(Math.abs(c.g - 0.502) < 1e-3, 'g should be ~0.502, got ' + c.g);
});

test('#rrggbbaa parses 8-digit hex with alpha', () => {
  assertColor(parse('#ff800080'), 1, 128 / 255, 0, 128 / 255);
  assertColor(parse('#00000000'), 0, 0, 0, 0);
  assertColor(parse('#336699cc'), 51 / 255, 102 / 255, 153 / 255, 204 / 255);
});

test('hex is case-insensitive', () => {
  assertColor(parse('#FF8000'), 1, 128 / 255, 0, 1);
  assertColor(parse('#AbCdEf'), 171 / 255, 205 / 255, 239 / 255, 1);
});

test('hex with invalid length or leading garbage digits -> null', () => {
  assert.strictEqual(parse('#'), null);
  assert.strictEqual(parse('#f'), null);
  assert.strictEqual(parse('#ff'), null);
  assert.strictEqual(parse('#12345'), null); // 5 digits
  assert.strictEqual(parse('#1234567'), null); // 7 digits
  assert.strictEqual(parse('#123456789'), null); // 9 digits
  assert.strictEqual(parse('#xyz'), null);
  assert.strictEqual(parse('#gg0000'), null);
});

test('hex with trailing non-hex garbage in a pair -> null', () => {
  assert.strictEqual(parse('#12345g'), null);
  assert.strictEqual(parse('#1x2x3x'), null);
});

// ---------------------------------------------------------------------------
// Named colors and keywords
// ---------------------------------------------------------------------------

test('named colors resolve to exact hex values', () => {
  assertColor(parse('red'), 1, 0, 0, 1);
  // cornflowerblue = #6495ed
  assertColor(parse('cornflowerblue'), 100 / 255, 149 / 255, 237 / 255, 1);
  // rebeccapurple = #663399
  assertColor(parse('rebeccapurple'), 0.4, 0.2, 0.6, 1);
  assertColor(parse('black'), 0, 0, 0, 1);
  assertColor(parse('white'), 1, 1, 1, 1);
});

test('named colors are case-insensitive', () => {
  assertColor(parse('RED'), 1, 0, 0, 1);
  assertColor(parse('CornflowerBlue'), 100 / 255, 149 / 255, 237 / 255, 1);
});

test('unknown names -> null', () => {
  assert.strictEqual(parse('notacolor'), null);
  assert.strictEqual(parse('redd'), null);
});

function assertNone(c) {
  // Note: core objects come from a vm realm, so avoid deepStrictEqual
  // (its prototype check fails across realms); compare properties instead.
  assert.ok(c !== null && typeof c === 'object', 'expected {none:true}, got ' + JSON.stringify(c));
  assert.strictEqual(c.none, true);
  assert.strictEqual(Object.keys(c).length, 1);
}

function assertCurrentColor(c) {
  assert.ok(c !== null && typeof c === 'object', 'expected {currentColor:true}, got ' + JSON.stringify(c));
  assert.strictEqual(c.currentColor, true);
  assert.strictEqual(Object.keys(c).length, 1);
}

test("'none' -> {none:true}", () => {
  assertNone(parse('none'));
  assertNone(parse('NONE'));
  assertNone(parse('  none  '));
});

test("'transparent' -> rgba(0,0,0,0)", () => {
  assertColor(parse('transparent'), 0, 0, 0, 0);
  assertColor(parse('Transparent'), 0, 0, 0, 0);
});

test("'currentColor' / 'currentcolor' -> {currentColor:true}", () => {
  assertCurrentColor(parse('currentColor'));
  assertCurrentColor(parse('currentcolor'));
  assertCurrentColor(parse('CURRENTCOLOR'));
});

// ---------------------------------------------------------------------------
// rgb() / rgba()
// ---------------------------------------------------------------------------

test('rgb(255,128,0) -> integer components scaled by 255', () => {
  const c = parse('rgb(255,128,0)');
  assertColor(c, 1, 128 / 255, 0, 1);
});

test('rgb(100%, 50%, 0%) -> percentage components', () => {
  assertColor(parse('rgb(100%, 50%, 0%)'), 1, 0.5, 0, 1);
  assertColor(parse('rgb(0%,0%,100%)'), 0, 0, 1, 1);
});

test('rgba(0,0,0,0.5) -> alpha as float', () => {
  assertColor(parse('rgba(0,0,0,0.5)'), 0, 0, 0, 0.5);
});

test('rgba alpha as percentage', () => {
  assertColor(parse('rgba(0, 0, 0, 50%)'), 0, 0, 0, 0.5);
});

test('rgb with generous internal whitespace', () => {
  assertColor(parse('rgb( 255 , 128 , 0 )'), 1, 128 / 255, 0, 1);
  assertColor(parse('rgba( 10,  20 ,30 , 0.25 )'), 10 / 255, 20 / 255, 30 / 255, 0.25);
});

test('modern space-separated rgb, with optional / alpha', () => {
  assertColor(parse('rgb(255 128 0)'), 1, 128 / 255, 0, 1);
  assertColor(parse('rgb(255 128 0 / 0.5)'), 1, 128 / 255, 0, 0.5);
});

test('rgb components are clamped to 0..1', () => {
  assertColor(parse('rgb(300, -20, 0)'), 1, 0, 0, 1);
  assertColor(parse('rgba(0,0,0,2)'), 0, 0, 0, 1);
  assertColor(parse('rgba(0,0,0,-1)'), 0, 0, 0, 0);
});

test('malformed rgb -> null', () => {
  assert.strictEqual(parse('rgb()'), null);
  assert.strictEqual(parse('rgb(1,2)'), null);
  assert.strictEqual(parse('rgb(a,b,c)'), null);
  assert.strictEqual(parse('rgb(255,0,0'), null); // missing close paren
});

// ---------------------------------------------------------------------------
// hsl() / hsla()
// ---------------------------------------------------------------------------

test('hsl(120, 100%, 50%) -> pure green', () => {
  assertColor(parse('hsl(120, 100%, 50%)'), 0, 1, 0, 1);
});

test('hsl(0, 0%, 50%) -> mid gray (achromatic path)', () => {
  assertColor(parse('hsl(0, 0%, 50%)'), 0.5, 0.5, 0.5, 1);
});

test('hsl primaries and lightness math', () => {
  assertColor(parse('hsl(0, 100%, 50%)'), 1, 0, 0, 1); // red
  assertColor(parse('hsl(240, 100%, 50%)'), 0, 0, 1, 1); // blue
  assertColor(parse('hsl(120, 100%, 25%)'), 0, 0.5, 0, 1); // dark green
  assertColor(parse('hsl(0, 0%, 100%)'), 1, 1, 1, 1); // white
  assertColor(parse('hsl(0, 0%, 0%)'), 0, 0, 0, 1); // black
});

test('hsl hue wraps: 360 -> red, negative hue wraps around', () => {
  assertColor(parse('hsl(360, 100%, 50%)'), 1, 0, 0, 1);
  assertColor(parse('hsl(480, 100%, 50%)'), 0, 1, 0, 1); // 480 == 120
  assertColor(parse('hsl(-120, 100%, 50%)'), 0, 0, 1, 1); // -120 == 240
});

test('hsla carries alpha, both comma and slash syntax', () => {
  assertColor(parse('hsla(240, 100%, 50%, 0.25)'), 0, 0, 1, 0.25);
  assertColor(parse('hsl(120 100% 50% / 0.5)'), 0, 1, 0, 0.5);
});

test('malformed hsl -> null', () => {
  assert.strictEqual(parse('hsl()'), null);
  assert.strictEqual(parse('hsl(120, 100%)'), null);
  assert.strictEqual(parse('hsl(a, b%, c%)'), null);
});

// ---------------------------------------------------------------------------
// Garbage inputs
// ---------------------------------------------------------------------------

test('garbage inputs -> null', () => {
  assert.strictEqual(parse(''), null);
  assert.strictEqual(parse('   '), null);
  assert.strictEqual(parse(null), null);
  assert.strictEqual(parse(undefined), null);
  assert.strictEqual(parse('#xyz'), null);
  assert.strictEqual(parse('rgb()'), null);
  assert.strictEqual(parse('url(#x)'), null);
  assert.strictEqual(parse('inherit'), null);
});

// ---------------------------------------------------------------------------
// Whitespace tolerance
// ---------------------------------------------------------------------------

test('leading/trailing whitespace is tolerated', () => {
  assertColor(parse('  red  '), 1, 0, 0, 1);
  assertColor(parse('\t#ff0000\n'), 1, 0, 0, 1);
  assertColor(parse(' rgb(255, 0, 0) '), 1, 0, 0, 1);
  assertColor(parse('\n hsl(120, 100%, 50%) \t'), 0, 1, 0, 1);
});
