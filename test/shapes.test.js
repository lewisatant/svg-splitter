'use strict';

// Tests for src/core/shapes.js — SVGSPLIT.shapes.contoursFor(name, attrs).
// attrs are STRING maps, exactly as they arrive from parsed XML.

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./load-core.js');

const S = loadCore();
const shapes = S.shapes;

const KAPPA = 0.5522847498307936;
const EPS = 1e-9;

function close(actual, expected, eps, msg) {
  assert.ok(
    Math.abs(actual - expected) <= (eps === undefined ? EPS : eps),
    (msg || 'value') + ': expected ' + expected + ', got ' + actual
  );
}

// Assert a point is a sharp corner: anchor at (x, y) and both control
// handles collapsed onto the anchor.
function assertSharp(p, x, y, label) {
  close(p.x, x, EPS, label + '.x');
  close(p.y, y, EPS, label + '.y');
  close(p.ix, x, EPS, label + '.ix');
  close(p.iy, y, EPS, label + '.iy');
  close(p.ox, x, EPS, label + '.ox');
  close(p.oy, y, EPS, label + '.oy');
}

// The core runs inside a vm sandbox, so its arrays come from another realm:
// deepStrictEqual against a host [] would fail on prototype identity.
// Array.isArray is cross-realm safe.
function assertEmptyArray(v, label) {
  assert.ok(Array.isArray(v), label + ': expected an array, got ' + v);
  assert.strictEqual(v.length, 0, label + ': expected empty array');
}

// Cubic bezier point for segment from point a to point b of a contour
// (controls are absolute coordinates).
function cubicAt(a, b, t) {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * a.x + w1 * a.ox + w2 * b.ix + w3 * b.x,
    y: w0 * a.y + w1 * a.oy + w2 * b.iy + w3 * b.y,
  };
}

// ---------------------------------------------------------------- rect

test('rect: basic 4-corner geometry, clockwise from top-left, closed', () => {
  const out = shapes.contoursFor('rect', {
    x: '10', y: '20', width: '30', height: '40',
  });
  assert.strictEqual(out.length, 1);
  const c = out[0];
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.points.length, 4);
  assertSharp(c.points[0], 10, 20, 'top-left');
  assertSharp(c.points[1], 40, 20, 'top-right');
  assertSharp(c.points[2], 40, 60, 'bottom-right');
  assertSharp(c.points[3], 10, 60, 'bottom-left');
});

test('rect: x/y default to 0 when absent', () => {
  const out = shapes.contoursFor('rect', { width: '8', height: '6' });
  assert.strictEqual(out.length, 1);
  assertSharp(out[0].points[0], 0, 0, 'top-left');
  assertSharp(out[0].points[2], 8, 6, 'bottom-right');
});

test('rect: rx only implies ry = rx', () => {
  const out = shapes.contoursFor('rect', {
    x: '0', y: '0', width: '100', height: '60', rx: '10',
  });
  const pts = out[0].points;
  assert.strictEqual(pts.length, 8);
  // Horizontal radius shows in the top edge endpoints...
  close(pts[0].x, 10, EPS, 'p0.x (x+rx)');
  close(pts[0].y, 0, EPS, 'p0.y');
  close(pts[1].x, 90, EPS, 'p1.x (x+w-rx)');
  // ...and the vertical radius (= rx) in the right edge endpoints.
  close(pts[2].x, 100, EPS, 'p2.x');
  close(pts[2].y, 10, EPS, 'p2.y (y+ry, ry=rx=10)');
  close(pts[3].y, 50, EPS, 'p3.y (y+h-ry)');
});

test('rect: ry only implies rx = ry', () => {
  const out = shapes.contoursFor('rect', {
    x: '0', y: '0', width: '100', height: '60', ry: '8',
  });
  const pts = out[0].points;
  assert.strictEqual(pts.length, 8);
  close(pts[0].x, 8, EPS, 'p0.x (x+rx, rx=ry=8)');
  close(pts[2].y, 8, EPS, 'p2.y (y+ry)');
});

test('rect: rx greater than w/2 is clamped to w/2', () => {
  const out = shapes.contoursFor('rect', {
    x: '0', y: '0', width: '10', height: '100', rx: '20', ry: '20',
  });
  const pts = out[0].points;
  assert.strictEqual(pts.length, 8);
  close(pts[0].x, 5, EPS, 'p0.x clamped to x+w/2');
  close(pts[1].x, 5, EPS, 'p1.x clamped to x+w-w/2');
  // ry = 20 <= h/2 = 50, so it must NOT be clamped.
  close(pts[2].y, 20, EPS, 'p2.y keeps ry=20');
});

test('rect: ry greater than h/2 is clamped to h/2', () => {
  const out = shapes.contoursFor('rect', {
    x: '0', y: '0', width: '100', height: '10', rx: '4', ry: '30',
  });
  const pts = out[0].points;
  close(pts[2].y, 5, EPS, 'p2.y clamped to y+h/2');
  close(pts[0].x, 4, EPS, 'p0.x keeps rx=4');
});

test('rect: rx=0 stays sharp (4 points, no rounding)', () => {
  const out = shapes.contoursFor('rect', {
    x: '1', y: '2', width: '10', height: '10', rx: '0',
  });
  const c = out[0];
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.points.length, 4);
  assertSharp(c.points[0], 1, 2, 'top-left');
  assertSharp(c.points[2], 11, 12, 'bottom-right');
});

test('rounded rect: 8 points, closed, kappa control offsets on top-right corner', () => {
  const rx = 10;
  const out = shapes.contoursFor('rect', {
    x: '0', y: '0', width: '100', height: '50', rx: String(rx),
  });
  const c = out[0];
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.points.length, 8);

  // Top-right corner arc runs from p1 (90, 0) to p2 (100, 10).
  const p1 = c.points[1];
  const p2 = c.points[2];
  const k = rx * KAPPA; // ~5.5228
  close(p1.x, 90, EPS, 'p1.x');
  close(p1.y, 0, EPS, 'p1.y');
  close(p1.ox, 90 + k, 1e-9, 'p1.ox = x+w-rx+kappa*rx');
  close(p1.oy, 0, EPS, 'p1.oy');
  close(p2.x, 100, EPS, 'p2.x');
  close(p2.y, 10, EPS, 'p2.y');
  close(p2.ix, 100, EPS, 'p2.ix');
  close(p2.iy, 10 - k, 1e-9, 'p2.iy = y+ry-kappa*ry');

  // The in-handle of p1 and out-handle of p2 sit on their anchors, so the
  // straight edges adjacent to the corner stay straight.
  close(p1.ix, p1.x, EPS, 'p1.ix on anchor');
  close(p1.iy, p1.y, EPS, 'p1.iy on anchor');
  close(p2.ox, p2.x, EPS, 'p2.ox on anchor');
  close(p2.oy, p2.y, EPS, 'p2.oy on anchor');

  // Numeric check: arc midpoint should be near the true circular corner
  // (center (90, 10), radius 10) — kappa error is well under 0.3%.
  const mid = cubicAt(p1, p2, 0.5);
  const d = Math.hypot(mid.x - 90, mid.y - 10);
  assert.ok(Math.abs(d - rx) / rx < 0.003,
    'corner arc midpoint radius ' + d + ' not within 0.3% of ' + rx);
});

test('rect: zero or negative width/height -> []', () => {
  assertEmptyArray(shapes.contoursFor('rect', { width: '0', height: '10' }), 'w=0');
  assertEmptyArray(shapes.contoursFor('rect', { width: '10', height: '0' }), 'h=0');
  assertEmptyArray(shapes.contoursFor('rect', { width: '-5', height: '10' }), 'w<0');
  assertEmptyArray(shapes.contoursFor('rect', { width: '10', height: '-0.1' }), 'h<0');
  // width/height missing entirely -> default 0 -> []
  assertEmptyArray(shapes.contoursFor('rect', {}), 'missing w/h');
});

// ---------------------------------------------------------------- circle

test('circle r=25 at (50,50): 4 quadrant points, closed, clockwise (y-down)', () => {
  const out = shapes.contoursFor('circle', { cx: '50', cy: '50', r: '25' });
  assert.strictEqual(out.length, 1);
  const c = out[0];
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.points.length, 4);
  const p = c.points;
  // start at (cx+r, cy), then bottom, left, top (clockwise with y down)
  close(p[0].x, 75, EPS, 'p0.x'); close(p[0].y, 50, EPS, 'p0.y');
  close(p[1].x, 50, EPS, 'p1.x'); close(p[1].y, 75, EPS, 'p1.y');
  close(p[2].x, 25, EPS, 'p2.x'); close(p[2].y, 50, EPS, 'p2.y');
  close(p[3].x, 50, EPS, 'p3.x'); close(p[3].y, 25, EPS, 'p3.y');

  // Control handles use kappa offsets.
  const k = 25 * KAPPA;
  close(p[0].ox, 75, EPS, 'p0.ox');
  close(p[0].oy, 50 + k, 1e-9, 'p0.oy = cy + r*kappa');
  close(p[1].ix, 50 + k, 1e-9, 'p1.ix = cx + r*kappa');
  close(p[1].iy, 75, EPS, 'p1.iy');

  // Sampled points along every quadrant bezier stay within 0.3% of r=25,
  // including each segment midpoint.
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    for (const t of [0.25, 0.5, 0.75]) {
      const q = cubicAt(a, b, t);
      const d = Math.hypot(q.x - 50, q.y - 50);
      assert.ok(Math.abs(d - 25) / 25 < 0.003,
        'segment ' + i + ' t=' + t + ': radius ' + d + ' off by more than 0.3%');
    }
  }
});

test('circle: r <= 0 or missing -> []', () => {
  assertEmptyArray(shapes.contoursFor('circle', { cx: '5', cy: '5', r: '0' }), 'r=0');
  assertEmptyArray(shapes.contoursFor('circle', { cx: '5', cy: '5', r: '-2' }), 'r<0');
  assertEmptyArray(shapes.contoursFor('circle', { cx: '5', cy: '5' }), 'r missing');
});

// ---------------------------------------------------------------- ellipse

test('ellipse rx != ry: quadrant anchors and per-axis kappa handles', () => {
  const out = shapes.contoursFor('ellipse', {
    cx: '10', cy: '20', rx: '30', ry: '15',
  });
  assert.strictEqual(out.length, 1);
  const c = out[0];
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.points.length, 4);
  const p = c.points;
  close(p[0].x, 40, EPS, 'p0.x (cx+rx)'); close(p[0].y, 20, EPS, 'p0.y');
  close(p[1].x, 10, EPS, 'p1.x'); close(p[1].y, 35, EPS, 'p1.y (cy+ry)');
  close(p[2].x, -20, EPS, 'p2.x (cx-rx)'); close(p[2].y, 20, EPS, 'p2.y');
  close(p[3].x, 10, EPS, 'p3.x'); close(p[3].y, 5, EPS, 'p3.y (cy-ry)');

  // Handle offsets must scale with the matching axis radius.
  close(p[0].oy, 20 + 15 * KAPPA, 1e-9, 'p0.oy uses ry*kappa');
  close(p[1].ix, 10 + 30 * KAPPA, 1e-9, 'p1.ix uses rx*kappa');

  // Sampled bezier points satisfy the ellipse equation within 0.3%.
  for (let i = 0; i < 4; i++) {
    const q = cubicAt(p[i], p[(i + 1) % 4], 0.5);
    const e = Math.hypot((q.x - 10) / 30, (q.y - 20) / 15);
    assert.ok(Math.abs(e - 1) < 0.003,
      'segment ' + i + ' midpoint ellipse residual ' + e);
  }
});

test('ellipse: rx or ry <= 0 -> []', () => {
  assertEmptyArray(shapes.contoursFor('ellipse', { rx: '0', ry: '5' }), 'rx=0');
  assertEmptyArray(shapes.contoursFor('ellipse', { rx: '5', ry: '-1' }), 'ry<0');
});

// ---------------------------------------------------------------- line

test('line: open 2-point contour', () => {
  const out = shapes.contoursFor('line', {
    x1: '1', y1: '2', x2: '3', y2: '4',
  });
  assert.strictEqual(out.length, 1);
  const c = out[0];
  assert.strictEqual(c.closed, false);
  assert.strictEqual(c.points.length, 2);
  assertSharp(c.points[0], 1, 2, 'line start');
  assertSharp(c.points[1], 3, 4, 'line end');
});

test('line: missing coordinates default to 0', () => {
  const out = shapes.contoursFor('line', { x2: '7' });
  assertSharp(out[0].points[0], 0, 0, 'line start');
  assertSharp(out[0].points[1], 7, 0, 'line end');
});

// ------------------------------------------------------ polyline / polygon

test("polyline '10,10 20,20 30,10': open, 3 points", () => {
  const out = shapes.contoursFor('polyline', { points: '10,10 20,20 30,10' });
  assert.strictEqual(out.length, 1);
  const c = out[0];
  assert.strictEqual(c.closed, false);
  assert.strictEqual(c.points.length, 3);
  assertSharp(c.points[0], 10, 10, 'p0');
  assertSharp(c.points[1], 20, 20, 'p1');
  assertSharp(c.points[2], 30, 10, 'p2');
});

test('polygon: same points but closed', () => {
  const out = shapes.contoursFor('polygon', { points: '10,10 20,20 30,10' });
  assert.strictEqual(out.length, 1);
  const c = out[0];
  assert.strictEqual(c.closed, true);
  assert.strictEqual(c.points.length, 3);
  assertSharp(c.points[0], 10, 10, 'p0');
  assertSharp(c.points[2], 30, 10, 'p2');
});

test('points string with odd count: trailing x is ignored', () => {
  const out = shapes.contoursFor('polyline', { points: '10,10 20,20 30' });
  const c = out[0];
  assert.strictEqual(c.points.length, 2);
  assertSharp(c.points[0], 10, 10, 'p0');
  assertSharp(c.points[1], 20, 20, 'p1');
});

test('points string: negative coords kept, garbage pairs skipped', () => {
  const out = shapes.contoursFor('polyline', {
    points: '-10,-20 foo,bar 30,40',
  });
  const c = out[0];
  assert.strictEqual(c.points.length, 2);
  assertSharp(c.points[0], -10, -20, 'negative point kept');
  assertSharp(c.points[1], 30, 40, 'point after garbage');
});

test('points string: fewer than 2 valid points -> []', () => {
  assertEmptyArray(shapes.contoursFor('polyline', { points: '5,5' }), 'single point');
  assertEmptyArray(shapes.contoursFor('polyline', { points: '' }), 'empty string');
  assertEmptyArray(shapes.contoursFor('polyline', {}), 'missing attr');
  assertEmptyArray(shapes.contoursFor('polygon', { points: 'a,b c,d' }), 'all garbage');
});

test('points string: mixed comma/whitespace separators and padding', () => {
  const out = shapes.contoursFor('polygon', { points: '  1 2, 3,4  ,5 6  ' });
  const c = out[0];
  assert.strictEqual(c.points.length, 3);
  assertSharp(c.points[0], 1, 2, 'p0');
  assertSharp(c.points[1], 3, 4, 'p1');
  assertSharp(c.points[2], 5, 6, 'p2');
});

// ---------------------------------------------------------------- unknown

test('unknown element names -> null', () => {
  assert.strictEqual(shapes.contoursFor('path', { d: 'M0 0L1 1' }), null);
  assert.strictEqual(shapes.contoursFor('g', {}), null);
  assert.strictEqual(shapes.contoursFor('star', {}), null);
  assert.strictEqual(shapes.contoursFor('', {}), null);
});
