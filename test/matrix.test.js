'use strict';

// Tests for src/core/matrix.js (SVGSPLIT.matrix)
// SVG-order affine matrices [a, b, c, d, e, f]:
//   (x, y) -> (a*x + c*y + e, b*x + d*y + f)

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./load-core.js');

const S = loadCore();
const M = S.matrix;

const EPS = 1e-9;

function assertNear(actual, expected, msg, eps) {
  eps = eps === undefined ? EPS : eps;
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg || 'value'}: expected ${expected}, got ${actual}`
  );
}

function assertMatrixNear(actual, expected, msg, eps) {
  assert.strictEqual(actual.length, 6, `${msg || 'matrix'}: length`);
  for (let i = 0; i < 6; i++) {
    assertNear(actual[i], expected[i], `${msg || 'matrix'}[${i}]`, eps);
  }
}

function assertPointNear(actual, expected, msg, eps) {
  assertNear(actual[0], expected[0], `${msg || 'point'}.x`, eps);
  assertNear(actual[1], expected[1], `${msg || 'point'}.y`, eps);
}

// Core arrays are created inside a vm sandbox (different Array realm), so
// deepStrictEqual would fail on the prototype; compare exact values instead.
function assertMatrixExact(actual, expected, msg) {
  assert.strictEqual(actual.length, 6, `${msg || 'matrix'}: length`);
  for (let i = 0; i < 6; i++) {
    assert.strictEqual(actual[i], expected[i], `${msg || 'matrix'}[${i}]`);
  }
}

// ---------------------------------------------------------------------------
// identity / apply

test('identity() is [1,0,0,1,0,0]', () => {
  assertMatrixExact(M.identity(), [1, 0, 0, 1, 0, 0]);
});

test('identity() returns a fresh array each call', () => {
  const a = M.identity();
  const b = M.identity();
  assert.notStrictEqual(a, b);
  a[4] = 99;
  assertMatrixExact(b, [1, 0, 0, 1, 0, 0]);
});

test('apply() with identity is a no-op', () => {
  assertPointNear(M.apply(M.identity(), 3.5, -7.25), [3.5, -7.25]);
});

test('apply() uses SVG order: (x,y) -> (a*x + c*y + e, b*x + d*y + f)', () => {
  // Distinct values in every slot so any index mix-up is caught.
  const m = [2, 3, 5, 7, 11, 13];
  // x' = 2*1 + 5*2 + 11 = 23, y' = 3*1 + 7*2 + 13 = 30
  assertPointNear(M.apply(m, 1, 2), [23, 30]);
});

// ---------------------------------------------------------------------------
// multiply order semantics

test('multiply(A, B) applies B first (matrix product A*B)', () => {
  const T = M.translate(10, 0);
  const Sc = M.scale(2, 2);
  // multiply(T, S): scale first, then translate: (1,0) -> (2,0) -> (12,0)
  assertPointNear(M.apply(M.multiply(T, Sc), 1, 0), [12, 0], 'T*S');
  // multiply(S, T): translate first, then scale: (1,0) -> (11,0) -> (22,0)
  assertPointNear(M.apply(M.multiply(Sc, T), 1, 0), [22, 0], 'S*T');
});

test('multiply() with identity on either side is a no-op', () => {
  const m = [2, 3, 5, 7, 11, 13];
  assertMatrixNear(M.multiply(M.identity(), m), m, 'I*m');
  assertMatrixNear(M.multiply(m, M.identity()), m, 'm*I');
});

test('multiply() is associative', () => {
  const A = M.rotate(30);
  const B = M.translate(4, -2);
  const C = M.scale(2, 3);
  assertMatrixNear(
    M.multiply(M.multiply(A, B), C),
    M.multiply(A, M.multiply(B, C)),
    '(A*B)*C == A*(B*C)'
  );
});

// ---------------------------------------------------------------------------
// translate / scale / rotate / rotateAt

test('translate(tx, ty) moves points', () => {
  assertMatrixExact(M.translate(10, 20), [1, 0, 0, 1, 10, 20]);
  assertPointNear(M.apply(M.translate(10, 20), 1, 2), [11, 22]);
});

test('scale(sx, sy) scales axes independently', () => {
  assertMatrixExact(M.scale(2, 3), [2, 0, 0, 3, 0, 0]);
  assertPointNear(M.apply(M.scale(2, 3), 4, 5), [8, 15]);
});

test('rotate(90) maps (1,0)->(0,1) and (0,1)->(-1,0)', () => {
  const r = M.rotate(90);
  assertMatrixNear(r, [0, 1, -1, 0, 0, 0], 'rotate(90)');
  assertPointNear(M.apply(r, 1, 0), [0, 1], '(1,0)');
  assertPointNear(M.apply(r, 0, 1), [-1, 0], '(0,1)');
});

test('rotate(45) maps (1,0) to (sqrt2/2, sqrt2/2)', () => {
  const h = Math.SQRT2 / 2;
  assertMatrixNear(M.rotate(45), [h, h, -h, h, 0, 0], 'rotate(45)');
  assertPointNear(M.apply(M.rotate(45), 1, 0), [h, h]);
});

test('rotate(-90) is the inverse of rotate(90)', () => {
  assertMatrixNear(M.multiply(M.rotate(90), M.rotate(-90)), M.identity());
});

test('rotateAt(90, cx, cy) fixes the pivot point', () => {
  const cx = 20;
  const cy = 15;
  const r = M.rotateAt(90, cx, cy);
  assertPointNear(M.apply(r, cx, cy), [cx, cy], 'pivot stays fixed');
  // A point one unit right of the pivot swings to one unit above it
  // (y-down SVG coords: mathematically (cx+1, cy) -> (cx, cy+1)).
  assertPointNear(M.apply(r, cx + 1, cy), [cx, cy + 1], 'orbit point');
});

test('rotateAt(deg, 0, 0) equals rotate(deg)', () => {
  assertMatrixNear(M.rotateAt(33, 0, 0), M.rotate(33));
});

// ---------------------------------------------------------------------------
// skewX / skewY

test('skewX(deg) puts tan(deg) in the c slot', () => {
  const t30 = Math.tan(30 * Math.PI / 180);
  assertMatrixNear(M.skewX(30), [1, 0, t30, 1, 0, 0], 'skewX(30)');
  // x shifts by tan(30)*y; y unchanged.
  assertPointNear(M.apply(M.skewX(30), 0, 1), [t30, 1]);
  assertPointNear(M.apply(M.skewX(30), 5, 0), [5, 0], 'y=0 line fixed');
});

test('skewY(deg) puts tan(deg) in the b slot', () => {
  const t20 = Math.tan(20 * Math.PI / 180);
  assertMatrixNear(M.skewY(20), [1, t20, 0, 1, 0, 0], 'skewY(20)');
  // y shifts by tan(20)*x; x unchanged.
  assertPointNear(M.apply(M.skewY(20), 1, 0), [1, t20]);
  assertPointNear(M.apply(M.skewY(20), 0, 5), [0, 5], 'x=0 line fixed');
});

test('skewX(45) tangent is exactly tan(45) ~= 1', () => {
  assertNear(M.skewX(45)[2], 1, 'tan(45)');
});

// ---------------------------------------------------------------------------
// det / strokeScale

test('det() is a*d - b*c', () => {
  assertNear(M.det([2, 3, 5, 7, 100, 200]), 2 * 7 - 3 * 5, 'det');
  assertNear(M.det(M.identity()), 1, 'det(I)');
  assertNear(M.det(M.rotate(37)), 1, 'det(rotation)');
  assertNear(M.det(M.scale(2, 3)), 6, 'det(scale)');
});

test('strokeScale() of uniform scale 2 is 2', () => {
  assertNear(M.strokeScale(M.scale(2, 2)), 2);
});

test('strokeScale() of a flip matrix(-1,0,0,1,0,0) is 1', () => {
  assertNear(M.strokeScale([-1, 0, 0, 1, 0, 0]), 1);
});

test('strokeScale() ignores translation and rotation', () => {
  const m = M.multiply(M.translate(50, -20), M.multiply(M.rotate(63), M.scale(3, 3)));
  assertNear(M.strokeScale(m), 3);
});

// ---------------------------------------------------------------------------
// isConformal

test('isConformal() true for rotation', () => {
  assert.strictEqual(M.isConformal(M.rotate(37)), true);
});

test('isConformal() true for uniform scale', () => {
  assert.strictEqual(M.isConformal(M.scale(2, 2)), true);
});

test('isConformal() true for a flip', () => {
  assert.strictEqual(M.isConformal([-1, 0, 0, 1, 0, 0]), true);
});

test('isConformal() true for rotation * uniform scale * translation', () => {
  const m = M.multiply(M.translate(9, 9), M.multiply(M.rotate(120), M.scale(0.5, 0.5)));
  assert.strictEqual(M.isConformal(m), true);
});

test('isConformal() false for non-uniform scale(2,1)', () => {
  assert.strictEqual(M.isConformal(M.scale(2, 1)), false);
});

test('isConformal() false for skewX(20)', () => {
  assert.strictEqual(M.isConformal(M.skewX(20)), false);
});

// ---------------------------------------------------------------------------
// parse()

test("parse('matrix(a b c d e f)') passes values through", () => {
  assertMatrixNear(M.parse('matrix(2 3 5 7 11 13)'), [2, 3, 5, 7, 11, 13]);
});

test("parse('translate(10)') defaults ty to 0", () => {
  assertMatrixNear(M.parse('translate(10)'), [1, 0, 0, 1, 10, 0]);
});

test("parse('translate(10,20)')", () => {
  assertMatrixNear(M.parse('translate(10,20)'), [1, 0, 0, 1, 10, 20]);
});

test("parse('scale(2)') is uniform", () => {
  assertMatrixNear(M.parse('scale(2)'), [2, 0, 0, 2, 0, 0]);
});

test("parse('scale(2 3)') is per-axis", () => {
  assertMatrixNear(M.parse('scale(2 3)'), [2, 0, 0, 3, 0, 0]);
});

test("parse('rotate(45)') equals rotate(45)", () => {
  assertMatrixNear(M.parse('rotate(45)'), M.rotate(45));
});

test("parse('rotate(15 20 15)') equals rotateAt(15, 20, 15)", () => {
  const parsed = M.parse('rotate(15 20 15)');
  assertMatrixNear(parsed, M.rotateAt(15, 20, 15));
  assertPointNear(M.apply(parsed, 20, 15), [20, 15], 'pivot fixed');
});

test("parse('skewX(30)') equals skewX(30)", () => {
  assertMatrixNear(M.parse('skewX(30)'), M.skewX(30));
});

test("parse('skewY(30)') equals skewY(30)", () => {
  assertMatrixNear(M.parse('skewY(30)'), M.skewY(30));
});

test('parse() composes multiple transforms left-to-right', () => {
  // SVG semantics: rightmost transform applies to the point first.
  // 'translate(10,0) scale(2)': (1,0) -scale-> (2,0) -translate-> (12,0)
  const m = M.parse('translate(10,0) scale(2)');
  assertPointNear(M.apply(m, 1, 0), [12, 0]);
  // Opposite order gives (1,0) -translate-> (11,0) -scale-> (22,0)
  const m2 = M.parse('scale(2) translate(10,0)');
  assertPointNear(M.apply(m2, 1, 0), [22, 0]);
});

test('parse() equals explicit multiply of the pieces', () => {
  assertMatrixNear(
    M.parse('translate(10,0) scale(2)'),
    M.multiply(M.translate(10, 0), M.scale(2, 2))
  );
});

test('parse() tolerates commas, extra whitespace, and newlines', () => {
  const expected = M.multiply(M.translate(10, 20), M.rotate(45));
  assertMatrixNear(M.parse('translate( 10 , 20 )   rotate(45)'), expected, 'spaces');
  assertMatrixNear(M.parse('translate(10,20),rotate(45)'), expected, 'comma separator');
  assertMatrixNear(M.parse('\n\ttranslate(10, 20)\n\trotate( 45 )\n'), expected, 'newlines');
  assertMatrixNear(M.parse('matrix(1, 0 ,0,1 5 6)'), [1, 0, 0, 1, 5, 6], 'mixed arg separators');
});

test('parse() of empty/null input returns identity', () => {
  assertMatrixExact(M.parse(''), [1, 0, 0, 1, 0, 0]);
  assertMatrixExact(M.parse(null), [1, 0, 0, 1, 0, 0]);
  assertMatrixExact(M.parse(undefined), [1, 0, 0, 1, 0, 0]);
});

test('parse() ignores unknown functions', () => {
  assertMatrixNear(M.parse('frobnicate(3 4)'), M.identity(), 'only unknown');
  assertMatrixNear(
    M.parse('frobnicate(3 4) translate(5,0)'),
    M.translate(5, 0),
    'unknown then known'
  );
});

test('parse() ignores functions with unsupported arity', () => {
  // rotate with 2 args is invalid per SVG spec: skipped, rest still applies.
  assertMatrixNear(M.parse('rotate(10 20) translate(1,2)'), M.translate(1, 2), 'rotate 2-arg');
  // matrix with wrong count is skipped.
  assertMatrixNear(M.parse('matrix(1 2 3) scale(2)'), M.scale(2, 2), 'matrix 3-arg');
});
