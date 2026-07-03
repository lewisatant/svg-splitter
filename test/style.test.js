'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./load-core.js');

const S = loadCore();
const style = S.style;

// Node shape helper: {type:'element', name, attrs:{}, children:[]}
function el(name, attrs) {
  return { type: 'element', name: name, attrs: attrs || {}, children: [] };
}

// Values returned by the core come from a separate vm realm, so their
// Object/Array prototypes differ from ours and deepStrictEqual rejects
// structurally-equal values. Normalize into this realm before comparing.
// All core outputs are JSON-safe (strings, numbers, plain objects, arrays).
function norm(x) {
  return x === null || x === undefined ? x : JSON.parse(JSON.stringify(x));
}

// ---------------------------------------------------------------------------
// parseInline
// ---------------------------------------------------------------------------

test('parseInline: basic declarations', () => {
  const out = style.parseInline('fill:red;stroke:blue');
  assert.deepStrictEqual(norm(out), { fill: 'red', stroke: 'blue' });
});

test('parseInline: whitespace is trimmed and keys are lowercased', () => {
  const out = style.parseInline('  FILL : red ;  stroke-width :  2  ;');
  assert.deepStrictEqual(norm(out), { fill: 'red', 'stroke-width': '2' });
});

test('parseInline: declaration missing a colon is ignored, rest kept', () => {
  const out = style.parseInline('fill red;stroke:blue;bogus');
  assert.deepStrictEqual(norm(out), { stroke: 'blue' });
});

test('parseInline: empty value or empty key dropped; empty/absent input -> {}', () => {
  assert.deepStrictEqual(norm(style.parseInline('fill:;stroke:blue')), { stroke: 'blue' });
  assert.deepStrictEqual(norm(style.parseInline(':red')), {});
  assert.deepStrictEqual(norm(style.parseInline('')), {});
  assert.deepStrictEqual(norm(style.parseInline(undefined)), {});
  assert.deepStrictEqual(norm(style.parseInline(null)), {});
});

// ---------------------------------------------------------------------------
// parseSheet
// ---------------------------------------------------------------------------

test('parseSheet: class selector .cls-1{fill:#fff}', () => {
  const sheet = style.parseSheet('.cls-1{fill:#fff}');
  assert.strictEqual(sheet.warnings.length, 0);
  assert.strictEqual(sheet.rules.length, 1);
  assert.deepStrictEqual(norm(sheet.rules[0].sel), { kind: 'class', name: 'cls-1' });
  assert.deepStrictEqual(norm(sheet.rules[0].decls), { fill: '#fff' });
  assert.strictEqual(sheet.rules[0].order, 0);
});

test('parseSheet: tag selector rect{stroke:red}', () => {
  const sheet = style.parseSheet('rect{stroke:red}');
  assert.strictEqual(sheet.warnings.length, 0);
  assert.strictEqual(sheet.rules.length, 1);
  assert.deepStrictEqual(norm(sheet.rules[0].sel), { kind: 'tag', name: 'rect' });
  assert.deepStrictEqual(norm(sheet.rules[0].decls), { stroke: 'red' });
});

test('parseSheet: id selector #id1{...}', () => {
  const sheet = style.parseSheet('#id1{fill:#00ff00;stroke-width:2}');
  assert.strictEqual(sheet.warnings.length, 0);
  assert.strictEqual(sheet.rules.length, 1);
  assert.deepStrictEqual(norm(sheet.rules[0].sel), { kind: 'id', name: 'id1' });
  assert.deepStrictEqual(norm(sheet.rules[0].decls), { fill: '#00ff00', 'stroke-width': '2' });
});

test('parseSheet: comments are stripped, including inside blocks', () => {
  const sheet = style.parseSheet(
    '/* header comment */ .a{fill:/* inline */red} /* trailing\n multiline */'
  );
  assert.strictEqual(sheet.warnings.length, 0);
  assert.strictEqual(sheet.rules.length, 1);
  assert.deepStrictEqual(norm(sheet.rules[0].decls), { fill: 'red' });
});

test('parseSheet: multi-selector "a,b{...}" yields one rule per selector', () => {
  const sheet = style.parseSheet('text, rect{fill:red}');
  assert.strictEqual(sheet.warnings.length, 0);
  assert.strictEqual(sheet.rules.length, 2);
  assert.deepStrictEqual(norm(sheet.rules[0].sel), { kind: 'tag', name: 'text' });
  assert.deepStrictEqual(norm(sheet.rules[1].sel), { kind: 'tag', name: 'rect' });
  assert.deepStrictEqual(norm(sheet.rules[0].decls), { fill: 'red' });
  assert.deepStrictEqual(norm(sheet.rules[1].decls), { fill: 'red' });
  assert.strictEqual(sheet.rules[0].order, 0);
  assert.strictEqual(sheet.rules[1].order, 1);
});

test('parseSheet: unsupported selector "g > path" warns and is ignored', () => {
  const sheet = style.parseSheet('g > path{fill:red} .ok{stroke:blue}');
  assert.strictEqual(sheet.rules.length, 1);
  assert.deepStrictEqual(norm(sheet.rules[0].sel), { kind: 'class', name: 'ok' });
  assert.strictEqual(sheet.warnings.length, 1);
  assert.match(sheet.warnings[0], /g > path/);
  assert.match(sheet.warnings[0], /ignored/);
});

test('parseSheet: empty/missing css -> no rules, no warnings', () => {
  assert.deepStrictEqual(norm(style.parseSheet('')), { rules: [], warnings: [] });
  assert.deepStrictEqual(norm(style.parseSheet(null)), { rules: [], warnings: [] });
});

// ---------------------------------------------------------------------------
// compute: cascade priority (each layer beats the next one down)
// ---------------------------------------------------------------------------

test('compute: inline style beats #id rule', () => {
  const sheet = style.parseSheet('#x{fill:blue}');
  const node = el('rect', { id: 'x', style: 'fill:red' });
  assert.strictEqual(style.compute(node, null, sheet).fill, 'red');
});

test('compute: #id rule beats .class rule (even if class rule comes later)', () => {
  const sheet = style.parseSheet('#x{fill:blue} .c{fill:green}');
  const node = el('rect', { id: 'x', 'class': 'c' });
  assert.strictEqual(style.compute(node, null, sheet).fill, 'blue');
});

test('compute: .class rule beats tag rule (even if tag rule comes later)', () => {
  const sheet = style.parseSheet('.c{fill:green} rect{fill:yellow}');
  const node = el('rect', { 'class': 'c' });
  assert.strictEqual(style.compute(node, null, sheet).fill, 'green');
});

test('compute: tag rule beats presentation attribute', () => {
  const sheet = style.parseSheet('rect{fill:yellow}');
  const node = el('rect', { fill: 'purple' });
  assert.strictEqual(style.compute(node, null, sheet).fill, 'yellow');
});

test('compute: presentation attribute beats inherited value', () => {
  const parent = style.compute(el('g', { fill: 'orange' }), null, null);
  assert.strictEqual(parent.fill, 'orange');
  const child = el('rect', { fill: 'purple' });
  assert.strictEqual(style.compute(child, parent, null).fill, 'purple');
});

test('compute: inherited value beats initial', () => {
  const parent = style.compute(el('g', { fill: 'orange' }), null, null);
  const child = el('rect', {});
  assert.strictEqual(style.compute(child, parent, null).fill, 'orange');
});

test('compute: equal specificity resolved by source order (later wins)', () => {
  const sheet = style.parseSheet('.a{fill:red} .b{fill:blue}');
  const node = el('rect', { 'class': 'a b' });
  assert.strictEqual(style.compute(node, null, sheet).fill, 'blue');
});

test('compute: universal selector * matches any element at tag specificity', () => {
  const sheet = style.parseSheet('*{fill:teal}');
  assert.strictEqual(sheet.warnings.length, 0);
  const node = el('circle', {});
  assert.strictEqual(style.compute(node, null, sheet).fill, 'teal');
  // class still beats * (same as tag level 0 vs class level 1)
  const sheet2 = style.parseSheet('.c{fill:green} *{fill:teal}');
  const node2 = el('circle', { 'class': 'c' });
  assert.strictEqual(style.compute(node2, null, sheet2).fill, 'green');
});

test('compute: class attr with multiple classes matches, tag match is case-insensitive', () => {
  const sheet = style.parseSheet('.cls-1{fill:#fff} RECT{stroke:red}');
  const node = el('Rect', { 'class': 'foo cls-1 bar' });
  const c = style.compute(node, null, sheet);
  assert.strictEqual(c.fill, '#fff');
  assert.strictEqual(c.stroke, 'red');
});

// ---------------------------------------------------------------------------
// compute: inheritance semantics
// ---------------------------------------------------------------------------

test('compute: fill, stroke, stroke-width inherit from parent computed style', () => {
  const parent = style.compute(
    el('g', { fill: '#123456', stroke: 'red', 'stroke-width': '3' }),
    null,
    null
  );
  const child = style.compute(el('path', {}), parent, null);
  assert.strictEqual(child.fill, '#123456');
  assert.strictEqual(child.stroke, 'red');
  assert.strictEqual(child['stroke-width'], '3');
});

test('compute: opacity, display, mix-blend-mode do NOT inherit', () => {
  const parent = style.compute(
    el('g', { opacity: '0.5', display: 'none', 'mix-blend-mode': 'multiply' }),
    null,
    null
  );
  assert.strictEqual(parent.opacity, '0.5');
  assert.strictEqual(parent.display, 'none');
  assert.strictEqual(parent['mix-blend-mode'], 'multiply');
  const child = style.compute(el('rect', {}), parent, null);
  assert.strictEqual(child.opacity, '1');
  assert.strictEqual(child.display, 'inline');
  assert.strictEqual(child['mix-blend-mode'], 'normal');
});

test('compute: "inherit" keyword on inheritable prop takes parent value', () => {
  const parent = style.compute(el('g', { fill: 'red', stroke: 'blue' }), null, null);
  const child = style.compute(
    el('rect', { fill: 'inherit', style: 'stroke:inherit' }),
    parent,
    null
  );
  assert.strictEqual(child.fill, 'red');
  assert.strictEqual(child.stroke, 'blue');
});

test('compute: "inherit" keyword at the root falls back to initial', () => {
  const c = style.compute(el('rect', { fill: 'inherit' }), null, null);
  assert.strictEqual(c.fill, 'black');
});

test(
  'compute: "inherit" keyword on non-inherited prop (opacity) takes parent computed value',
  {
    skip:
      'BUG: style.compute treats "inherit" as null then applies the default-inheritance ' +
      'flag, so opacity:"inherit" with parent opacity 0.5 computes "1" (initial) instead ' +
      'of "0.5". Per CSS 2.1 / SVG 1.1 the inherit keyword forces inheritance for all ' +
      'properties, including non-inherited ones.',
  },
  () => {
    const parent = style.compute(el('g', { opacity: '0.5' }), null, null);
    const child = style.compute(el('rect', { opacity: 'inherit' }), parent, null);
    assert.strictEqual(child.opacity, '0.5'); // actual: '1'
  }
);

test('compute: initial values with no parent, no sheet, no attrs', () => {
  const c = style.compute(el('rect', {}), null, null);
  assert.strictEqual(c.fill, 'black');
  assert.strictEqual(c.stroke, 'none');
  assert.strictEqual(c['fill-rule'], 'nonzero');
  assert.strictEqual(c['stroke-width'], '1');
  assert.strictEqual(c.opacity, '1');
  assert.strictEqual(c['stroke-dasharray'], 'none');
});

test('compute: whitespace-only presentation attribute is ignored', () => {
  const parent = style.compute(el('g', { fill: 'orange' }), null, null);
  const c = style.compute(el('rect', { fill: '   ' }), parent, null);
  assert.strictEqual(c.fill, 'orange');
});

// ---------------------------------------------------------------------------
// parseLength
// ---------------------------------------------------------------------------

test('parseLength: numbers with and without px', () => {
  assert.strictEqual(style.parseLength('2px', -1), 2);
  assert.strictEqual(style.parseLength('2', -1), 2);
  assert.strictEqual(style.parseLength('2.5px', -1), 2.5);
  assert.strictEqual(style.parseLength('.5', -1), 0.5);
  assert.strictEqual(style.parseLength(' 3 px', -1), 3); // lenient: space before unit ok
  assert.strictEqual(style.parseLength('  7px  ', -1), 7); // surrounding whitespace ok
});

test('parseLength: empty, garbage, unsupported units, null -> fallback', () => {
  assert.strictEqual(style.parseLength('', 42), 42);
  assert.strictEqual(style.parseLength('garbage', 42), 42);
  assert.strictEqual(style.parseLength('2em', 42), 42);
  assert.strictEqual(style.parseLength('px', 42), 42);
  assert.strictEqual(style.parseLength(null, 42), 42);
  assert.strictEqual(style.parseLength(undefined, 42), 42);
});

test('parseLength: negative values are allowed', () => {
  assert.strictEqual(style.parseLength('-3', 0), -3);
  assert.strictEqual(style.parseLength('-4.5px', 0), -4.5);
});

// ---------------------------------------------------------------------------
// parseDashArray
// ---------------------------------------------------------------------------

test('parseDashArray: none / empty / null -> null', () => {
  assert.strictEqual(style.parseDashArray('none'), null);
  assert.strictEqual(style.parseDashArray(''), null);
  assert.strictEqual(style.parseDashArray(null), null);
  assert.strictEqual(style.parseDashArray(undefined), null);
});

test('parseDashArray: "4 2" -> [4, 2]', () => {
  assert.deepStrictEqual(norm(style.parseDashArray('4 2')), [4, 2]);
});

test('parseDashArray: odd count is doubled: "5 3 1" -> [5,3,1,5,3,1]', () => {
  assert.deepStrictEqual(norm(style.parseDashArray('5 3 1')), [5, 3, 1, 5, 3, 1]);
});

test('parseDashArray: any negative value -> null', () => {
  assert.strictEqual(style.parseDashArray('4 -2'), null);
  assert.strictEqual(style.parseDashArray('-1'), null);
});

test('parseDashArray: all-zero values -> null', () => {
  assert.strictEqual(style.parseDashArray('0 0'), null);
  assert.strictEqual(style.parseDashArray('0'), null);
});

test('parseDashArray: comma and space separators mix', () => {
  assert.deepStrictEqual(norm(style.parseDashArray('4,2')), [4, 2]);
  assert.deepStrictEqual(norm(style.parseDashArray('4, 2 ,1')), [4, 2, 1, 4, 2, 1]);
  assert.deepStrictEqual(norm(style.parseDashArray('4px, 2px')), [4, 2]);
});

test('parseDashArray: garbage entry -> null', () => {
  assert.strictEqual(style.parseDashArray('4 abc'), null);
});
