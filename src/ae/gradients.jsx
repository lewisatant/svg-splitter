// Gradient stop injection for shape-layer Gradient Fill / Gradient Stroke.
// AE does not expose 'ADBE Vector Grad Colors' to scripting (NO_VALUE through
// AE 26.x), so stops are written via a patched .ffx preset and applyPreset()
// with the target property selected - the technique from Google AEUX
// (Apache-2.0). Scriptable parts (type, start/end points) are set directly.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.aegrad = (function () {
  var tempFfxFile = null;

  // Resample gradient stops down to n entries (templates cover 2..8).
  function resampleStops(stops, n) {
    if (stops.length <= n) return stops;
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      // find surrounding stops
      var lo = stops[0];
      var hi = stops[stops.length - 1];
      for (var j = 0; j < stops.length - 1; j++) {
        if (stops[j].offset <= t && stops[j + 1].offset >= t) {
          lo = stops[j];
          hi = stops[j + 1];
          break;
        }
      }
      var span = hi.offset - lo.offset;
      var f = span > 0 ? (t - lo.offset) / span : 0;
      out[out.length] = {
        offset: t,
        color: {
          r: lo.color.r + (hi.color.r - lo.color.r) * f,
          g: lo.color.g + (hi.color.g - lo.color.g) * f,
          b: lo.color.b + (hi.color.b - lo.color.b) * f
        },
        opacity: lo.opacity + (hi.opacity - lo.opacity) * f
      };
    }
    return out;
  }

  // Patches a template's placeholder lines with actual stop values.
  // Placeholder lines look like: points[0].rampPoint / points[2].color[1]
  function patchTemplate(templateStr, stops) {
    var lines = templateStr.split('\n');
    var out = '';
    var re = /points\[(\d+)\]\.(rampPoint|midPoint|opacity|color\[(\d)\])/;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var m = re.exec(line);
      if (m) {
        var stop = stops[parseInt(m[1], 10)];
        var value = 0;
        if (m[2] === 'rampPoint') value = stop.offset;
        else if (m[2] === 'midPoint') value = 0.5;
        else if (m[2] === 'opacity') value = stop.opacity;
        else {
          var ci = parseInt(m[3], 10);
          value = ci === 0 ? stop.color.r : ci === 1 ? stop.color.g : stop.color.b;
        }
        line = '<float>' + value.toFixed(8) + '</float>';
      }
      out += line + '\n';
    }
    return out;
  }

  function writeFfx(stops) {
    var n = stops.length;
    if (n < 2) return null;
    var key = n > 8 ? 'grad8' : 'grad' + n;
    var template = SVGSPLIT.gradTemplates[key];
    if (!template) return null;
    var patched = patchTemplate(template, n > 8 ? resampleStops(stops, 8) : stops);
    var file = new File(Folder.temp.fsName + '/svg-splitter-grad.ffx');
    file.encoding = 'BINARY';
    if (!file.open('w')) return null;
    file.write(patched);
    file.close();
    tempFfxFile = file;
    return file;
  }

  function deselectAll(comp) {
    var sel = comp.selectedProperties;
    for (var i = sel.length - 1; i >= 0; i--) {
      sel[i].selected = false;
    }
    var selLayers = comp.selectedLayers;
    for (var j = selLayers.length - 1; j >= 0; j--) {
      selLayers[j].selected = false;
    }
  }

  // Applies gradient stops + geometry to a freshly created G-Fill/G-Stroke
  // property. Returns true on success; on failure the caller should fall
  // back to a solid fill.
  // paint: scene gradient paint {kind, stops, start, end, hilite}
  // toLayerSpace: function([x,y]) -> [x,y] mapping comp coords to layer coords.
  function apply(comp, layer, gradProp, paint, toLayerSpace, warn) {
    var start = toLayerSpace(paint.start);
    var end = toLayerSpace(paint.end);
    gradProp.property('ADBE Vector Grad Type').setValue(paint.kind === 'radial' ? 2 : 1);
    gradProp.property('ADBE Vector Grad Start Pt').setValue(start);
    gradProp.property('ADBE Vector Grad End Pt').setValue(end);
    if (paint.kind === 'radial' && paint.hilite) {
      try {
        gradProp.property('ADBE Vector Grad HiLite Length').setValue(paint.hilite.length * 100);
        gradProp.property('ADBE Vector Grad HiLite Angle').setValue(paint.hilite.angleDeg);
      } catch (eHilite) {
        warn('radial focal point not applied: ' + eHilite.toString());
      }
    }

    if (paint.stops.length > 8) {
      warn('gradient has ' + paint.stops.length + ' stops; resampled to 8');
    }

    var ffx = null;
    try {
      ffx = writeFfx(paint.stops);
    } catch (eWrite) {
      ffx = null;
    }
    if (!ffx) {
      warn('could not write gradient preset (enable "Allow Scripts to Write Files and Access Network" in Preferences > Scripting & Expressions); gradient stops left at default');
      return false;
    }

    try {
      deselectAll(comp);
      gradProp.selected = true;
      layer.applyPreset(ffx);
      layer.selected = false;
      return true;
    } catch (eApply) {
      warn('gradient preset failed to apply (' + eApply.toString() + '); stops left at default');
      return false;
    }
  }

  function cleanup() {
    if (tempFfxFile !== null) {
      try {
        tempFfxFile.remove();
      } catch (e) {
        // best effort
      }
      tempFfxFile = null;
    }
  }

  return { apply: apply, cleanup: cleanup, resampleStops: resampleStops, patchTemplate: patchTemplate };
})();
