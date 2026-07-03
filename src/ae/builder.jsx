// AE-side builder: turns scene layer specs into shape/text layers.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.ae = (function () {
  // Enum values verified empirically by the E2E probe (probe.jsx):
  // line caps/joins 1..3, fill rule 2 = even-odd, merge mode 4 = intersect.
  var CAPS = { butt: 1, round: 2, square: 3 };
  var JOINS = { miter: 1, round: 2, bevel: 3 };
  var FILL_RULE_NONZERO = 1;
  var FILL_RULE_EVENODD = 2;
  var MERGE_INTERSECT = 4;

  // Empirical render-match factors (calibrated in E2E against Chrome):
  // AE Drop Shadow "Softness" and Gaussian Blur "Blurriness" per SVG stdDeviation.
  var SHADOW_SOFTNESS_PER_STD = 2.0;
  var BLUR_PER_STD = 2.0;

  function blendEnum(cssName) {
    var map = {
      multiply: BlendingMode.MULTIPLY,
      screen: BlendingMode.SCREEN,
      overlay: BlendingMode.OVERLAY,
      darken: BlendingMode.DARKEN,
      lighten: BlendingMode.LIGHTEN,
      'color-dodge': BlendingMode.CLASSIC_COLOR_DODGE,
      'color-burn': BlendingMode.CLASSIC_COLOR_BURN,
      'hard-light': BlendingMode.HARD_LIGHT,
      'soft-light': BlendingMode.SOFT_LIGHT,
      difference: BlendingMode.DIFFERENCE,
      exclusion: BlendingMode.EXCLUSION,
      hue: BlendingMode.HUE,
      saturation: BlendingMode.SATURATION,
      color: BlendingMode.COLOR,
      luminosity: BlendingMode.LUMINOSITY
    };
    return map.hasOwnProperty(cssName) ? map[cssName] : null;
  }

  function contourToShape(contour, offsetX, offsetY) {
    var vertices = [];
    var inT = [];
    var outT = [];
    var pts = contour.points;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      vertices[i] = [p.x - offsetX, p.y - offsetY];
      inT[i] = [p.ix - p.x, p.iy - p.y];
      outT[i] = [p.ox - p.x, p.oy - p.y];
    }
    var shape = new Shape();
    shape.vertices = vertices;
    shape.inTangents = inT;
    shape.outTangents = outT;
    shape.closed = contour.closed;
    return shape;
  }

  function addContour(contents, contour, offsetX, offsetY, nameHint) {
    var prop = contents.addProperty('ADBE Vector Shape - Group');
    if (nameHint) {
      try { prop.name = nameHint; } catch (eName) { /* keep default */ }
    }
    prop.property('ADBE Vector Shape').setValue(contourToShape(contour, offsetX, offsetY));
    return prop;
  }

  function setDashes(strokeProp, dashes, dashOffset, warn) {
    if (!dashes || dashes.length === 0) return;
    var dashGroup = strokeProp.property('ADBE Vector Stroke Dashes');
    var pairs = Math.ceil(dashes.length / 2);
    if (pairs > 3) {
      warn('stroke-dasharray has ' + dashes.length + ' values; AE supports 3 dash/gap pairs, truncating');
      pairs = 3;
    }
    for (var i = 0; i < pairs; i++) {
      var dashVal = dashes[i * 2];
      var gapVal = i * 2 + 1 < dashes.length ? dashes[i * 2 + 1] : dashes[i * 2];
      var d = dashGroup.addProperty('ADBE Vector Stroke Dash ' + (i + 1));
      d.setValue(dashVal);
      var g = dashGroup.addProperty('ADBE Vector Stroke Gap ' + (i + 1));
      g.setValue(gapVal);
    }
    if (dashOffset) {
      var off = dashGroup.addProperty('ADBE Vector Stroke Offset');
      off.setValue(dashOffset);
    }
  }

  function solidColorOf(paint) {
    // First-stop color for gradient fallback; direct color for solids.
    if (paint.type === 'gradient') {
      var s = paint.stops[0];
      return [s.color.r, s.color.g, s.color.b];
    }
    if (paint.type === 'placeholder') return [0.5, 0.5, 0.5];
    return [paint.color.r, paint.color.g, paint.color.b];
  }

  function buildShapeLayer(comp, spec, opts, warn) {
    var layer = comp.layers.addShape();
    layer.name = spec.name;
    var contents = layer.property('ADBE Root Vectors Group');

    var cx = (spec.bbox.minX + spec.bbox.maxX) / 2;
    var cy = (spec.bbox.minY + spec.bbox.maxY) / 2;
    // With anchor == position, layer space coincides with comp space, so we
    // subtract the anchor from baked vertices and placement is pixel-exact.
    var transform = layer.property('ADBE Transform Group');
    transform.property('ADBE Anchor Point').setValue([cx, cy]);
    transform.property('ADBE Position').setValue([cx, cy]);

    function toLayerSpace(pt) {
      return [pt[0], pt[1]];
    }

    for (var ii = 0; ii < spec.items.length; ii++) {
      var item = spec.items[ii];
      var group = contents.addProperty('ADBE Vector Group');
      try { group.name = item.name; } catch (eGname) { /* keep default */ }
      var groupContents = group.property('ADBE Vectors Group');

      var ci;
      for (ci = 0; ci < item.contours.length; ci++) {
        addContour(groupContents, item.contours[ci], 0, 0, null);
      }
      // Clip emulation: clip contours + Merge Paths (Intersect) consume
      // everything above them in this group.
      for (var cs = 0; cs < item.clips.length; cs++) {
        var clipSet = item.clips[cs];
        for (ci = 0; ci < clipSet.length; ci++) {
          addContour(groupContents, clipSet[ci], 0, 0, 'Clip');
        }
        var merge = groupContents.addProperty('ADBE Vector Filter - Merge');
        merge.property('ADBE Vector Merge Type').setValue(MERGE_INTERSECT);
      }

      // Stroke first so it renders above the fill (SVG paint order).
      if (item.stroke) {
        var strokePaint = item.stroke.paint;
        var strokeProp;
        var strokeIsGradient = strokePaint.type === 'gradient' && opts.gradients !== 'solid';
        if (strokeIsGradient) {
          strokeProp = groupContents.addProperty('ADBE Vector Graphic - G-Stroke');
          if (!SVGSPLIT.aegrad.apply(comp, layer, strokeProp, strokePaint, toLayerSpace, warn)) {
            strokeIsGradient = false;
            strokeProp.remove();
          }
        }
        if (!strokeIsGradient) {
          strokeProp = groupContents.addProperty('ADBE Vector Graphic - Stroke');
          strokeProp.property('ADBE Vector Stroke Color').setValue(solidColorOf(strokePaint));
          if (strokePaint.type === 'gradient') warn('gradient stroke fell back to first-stop solid on "' + spec.name + '"');
        }
        strokeProp.property('ADBE Vector Stroke Width').setValue(item.stroke.width);
        strokeProp.property('ADBE Vector Stroke Opacity').setValue(item.stroke.opacity * 100);
        strokeProp.property('ADBE Vector Stroke Line Cap').setValue(CAPS.hasOwnProperty(item.stroke.cap) ? CAPS[item.stroke.cap] : 1);
        strokeProp.property('ADBE Vector Stroke Line Join').setValue(JOINS.hasOwnProperty(item.stroke.join) ? JOINS[item.stroke.join] : 1);
        strokeProp.property('ADBE Vector Stroke Miter Limit').setValue(item.stroke.miterLimit);
        setDashes(strokeProp, item.stroke.dashes, item.stroke.dashOffset, warn);
      }

      if (item.fill) {
        var fillPaint = item.fill.paint;
        var fillProp;
        var fillIsGradient = fillPaint.type === 'gradient' && opts.gradients !== 'solid';
        if (fillIsGradient) {
          fillProp = groupContents.addProperty('ADBE Vector Graphic - G-Fill');
          if (!SVGSPLIT.aegrad.apply(comp, layer, fillProp, fillPaint, toLayerSpace, warn)) {
            fillIsGradient = false;
            fillProp.remove();
          }
        }
        if (!fillIsGradient) {
          fillProp = groupContents.addProperty('ADBE Vector Graphic - Fill');
          fillProp.property('ADBE Vector Fill Color').setValue(solidColorOf(fillPaint));
          if (fillPaint.type === 'gradient') warn('gradient fill fell back to first-stop solid on "' + spec.name + '"');
        }
        fillProp.property('ADBE Vector Fill Opacity').setValue(item.fill.opacity * 100);
        try {
          fillProp.property('ADBE Vector Fill Rule').setValue(
            item.fillRule === 'evenodd' ? FILL_RULE_EVENODD : FILL_RULE_NONZERO);
        } catch (eRule) {
          // G-Fill exposes the same property; if missing, non-zero default stands
          if (item.fillRule === 'evenodd') warn('could not set even-odd fill rule on "' + spec.name + '"');
        }
      }
    }
    return layer;
  }

  function buildTextLayers(comp, spec, warn) {
    var created = [];
    for (var i = 0; i < spec.textRuns.length; i++) {
      var run = spec.textRuns[i];
      var layer = comp.layers.addText(run.text);
      layer.name = spec.name + (spec.textRuns.length > 1 ? ' ' + (i + 1) : '');
      var textProp = layer.property('ADBE Text Properties').property('ADBE Text Document');
      var doc = textProp.value;
      doc.fontSize = run.fontSize;
      doc.fillColor = [run.color.r, run.color.g, run.color.b];
      if (run.fontFamily) {
        try {
          doc.font = run.fontFamily;
        } catch (eFont) {
          warn('font "' + run.fontFamily + '" not found; using default');
        }
      }
      try {
        doc.tracking = run.letterSpacing && run.fontSize > 0 ? run.letterSpacing / run.fontSize * 1000 : 0;
      } catch (eTrack) { /* older AE */ }
      textProp.setValue(doc);
      // AE text layers anchor at the baseline start - same as the SVG x/y.
      layer.property('ADBE Transform Group').property('ADBE Position').setValue([run.pos[0], run.pos[1]]);
      layer.property('ADBE Transform Group').property('ADBE Opacity').setValue(run.opacity * 100);
      created[created.length] = layer;
    }
    return created;
  }

  function addEffects(layer, spec, warn) {
    for (var i = 0; i < spec.effects.length; i++) {
      var fx = spec.effects[i];
      var parade = layer.property('ADBE Effect Parade');
      if (fx.type === 'dropShadow') {
        var shadow = parade.addProperty('ADBE Drop Shadow');
        shadow.property('ADBE Drop Shadow-0001').setValue([fx.color.r, fx.color.g, fx.color.b, 1]);
        shadow.property('ADBE Drop Shadow-0002').setValue(fx.opacity * 255);
        var angle = 90 + Math.atan2(fx.dy, fx.dx) * 180 / Math.PI;
        shadow.property('ADBE Drop Shadow-0003').setValue(angle);
        shadow.property('ADBE Drop Shadow-0004').setValue(Math.sqrt(fx.dx * fx.dx + fx.dy * fx.dy));
        shadow.property('ADBE Drop Shadow-0005').setValue(fx.stdDeviation * SHADOW_SOFTNESS_PER_STD);
      } else if (fx.type === 'gaussianBlur') {
        var blur = parade.addProperty('ADBE Gaussian Blur 2');
        blur.property('ADBE Gaussian Blur 2-0001').setValue(fx.stdDeviation * BLUR_PER_STD);
      }
    }
  }

  // scene: result of SVGSPLIT.scene.build
  // opts: { newComp: bool, compName: str, duration: sec, frameRate: fps,
  //         gradients: 'ffx'|'solid', onProgress: fn(i,total,name)|null }
  // Returns { comp, layerCount, warnings: [str] }
  function buildComp(scene, opts) {
    opts = opts || {};
    var warnings = [];
    function warn(msg) {
      warnings[warnings.length] = msg;
    }

    var totalLayers = scene.layers.length;
    if (totalLayers === 0) {
      throw new Error('No convertible layers found in this SVG.');
    }
    if (totalLayers > 400 && opts.confirmLarge) {
      if (!opts.confirmLarge(totalLayers)) {
        throw new Error('Import cancelled (' + totalLayers + ' layers).');
      }
    }

    var comp;
    app.beginUndoGroup('SVG Splitter Import');
    try {
      if (opts.newComp === false && app.project.activeItem instanceof CompItem) {
        comp = app.project.activeItem;
      } else {
        comp = app.project.items.addComp(
          opts.compName || 'SVG Import',
          Math.max(scene.width, 4),
          Math.max(scene.height, 4),
          1.0,
          opts.duration || 10,
          opts.frameRate || 30
        );
      }

      for (var i = 0; i < scene.layers.length; i++) {
        var spec = scene.layers[i];
        if (opts.onProgress) opts.onProgress(i + 1, totalLayers, spec.name);
        var layer = null;
        if (spec.kind === 'text') {
          var textLayers = buildTextLayers(comp, spec, warn);
          layer = textLayers.length > 0 ? textLayers[0] : null;
        } else {
          layer = buildShapeLayer(comp, spec, opts, warn);
        }
        if (layer) {
          if (spec.blendMode) {
            var be = blendEnum(spec.blendMode);
            if (be !== null) layer.blendingMode = be;
            else warn('blend mode "' + spec.blendMode + '" not mapped; left normal');
          }
          addEffects(layer, spec, warn);
        }
        for (var wi = 0; wi < spec.warnings.length; wi++) {
          warnings[warnings.length] = '[' + spec.name + '] ' + spec.warnings[wi];
        }
      }
    } finally {
      SVGSPLIT.aegrad.cleanup();
      app.endUndoGroup();
    }
    for (var gw = 0; gw < scene.warnings.length; gw++) {
      warnings[warnings.length] = scene.warnings[gw];
    }
    return { comp: comp, layerCount: totalLayers, warnings: warnings };
  }

  // Reads an SVG from disk and imports it. Entry point shared by the panel
  // and the E2E harness.
  function importFile(path, opts) {
    opts = opts || {};
    var file = new File(path);
    if (!file.exists) throw new Error('File not found: ' + path);
    file.encoding = 'UTF-8';
    if (!file.open('r')) throw new Error('Cannot open: ' + path);
    var text = file.read();
    file.close();
    var scene = SVGSPLIT.scene.build(text, { splitMode: opts.splitMode || 'toplevel' });
    if (!opts.compName) {
      opts.compName = decodeURIComponent(file.name).replace(/\.svg$/i, '');
    }
    return buildComp(scene, opts);
  }

  return { buildComp: buildComp, importFile: importFile };
})();
