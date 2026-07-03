// SVG path data parser. ES3 only.
//
// parse(d) -> { contours: [contour] }
// contour: { closed: bool, points: [ { x, y, ix, iy, ox, oy } ] }
//   ix/iy: absolute incoming bezier control point (from previous anchor)
//   ox/oy: absolute outgoing bezier control point (toward next anchor)
//   Straight segments have controls equal to their anchors (zero tangents).
// All commands are converted to absolute cubics; arcs and quadratics are
// approximated/converted to cubics. Contours split at every M.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.path = (function () {
  var EPS = 1e-9;

  function Scanner(text) {
    this.text = text;
    this.pos = 0;
    this.len = text.length;
  }

  Scanner.prototype.skipSep = function () {
    while (this.pos < this.len) {
      var ch = this.text.charAt(this.pos);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') this.pos++;
      else break;
    }
  };

  Scanner.prototype.atEnd = function () {
    this.skipSep();
    return this.pos >= this.len;
  };

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  Scanner.prototype.peekNumberStart = function () {
    this.skipSep();
    var ch = this.text.charAt(this.pos);
    return isDigit(ch) || ch === '+' || ch === '-' || ch === '.';
  };

  Scanner.prototype.fail = function (msg) {
    throw new Error('path parse error at index ' + this.pos + ': ' + msg +
      ' (near "' + this.text.substring(this.pos, this.pos + 12) + '")');
  };

  Scanner.prototype.nextNumber = function () {
    this.skipSep();
    var t = this.text;
    var start = this.pos;
    var p = this.pos;
    var ch = t.charAt(p);
    if (ch === '+' || ch === '-') p++;
    var digitsBefore = 0;
    while (isDigit(t.charAt(p))) { p++; digitsBefore++; }
    var digitsAfter = 0;
    if (t.charAt(p) === '.') {
      p++;
      while (isDigit(t.charAt(p))) { p++; digitsAfter++; }
    }
    if (digitsBefore === 0 && digitsAfter === 0) this.fail('expected number');
    ch = t.charAt(p);
    if (ch === 'e' || ch === 'E') {
      var q = p + 1;
      ch = t.charAt(q);
      if (ch === '+' || ch === '-') q++;
      var expDigits = 0;
      while (isDigit(t.charAt(q))) { q++; expDigits++; }
      if (expDigits > 0) p = q;
    }
    this.pos = p;
    return parseFloat(t.substring(start, p));
  };

  // Arc flags are single characters and may be run together ("011" = 0,1,1-start).
  Scanner.prototype.nextFlag = function () {
    this.skipSep();
    var ch = this.text.charAt(this.pos);
    if (ch !== '0' && ch !== '1') this.fail('expected arc flag');
    this.pos++;
    return ch === '1' ? 1 : 0;
  };

  Scanner.prototype.nextCommand = function () {
    this.skipSep();
    var ch = this.text.charAt(this.pos);
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      this.pos++;
      return ch;
    }
    return null;
  };

  function Builder() {
    this.contours = [];
    this.points = null; // current contour's points
    this.closedFlag = false;
  }

  Builder.prototype.startContour = function (x, y) {
    this.finishContour();
    this.points = [{ x: x, y: y, ix: x, iy: y, ox: x, oy: y }];
    this.closedFlag = false;
  };

  Builder.prototype.finishContour = function () {
    if (this.points && (this.points.length > 1 || this.closedFlag && this.points.length > 0)) {
      this.contours[this.contours.length] = { closed: this.closedFlag, points: this.points };
    }
    this.points = null;
    this.closedFlag = false;
  };

  Builder.prototype.last = function () {
    return this.points[this.points.length - 1];
  };

  Builder.prototype.lineTo = function (x, y) {
    if (!this.points) this.startContour(0, 0);
    this.points[this.points.length] = { x: x, y: y, ix: x, iy: y, ox: x, oy: y };
  };

  Builder.prototype.cubicTo = function (c1x, c1y, c2x, c2y, x, y) {
    if (!this.points) this.startContour(0, 0);
    var prev = this.last();
    prev.ox = c1x;
    prev.oy = c1y;
    this.points[this.points.length] = { x: x, y: y, ix: c2x, iy: c2y, ox: x, oy: y };
  };

  Builder.prototype.close = function () {
    if (!this.points || this.points.length === 0) return;
    var first = this.points[0];
    var last = this.last();
    var dx = last.x - first.x;
    var dy = last.y - first.y;
    if (this.points.length > 1 && dx * dx + dy * dy < EPS) {
      // merge coincident closing anchor into the first anchor
      first.ix = last.ix;
      first.iy = last.iy;
      this.points.length = this.points.length - 1;
    }
    this.closedFlag = true;
    this.finishContour();
  };

  // --- arc conversion (SVG spec F.6.5/F.6.6) ---
  function arcToCubics(builder, x1, y1, rx, ry, phiDeg, laf, sf, x2, y2) {
    if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) < EPS) return;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx < EPS || ry < EPS) {
      builder.lineTo(x2, y2);
      return;
    }
    var phi = (phiDeg % 360) * Math.PI / 180;
    var cosPhi = Math.cos(phi);
    var sinPhi = Math.sin(phi);
    var dx2 = (x1 - x2) / 2;
    var dy2 = (y1 - y2) / 2;
    var x1p = cosPhi * dx2 + sinPhi * dy2;
    var y1p = -sinPhi * dx2 + cosPhi * dy2;
    var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      var lam = Math.sqrt(lambda);
      rx *= lam;
      ry *= lam;
    }
    var rx2 = rx * rx;
    var ry2 = ry * ry;
    var num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
    if (num < 0) num = 0;
    var den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    var coef = den < EPS ? 0 : Math.sqrt(num / den);
    if (laf === sf) coef = -coef;
    var cxp = coef * rx * y1p / ry;
    var cyp = -coef * ry * x1p / rx;
    var cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    var cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    function angle(ux, uy, vx, vy) {
      var dot = ux * vx + uy * vy;
      var lenp = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
      var v = dot / lenp;
      if (v > 1) v = 1;
      if (v < -1) v = -1;
      var a = Math.acos(v);
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    }

    var theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    var TWO_PI = Math.PI * 2;
    if (!sf && dtheta > 0) dtheta -= TWO_PI;
    if (sf && dtheta < 0) dtheta += TWO_PI;

    var segs = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
    if (segs === 0) return;
    var delta = dtheta / segs;
    var k = 4 / 3 * Math.tan(delta / 4);

    function pointAt(theta) {
      var px = rx * Math.cos(theta);
      var py = ry * Math.sin(theta);
      return [cx + cosPhi * px - sinPhi * py, cy + sinPhi * px + cosPhi * py];
    }
    function derivAt(theta) {
      var px = -rx * Math.sin(theta);
      var py = ry * Math.cos(theta);
      return [cosPhi * px - sinPhi * py, sinPhi * px + cosPhi * py];
    }

    var theta = theta1;
    for (var i = 0; i < segs; i++) {
      var thetaNext = theta + delta;
      var p0 = pointAt(theta);
      var p3 = pointAt(thetaNext);
      var d0 = derivAt(theta);
      var d3 = derivAt(thetaNext);
      // snap segment endpoints to the exact command endpoints
      if (i === 0) { p0 = [x1, y1]; }
      if (i === segs - 1) { p3 = [x2, y2]; }
      builder.cubicTo(
        p0[0] + k * d0[0], p0[1] + k * d0[1],
        p3[0] - k * d3[0], p3[1] - k * d3[1],
        p3[0], p3[1]
      );
      theta = thetaNext;
    }
  }

  function parse(d) {
    var scanner = new Scanner(String(d === null || d === undefined ? '' : d));
    var builder = new Builder();
    var cx = 0, cy = 0;         // current point
    var sx = 0, sy = 0;         // subpath start
    var lastCmd = null;
    var lastC2x = 0, lastC2y = 0; // last cubic control2 (for S)
    var lastQx = 0, lastQy = 0;   // last quad control (for T)
    var afterClose = false;

    function ensureContour() {
      // after Z, drawing continues from the subpath start in a new contour
      if (afterClose || !builder.points) {
        builder.startContour(cx, cy);
        afterClose = false;
      }
    }

    while (!scanner.atEnd()) {
      var cmd = scanner.nextCommand();
      if (cmd === null) {
        if (lastCmd === null) scanner.fail('expected command');
        // implicit command repetition
        cmd = lastCmd;
        if (cmd === 'M') cmd = 'L';
        if (cmd === 'm') cmd = 'l';
        // Z takes no arguments, so trailing data after Z can never be
        // consumed as a repetition - that's malformed path data.
        if (cmd === 'Z' || cmd === 'z') scanner.fail('unexpected data after Z');
      }
      var rel = cmd >= 'a' && cmd <= 'z';
      var CMD = rel ? cmd.toUpperCase() : cmd;
      var x, y, x1, y1, x2, y2;

      if (CMD === 'M') {
        x = scanner.nextNumber();
        y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y; sx = x; sy = y;
        afterClose = false;
        builder.startContour(x, y);
      } else if (CMD === 'L') {
        x = scanner.nextNumber();
        y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        ensureContour();
        builder.lineTo(x, y);
        cx = x; cy = y;
      } else if (CMD === 'H') {
        x = scanner.nextNumber();
        if (rel) x += cx;
        ensureContour();
        builder.lineTo(x, cy);
        cx = x;
      } else if (CMD === 'V') {
        y = scanner.nextNumber();
        if (rel) y += cy;
        ensureContour();
        builder.lineTo(cx, y);
        cy = y;
      } else if (CMD === 'C') {
        x1 = scanner.nextNumber(); y1 = scanner.nextNumber();
        x2 = scanner.nextNumber(); y2 = scanner.nextNumber();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        ensureContour();
        builder.cubicTo(x1, y1, x2, y2, x, y);
        lastC2x = x2; lastC2y = y2;
        cx = x; cy = y;
      } else if (CMD === 'S') {
        x2 = scanner.nextNumber(); y2 = scanner.nextNumber();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        var prevWasCubic = lastCmd !== null && /[CcSs]/.test(lastCmd);
        x1 = prevWasCubic ? 2 * cx - lastC2x : cx;
        y1 = prevWasCubic ? 2 * cy - lastC2y : cy;
        ensureContour();
        builder.cubicTo(x1, y1, x2, y2, x, y);
        lastC2x = x2; lastC2y = y2;
        cx = x; cy = y;
      } else if (CMD === 'Q') {
        x1 = scanner.nextNumber(); y1 = scanner.nextNumber();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
        ensureContour();
        builder.cubicTo(
          cx + 2 / 3 * (x1 - cx), cy + 2 / 3 * (y1 - cy),
          x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y),
          x, y
        );
        lastQx = x1; lastQy = y1;
        cx = x; cy = y;
      } else if (CMD === 'T') {
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        var prevWasQuad = lastCmd !== null && /[QqTt]/.test(lastCmd);
        x1 = prevWasQuad ? 2 * cx - lastQx : cx;
        y1 = prevWasQuad ? 2 * cy - lastQy : cy;
        ensureContour();
        builder.cubicTo(
          cx + 2 / 3 * (x1 - cx), cy + 2 / 3 * (y1 - cy),
          x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y),
          x, y
        );
        lastQx = x1; lastQy = y1;
        cx = x; cy = y;
      } else if (CMD === 'A') {
        var rx = scanner.nextNumber();
        var ry = scanner.nextNumber();
        var rot = scanner.nextNumber();
        var laf = scanner.nextFlag();
        var sf = scanner.nextFlag();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        ensureContour();
        arcToCubics(builder, cx, cy, rx, ry, rot, laf, sf, x, y);
        cx = x; cy = y;
      } else if (CMD === 'Z') {
        builder.close();
        cx = sx; cy = sy;
        afterClose = true;
      }
      lastCmd = cmd;
    }
    builder.finishContour();
    return { contours: builder.contours };
  }

  // Exact bounding box of contours (accounts for bezier extrema).
  function bounds(contours) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function acc(x, y) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    function cubicAxisExtrema(p0, p1, p2, p3, cb) {
      // derivative: 3[(p1-p0) + 2t(p2-2p1+p0) + t^2(p3-3p2+3p1-p0)]
      var a = p3 - 3 * p2 + 3 * p1 - p0;
      var b = 2 * (p2 - 2 * p1 + p0);
      var c = p1 - p0;
      var ts = [];
      if (Math.abs(a) < EPS) {
        if (Math.abs(b) > EPS) ts[ts.length] = -c / b;
      } else {
        var disc = b * b - 4 * a * c;
        if (disc >= 0) {
          var sq = Math.sqrt(disc);
          ts[ts.length] = (-b + sq) / (2 * a);
          ts[ts.length] = (-b - sq) / (2 * a);
        }
      }
      for (var i = 0; i < ts.length; i++) {
        var t = ts[i];
        if (t > 0 && t < 1) {
          var mt = 1 - t;
          cb(mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3);
        }
      }
    }
    for (var cj = 0; cj < contours.length; cj++) {
      var cpts = contours[cj].points;
      var m = cpts.length;
      for (var j = 0; j < m; j++) {
        var pp = cpts[j];
        acc(pp.x, pp.y);
        var last = j === m - 1;
        if (last && !contours[cj].closed) continue;
        var qq = cpts[last ? 0 : j + 1];
        cubicAxisExtrema(pp.x, pp.ox, qq.ix, qq.x, function (vx) {
          if (vx < minX) minX = vx;
          if (vx > maxX) maxX = vx;
        });
        cubicAxisExtrema(pp.y, pp.oy, qq.iy, qq.y, function (vy) {
          if (vy < minY) minY = vy;
          if (vy > maxY) maxY = vy;
        });
      }
    }
    if (minX === Infinity) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  return { parse: parse, bounds: bounds };
})();
