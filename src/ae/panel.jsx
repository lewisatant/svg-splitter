// ScriptUI panel. Dockable when installed in Scripts/ScriptUI Panels/,
// floating palette when run via File > Scripts.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.ui = (function () {
  var PREFS = 'SVGSplitter';

  function shortenPath(p, maxLen) {
    if (p.length <= maxLen) return p;
    return '...' + p.substring(p.length - maxLen + 3);
  }

  // Persisted settings (app.settings stores strings). Best-effort: any failure
  // falls back to the supplied default rather than breaking the panel.
  function loadPref(key, dflt) {
    try {
      if (app.settings.haveSetting(PREFS, key)) return app.settings.getSetting(PREFS, key);
    } catch (e) {}
    return dflt;
  }
  function savePref(key, val) {
    try { app.settings.saveSetting(PREFS, key, String(val)); } catch (e) {}
  }
  function loadBool(key, dflt) {
    return loadPref(key, dflt ? '1' : '0') === '1';
  }
  function parseNumOr(text, dflt) {
    var n = parseFloat(text);
    if (isNaN(n) || n <= 0) return dflt;
    return n;
  }

  function run(thisObj) {
    var pal = thisObj instanceof Panel
      ? thisObj
      : new Window('palette', 'SVG Splitter', undefined, { resizeable: true });
    pal.orientation = 'column';
    pal.alignChildren = ['fill', 'top'];
    pal.spacing = 6;
    pal.margins = 10;

    var selectedFile = null;
    var logLines = [];

    // --- File picker -------------------------------------------------------
    var fileGroup = pal.add('group');
    fileGroup.orientation = 'row';
    fileGroup.alignChildren = ['left', 'center'];
    var browseBtn = fileGroup.add('button', undefined, 'Choose SVG…');
    browseBtn.helpTip = 'Pick an SVG exported from Figma.';
    var fileLabel = fileGroup.add('statictext', undefined, 'no file selected', { truncate: 'middle' });
    fileLabel.alignment = ['fill', 'center'];
    fileLabel.minimumSize.width = 140;

    var hint = pal.add('statictext', undefined,
      'Tip: export from Figma with "Include id" on (named layers), "Simplify stroke" on, and outline text as preferred.',
      { multiline: true });
    hint.alignment = ['fill', 'top'];
    hint.minimumSize.height = 42;

    // --- Split mode --------------------------------------------------------
    var splitPanel = pal.add('panel', undefined, 'Split');
    splitPanel.orientation = 'column';
    splitPanel.alignChildren = ['left', 'top'];
    splitPanel.margins = 12;
    var radioTop = splitPanel.add('radiobutton', undefined, 'One layer per top-level group (Figma layers)');
    radioTop.helpTip = 'Mirrors the Figma layer list: one AE layer per top-level group.';
    var radioNested = splitPanel.add('radiobutton', undefined, 'One precomp per group (nested)');
    radioNested.helpTip = 'Preserve the Figma hierarchy: every group becomes a precomposition, ' +
      'nested groups become nested precomps, and each shape is its own layer inside.';
    var radioLeaf = splitPanel.add('radiobutton', undefined, 'One layer per shape');
    radioLeaf.helpTip = 'Fully exploded: every shape/text element becomes its own AE layer.';

    // --- Options -----------------------------------------------------------
    var optionsPanel = pal.add('panel', undefined, 'Options');
    optionsPanel.orientation = 'column';
    optionsPanel.alignChildren = ['left', 'top'];
    optionsPanel.margins = 12;

    var newCompCheck = optionsPanel.add('checkbox', undefined, 'Create new composition');
    newCompCheck.helpTip = 'On: build into a new comp sized to the SVG. Off: add layers to the active comp.';

    var gradCheck = optionsPanel.add('checkbox', undefined, 'Full gradients (writes temp .ffx preset)');
    gradCheck.helpTip = 'On: real multi-stop gradients via a temp preset. Off: solid first-stop color.';

    var gradWarn = optionsPanel.add('statictext', undefined, '', { multiline: true });
    gradWarn.alignment = ['fill', 'top'];
    gradWarn.minimumSize.height = 42;

    var compRow = optionsPanel.add('group');
    compRow.orientation = 'row';
    compRow.alignChildren = ['left', 'center'];
    compRow.add('statictext', undefined, 'Duration (s):');
    var durField = compRow.add('edittext', undefined, '10');
    durField.characters = 5;
    durField.helpTip = 'New-comp duration in seconds.';
    compRow.add('statictext', undefined, 'FPS:');
    var fpsField = compRow.add('edittext', undefined, '30');
    fpsField.characters = 5;
    fpsField.helpTip = 'New-comp frame rate.';

    // --- Action buttons ----------------------------------------------------
    var btnRow = pal.add('group');
    btnRow.orientation = 'row';
    btnRow.alignChildren = ['fill', 'center'];
    var importBtn = btnRow.add('button', undefined, 'Create Layers');
    importBtn.alignment = ['fill', 'center'];
    importBtn.helpTip = 'Convert the selected SVG into AE layers.';
    importBtn.enabled = false;
    var saveLogBtn = btnRow.add('button', undefined, 'Save log…');
    saveLogBtn.helpTip = 'Save the last run summary and warnings to a text file.';
    saveLogBtn.enabled = false;

    var status = pal.add('statictext', undefined, 'Ready.');
    status.alignment = ['fill', 'top'];

    // Read-only multiline log: selectable and copyable (Cmd+C), unlike a listbox.
    var logText = pal.add('edittext', undefined, '', { multiline: true, scrolling: true, readonly: true });
    logText.alignment = ['fill', 'fill'];
    logText.minimumSize.height = 90;

    function log(msg) {
      logLines[logLines.length] = msg;
      logText.text = logLines.join('\n');
      saveLogBtn.enabled = logLines.length > 0;
    }
    function clearLog() {
      logLines = [];
      logText.text = '';
      saveLogBtn.enabled = false;
    }

    // Show/hide the gradient-preference warning based on current capability.
    function refreshGradWarn() {
      if (gradCheck.value && !SVGSPLIT.ae.canWriteFiles()) {
        gradWarn.text = '! Full gradients need Preferences > Scripting & Expressions > ' +
          '"Allow Scripts to Write Files and Access Network" enabled — otherwise gradients ' +
          'fall back to solid colors.';
      } else {
        gradWarn.text = '';
      }
    }

    // --- Restore persisted settings (before wiring handlers so programmatic
    //     value changes don't trigger a redundant save) ---------------------
    var savedSplit = loadPref('splitMode', 'toplevel');
    radioLeaf.value = savedSplit === 'leaf';
    radioNested.value = savedSplit === 'nested';
    radioTop.value = !radioLeaf.value && !radioNested.value;
    newCompCheck.value = loadBool('newComp', true);
    gradCheck.value = loadPref('gradients', 'ffx') !== 'solid';
    durField.text = loadPref('duration', '10');
    fpsField.text = loadPref('frameRate', '30');
    refreshGradWarn();

    // --- Persist on change -------------------------------------------------
    radioTop.onClick = radioNested.onClick = radioLeaf.onClick = function () {
      savePref('splitMode', radioLeaf.value ? 'leaf' : radioNested.value ? 'nested' : 'toplevel');
    };
    newCompCheck.onClick = function () {
      savePref('newComp', newCompCheck.value ? '1' : '0');
    };
    gradCheck.onClick = function () {
      savePref('gradients', gradCheck.value ? 'ffx' : 'solid');
      refreshGradWarn();
    };
    durField.onChange = function () {
      savePref('duration', durField.text);
    };
    fpsField.onChange = function () {
      savePref('frameRate', fpsField.text);
    };

    // --- Browse ------------------------------------------------------------
    browseBtn.onClick = function () {
      var f = File.openDialog('Select an SVG exported from Figma', '*.svg');
      if (f) {
        selectedFile = f;
        fileLabel.text = shortenPath(decodeURIComponent(f.name), 40);
        importBtn.enabled = true;
      }
    };

    // --- Import ------------------------------------------------------------
    importBtn.onClick = function () {
      if (!selectedFile) return;

      // Make the gradient fallback loud instead of silent.
      if (gradCheck.value && !SVGSPLIT.ae.canWriteFiles()) {
        var proceed = confirm('Full gradients need "Allow Scripts to Write Files and Access ' +
          'Network" enabled in Preferences > Scripting & Expressions.\n\n' +
          'Continue anyway? Gradients will use solid fallback colors.');
        if (!proceed) {
          status.text = 'Cancelled — enable file writing for full gradients.';
          return;
        }
      }

      clearLog();
      status.text = 'Importing…';
      pal.update && pal.update();
      try {
        var result = SVGSPLIT.ae.importFile(selectedFile.fsName, {
          splitMode: radioLeaf.value ? 'leaf' : radioNested.value ? 'nested' : 'toplevel',
          newComp: newCompCheck.value,
          gradients: gradCheck.value ? 'ffx' : 'solid',
          duration: parseNumOr(durField.text, 10),
          frameRate: parseNumOr(fpsField.text, 30),
          confirmLarge: function (count) {
            return confirm('This SVG produces ' + count + ' layers. Continue?');
          },
          onProgress: function (i, total, name) {
            status.text = 'Layer ' + i + '/' + total + ': ' + name;
            pal.update && pal.update();
          }
        });
        status.text = 'Done: ' + result.layerCount + ' layer' + (result.layerCount === 1 ? '' : 's') +
          ' in "' + result.comp.name + '"' +
          (result.warnings.length > 0 ? ' — ' + result.warnings.length + ' warning(s).' : '.');

        log('SVG Splitter — "' + result.comp.name + '"');
        log(result.layerCount + ' layer' + (result.layerCount === 1 ? '' : 's') + ' created.');
        logWarnings(result.warnings);

        result.comp.openInViewer();
      } catch (e) {
        status.text = 'Import failed.';
        log('ERROR: ' + e.toString());
        alert('SVG Splitter\n\n' + e.toString());
      }
    };

    // Group warnings into document-level vs layer-scoped ([name] prefix set in
    // builder.jsx) so a long list is scannable.
    function logWarnings(warnings) {
      if (warnings.length === 0) {
        log('No warnings.');
        return;
      }
      var docW = [];
      var layerW = [];
      for (var i = 0; i < warnings.length; i++) {
        if (warnings[i].charAt(0) === '[') layerW[layerW.length] = warnings[i];
        else docW[docW.length] = warnings[i];
      }
      log('');
      log('Warnings (' + warnings.length + '):');
      var k;
      if (docW.length > 0) {
        log('-- Document --');
        for (k = 0; k < docW.length; k++) log('  ' + docW[k]);
      }
      if (layerW.length > 0) {
        log('-- Layers --');
        for (k = 0; k < layerW.length; k++) log('  ' + layerW[k]);
      }
    }

    // --- Save log ----------------------------------------------------------
    saveLogBtn.onClick = function () {
      if (logLines.length === 0) return;
      var f = File.saveDialog('Save SVG Splitter log', 'Text:*.txt');
      if (!f) return;
      if (!/\.txt$/i.test(f.name)) f = new File(f.fsName + '.txt');
      f.encoding = 'UTF-8';
      if (f.open('w')) {
        f.write(logLines.join('\n'));
        f.close();
        status.text = 'Log saved: ' + decodeURIComponent(f.name);
      } else {
        status.text = 'Could not write log (check file-write permission).';
      }
    };

    pal.onResizing = pal.onResize = function () {
      this.layout.resize();
    };

    if (pal instanceof Window) {
      pal.center();
      pal.show();
    } else {
      pal.layout.layout(true);
      pal.layout.resize();
    }
  }

  return { run: run };
})();
