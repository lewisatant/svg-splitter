// SVG shape primitives -> contours (same format as SVGSPLIT.path). ES3 only.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.shapes = (function () {
  // Circle kappa: control-point offset factor for a 90-degree bezier arc.
  var KAPPA = 0.5522847498307936;

  function num(attrs, name, fallback) {
    var v = attrs[name];
    if (v === undefined || v === null || v === '') return fallback;
    var f = parseFloat(v);
    return isNaN(f) ? fallback : f;
  }

  function pt(x, y) {
    return { x: x, y: y, ix: x, iy: y, ox: x, oy: y };
  }

  // Full ellipse as 4 bezier quadrants, starting at (cx+rx, cy), clockwise
  // in the SVG y-down coordinate system.
  function ellipseContour(cx, cy, rx, ry) {
    var kx = rx * KAPPA;
    var ky = ry * KAPPA;
    var p0 = pt(cx + rx, cy);
    var p1 = pt(cx, cy + ry);
    var p2 = pt(cx - rx, cy);
    var p3 = pt(cx, cy - ry);
    p0.ox = cx + rx; p0.oy = cy + ky; p0.ix = cx + rx; p0.iy = cy - ky;
    p1.ix = cx + kx; p1.iy = cy + ry; p1.ox = cx - kx; p1.oy = cy + ry;
    p2.ix = cx - rx; p2.iy = cy + ky; p2.ox = cx - rx; p2.oy = cy - ky;
    p3.ix = cx - kx; p3.iy = cy - ry; p3.ox = cx + kx; p3.oy = cy - ry;
    return { closed: true, points: [p0, p1, p2, p3] };
  }

  function rectContours(attrs) {
    var x = num(attrs, 'x', 0);
    var y = num(attrs, 'y', 0);
    var w = num(attrs, 'width', 0);
    var h = num(attrs, 'height', 0);
    if (w <= 0 || h <= 0) return [];
    var rx = num(attrs, 'rx', -1);
    var ry = num(attrs, 'ry', -1);
    if (rx < 0 && ry >= 0) rx = ry;
    if (ry < 0 && rx >= 0) ry = rx;
    if (rx < 0) rx = 0;
    if (ry < 0) ry = 0;
    if (rx > w / 2) rx = w / 2;
    if (ry > h / 2) ry = h / 2;

    if (rx === 0 || ry === 0) {
      return [{
        closed: true,
        points: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)]
      }];
    }

    var kx = rx * KAPPA;
    var ky = ry * KAPPA;
    // clockwise from top-left corner end
    var pts = [];
    function add(px, py, inx, iny, outx, outy) {
      var p = pt(px, py);
      p.ix = inx; p.iy = iny; p.ox = outx; p.oy = outy;
      pts[pts.length] = p;
    }
    add(x + rx, y, x + rx - kx, y, x + rx, y); // top-left arc end
    add(x + w - rx, y, x + w - rx, y, x + w - rx + kx, y); // top-right arc start
    add(x + w, y + ry, x + w, y + ry - ky, x + w, y + ry);
    add(x + w, y + h - ry, x + w, y + h - ry, x + w, y + h - ry + ky);
    add(x + w - rx, y + h, x + w - rx + kx, y + h, x + w - rx, y + h);
    add(x + rx, y + h, x + rx, y + h, x + rx - kx, y + h);
    add(x, y + h - ry, x, y + h - ry + ky, x, y + h - ry);
    add(x, y + ry, x, y + ry, x, y + ry - ky);
    return [{ closed: true, points: pts }];
  }

  function circleContours(attrs) {
    var r = num(attrs, 'r', 0);
    if (r <= 0) return [];
    return [ellipseContour(num(attrs, 'cx', 0), num(attrs, 'cy', 0), r, r)];
  }

  function ellipseContours(attrs) {
    var rx = num(attrs, 'rx', 0);
    var ry = num(attrs, 'ry', 0);
    if (rx <= 0 || ry <= 0) return [];
    return [ellipseContour(num(attrs, 'cx', 0), num(attrs, 'cy', 0), rx, ry)];
  }

  function lineContours(attrs) {
    return [{
      closed: false,
      points: [
        pt(num(attrs, 'x1', 0), num(attrs, 'y1', 0)),
        pt(num(attrs, 'x2', 0), num(attrs, 'y2', 0))
      ]
    }];
  }

  function parsePoints(text) {
    var out = [];
    if (!text) return out;
    var pieces = text.replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
    for (var i = 0; i + 1 < pieces.length; i += 2) {
      var px = parseFloat(pieces[i]);
      var py = parseFloat(pieces[i + 1]);
      if (!isNaN(px) && !isNaN(py)) out[out.length] = pt(px, py);
    }
    return out;
  }

  function polylineContours(attrs, close) {
    var pts = parsePoints(attrs.points);
    if (pts.length < 2) return [];
    return [{ closed: !!close, points: pts }];
  }

  // Returns contours for a drawable primitive element, or null when the
  // element name is not a primitive this module handles.
  function contoursFor(name, attrs) {
    if (name === 'rect') return rectContours(attrs);
    if (name === 'circle') return circleContours(attrs);
    if (name === 'ellipse') return ellipseContours(attrs);
    if (name === 'line') return lineContours(attrs);
    if (name === 'polyline') return polylineContours(attrs, false);
    if (name === 'polygon') return polylineContours(attrs, true);
    return null;
  }

  return {
    contoursFor: contoursFor,
    ellipseContour: ellipseContour,
    parsePoints: parsePoints
  };
})();
