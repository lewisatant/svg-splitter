// Slot-mapping probe #3: production writeFfx path, fresh project,
// unique marker values in every patchable slot.

//@include "/Users/lewismenelaws/svg-splitter/dist/svg-splitter-lib.jsx"

(function () {
  var lines = [];
  function log(s) { lines[lines.length] = s; }
  app.beginSuppressDialogs();
  try {
    app.newProject();
    var comp = app.project.items.addComp('grad-probe3', 100, 100, 1.0, 1, 30);
    var layer = comp.layers.addShape();
    var group = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var gc = group.property('ADBE Vectors Group');
    var rectProp = gc.addProperty('ADBE Vector Shape - Rect');
    rectProp.property('ADBE Vector Rect Size').setValue([80, 80]);
    var gfill = gc.addProperty('ADBE Vector Graphic - G-Fill');

    var paint = {
      kind: 'linear',
      start: [10, 50],
      end: [90, 50],
      hilite: null,
      stops: [
        { offset: 0.13, color: { r: 0.11, g: 0.22, b: 0.33 }, opacity: 0.44 },
        { offset: 0.87, color: { r: 0.55, g: 0.66, b: 0.77 }, opacity: 0.88 }
      ]
    };
    var ok = SVGSPLIT.aegrad.apply(comp, layer, gfill, paint, function (p) { return p; }, log);
    log('apply=' + ok.applied);

    var proj = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe3.aep');
    if (proj.exists) proj.remove();
    app.project.save(proj);
    log('saved');
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' line ' + e.line : ''));
  }
  app.endSuppressDialogs(false);
  var lf = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe3.log');
  lf.encoding = 'UTF-8';
  lf.open('w');
  lf.write(lines.join('\n'));
  lf.close();
})();
