// Dash property probe: find which add/set step throws "hidden" errors.
(function () {
  var lines = [];
  function log(s) { lines[lines.length] = s; }
  app.beginSuppressDialogs();
  try {
    app.newProject();
    var comp = app.project.items.addComp('dash-probe', 100, 100, 1.0, 1, 30);
    var layer = comp.layers.addShape();
    var group = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var gc = group.property('ADBE Vectors Group');
    var rectProp = gc.addProperty('ADBE Vector Shape - Rect');
    rectProp.property('ADBE Vector Rect Size').setValue([80, 80]);
    var stroke = gc.addProperty('ADBE Vector Graphic - Stroke');
    stroke.property('ADBE Vector Stroke Width').setValue(4);

    var dashes = stroke.property('ADBE Vector Stroke Dashes');
    log('dashes group numProperties=' + dashes.numProperties);
    for (var i = 1; i <= dashes.numProperties; i++) {
      var p = dashes.property(i);
      log('  [' + i + '] ' + p.matchName + ' elided=' + p.elided + ' canSetEnabled=' + p.canSetEnabled);
    }

    function attempt(desc, fn) {
      try {
        fn();
        log('OK   ' + desc);
      } catch (e) {
        log('FAIL ' + desc + ' -> ' + e.toString());
      }
    }

    attempt('addProperty Dash 1', function () { dashes.addProperty('ADBE Vector Stroke Dash 1'); });
    attempt('set Dash 1 = 8', function () { dashes.property('ADBE Vector Stroke Dash 1').setValue(8); });
    attempt('addProperty Gap 1', function () { dashes.addProperty('ADBE Vector Stroke Gap 1'); });
    attempt('set Gap 1 = 4', function () { dashes.property('ADBE Vector Stroke Gap 1').setValue(4); });
    attempt('addProperty Dash 2', function () { dashes.addProperty('ADBE Vector Stroke Dash 2'); });
    attempt('set Dash 2 = 2', function () { dashes.property('ADBE Vector Stroke Dash 2').setValue(2); });
    attempt('addProperty Gap 2', function () { dashes.addProperty('ADBE Vector Stroke Gap 2'); });
    attempt('set Gap 2 = 4', function () { dashes.property('ADBE Vector Stroke Gap 2').setValue(4); });
    attempt('addProperty Offset', function () { dashes.addProperty('ADBE Vector Stroke Offset'); });
    attempt('set Offset = 2', function () { dashes.property('ADBE Vector Stroke Offset').setValue(2); });

    log('after adds, numProperties=' + dashes.numProperties);
    for (var j = 1; j <= dashes.numProperties; j++) {
      var q = dashes.property(j);
      log('  [' + j + '] ' + q.matchName + ' elided=' + q.elided);
    }
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' line ' + e.line : ''));
  }
  app.endSuppressDialogs(false);
  var lf = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/probe-dash.log');
  lf.encoding = 'UTF-8';
  lf.open('w');
  lf.write(lines.join('\n'));
  lf.close();
})();
