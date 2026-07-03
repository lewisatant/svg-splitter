// Probes frame-export options on a real comp instance.
(function () {
  var lines = [];
  function log(s) { lines[lines.length] = s; }
  app.beginSuppressDialogs();
  try {
    var comp = app.project.items.addComp('png-probe', 64, 64, 1.0, 1, 30);
    var solid = comp.layers.addSolid([1, 0, 0], 'red', 64, 64, 1);
    log('typeof instance saveFrameToPng=' + (typeof comp.saveFrameToPng));

    var out = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/probe-frame.png');
    if (out.exists) out.remove();
    if (typeof comp.saveFrameToPng === 'function') {
      var r = comp.saveFrameToPng(0, out);
      log('saveFrameToPng called, returned=' + r);
    } else {
      log('saveFrameToPng unavailable, trying render queue');
      var rqi = app.project.renderQueue.items.add(comp);
      var om = rqi.outputModule(1);
      var tmpl = om.templates;
      var names = '';
      for (var i = 0; i < tmpl.length; i++) names += tmpl[i] + '|';
      log('om templates=' + names);
      // pick a PNG template if present
      var pick = null;
      for (var j = 0; j < tmpl.length; j++) {
        if (/png/i.test(tmpl[j]) && !/alpha/i.test(tmpl[j])) { pick = tmpl[j]; break; }
      }
      if (pick === null) {
        for (var k = 0; k < tmpl.length; k++) {
          if (/png/i.test(tmpl[k])) { pick = tmpl[k]; break; }
        }
      }
      log('picked template=' + pick);
      if (pick !== null) {
        om.applyTemplate(pick);
        om.file = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/probe-frame_[#####].png');
        rqi.timeSpanStart = 0;
        rqi.timeSpanDuration = comp.frameDuration;
        app.project.renderQueue.render();
        log('render queue done');
      }
    }
    solid.remove();
    comp.remove();
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' line ' + e.line : ''));
  }
  app.endSuppressDialogs(false);
  var f = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/probe-png.log');
  f.encoding = 'UTF-8';
  f.open('w');
  f.write(lines.join('\r\n'));
  f.close();
})();
