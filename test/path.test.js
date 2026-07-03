'use strict';

// Tests for src/core/path.js (SVGSPLIT.path.parse / SVGSPLIT.path.bounds).
//
// parse(d) -> { contours: [{ closed, points: [{x,y,ix,iy,ox,oy}] }] }
//   Controls are ABSOLUTE; straight segments have controls equal to anchors.
// bounds(contours) -> exact bezier bbox { minX, minY, maxX, maxY } | null.

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./load-core.js');

const S = loadCore();

// --- helpers ---------------------------------------------------------------

function approx(actual, expected, eps = 1e-9, msg = '') {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `${msg} expected ${expected} +/- ${eps}, got ${actual}`
  );
}

function anchors(contour) {
  return contour.points.map((p) => [p.x, p.y]);
}

function assertAnchors(contour, expected) {
  const got = anchors(contour);
  assert.strictEqual(got.length, expected.length, `anchor count: got ${JSON.stringify(got)}`);
  for (let i = 0; i < expected.length; i++) {
    approx(got[i][0], expected[i][0], 1e-9, `anchor[${i}].x`);
    approx(got[i][1], expected[i][1], 1e-9, `anchor[${i}].y`);
  }
}

function assertStraightPoint(p) {
  // A point whose adjacent segments are straight has controls == anchor.
  assert.strictEqual(p.ix, p.x);
  assert.strictEqual(p.iy, p.y);
  assert.strictEqual(p.ox, p.x);
  assert.strictEqual(p.oy, p.y);
}

function bezAt(p0, c1, c2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * p3;
}

// Sample every cubic segment of a contour (including the wrap segment when closed).
function sampleContour(contour, perSegment = 17) {
  const pts = contour.points;
  const out = [];
  const segCount = contour.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < segCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    for (let s = 0; s <= perSegment; s++) {
      const t = s / perSegment;
      out.push([
        bezAt(a.x, a.ox, b.ix, b.x, t),
        bezAt(a.y, a.oy, b.iy, b.y, t),
      ]);
    }
  }
  return out;
}

function assertOnCircle(contour, cx, cy, r, tol = 0.1) {
  const samples = sampleContour(contour);
  for (const [x, y] of samples) {
    const d = Math.hypot(x - cx, y - cy);
    assert.ok(
      Math.abs(d - r) <= tol,
      `sample (${x}, ${y}) is ${d} from (${cx}, ${cy}); expected ${r} +/- ${tol}`
    );
  }
}

// --- M / L / H / V, absolute + relative, implicit repetition ----------------

test('M/L absolute produces straight open contour with zero tangents', () => {
  const r = S.path.parse('M0 0 L10 5');
  assert.strictEqual(r.contours.length, 1);
  const c = r.contours[0];
  assert.strictEqual(c.closed, false);
  assertAnchors(c, [[0, 0], [10, 5]]);
  c.points.forEach(assertStraightPoint);
});

test('implicit repetition: M0 0 10 10 20 20 is M then two absolute Ls', () => {
  const r = S.path.parse('M0 0 10 10 20 20');
  assert.strictEqual(r.contours.length, 1);
  const c = r.contours[0];
  assert.strictEqual(c.closed, false);
  assertAnchors(c, [[0, 0], [10, 10], [20, 20]]);
  c.points.forEach(assertStraightPoint);
});

test('implicit repetition after m uses relative l', () => {
  const r = S.path.parse('m 10 10 5 5 5 5');
  assertAnchors(r.contours[0], [[10, 10], [15, 15], [20, 20]]);
});

test('H/V absolute and relative', () => {
  const r = S.path.parse('M5 5 h 10 v -3 H 0 V 0');
  const c = r.contours[0];
  assertAnchors(c, [[5, 5], [15, 5], [15, 2], [0, 2], [0, 0]]);
  c.points.forEach(assertStraightPoint);
});

test('relative l accumulates from current point', () => {
  const r = S.path.parse('M1 2 l 3 4 l -1 -1');
  assertAnchors(r.contours[0], [[1, 2], [4, 6], [3, 5]]);
});

// --- C / S reflection --------------------------------------------------------

test('C sets absolute out-control on previous anchor and in-control on new anchor', () => {
  const r = S.path.parse('M0 0 C 0 10 10 10 10 0');
  const [p0, p1] = r.contours[0].points;
  assert.strictEqual(p0.ox, 0);
  assert.strictEqual(p0.oy, 10);
  assert.strictEqual(p1.ix, 10);
  assert.strictEqual(p1.iy, 10);
  assert.strictEqual(p1.x, 10);
  assert.strictEqual(p1.y, 0);
  // out-control of the final anchor stays at the anchor (nothing follows)
  assert.strictEqual(p1.ox, 10);
  assert.strictEqual(p1.oy, 0);
});

test('relative c offsets all three coordinate pairs from the current point', () => {
  const r = S.path.parse('M10 20 c 0 10 10 10 10 0');
  const [p0, p1] = r.contours[0].points;
  assert.strictEqual(p0.ox, 10);
  assert.strictEqual(p0.oy, 30);
  assert.strictEqual(p1.ix, 20);
  assert.strictEqual(p1.iy, 30);
  assert.strictEqual(p1.x, 20);
  assert.strictEqual(p1.y, 20);
});

test('S after C reflects the previous control2 about the current point', () => {
  const r = S.path.parse('M0 0 C 0 10 10 10 10 0 S 20 -10 20 0');
  const [, p1, p2] = r.contours[0].points;
  // reflection of (10,10) about (10,0) is (10,-10)
  assert.strictEqual(p1.ox, 10);
  assert.strictEqual(p1.oy, -10);
  assert.strictEqual(p2.ix, 20);
  assert.strictEqual(p2.iy, -10);
  assert.strictEqual(p2.x, 20);
  assert.strictEqual(p2.y, 0);
});

test('S with no preceding cubic uses the current point as control1', () => {
  const r = S.path.parse('M0 0 S 10 10 20 0');
  const [p0, p1] = r.contours[0].points;
  assert.strictEqual(p0.ox, 0);
  assert.strictEqual(p0.oy, 0);
  assert.strictEqual(p1.ix, 10);
  assert.strictEqual(p1.iy, 10);
});

test('relative s reflects and offsets', () => {
  const r = S.path.parse('M0 0 C 0 10 10 10 10 0 s 10 -10 10 0');
  const [, p1, p2] = r.contours[0].points;
  assert.strictEqual(p1.ox, 10);
  assert.strictEqual(p1.oy, -10);
  assert.strictEqual(p2.ix, 20); // 10 + 10
  assert.strictEqual(p2.iy, -10); // 0 + -10
  assert.strictEqual(p2.x, 20);
  assert.strictEqual(p2.y, 0);
});

// --- Q / T conversion to cubic ----------------------------------------------

test('Q converts to cubic with exact 2/3 control math', () => {
  const r = S.path.parse('M0 0 Q 5 10 10 0');
  const [p0, p1] = r.contours[0].points;
  // c1 = q0 + 2/3 (q - q0), c2 = p + 2/3 (q - p)
  approx(p0.ox, 10 / 3, 1e-12, 'c1.x');
  approx(p0.oy, 20 / 3, 1e-12, 'c1.y');
  approx(p1.ix, 20 / 3, 1e-12, 'c2.x');
  approx(p1.iy, 20 / 3, 1e-12, 'c2.y');
  assert.strictEqual(p1.x, 10);
  assert.strictEqual(p1.y, 0);
  // converted cubic must trace the original quadratic exactly
  for (let s = 0; s <= 10; s++) {
    const t = s / 10;
    const qx = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * 5 + t * t * 10;
    const qy = (1 - t) * (1 - t) * 0 + 2 * (1 - t) * t * 10 + t * t * 0;
    approx(bezAt(p0.x, p0.ox, p1.ix, p1.x, t), qx, 1e-9, `x(t=${t})`);
    approx(bezAt(p0.y, p0.oy, p1.iy, p1.y, t), qy, 1e-9, `y(t=${t})`);
  }
});

test('T reflects the previous quadratic control, chaining across multiple Ts', () => {
  const r = S.path.parse('M0 0 Q 5 5 10 0 T 20 0 T 30 0');
  const [, p1, p2, p3] = r.contours[0].points;
  // first T: quad control = reflect (5,5) about (10,0) = (15,-5)
  approx(p1.ox, 40 / 3, 1e-12); // 10 + 2/3*(15-10)
  approx(p1.oy, -10 / 3, 1e-12); // 0 + 2/3*(-5-0)
  approx(p2.ix, 50 / 3, 1e-12); // 20 + 2/3*(15-20)
  approx(p2.iy, -10 / 3, 1e-12);
  // second T: quad control = reflect (15,-5) about (20,0) = (25,5)
  approx(p2.ox, 70 / 3, 1e-12);
  approx(p2.oy, 10 / 3, 1e-12);
  approx(p3.ix, 80 / 3, 1e-12);
  approx(p3.iy, 10 / 3, 1e-12);
  assert.strictEqual(p3.x, 30);
  assert.strictEqual(p3.y, 0);
});

test('T with no preceding quadratic uses the current point (degenerate straight quad)', () => {
  const r = S.path.parse('M0 0 L 5 0 T 10 10');
  const [, p1, p2] = r.contours[0].points;
  // control collapses to the current point (5,0)
  assert.strictEqual(p1.ox, 5);
  assert.strictEqual(p1.oy, 0);
  assert.strictEqual(p2.x, 10);
  assert.strictEqual(p2.y, 10);
  // degenerate quad still traces the straight line (5,0)->(10,10)
  const midX = bezAt(p1.x, p1.ox, p2.ix, p2.x, 0.5);
  const midY = bezAt(p1.y, p1.oy, p2.iy, p2.y, 0.5);
  approx(midY / (midX - 5), 10 / 5, 1e-9, 'slope at t=0.5');
});

// --- Z closing ----------------------------------------------------------------

test('Z closes contour without merging when end != start', () => {
  const r = S.path.parse('M0 0 L10 0 L10 10 Z');
  assert.strictEqual(r.contours.length, 1);
  const c = r.contours[0];
  assert.strictEqual(c.closed, true);
  assertAnchors(c, [[0, 0], [10, 0], [10, 10]]);
  c.points.forEach(assertStraightPoint);
});

test('Z merges a coincident closing anchor into the first point', () => {
  const r = S.path.parse('M0 0 L10 0 L10 10 L0 0 Z');
  const c = r.contours[0];
  assert.strictEqual(c.closed, true);
  assertAnchors(c, [[0, 0], [10, 0], [10, 10]]);
});

test('coincident-merge transfers the in-control of the dropped point to the first point', () => {
  const r = S.path.parse('M0 0 L100 0 C 100 50 0 50 0 0 Z');
  const c = r.contours[0];
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.points.length, 2);
  const p0 = c.points[0];
  // the cubic ended at (0,0) with in-control (0,50); first point inherits it
  assert.strictEqual(p0.ix, 0);
  assert.strictEqual(p0.iy, 50);
  // out-control of first point unchanged (straight L toward (100,0))
  assert.strictEqual(p0.ox, 0);
  assert.strictEqual(p0.oy, 0);
});

test('drawing after Z starts a new contour at the subpath start', () => {
  const r = S.path.parse('M0 0 L10 0 L10 10 Z L20 20');
  assert.strictEqual(r.contours.length, 2);
  assert.strictEqual(r.contours[0].closed, true);
  assertAnchors(r.contours[0], [[0, 0], [10, 0], [10, 10]]);
  const c2 = r.contours[1];
  assert.strictEqual(c2.closed, false);
  assertAnchors(c2, [[0, 0], [20, 20]]);
});

// --- multiple subpaths ----------------------------------------------------------

test('donut: two M sections produce two contours', () => {
  const r = S.path.parse(
    'M0 0 L100 0 L100 100 L0 100 Z M25 25 L25 75 L75 75 L75 25 Z'
  );
  assert.strictEqual(r.contours.length, 2);
  assert.strictEqual(r.contours[0].closed, true);
  assert.strictEqual(r.contours[1].closed, true);
  assertAnchors(r.contours[0], [[0, 0], [100, 0], [100, 100], [0, 100]]);
  assertAnchors(r.contours[1], [[25, 25], [25, 75], [75, 75], [75, 25]]);
});

test('relative m after Z starts the next subpath relative to the previous subpath start', () => {
  const r = S.path.parse('M10 10 L20 10 L20 20 Z m 2 2 l 6 0 l 0 6 z');
  assert.strictEqual(r.contours.length, 2);
  // after Z the current point is the subpath start (10,10); m 2 2 -> (12,12)
  assertAnchors(r.contours[1], [[12, 12], [18, 12], [18, 18]]);
  assert.strictEqual(r.contours[1].closed, true);
});

// --- arcs -------------------------------------------------------------------------

test('semicircle arc: every sample within 0.1 of radius 50 from (50,50)', () => {
  const r = S.path.parse('M 0 50 A 50 50 0 1 1 100 50');
  assert.strictEqual(r.contours.length, 1);
  const c = r.contours[0];
  const pts = c.points;
  // endpoints snapped exactly to the command endpoints
  approx(pts[0].x, 0, 1e-9);
  approx(pts[0].y, 50, 1e-9);
  approx(pts[pts.length - 1].x, 100, 1e-9);
  approx(pts[pts.length - 1].y, 50, 1e-9);
  assertOnCircle(c, 50, 50, 50, 0.1);
});

test('sweep flag parity: sweep 0 and sweep 1 bulge to opposite sides of the chord', () => {
  const sweep1 = S.path.parse('M0 0 A 50 50 0 0 1 100 0').contours[0];
  const sweep0 = S.path.parse('M0 0 A 50 50 0 0 0 100 0').contours[0];
  const ys1 = sampleContour(sweep1).map((p) => p[1]);
  const ys0 = sampleContour(sweep0).map((p) => p[1]);
  // sweep=1 arc stays at y <= 0 and reaches near -50; sweep=0 the mirror image
  assert.ok(Math.max(...ys1) <= 1e-6, `sweep1 max y ${Math.max(...ys1)}`);
  assert.ok(Math.min(...ys1) < -49, `sweep1 min y ${Math.min(...ys1)}`);
  assert.ok(Math.min(...ys0) >= -1e-6, `sweep0 min y ${Math.min(...ys0)}`);
  assert.ok(Math.max(...ys0) > 49, `sweep0 max y ${Math.max(...ys0)}`);
  assertOnCircle(sweep1, 50, 0, 50, 0.1);
  assertOnCircle(sweep0, 50, 0, 50, 0.1);
});

test("run-together arc flags parse: 'M0 0a25 25 0 0150 0' means laf=0 sf=1 x=50 y=0", () => {
  const r = S.path.parse('M0 0a25 25 0 0150 0');
  assert.strictEqual(r.contours.length, 1);
  const c = r.contours[0];
  const last = c.points[c.points.length - 1];
  approx(last.x, 50, 1e-9);
  approx(last.y, 0, 1e-9);
  // semicircle of radius 25 centered at (25,0); sweep=1 goes through negative y
  assertOnCircle(c, 25, 0, 25, 0.1);
  const ys = sampleContour(c).map((p) => p[1]);
  assert.ok(Math.min(...ys) < -24, `sf=1 should dip near -25, got min ${Math.min(...ys)}`);
});

test('rx=0 arc degenerates to a straight line', () => {
  const r = S.path.parse('M0 0 A 0 50 0 0 1 100 20');
  const c = r.contours[0];
  assertAnchors(c, [[0, 0], [100, 20]]);
  c.points.forEach(assertStraightPoint);
});

test('arc with equal endpoints is skipped entirely', () => {
  const r = S.path.parse('M0 0 L 10 0 A 50 50 0 1 1 10 0 L 10 10');
  assert.strictEqual(r.contours.length, 1);
  assertAnchors(r.contours[0], [[0, 0], [10, 0], [10, 10]]);
});

test('out-of-range radii are scaled up (lambda correction) and endpoint is still reached', () => {
  const r = S.path.parse('M0 0 A 1 1 0 0 0 100 0');
  const c = r.contours[0];
  const last = c.points[c.points.length - 1];
  approx(last.x, 100, 1e-9, 'end x');
  approx(last.y, 0, 1e-9, 'end y');
  // radii scale to 50, center at chord midpoint (50,0)
  assertOnCircle(c, 50, 0, 50, 0.1);
});

// --- number tokenizer --------------------------------------------------------------

test("scientific notation '1e-5' parses", () => {
  const r = S.path.parse('M 1e-5 0 L 1 1');
  assert.strictEqual(r.contours[0].points[0].x, 1e-5);
});

test("'.5.5' tokenizes as 0.5 then 0.5", () => {
  const r = S.path.parse('M.5.5 L1 1');
  assert.strictEqual(r.contours[0].points[0].x, 0.5);
  assert.strictEqual(r.contours[0].points[0].y, 0.5);
});

test("'5-3' tokenizes as 5 then -3", () => {
  const r = S.path.parse('M5-3L0 0');
  assert.strictEqual(r.contours[0].points[0].x, 5);
  assert.strictEqual(r.contours[0].points[0].y, -3);
});

test("explicit plus sign '+3' parses", () => {
  const r = S.path.parse('M+3 +3L0 0');
  assert.strictEqual(r.contours[0].points[0].x, 3);
  assert.strictEqual(r.contours[0].points[0].y, 3);
});

test('leading and trailing commas are separators', () => {
  const r = S.path.parse(',M,0,0,,L,10,10,');
  assertAnchors(r.contours[0], [[0, 0], [10, 10]]);
});

// --- bounds ------------------------------------------------------------------------

test('bounds of a straight line is the anchor bbox', () => {
  const b = S.path.bounds(S.path.parse('M0 0 L10 5').contours);
  assert.deepStrictEqual(b, { minX: 0, minY: 0, maxX: 10, maxY: 5 });
});

test('bounds includes cubic extremum beyond the anchors (maxY 37.5)', () => {
  const b = S.path.bounds(S.path.parse('M0 0 C 0 50 100 50 100 0').contours);
  approx(b.minX, 0, 1e-9);
  approx(b.maxX, 100, 1e-9);
  approx(b.minY, 0, 1e-9);
  approx(b.maxY, 37.5, 1e-9, 'cubic apex');
});

test('bounds of a full circle built from two arcs is ~[-r,-r,r,r]', () => {
  const d = 'M-50 0 A 50 50 0 1 1 50 0 A 50 50 0 1 1 -50 0 Z';
  const b = S.path.bounds(S.path.parse(d).contours);
  approx(b.minX, -50, 0.05);
  approx(b.minY, -50, 0.05);
  approx(b.maxX, 50, 0.05);
  approx(b.maxY, 50, 0.05);
});

test('bounds includes the wrap segment only for closed contours', () => {
  // closed contour: L(0,0)->(100,0), then a bulging cubic back on the closing segment
  const parsed = S.path.parse('M0 0 L100 0 C 100 50 0 50 0 0 Z');
  const closedB = S.path.bounds(parsed.contours);
  approx(closedB.maxY, 37.5, 1e-9, 'closed contour includes final-segment curve');

  // same point data reinterpreted as open: the last->first segment must be ignored
  const openContour = { closed: false, points: parsed.contours[0].points };
  const openB = S.path.bounds([openContour]);
  approx(openB.maxY, 0, 1e-9, 'open contour ignores final-segment curve');
  approx(openB.maxX, 100, 1e-9);
});

test('bounds of empty input is null', () => {
  assert.strictEqual(S.path.bounds([]), null);
  assert.strictEqual(S.path.bounds(S.path.parse('').contours), null);
});

// --- errors / edge behavior ----------------------------------------------------------

test("garbage leading command 'X 5 5' throws a parse error", () => {
  assert.throws(() => S.path.parse('X 5 5'), /path parse error/);
});

test('empty string yields { contours: [] }', () => {
  assert.deepStrictEqual(S.path.parse(''), { contours: [] });
  assert.deepStrictEqual(S.path.parse('   '), { contours: [] });
});

test('a lone M produces no contour (single-point open contours are dropped)', () => {
  assert.deepStrictEqual(S.path.parse('M5 5').contours, []);
});

test(
  'numbers after Z with no command should error, not hang',
  { skip: "BUG: parse('M0 0 L10 0 Z 5 5') never returns — implicit repetition re-dispatches Z, which consumes no input, so the scanner never advances (infinite loop). Verified: subprocess still running after 3s kill-timer." },
  () => {
    // Per SVG spec, Z takes no parameters, so trailing numbers are invalid
    // path data and should raise a parse error.
    assert.throws(() => S.path.parse('M0 0 L10 0 Z 5 5'), /path parse error/);
  }
);
