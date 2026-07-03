// Probe #5 part A: build a shape layer with a G-Fill whose stops were set by
// the legacy (uncorrected) ffx, then leave ONLY the G-Fill selected so the
// AppleScript driver can invoke Animation > Save Animation Preset...

//@include "/Users/lewismenelaws/svg-splitter/dist/svg-splitter-lib.jsx"

(function () {
  var lines = [];
  function log(s) { lines[lines.length] = s; }
  app.beginSuppressDialogs();
  try {
    app.newProject();
    var comp = app.project.items.addComp('grad-probe5', 100, 100, 1.0, 1, 30);
    comp.openInViewer();
    var layer = comp.layers.addShape();
    var group = layer.property('ADBE Root Vectors Group').addProperty('ADBE Vector Group');
    var gc = group.property('ADBE Vectors Group');
    var rectProp = gc.addProperty('ADBE Vector Shape - Rect');
    rectProp.property('ADBE Vector Rect Size').setValue([80, 80]);
    var gfill = gc.addProperty('ADBE Vector Graphic - G-Fill');

    // Legacy path: patch template but DO NOT fix RIFX sizes (mimics AEUX).
    var stops = [
      { offset: 0.13, color: { r: 0.11, g: 0.22, b: 0.33 }, opacity: 0.44 },
      { offset: 0.87, color: { r: 0.55, g: 0.66, b: 0.77 }, opacity: 0.88 }
    ];
    var patched = SVGSPLIT.aegrad.patchTemplate(SVGSPLIT.gradTemplates.grad2, stops);
    var f = new File(Folder.temp.fsName + '/probe5-legacy.ffx');
    f.encoding = 'BINARY';
    f.open('w');
    f.write(patched);
    f.close();

    var sel = comp.selectedProperties;
    for (var s = sel.length - 1; s >= 0; s--) sel[s].selected = false;
    gfill.selected = true;
    layer.applyPreset(f);
    layer.selected = false;

    // Re-select ONLY the G-Fill for the preset save.
    var sel2 = comp.selectedProperties;
    for (var s2 = sel2.length - 1; s2 >= 0; s2--) sel2[s2].selected = false;
    gfill.selected = true;
    log('ready');
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' line ' + e.line : ''));
  }
  app.endSuppressDialogs(false);
  var lf = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/grad-probe5.log');
  lf.encoding = 'UTF-8';
  lf.open('w');
  lf.write(lines.join('\n'));
  lf.close();
})();
