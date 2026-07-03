// Scene builder: walks a parsed SVG document and produces flat,
// AE-agnostic layer specs with world-space (comp-space) geometry.
// ES3 only.
//
// SVGSPLIT.scene.build(svgText, opts) -> {
//   width, height,
//   layers: [layerSpec],      // document order (first = bottom in AE)
//   warnings: [string]
// }
//
// layerSpec: {
//   name, kind: 'shape'|'text',
//   items: [item],            // document order (first = painted first)
//   textRuns: [run]|null,
//   effects: [effect],
//   blendMode: string|null,
//   bbox: {minX,minY,maxX,maxY},
//   warnings: [string]
// }
// item: {
//   name, contours, fillRule ('nonzero'|'evenodd'),
//   fill:   null|paint, stroke: null|strokeSpec,
//   clips:  [ [contour] ]     // baked clip contour sets to merge-intersect
// }
// paint: {type:'solid', color:{r,g,b}, opacity}
//      | {type:'gradient', kind:'linear'|'radial', stops:[{offset,color,opacity}],
//         start:[x,y], end:[x,y], hilite:{length,angleDeg}|null}
//      | {type:'placeholder'}   // unsupported paint (image/pattern)

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.scene = (function () {
  var matrix = SVGSPLIT.matrix;
  var colorMod = SVGSPLIT.color;
  var xmlMod = SVGSPLIT.xml;
  var pathMod = SVGSPLIT.path;
  var shapesMod = SVGSPLIT.shapes;
  var styleMod = SVGSPLIT.style;

  var DRAWABLES = {
    path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1
  };
  // element names that never render as part of the tree walk
  var NON_RENDERED = {
    defs: 1, style: 1, title: 1, desc: 1, metadata: 1, symbol: 1, marker: 1,
    clipPath: 1, mask: 1, linearGradient: 1, radialGradient: 1, pattern: 1,
    filter: 1, script: 1
  };

  function localName(node) {
    var n = node.name;
    var idx = n.indexOf(':');
    return idx === -1 ? n : n.substring(idx + 1);
  }

  function isElement(node) {
    return node.type === 'element';
  }

  function textContent(node) {
    var out = '';
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.type === 'text') out += c.text;
      else if (c.type === 'element') out += textContent(c);
    }
    return out;
  }

  function attrOr(node, name, fallback) {
    var v = node.attrs[name];
    return v === undefined || v === null || v === '' ? fallback : v;
  }

  function hrefOf(node) {
    var h = node.attrs['href'];
    if (h === undefined) h = node.attrs['xlink:href'];
    return h;
  }

  function urlRefId(value) {
    if (!value) return null;
    var m = /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value);
    return m ? m[1] : null;
  }

  function transformContours(contours, m) {
    var out = [];
    for (var i = 0; i < contours.length; i++) {
      var src = contours[i].points;
      var pts = [];
      for (var j = 0; j < src.length; j++) {
        var p = src[j];
        var a = matrix.apply(m, p.x, p.y);
        var bIn = matrix.apply(m, p.ix, p.iy);
        var bOut = matrix.apply(m, p.ox, p.oy);
        pts[pts.length] = { x: a[0], y: a[1], ix: bIn[0], iy: bIn[1], ox: bOut[0], oy: bOut[1] };
      }
      out[out.length] = { closed: contours[i].closed, points: pts };
    }
    return out;
  }

  function boundsUnion(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      minX: a.minX < b.minX ? a.minX : b.minX,
      minY: a.minY < b.minY ? a.minY : b.minY,
      maxX: a.maxX > b.maxX ? a.maxX : b.maxX,
      maxY: a.maxY > b.maxY ? a.maxY : b.maxY
    };
  }

  // True when contours form a single axis-aligned rectangle (no curves).
  function rectOf(contours) {
    if (contours.length !== 1) return null;
    var c = contours[0];
    if (!c.closed || c.points.length !== 4) return null;
    for (var i = 0; i < 4; i++) {
      var p = c.points[i];
      if (p.ix !== p.x || p.iy !== p.y || p.ox !== p.x || p.oy !== p.y) return null;
    }
    var xs = [c.points[0].x, c.points[1].x, c.points[2].x, c.points[3].x];
    var ys = [c.points[0].y, c.points[1].y, c.points[2].y, c.points[3].y];
    // each x must appear exactly twice for an axis-aligned rect
    xs.sort(function (u, v) { return u - v; });
    ys.sort(function (u, v) { return u - v; });
    if (xs[0] !== xs[1] || xs[2] !== xs[3] || ys[0] !== ys[1] || ys[2] !== ys[3]) return null;
    if (xs[0] === xs[2] || ys[0] === ys[2]) return null;
    return { minX: xs[0], minY: ys[0], maxX: xs[2], maxY: ys[2] };
  }

  function bboxInside(inner, outer, eps) {
    if (!inner || !outer) return false;
    if (eps === undefined) eps = 0.01;
    return inner.minX >= outer.minX - eps && inner.minY >= outer.minY - eps &&
      inner.maxX <= outer.maxX + eps && inner.maxY <= outer.maxY + eps;
  }

  // ---------- gradient parsing ----------

  function parseOffset(v) {
    if (v === undefined || v === null || v === '') return 0;
    var s = String(v);
    var isPct = s.charAt(s.length - 1) === '%';
    var f = parseFloat(s);
    if (isNaN(f)) return 0;
    if (isPct) f /= 100;
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    return f;
  }

  function gradientStops(gradNode, defs, depth) {
    var stops = [];
    for (var i = 0; i < gradNode.children.length; i++) {
      var c = gradNode.children[i];
      if (!isElement(c) || localName(c) !== 'stop') continue;
      var inline = styleMod.parseInline(c.attrs.style);
      var colorStr = inline['stop-color'] || attrOr(c, 'stop-color', '#000');
      var opacityStr = inline['stop-opacity'] || attrOr(c, 'stop-opacity', '1');
      var col = colorMod.parse(colorStr);
      if (!col || col.none || col.currentColor) col = { r: 0, g: 0, b: 0, a: 1 };
      var op = parseFloat(opacityStr);
      if (isNaN(op)) op = 1;
      stops[stops.length] = {
        offset: parseOffset(c.attrs.offset),
        color: { r: col.r, g: col.g, b: col.b },
        opacity: op * col.a
      };
    }
    if (stops.length === 0 && depth < 4) {
      var href = hrefOf(gradNode);
      if (href && href.charAt(0) === '#') {
        var target = defs[href.substring(1)];
        if (target) return gradientStops(target, defs, depth + 1);
      }
    }
    // enforce non-decreasing offsets (spec)
    var maxSeen = 0;
    for (var j = 0; j < stops.length; j++) {
      if (stops[j].offset < maxSeen) stops[j].offset = maxSeen;
      else maxSeen = stops[j].offset;
    }
    return stops;
  }

  function lenOf(vx, vy) {
    return Math.sqrt(vx * vx + vy * vy);
  }

  // Resolve a gradient def to a baked paint.
  // ctm: element's full CTM; userBBox: element bbox in its own user space;
  // viewport: [width, height] for percentage coordinates.
  function resolveGradient(gradNode, defs, ctm, userBBox, warn, viewport) {
    var kind = localName(gradNode) === 'radialGradient' ? 'radial' : 'linear';
    var stops = gradientStops(gradNode, defs, 0);
    if (stops.length === 0) {
      warn('gradient "' + attrOr(gradNode, 'id', '?') + '" has no stops; using black');
      stops = [{ offset: 0, color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    }
    if (stops.length === 1) {
      return { type: 'solid', color: stops[0].color, opacity: stops[0].opacity };
    }
    var units = attrOr(gradNode, 'gradientUnits', 'objectBoundingBox');
    var m = ctm;
    if (units === 'objectBoundingBox') {
      if (!userBBox) {
        warn('objectBoundingBox gradient on element without geometry; using black fill');
        return { type: 'solid', color: stops[0].color, opacity: stops[0].opacity };
      }
      m = matrix.multiply(ctm, [
        userBBox.maxX - userBBox.minX, 0, 0,
        userBBox.maxY - userBBox.minY, userBBox.minX, userBBox.minY
      ]);
    }
    var gt = matrix.parse(gradNode.attrs.gradientTransform);
    m = matrix.multiply(m, gt);

    var spread = attrOr(gradNode, 'spreadMethod', 'pad');
    if (spread !== 'pad') {
      warn('gradient spreadMethod="' + spread + '" not supported; treating as pad');
    }

    var isObb = units === 'objectBoundingBox';

    // Gradient coordinate: percentages are fractions of the bbox for
    // objectBoundingBox units, or of the viewport dimension for userSpaceOnUse.
    function gradCoord(attrName, fallback, viewportSize) {
      var v = gradNode.attrs[attrName];
      if (v === undefined || v === null || v === '') return fallback;
      var s = String(v);
      var f = parseFloat(s);
      if (isNaN(f)) return fallback;
      if (s.indexOf('%') !== -1) return isObb ? f / 100 : f / 100 * viewportSize;
      return f;
    }
    var vpW = viewport[0];
    var vpH = viewport[1];
    var vpDiag = Math.sqrt((vpW * vpW + vpH * vpH) / 2);

    if (kind === 'linear') {
      var x1 = gradCoord('x1', 0, vpW);
      var y1 = gradCoord('y1', 0, vpH);
      var x2 = gradCoord('x2', isObb ? 1 : 0, vpW);
      var y2 = gradCoord('y2', 0, vpH);
      var start = matrix.apply(m, x1, y1);
      var end = matrix.apply(m, x2, y2);
      return { type: 'gradient', kind: 'linear', stops: stops, start: start, end: end, hilite: null };
    }

    // radial
    var cx = gradCoord('cx', isObb ? 0.5 : 0, vpW);
    var cy = gradCoord('cy', isObb ? 0.5 : 0, vpH);
    var r = gradCoord('r', isObb ? 0.5 : 1, vpDiag);
    var fx = gradCoord('fx', cx, vpW);
    var fy = gradCoord('fy', cy, vpH);
    var center = matrix.apply(m, cx, cy);
    var rp1 = matrix.apply(m, cx + r, cy);
    var rp2 = matrix.apply(m, cx, cy + r);
    var rA = lenOf(rp1[0] - center[0], rp1[1] - center[1]);
    var rB = lenOf(rp2[0] - center[0], rp2[1] - center[1]);
    var radius = (rA + rB) / 2;
    if (radius > 0 && Math.abs(rA - rB) / radius > 0.01) {
      warn('elliptical radial gradient approximated as circular (radii ' +
        rA.toFixed(1) + ' vs ' + rB.toFixed(1) + ')');
    }
    var hilite = null;
    if (fx !== cx || fy !== cy) {
      var f = matrix.apply(m, fx, fy);
      var flen = lenOf(f[0] - center[0], f[1] - center[1]);
      if (radius > 0 && flen > 1e-6) {
        hilite = {
          length: flen / radius,
          angleDeg: Math.atan2(f[1] - center[1], f[0] - center[0]) * 180 / Math.PI
        };
      }
    }
    return {
      type: 'gradient', kind: 'radial', stops: stops,
      start: center, end: [center[0] + radius, center[1]], hilite: hilite
    };
  }

  // ---------- filter decoding (Figma signatures) ----------

  function parseColorMatrixValues(text) {
    if (!text) return null;
    var pieces = text.replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
    if (pieces.length !== 20) return null;
    var vals = [];
    for (var i = 0; i < 20; i++) {
      var f = parseFloat(pieces[i]);
      if (isNaN(f)) return null;
      vals[vals.length] = f;
    }
    return vals;
  }

  // Returns { effects: [...], warnings: [...] }
  function decodeFilter(filterNode) {
    var prims = [];
    for (var i = 0; i < filterNode.children.length; i++) {
      if (isElement(filterNode.children[i])) prims[prims.length] = filterNode.children[i];
    }
    var effects = [];
    var warnings = [];
    var fid = attrOr(filterNode, 'id', '?');

    var dx = 0, dy = 0, std = 0;
    var hasOffset = false, hasBlur = false, hasCompositeOut = false, hasInner = false;
    var hasMorphology = false;
    var shadowColor = { r: 0, g: 0, b: 0 };
    var shadowOpacity = 1;
    var sawDropShadowPrim = null;

    for (var p = 0; p < prims.length; p++) {
      var prim = prims[p];
      var pname = localName(prim);
      if (pname === 'feOffset') {
        hasOffset = true;
        dx = parseFloat(attrOr(prim, 'dx', '0')) || 0;
        dy = parseFloat(attrOr(prim, 'dy', '0')) || 0;
      } else if (pname === 'feGaussianBlur') {
        hasBlur = true;
        var sd = String(attrOr(prim, 'stdDeviation', '0')).replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
        std = parseFloat(sd[0]) || 0;
      } else if (pname === 'feComposite') {
        var op = attrOr(prim, 'operator', 'over');
        if (op === 'out') hasCompositeOut = true;
        if (op === 'arithmetic' && parseFloat(attrOr(prim, 'k2', '0')) === -1) hasInner = true;
      } else if (pname === 'feColorMatrix') {
        if (attrOr(prim, 'in', '') !== 'SourceAlpha') {
          var vals = parseColorMatrixValues(prim.attrs.values);
          if (vals) {
            shadowColor = { r: vals[4], g: vals[9], b: vals[14] };
            shadowOpacity = vals[18];
          }
        }
      } else if (pname === 'feMorphology') {
        hasMorphology = true;
      } else if (pname === 'feDropShadow') {
        sawDropShadowPrim = {
          dx: parseFloat(attrOr(prim, 'dx', '2')) || 0,
          dy: parseFloat(attrOr(prim, 'dy', '2')) || 0,
          std: parseFloat(attrOr(prim, 'stdDeviation', '2')) || 0
        };
        var fc = colorMod.parse(attrOr(prim, 'flood-color', 'black'));
        var fo = parseFloat(attrOr(prim, 'flood-opacity', '1'));
        if (fc && !fc.none) shadowColor = { r: fc.r, g: fc.g, b: fc.b };
        if (!isNaN(fo)) shadowOpacity = fo * (fc ? fc.a : 1);
      }
    }

    if (sawDropShadowPrim) {
      effects[effects.length] = {
        type: 'dropShadow', dx: sawDropShadowPrim.dx, dy: sawDropShadowPrim.dy,
        stdDeviation: sawDropShadowPrim.std, color: shadowColor, opacity: shadowOpacity
      };
    } else if (hasInner) {
      warnings[warnings.length] = 'inner shadow (filter #' + fid + ') not supported; skipped';
    } else if (hasOffset || hasCompositeOut) {
      effects[effects.length] = {
        type: 'dropShadow', dx: dx, dy: dy, stdDeviation: std,
        color: shadowColor, opacity: shadowOpacity
      };
      if (hasMorphology) {
        warnings[warnings.length] = 'shadow spread (feMorphology, filter #' + fid + ') approximated without spread';
      }
    } else if (hasBlur) {
      // background blur renders as a plain blur warning; foreground blur converts
      if (/_b_|backgroundBlur/.test(fid) || filterHasBackgroundBlurResult(prims)) {
        warnings[warnings.length] = 'background blur (filter #' + fid + ') not supported; skipped';
      } else {
        effects[effects.length] = { type: 'gaussianBlur', stdDeviation: std };
      }
    } else if (prims.length > 0) {
      warnings[warnings.length] = 'filter #' + fid + ' not recognized; skipped';
    }
    return { effects: effects, warnings: warnings };
  }

  function filterHasBackgroundBlurResult(prims) {
    for (var i = 0; i < prims.length; i++) {
      if (/backgroundBlur/.test(attrOr(prims[i], 'result', ''))) return true;
    }
    return false;
  }

  // ---------- main walk ----------

  function build(svgText, opts) {
    opts = opts || {};
    var splitMode = opts.splitMode === 'leaf' ? 'leaf' : 'toplevel';
    var globalWarnings = [];

    function warnGlobal(msg) {
      globalWarnings[globalWarnings.length] = msg;
    }

    var root = xmlMod.parse(svgText);
    if (localName(root) !== 'svg') {
      throw new Error('root element is <' + root.name + '>, expected <svg>');
    }

    // ----- viewport -----
    var vb = null;
    if (root.attrs.viewBox) {
      var vbParts = root.attrs.viewBox.replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
      if (vbParts.length === 4) {
        vb = [parseFloat(vbParts[0]), parseFloat(vbParts[1]), parseFloat(vbParts[2]), parseFloat(vbParts[3])];
        if (isNaN(vb[0]) || isNaN(vb[1]) || vb[2] <= 0 || vb[3] <= 0) vb = null;
      }
    }
    function attrLen(name) {
      var v = root.attrs[name];
      if (!v || String(v).indexOf('%') !== -1) return null;
      var f = parseFloat(v);
      return isNaN(f) || f <= 0 ? null : f;
    }
    var attrW = attrLen('width');
    var attrH = attrLen('height');
    var width, height;
    var rootMatrix = matrix.identity();
    if (vb) {
      width = attrW !== null ? attrW : vb[2];
      height = attrH !== null ? attrH : vb[3];
      var sx = width / vb[2];
      var sy = height / vb[3];
      if (Math.abs(sx - sy) > 1e-6) {
        // preserveAspectRatio default is uniform 'meet'; Figma always matches, guard rail only
        var s = sx < sy ? sx : sy;
        warnGlobal('svg width/height aspect differs from viewBox; using uniform scale');
        sx = s; sy = s;
      }
      rootMatrix = matrix.multiply(matrix.scale(sx, sy), matrix.translate(-vb[0], -vb[1]));
    } else {
      width = attrW !== null ? attrW : 300;
      height = attrH !== null ? attrH : 150;
      if (attrW === null || attrH === null) warnGlobal('svg has no usable viewBox/width/height; defaulting viewport');
    }

    // ----- defs index + stylesheet -----
    var defs = {};
    var cssTexts = [];
    (function indexTree(node) {
      if (node.attrs.id !== undefined && node.attrs.id !== '') {
        if (defs[node.attrs.id] === undefined) defs[node.attrs.id] = node;
      }
      if (localName(node) === 'style') cssTexts[cssTexts.length] = textContent(node);
      for (var i = 0; i < node.children.length; i++) {
        if (isElement(node.children[i])) indexTree(node.children[i]);
      }
    })(root);
    var sheet = styleMod.parseSheet(cssTexts.join('\n'));
    for (var w = 0; w < sheet.warnings.length; w++) warnGlobal(sheet.warnings[w]);

    var viewBoxBounds = { minX: 0, minY: 0, maxX: width, maxY: height };

    // Resolve a clip-path reference into baked contour sets.
    // Returns {contoursSets: [contours], unclipped: bool(viewBox no-op)} or null.
    function resolveClip(refId, ctm, warn) {
      var clipNode = defs[refId];
      if (!clipNode || localName(clipNode) !== 'clipPath') {
        warn('clip-path #' + refId + ' not found; ignored');
        return null;
      }
      if (attrOr(clipNode, 'clipPathUnits', 'userSpaceOnUse') !== 'userSpaceOnUse') {
        warn('clipPathUnits="objectBoundingBox" not supported; clip #' + refId + ' ignored');
        return null;
      }
      var contours = [];
      var clipWarn = [];
      (function walkClip(node, m) {
        for (var i = 0; i < node.children.length; i++) {
          var c = node.children[i];
          if (!isElement(c)) continue;
          var cm = matrix.multiply(m, matrix.parse(c.attrs.transform));
          var name = localName(c);
          var got = null;
          if (name === 'path') got = pathMod.parse(attrOr(c, 'd', '')).contours;
          else if (DRAWABLES[name]) got = shapesMod.contoursFor(name, c.attrs);
          else if (name === 'use') {
            var href = hrefOf(c);
            var target = href && href.charAt(0) === '#' ? defs[href.substring(1)] : null;
            if (target) {
              var um = matrix.multiply(cm, matrix.translate(
                parseFloat(attrOr(c, 'x', '0')) || 0, parseFloat(attrOr(c, 'y', '0')) || 0));
              walkClip({ children: [target], attrs: {} }, um);
            }
            continue;
          } else if (name === 'g') {
            walkClip(c, cm);
            continue;
          } else {
            clipWarn[clipWarn.length] = 'unsupported element <' + name + '> in clipPath #' + refId;
            continue;
          }
          if (got && got.length > 0) {
            var baked = transformContours(got, cm);
            for (var b = 0; b < baked.length; b++) contours[contours.length] = baked[b];
          }
          if ((c.attrs['clip-rule'] || '') === 'evenodd' || /clip-rule\s*:\s*evenodd/.test(attrOr(c, 'style', ''))) {
            clipWarn[clipWarn.length] = 'clip-rule="evenodd" in clipPath #' + refId + ' may merge differently in AE';
          }
        }
      })(clipNode, ctm);
      for (var cw = 0; cw < clipWarn.length; cw++) warn(clipWarn[cw]);
      if (contours.length === 0) {
        warn('clipPath #' + refId + ' has no usable geometry; clip ignored');
        return null;
      }
      return contours;
    }

    // A clip whose merged geometry is a rect covering the whole viewBox is a no-op.
    function clipIsViewBoxNoop(clipContours) {
      var r = rectOf(clipContours);
      return r !== null && bboxInside(viewBoxBounds, r, 0.51);
    }

    function resolvePaint(paintStr, computed, ctm, userBBox, warn) {
      if (!paintStr || paintStr === 'none') return null;
      var refId = urlRefId(paintStr);
      if (refId !== null) {
        var def = defs[refId];
        if (!def) {
          warn('paint reference #' + refId + ' not found; skipped');
          return null;
        }
        var defName = localName(def);
        if (defName === 'linearGradient' || defName === 'radialGradient') {
          return resolveGradient(def, defs, ctm, userBBox, warn, [width, height]);
        }
        if (defName === 'pattern') {
          warn('image/pattern fill #' + refId + ' not supported; using gray placeholder');
          return { type: 'placeholder' };
        }
        warn('unsupported paint reference <' + defName + '> #' + refId + '; skipped');
        return null;
      }
      var col = colorMod.parse(paintStr);
      if (!col) {
        warn('unparseable paint "' + paintStr + '"; skipped');
        return null;
      }
      if (col.none) return null;
      if (col.currentColor) {
        col = colorMod.parse(computed.color);
        if (!col || col.none || col.currentColor) col = { r: 0, g: 0, b: 0, a: 1 };
      }
      return { type: 'solid', color: { r: col.r, g: col.g, b: col.b }, opacity: col.a };
    }

    // ---- item collection ----
    // ctx: { m, style, opacity, clips, name, depth }
    function collectItems(node, ctx, sink) {
      if (!isElement(node)) return;
      var name = localName(node);
      if (NON_RENDERED[name]) return;

      var computed = styleMod.compute(node, ctx.style, sheet);
      if (computed.display === 'none') return;

      var m = matrix.multiply(ctx.m, matrix.parse(node.attrs.transform));
      var opacity = ctx.opacity * clampOpacity(computed.opacity);

      var clips = ctx.clips;
      var clipRef = urlRefId(node.attrs['clip-path'] || styleMod.parseInline(node.attrs.style)['clip-path']);
      if (clipRef !== null) {
        var clipContours = resolveClip(clipRef, m, sink.warn);
        if (clipContours && !clipIsViewBoxNoop(clipContours)) {
          clips = clips.concat([clipContours]);
        }
      }

      if (node.attrs.mask !== undefined || styleMod.parseInline(node.attrs.style).mask) {
        sink.warn('mask on <' + name + (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
          '> not supported; content imported unmasked');
      }

      var filterRef = urlRefId(node.attrs.filter || styleMod.parseInline(node.attrs.style).filter);
      if (filterRef !== null) {
        var filterNode = defs[filterRef];
        if (filterNode && localName(filterNode) === 'filter') {
          var decoded = decodeFilter(filterNode);
          for (var dw = 0; dw < decoded.warnings.length; dw++) sink.warn(decoded.warnings[dw]);
          for (var de = 0; de < decoded.effects.length; de++) sink.effect(decoded.effects[de]);
        } else {
          sink.warn('filter #' + filterRef + ' not found; ignored');
        }
      }

      var blend = computed['mix-blend-mode'];
      if (blend && blend !== 'normal') sink.blend(blend);

      var childCtx = {
        m: m, style: computed, opacity: opacity, clips: clips,
        name: node.attrs.id || ctx.name, depth: ctx.depth
      };

      if (name === 'g' || name === 'svg' || name === 'a') {
        if (name === 'svg' && node !== root) {
          sink.warn('nested <svg> treated as group (inner viewBox ignored)');
        }
        if (opacity < 1 && countRenderedChildren(node) > 1) {
          sink.warn('group opacity ' + computed.opacity + ' on <g' +
            (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
            '> flattened into children (overlap may differ)');
        }
        for (var i = 0; i < node.children.length; i++) {
          collectItems(node.children[i], childCtx, sink);
        }
        return;
      }

      if (name === 'use') {
        if (ctx.depth > 24) {
          sink.warn('<use> nesting too deep; skipped');
          return;
        }
        var href = hrefOf(node);
        var target = href && href.charAt(0) === '#' ? defs[href.substring(1)] : null;
        if (!target) {
          sink.warn('<use> target "' + (href || '') + '" not found; skipped');
          return;
        }
        var ux = parseFloat(attrOr(node, 'x', '0')) || 0;
        var uy = parseFloat(attrOr(node, 'y', '0')) || 0;
        var useCtx = {
          m: matrix.multiply(m, matrix.translate(ux, uy)),
          style: computed, opacity: opacity, clips: clips,
          name: node.attrs.id || ctx.name, depth: ctx.depth + 1
        };
        collectItems(target, useCtx, sink);
        return;
      }

      if (name === 'text') {
        collectText(node, childCtx, computed, sink);
        return;
      }

      if (name === 'image') {
        sink.warn('<image> not supported; gray placeholder rectangle created');
        var iw = parseFloat(attrOr(node, 'width', '0')) || 0;
        var ih = parseFloat(attrOr(node, 'height', '0')) || 0;
        if (iw > 0 && ih > 0) {
          var rectAttrs = { x: attrOr(node, 'x', '0'), y: attrOr(node, 'y', '0'), width: String(iw), height: String(ih) };
          sink.item(makeItem(node, shapesMod.contoursFor('rect', rectAttrs), m, computed,
            { type: 'placeholder' }, null, opacity, clips, ctx, sink.warn));
        }
        return;
      }

      if (computed.visibility !== 'visible') return;

      var contours = null;
      if (name === 'path') {
        var d = attrOr(node, 'd', '');
        if (d) contours = pathMod.parse(d).contours;
      } else if (DRAWABLES[name]) {
        contours = shapesMod.contoursFor(name, node.attrs);
      } else {
        sink.warn('<' + name + '> not supported; skipped');
        return;
      }
      if (!contours || contours.length === 0) return;

      var userBBox = pathMod.bounds(contours);
      var fill = resolvePaint(computed.fill, computed, m, userBBox, sink.warn);
      var stroke = resolvePaint(computed.stroke, computed, m, userBBox, sink.warn);
      sink.item(makeItem(node, contours, m, computed, fill, stroke, opacity, clips, ctx, sink.warn));
    }

    function clampOpacity(v) {
      var f = parseFloat(v);
      if (isNaN(f)) return 1;
      if (f < 0) return 0;
      if (f > 1) return 1;
      return f;
    }

    function countRenderedChildren(node) {
      var n = 0;
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (isElement(c) && !NON_RENDERED[localName(c)]) n++;
      }
      return n;
    }

    function makeItem(node, contours, m, computed, fill, stroke, opacity, clips, ctx, warn) {
      var baked = transformContours(contours, m);
      var strokeSpec = null;
      if (stroke) {
        var swScale = matrix.strokeScale(m);
        if (!matrix.isConformal(m, 1e-3)) {
          warn('non-uniform transform on stroked <' + localName(node) +
            (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') + '>; stroke width approximated');
        }
        var dashes = styleMod.parseDashArray(computed['stroke-dasharray']);
        if (dashes) {
          for (var di = 0; di < dashes.length; di++) dashes[di] *= swScale;
        }
        strokeSpec = {
          paint: stroke,
          width: styleMod.parseLength(computed['stroke-width'], 1) * swScale,
          cap: computed['stroke-linecap'],
          join: computed['stroke-linejoin'],
          miterLimit: styleMod.parseLength(computed['stroke-miterlimit'], 4),
          dashes: dashes,
          dashOffset: styleMod.parseLength(computed['stroke-dashoffset'], 0) * swScale,
          opacity: opacity * clampOpacity(computed['stroke-opacity']) * (stroke.opacity !== undefined ? stroke.opacity : 1)
        };
        if (clips.length > 0) {
          warn('stroked element <' + localName(node) +
            (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
            '> is clipped; stroke will follow clipped geometry (may differ from SVG)');
        }
      }
      var fillSpec = null;
      if (fill) {
        fillSpec = {
          paint: fill,
          opacity: opacity * clampOpacity(computed['fill-opacity']) * (fill.opacity !== undefined && fill.type === 'solid' ? fill.opacity : 1)
        };
      }
      return {
        name: node.attrs.id || localName(node),
        contours: baked,
        fillRule: computed['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
        fill: fillSpec,
        stroke: strokeSpec,
        clips: clips
      };
    }

    function collectText(node, ctx, computed, sink) {
      var runs = [];
      var hasTspan = false;
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (isElement(c) && localName(c) === 'tspan') {
          hasTspan = true;
          var tspanStyle = styleMod.compute(c, computed, sheet);
          runs[runs.length] = makeRun(textContent(c), c.attrs, node.attrs, tspanStyle, ctx, sink);
        }
      }
      if (!hasTspan) {
        var raw = textContent(node);
        if (raw.replace(/\s+/g, '').length > 0) {
          runs[runs.length] = makeRun(raw, node.attrs, node.attrs, computed, ctx, sink);
        }
      }
      if (runs.length > 0) {
        sink.warn('<text> converted to AE text layer(s); font metrics may differ (Figma usually outlines text on export)');
        for (var r = 0; r < runs.length; r++) sink.text(runs[r]);
      }
    }

    function makeRun(text, attrs, parentAttrs, computed, ctx, sink) {
      var x = parseFloat(attrs.x !== undefined ? attrs.x : parentAttrs.x || '0') || 0;
      var y = parseFloat(attrs.y !== undefined ? attrs.y : parentAttrs.y || '0') || 0;
      var pos = matrix.apply(ctx.m, x, y);
      var col = colorMod.parse(computed.fill);
      if (!col || col.none || col.currentColor) col = { r: 0, g: 0, b: 0, a: 1 };
      var fontScale = matrix.strokeScale(ctx.m);
      return {
        text: text,
        pos: pos,
        fontFamily: computed['font-family'].replace(/^['"]|['"]$/g, ''),
        fontSize: styleMod.parseLength(computed['font-size'], 16) * fontScale,
        fontWeight: computed['font-weight'],
        fontStyle: computed['font-style'],
        letterSpacing: styleMod.parseLength(computed['letter-spacing'], 0),
        color: { r: col.r, g: col.g, b: col.b },
        opacity: ctx.opacity * clampOpacity(computed['fill-opacity']) * col.a
      };
    }

    // ----- determine top-level candidates (with no-op clip wrapper unwrap) -----
    function topLevelCandidates(svgNode) {
      var out = [];
      for (var i = 0; i < svgNode.children.length; i++) {
        var c = svgNode.children[i];
        if (!isElement(c)) continue;
        var name = localName(c);
        if (NON_RENDERED[name]) continue;
        if (name === 'g' && isNoopClipWrapper(c)) {
          var inner = topLevelCandidates(c);
          for (var j = 0; j < inner.length; j++) out[out.length] = inner[j];
          continue;
        }
        out[out.length] = c;
      }
      return out;
    }

    function isNoopClipWrapper(gNode) {
      // A wrapper is a no-op when its ONLY effect is a viewBox-covering clip.
      var attrs = gNode.attrs;
      var keys = ['transform', 'opacity', 'filter', 'mask', 'style', 'fill', 'stroke'];
      for (var i = 0; i < keys.length; i++) {
        if (attrs[keys[i]] !== undefined && attrs[keys[i]] !== '') return false;
      }
      var clipRef = urlRefId(attrs['clip-path']);
      if (clipRef === null) return false;
      var silent = function () {};
      var clipContours = resolveClip(clipRef, rootMatrix, silent);
      return clipContours !== null && clipIsViewBoxNoop(clipContours);
    }

    // ----- build layers -----
    var layers = [];

    function newLayerAccumulator(fallbackName) {
      var layer = {
        name: fallbackName, kind: 'shape', items: [], textRuns: [],
        effects: [], blendMode: null, bbox: null, warnings: []
      };
      var sink = {
        item: function (item) {
          layer.items[layer.items.length] = item;
          var bb = pathMod.bounds(item.contours);
          if (item.stroke && bb) {
            var half = item.stroke.width / 2;
            bb = { minX: bb.minX - half, minY: bb.minY - half, maxX: bb.maxX + half, maxY: bb.maxY + half };
          }
          layer.bbox = boundsUnion(layer.bbox, bb);
        },
        text: function (run) {
          layer.kind = 'text';
          layer.textRuns[layer.textRuns.length] = run;
        },
        effect: function (e) {
          layer.effects[layer.effects.length] = e;
        },
        blend: function (mode) {
          if (layer.blendMode && layer.blendMode !== mode) {
            layer.warnings[layer.warnings.length] = 'multiple blend modes in one layer; using ' + mode;
          }
          layer.blendMode = mode;
        },
        warn: function (msg) {
          layer.warnings[layer.warnings.length] = msg;
        }
      };
      return { layer: layer, sink: sink };
    }

    var candidates = topLevelCandidates(root);
    var rootStyle = styleMod.compute(root, null, sheet);
    var baseCtx = { m: rootMatrix, style: rootStyle, opacity: 1, clips: [], name: null, depth: 0 };

    if (splitMode === 'toplevel') {
      for (var ci = 0; ci < candidates.length; ci++) {
        var cand = candidates[ci];
        var acc = newLayerAccumulator(cand.attrs.id || localName(cand) + ' ' + (ci + 1));
        collectItems(cand, baseCtx, acc.sink);
        finishLayer(acc.layer);
      }
    } else {
      // leaf mode: every produced item/text run becomes its own layer
      for (var li = 0; li < candidates.length; li++) {
        var leafCand = candidates[li];
        var counter = { n: 0 };
        collectItemsLeafMode(leafCand, baseCtx, leafCand.attrs.id || localName(leafCand) + ' ' + (li + 1), counter);
      }
    }

    function collectItemsLeafMode(node, ctx, baseName, counter) {
      var pendingEffects = [];
      var pendingBlend = [null];
      var sink = {
        item: function (item) {
          counter.n++;
          var acc = newLayerAccumulator(baseName + ' / ' + item.name + ' ' + counter.n);
          acc.layer.effects = acc.layer.effects.concat(pendingEffects);
          acc.layer.blendMode = pendingBlend[0];
          acc.sink.item(item);
          finishLayer(acc.layer);
        },
        text: function (run) {
          counter.n++;
          var acc = newLayerAccumulator(baseName + ' / text ' + counter.n);
          acc.sink.text(run);
          finishLayer(acc.layer);
        },
        effect: function (e) { pendingEffects[pendingEffects.length] = e; },
        blend: function (mode) { pendingBlend[0] = mode; },
        warn: function (msg) { warnGlobal(msg); }
      };
      collectItems(node, ctx, sink);
    }

    function finishLayer(layer) {
      var hasContent = layer.items.length > 0 || layer.textRuns.length > 0;
      if (!hasContent) {
        for (var i = 0; i < layer.warnings.length; i++) warnGlobal(layer.warnings[i]);
        return;
      }
      if (layer.kind === 'shape' && !layer.bbox) {
        layer.bbox = { minX: 0, minY: 0, maxX: width, maxY: height };
      }
      layers[layers.length] = layer;
    }

    return {
      width: Math.ceil(width),
      height: Math.ceil(height),
      layers: layers,
      warnings: globalWarnings
    };
  }

  return { build: build };
})();
