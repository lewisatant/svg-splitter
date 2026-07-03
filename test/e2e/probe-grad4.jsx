// Probe #4: does AE 2026's ffx parser expect SEVEN floats per color stop?
// Emits [ramp, mid, dummy(0.99), R, G, B, 1] per stop.

//@include "/Users/lewismenelaws/svg-splitter/dist/svg-splitter-lib.jsx"

(function () {
  var lines = [];
  function log(s) { lines[lines.length] = s; }
  app.beginSuppressDialogs();
  try {
    app.newProject();
    var comp = app.project.items.addComp('grad-probe4', 100, 100, 1.0, 1, 30);
    var layer = comp.layers.addShape();
    var group = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var gc = group.property('ADBE Vectors Group');
    var rectProp = gc.addProperty('ADBE Vector Shape - Rect');
    rectProp.property('ADBE Vector Rect Size').setValue([80, 80]);
    var gfill = gc.addProperty('ADBE Vector Graphic - G-Fill');

    var stops = [
      { offset: 0.13, color: { r: 0.11, g: 0.22, b: 0.33 }, opacity: 0.44 },
      { offset: 0.87, color: { r: 0.55, g: 0.66, b: 0.77 }, opacity: 0.88 }
    ];

    // Patch like production, but insert an extra dummy float line right
    // before each color stop's color[0] line.
    var template = SVGSPLIT.gradTemplates.grad2;
    var srcLines = template.split('\n');
    var out = [];
    var re = /points\[(\d+)\]\.(rampPoint|midPoint|opacity|color\[(\d)\])/;
    for (var i = 0; i < srcLines.length; i++) {
      var line = srcLines[i];
      var m = re.exec(line);
      if (m) {
        var stop = stops[parseInt(m[1], 10)];
        var v = 0;
        if (m[2] === 'rampPoint') v = stop.offset;
        else if (m[2] === 'midPoint') v = 0.5;
        else if (m[2] === 'opacity') v = stop.opacity;
        else {
          var ci = parseInt(m[3], 10);
          if (ci === 0) {
            out[out.length] = '<float>0.99000000</float>'; // extra 7th float
            v = stop.color.r;
          } else {
            v = ci === 1 ? stop.color.g : stop.color.b;
          }
        }
        line = '<float>' + v.toFixed(8) + '</float>';
      }
      out[out.length] = line;
    }

    var f = new File(Folder.temp.fsName + '/probe-grad4.ffx');
    f.encoding = 'BINARY';
    f.open('w');
    f.write(out.join('\n'));
    f.close();

    var sel = comp.selectedProperties;
    for (var s = sel.length - 1; s >= 0; s--) sel[s].selected = false;
    gfill.selected = true;
    layer.applyPreset(f);
    layer.selected = false;
    log('applied');

    var proj = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe4.aep');
    if (proj.exists) proj.remove();
    app.project.save(proj);
    log('saved');
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' line ' + e.line : ''));
  }
  app.endSuppressDialogs(false);
  var lf = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe4.log');
  lf.encoding = 'UTF-8';
  lf.open('w');
  lf.write(lines.join('\n'));
  lf.close();
})();
