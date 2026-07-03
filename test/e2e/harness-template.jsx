// E2E harness template - placeholders (__NAME__) are replaced per fixture by
// test/e2e/run.js. Runs inside After Effects via AppleScript DoScriptFile.

//@include "__LIB_PATH__"

(function () {
  var LOG_PATH = '__LOG_PATH__';
  var lines = [];

  function log(line) {
    lines[lines.length] = line;
  }

  function flush() {
    var f = new File(LOG_PATH);
    f.encoding = 'UTF-8';
    f.open('w');
    f.write(lines.join('\n'));
    f.close();
  }

  app.beginSuppressDialogs();
  try {
    var result = SVGSPLIT.ae.importFile('__FIXTURE_PATH__', {
      splitMode: '__SPLIT_MODE__',
      gradients: 'ffx',
      newComp: true,
      compName: '__COMP_NAME__'
    });
    var comp = result.comp;
    log('OK layers=' + result.layerCount);
    for (var i = 0; i < result.warnings.length; i++) {
      log('WARN ' + result.warnings[i]);
    }

    // White backdrop so the exported frame matches Chrome's white page.
    var bg = comp.layers.addSolid([1, 1, 1], 'E2E BG', comp.width, comp.height, 1);
    bg.moveToEnd();

    var outFile = new File('__OUT_PNG__');
    if (outFile.exists) outFile.remove();
    comp.saveFrameToPng(0, outFile);
    log('PNG requested');
  } catch (e) {
    log('ERROR ' + e.toString() + (e.line ? ' (line ' + e.line + ')' : ''));
  }
  app.endSuppressDialogs(false);
  flush();
})();
