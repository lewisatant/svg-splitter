'use strict';

// ES3 syntax gate for everything that ships inside the ExtendScript bundle.
// espree parses with ecmaVersion 3, so const/let/arrows/getters/trailing
// commas/reserved-word property shorthand all fail at parse time.
const es3Globals = {
  SVGSPLIT: 'writable',
  // ExtendScript hosts
  $: 'readonly',
  app: 'readonly',
  File: 'readonly',
  Folder: 'readonly',
  Shape: 'readonly',
  Panel: 'readonly',
  Window: 'readonly',
  BlendingMode: 'readonly',
  CompItem: 'readonly',
  system: 'readonly',
  alert: 'readonly',
  confirm: 'readonly',
  // ES3 built-ins
  Math: 'readonly',
  String: 'readonly',
  Number: 'readonly',
  Array: 'readonly',
  Object: 'readonly',
  RegExp: 'readonly',
  Error: 'readonly',
  Date: 'readonly',
  parseFloat: 'readonly',
  parseInt: 'readonly',
  isNaN: 'readonly',
  isFinite: 'readonly',
  NaN: 'readonly',
  Infinity: 'readonly',
  undefined: 'readonly',
  encodeURIComponent: 'readonly',
  decodeURIComponent: 'readonly',
};

module.exports = [
  {
    files: ['src/**/*.js', 'src/**/*.jsx'],
    languageOptions: {
      ecmaVersion: 3,
      sourceType: 'script',
      globals: es3Globals,
    },
    rules: {
      'no-undef': 'error',
      'no-unused-vars': ['warn', { args: 'none', vars: 'local', caughtErrors: 'none' }],
      // for...in over arrays is unsafe in a shared ExtendScript engine where
      // other scripts may have polluted prototypes.
      'no-restricted-syntax': [
        'error',
        { selector: 'ForInStatement', message: 'no for...in (prototype pollution hazard in shared AE engine)' },
      ],
    },
  },
];
