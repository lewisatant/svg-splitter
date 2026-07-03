// One-time E2E preflight: enable script file writing, verify File.write and
// saveFrameToPng availability, report AE version.
(function () {
  try {
    app.preferences.savePrefAsLong('Main Pref Section', 'Pref_SCRIPTING_FILE_NETWORK_SECURITY', 1);
    app.preferences.saveToDisk();
    app.preferences.reload();
  } catch (ePref) {
    // pref key may differ; the write test below is the real check
  }
  var lines = [];
  lines[lines.length] = 'version=' + app.version;
  lines[lines.length] = 'buildName=' + app.buildName;
  lines[lines.length] = 'saveFrameToPng=' + (typeof CompItem.prototype.saveFrameToPng);
  var f = new File('/Users/lewismenelaws/svg-splitter/test/e2e/out/preflight.log');
  f.encoding = 'UTF-8';
  var ok = f.open('w');
  if (ok) {
    f.write(lines.join('\n'));
    f.close();
  }
})();
