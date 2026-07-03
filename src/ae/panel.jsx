// ScriptUI panel. Dockable when installed in Scripts/ScriptUI Panels/,
// floating palette when run via File > Scripts.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.ui = (function () {
  function shortenPath(p, maxLen) {
    if (p.length <= maxLen) return p;
    return '...' + p.substring(p.length - maxLen + 3);
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

    var fileGroup = pal.add('group');
    fileGroup.orientation = 'row';
    fileGroup.alignChildren = ['left', 'center'];
    var browseBtn = fileGroup.add('button', undefined, 'Choose SVG…');
    var fileLabel = fileGroup.add('statictext', undefined, 'no file selected', { truncate: 'middle' });
    fileLabel.alignment = ['fill', 'center'];
    fileLabel.minimumSize.width = 140;

    var splitPanel = pal.add('panel', undefined, 'Split');
    splitPanel.orientation = 'column';
    splitPanel.alignChildren = ['left', 'top'];
    splitPanel.margins = 12;
    var radioTop = splitPanel.add('radiobutton', undefined, 'One layer per top-level group (Figma layers)');
    var radioLeaf = splitPanel.add('radiobutton', undefined, 'One layer per shape');
    radioTop.value = true;

    var optionsPanel = pal.add('panel', undefined, 'Options');
    optionsPanel.orientation = 'column';
    optionsPanel.alignChildren = ['left', 'top'];
    optionsPanel.margins = 12;
    var newCompCheck = optionsPanel.add('checkbox', undefined, 'Create new composition');
    newCompCheck.value = true;
    var gradCheck = optionsPanel.add('checkbox', undefined, 'Full gradients (writes temp .ffx preset)');
    gradCheck.value = true;

    var importBtn = pal.add('button', undefined, 'Create Layers');
    importBtn.enabled = false;

    var status = pal.add('statictext', undefined, 'Export from Figma with "Include id" on for named layers.');
    status.alignment = ['fill', 'top'];

    var logBox = pal.add('listbox', undefined, [], { multiselect: false });
    logBox.alignment = ['fill', 'fill'];
    logBox.minimumSize.height = 90;

    function log(msg) {
      logBox.add('item', msg);
    }

    function clearLog() {
      logBox.removeAll();
    }

    browseBtn.onClick = function () {
      var f = File.openDialog('Select an SVG exported from Figma', '*.svg');
      if (f) {
        selectedFile = f;
        fileLabel.text = shortenPath(decodeURIComponent(f.name), 40);
        importBtn.enabled = true;
      }
    };

    importBtn.onClick = function () {
      if (!selectedFile) return;
      clearLog();
      status.text = 'Importing…';
      pal.update && pal.update();
      try {
        var result = SVGSPLIT.ae.importFile(selectedFile.fsName, {
          splitMode: radioLeaf.value ? 'leaf' : 'toplevel',
          newComp: newCompCheck.value,
          gradients: gradCheck.value ? 'ffx' : 'solid',
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
          (result.warnings.length > 0 ? ' — ' + result.warnings.length + ' warning(s):' : '.');
        for (var i = 0; i < result.warnings.length; i++) {
          log(result.warnings[i]);
        }
        if (result.warnings.length === 0) log('No warnings.');
        result.comp.openInViewer();
      } catch (e) {
        status.text = 'Import failed.';
        log('ERROR: ' + e.toString());
        alert('SVG Splitter\n\n' + e.toString());
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
