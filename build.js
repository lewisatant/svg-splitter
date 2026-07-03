'use strict';

// Concatenates src/core + src/ae into dist/SVG Splitter.jsx after running the
// ES3 lint gate. The output is a single self-contained ExtendScript file.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = __dirname;

const CORE_FILES = [
  'src/core/matrix.js',
  'src/core/color.js',
  'src/core/xml.js',
  'src/core/path.js',
  'src/core/shapes.js',
  'src/core/style.js',
  'src/core/scene.js',
];

const AE_FILES = [
  'src/ae/grad-templates.jsx',
  'src/ae/gradients.jsx',
  'src/ae/builder.jsx',
  'src/ae/panel.jsx',
];

function lint() {
  const eslint = path.join(ROOT, 'node_modules', '.bin', 'eslint');
  execFileSync(eslint, ['src'], { cwd: ROOT, stdio: 'inherit' });
}

function build() {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const parts = [];
  parts.push(
    [
      '/*',
      ' * SVG Splitter ' + pkg.version,
      ' * Splits a Figma-exported SVG into After Effects shape layers.',
      ' *',
      ' * Install: copy this file into',
      ' *   <AE>/Scripts/ScriptUI Panels/   (dockable panel)',
      ' * or run via File > Scripts > Run Script File... (floating palette).',
      ' *',
      ' * Gradient stop injection adapts the .ffx technique from Google AEUX',
      ' * (https://github.com/google/AEUX, Apache-2.0).',
      ' *',
      ' * Generated file - edit src/ and run `node build.js`.',
      ' */',
      '',
      '(function svgSplitterMain(thisObj) {',
      '',
      'var SVGSPLIT = {};',
      '',
    ].join('\n')
  );

  for (const rel of CORE_FILES.concat(AE_FILES)) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    parts.push('// ---- ' + rel + ' ----\n' + src);
  }

  parts.push('SVGSPLIT.ui.run(thisObj);\n');
  parts.push('})(this);\n');

  const out = parts.join('\n');
  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const outPath = path.join(ROOT, 'dist', 'SVG Splitter.jsx');
  fs.writeFileSync(outPath, out);
  console.log('wrote ' + outPath + ' (' + out.length + ' bytes)');

  // Library flavor for the E2E harness: same code, no UI, SVGSPLIT exposed
  // globally so generated harness scripts can call SVGSPLIT.ae.importFile().
  const libParts = parts.slice(0, parts.length - 2);
  libParts.push('$.global.SVGSPLIT = SVGSPLIT;\n');
  libParts.push('})(this);\n');
  const libPath = path.join(ROOT, 'dist', 'svg-splitter-lib.jsx');
  fs.writeFileSync(libPath, libParts.join('\n'));
  console.log('wrote ' + libPath);
}

lint();
build();
