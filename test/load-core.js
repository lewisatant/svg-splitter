'use strict';

// Loads the ES3 core modules into a fresh vm sandbox exactly as ExtendScript
// would see them (plain script concatenation, no CommonJS). Returns SVGSPLIT.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const CORE_FILES = [
  'src/core/matrix.js',
  'src/core/color.js',
  'src/core/xml.js',
  'src/core/path.js',
  'src/core/shapes.js',
  'src/core/style.js',
  'src/core/scene.js',
];

function loadCore() {
  const context = vm.createContext({});
  for (const rel of CORE_FILES) {
    const file = path.join(ROOT, rel);
    vm.runInContext(fs.readFileSync(file, 'utf8'), context, { filename: rel });
  }
  return context.SVGSPLIT;
}

function fixture(name) {
  return fs.readFileSync(path.join(ROOT, 'test', 'fixtures', name), 'utf8');
}

module.exports = { loadCore, fixture, CORE_FILES };
