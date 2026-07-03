// Slot-mapping probe #2: distinct marker in every float slot of one color stop.

//@include "/Users/lewismenelaws/svg-splitter/dist/svg-splitter-lib.jsx"

(function () {
  var lines = [];
  function log(s) { lines[lines.length] = s; }
  app.beginSuppressDialogs();
  try {
    // fresh project so the .aep contains exactly one gradient
    app.newProject();
    var comp = app.project.items.addComp('grad-probe2', 100, 100, 1.0, 1, 30);
    var layer = comp.layers.addShape();
    var group = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var gc = group.property('ADBE Vectors Group');
    var rectProp = gc.addProperty('ADBE Vector Shape - Rect');
    rectProp.property('ADBE Vector Rect Size').setValue([80, 80]);
    var gfill = gc.addProperty('ADBE Vector Graphic - G-Fill');
    gfill.property('ADBE Vector Grad Start Pt').setValue([10, 50]);
    gfill.property('ADBE Vector Grad End Pt').setValue([90, 50]);

    // Hand-patch the grad2 template with unique markers in EVERY slot.
    var template = SVGSPLIT.gradTemplates.grad2;
    var alphaMarkers = [
      [0.13, 0.53, 0.93],   // stop0: ramp, mid, opacity
      [0.83, 0.54, 0.94]    // stop1
    ];
    var colorMarkers = [
      [0.11, 0.51, 0.21, 0.31, 0.41, 0.61], // stop0: ramp, mid, c0, c1, c2, literal
      [0.81, 0.52, 0.22, 0.32, 0.42, 0.62]  // stop1
    ];
    var out = [];
    var srcLines = template.split('\n');
    var alphaIdx = [0, 0];
    var colorIdx = [0, 0];
    var seenColorHeader = false;
    var seenLiteral = 0;
    for (var i = 0; i < srcLines.length; i++) {
      var line = srcLines[i];
      if (line.indexOf('Color Stops') !== -1) seenColorHeader = true;
      var m = /points\[(\d+)\]\./.exec(line);
      if (m) {
        var stop = parseInt(m[1], 10);
        var v;
        if (!seenColorHeader) {
          v = alphaMarkers[stop][alphaIdx[stop]++];
        } else {
          v = colorMarkers[stop][colorIdx[stop]++];
        }
        line = '<float>' + v.toFixed(8) + '</float>';
      } else if (seenColorHeader && line.indexOf('<float>1</float>') !== -1) {
        // replace the literal trailing float (first belongs to stop0, second to stop1)
        line = '<float>' + (seenLiteral === 0 ? 0.61 : 0.62).toFixed(8) + '</float>';
        seenLiteral++;
      }
      out[out.length] = line;
    }

    var f = new File(Folder.temp.fsName + '/probe-grad2.ffx');
    f.encoding = 'BINARY';
    f.open('w');
    f.write(out.join('\n'));
    f.close();

    var sel = comp.selectedProperties;
    for (var s = sel.length - 1; s >= 0; s--) sel[s].selected = false;
    gfill.selected = true;
    layer.applyPreset(f);
    layer.selected = false;

    var proj = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe2.aep');
    if (proj.exists) proj.remove();
    app.project.save(proj);
    log('saved');
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' line ' + e.line : ''));
  }
  app.endSuppressDialogs(false);
  var lf = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe2.log');
  lf.encoding = 'UTF-8';
  lf.open('w');
  lf.write(lines.join('\n'));
  lf.close();
})();
