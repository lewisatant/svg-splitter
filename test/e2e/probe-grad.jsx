// Gradient slot-mapping probe: applies a distinctive gradient via the ffx
// technique, saves the project, so Node can read back what AE stored.

//@include "/Users/lewismenelaws/svg-splitter/dist/svg-splitter-lib.jsx"

(function () {
  var lines = [];
  function log(s) { lines[lines.length] = s; }
  app.beginSuppressDialogs();
  try {
    var comp = app.project.items.addComp('grad-probe', 100, 100, 1.0, 1, 30);
    var layer = comp.layers.addShape();
    var contents = layer.property('ADBE Root Vectors Group');
    var group = contents.addProperty('ADBE Vector Group');
    var gc = group.property('ADBE Vectors Group');
    var rectProp = gc.addProperty('ADBE Vector Shape - Rect');
    rectProp.property('ADBE Vector Rect Size').setValue([80, 80]);
    var gfill = gc.addProperty('ADBE Vector Graphic - G-Fill');

    // Distinctive values: every slot unique.
    // stop0: offset 0.00, color (0.1, 0.2, 0.3), opacity 0.9
    // stop1: offset 1.00, color (0.4, 0.5, 0.6), opacity 0.8
    var paint = {
      kind: 'linear',
      start: [10, 50],
      end: [90, 50],
      hilite: null,
      stops: [
        { offset: 0.0, color: { r: 0.1, g: 0.2, b: 0.3 }, opacity: 0.9 },
        { offset: 1.0, color: { r: 0.4, g: 0.5, b: 0.6 }, opacity: 0.8 }
      ]
    };
    var ok = SVGSPLIT.aegrad.apply(comp, layer, gfill, paint, function (p) { return p; }, log);
    log('apply=' + ok);

    var proj = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe.aep');
    if (proj.exists) proj.remove();
    app.project.save(proj);
    log('saved');
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' line ' + e.line : ''));
  }
  app.endSuppressDialogs(false);
  var f = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe.log');
  f.encoding = 'UTF-8';
  f.open('w');
  f.write(lines.join('\n'));
  f.close();
})();
