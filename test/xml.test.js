'use strict';

// Tests for src/core/xml.js — SVGSPLIT.xml.parse
// Element nodes: { type: 'element', name, attrs, children }
// Text nodes:    { type: 'text', text }

const { test } = require('node:test');
const assert = require('node:assert');
const { loadCore } = require('./load-core.js');

const S = loadCore();
const parse = (s) => S.xml.parse(s);

// Nodes are created inside a vm sandbox, so their prototypes belong to another
// realm and deepStrictEqual would reject them. Normalize to local-realm plain
// objects before deep comparison.
const plain = (x) => JSON.parse(JSON.stringify(x));

test('simple nested elements with double/single/no-value attributes', () => {
  const root = parse(
    '<svg width="100" height=\'50\' data-flag><g id="layer1"><rect x="1"/></g></svg>'
  );
  assert.strictEqual(root.type, 'element');
  assert.strictEqual(root.name, 'svg');
  assert.strictEqual(root.attrs.width, '100');
  assert.strictEqual(root.attrs.height, '50');
  // no-value attribute is present with empty-string value
  assert.ok(Object.prototype.hasOwnProperty.call(root.attrs, 'data-flag'));
  assert.strictEqual(root.attrs['data-flag'], '');

  assert.strictEqual(root.children.length, 1);
  const g = root.children[0];
  assert.strictEqual(g.type, 'element');
  assert.strictEqual(g.name, 'g');
  assert.strictEqual(g.attrs.id, 'layer1');

  assert.strictEqual(g.children.length, 1);
  const rect = g.children[0];
  assert.strictEqual(rect.name, 'rect');
  assert.strictEqual(rect.attrs.x, '1');
  assert.deepStrictEqual(plain(rect.children), []);
});

test('quote styles: opposite quote char is literal inside a value', () => {
  const root = parse('<a t=\'He said "hi"\' u="it&apos;s"/>');
  assert.strictEqual(root.attrs.t, 'He said "hi"');
  assert.strictEqual(root.attrs.u, "it's");
});

test('self-closing tags, with and without attributes/space', () => {
  const root = parse('<svg><rect width="5" /><circle/><g></g></svg>');
  assert.strictEqual(root.children.length, 3);
  assert.strictEqual(root.children[0].name, 'rect');
  assert.strictEqual(root.children[0].attrs.width, '5');
  assert.deepStrictEqual(plain(root.children[0].children), []);
  assert.strictEqual(root.children[1].name, 'circle');
  assert.deepStrictEqual(plain(root.children[1].children), []);
  assert.strictEqual(root.children[2].name, 'g');
  assert.deepStrictEqual(plain(root.children[2].children), []);
});

test('prolog, DOCTYPE with internal subset brackets, and comments are skipped', () => {
  const doc = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!-- exported by figma -->',
    '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN"',
    '  "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [',
    '  <!ENTITY brand "Acme">',
    '  <!ELEMENT note (#PCDATA)>',
    ']>',
    '<!-- another comment -->',
    '<svg viewBox="0 0 10 10"><rect/></svg>',
  ].join('\n');
  const root = parse(doc);
  assert.strictEqual(root.name, 'svg');
  assert.strictEqual(root.attrs.viewBox, '0 0 10 10');
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(root.children[0].name, 'rect');
});

test('multiple root-level comments and PIs before the root element', () => {
  const root = parse(
    '<!--a--> <?pi one?>\n<!--b--><?xml-stylesheet href="x.css" type="text/css"?>\n<root/>'
  );
  assert.strictEqual(root.name, 'root');
  assert.deepStrictEqual(plain(root.children), []);
});

test('comments inside element content are skipped, surrounding text kept', () => {
  const root = parse('<a>before<!-- gone -->after</a>');
  assert.deepStrictEqual(plain(root.children), [
    { type: 'text', text: 'before' },
    { type: 'text', text: 'after' },
  ]);
});

test('CDATA becomes text; its content is raw (no entity decoding, markup literal)', () => {
  const root = parse('<style>a&amp;b<![CDATA[.c { fill:&amp;"<x>" }]]>tail</style>');
  // Text pending before the CDATA is decoded and merged with the raw CDATA body.
  assert.strictEqual(root.children.length, 2);
  assert.deepStrictEqual(plain(root.children[0]), {
    type: 'text',
    text: 'a&b.c { fill:&amp;"<x>" }',
  });
  assert.deepStrictEqual(plain(root.children[1]), { type: 'text', text: 'tail' });
});

test('entity decoding in text content', () => {
  const root = parse('<a>&amp;&lt;&gt;&quot;&apos;&#65;&#x41;</a>');
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(root.children[0].type, 'text');
  assert.strictEqual(root.children[0].text, '&<>"\'AA');
});

test('entity decoding in attribute values', () => {
  const root = parse('<a v="&amp;&lt;&gt;&quot;&apos;&#65;&#x41;"/>');
  assert.strictEqual(root.attrs.v, '&<>"\'AA');
});

test('unknown named entity is left literal in text and attrs', () => {
  const root = parse('<a t="&nbsp;">x &nbsp; y &bogus; z</a>');
  assert.strictEqual(root.attrs.t, '&nbsp;');
  assert.strictEqual(root.children[0].text, 'x &nbsp; y &bogus; z');
});

test('raw control characters are sanitized out of text and attrs', () => {
  const ETX = String.fromCharCode(3); // raw 0x03, as seen in Figma exports
  const DEL = String.fromCharCode(0x7f);
  const root = parse('<a t="p' + ETX + 'q">a' + ETX + 'b' + DEL + 'c</a>');
  assert.strictEqual(root.attrs.t, 'pq');
  assert.strictEqual(root.children.length, 1);
  assert.strictEqual(root.children[0].text, 'abc');
});

test('leading BOM is stripped', () => {
  const root = parse('\uFEFF<?xml version="1.0"?>\n<svg width="1"/>');
  assert.strictEqual(root.name, 'svg');
  assert.strictEqual(root.attrs.width, '1');
});

test('attribute values may contain newlines and tabs', () => {
  const root = parse('<path d="M0 0\n\tL10 10\r\nZ"/>');
  assert.strictEqual(root.attrs.d, 'M0 0\n\tL10 10\r\nZ');
});

test('namespaced attribute names are preserved verbatim', () => {
  const root = parse(
    '<use xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="#shape"/>'
  );
  assert.strictEqual(root.attrs['xlink:href'], '#shape');
  assert.strictEqual(root.attrs['xmlns:xlink'], 'http://www.w3.org/1999/xlink');
});

test('mismatched close tag throws', () => {
  assert.throws(() => parse('<a><b>x</a></b>'), /mismatched close tag/);
  assert.throws(() => parse('<a></b>'), /mismatched close tag/);
});

test('unterminated comment throws', () => {
  assert.throws(() => parse('<!-- never closed <svg/>'), /unterminated comment/);
  assert.throws(() => parse('<a><!-- oops</a>'), /unterminated comment/);
});

test('unexpected end of input inside an element throws', () => {
  assert.throws(() => parse('<a><b>text'), /unexpected end of input/);
});

test('text around child elements is preserved in document order', () => {
  const root = parse('<a>one<b/>two<c>x</c>three</a>');
  assert.strictEqual(root.children.length, 5);
  assert.deepStrictEqual(plain(root.children[0]), { type: 'text', text: 'one' });
  assert.strictEqual(root.children[1].name, 'b');
  assert.deepStrictEqual(plain(root.children[2]), { type: 'text', text: 'two' });
  assert.strictEqual(root.children[3].name, 'c');
  assert.deepStrictEqual(plain(root.children[3].children), [{ type: 'text', text: 'x' }]);
  assert.deepStrictEqual(plain(root.children[4]), { type: 'text', text: 'three' });
});

test('whitespace-only text between elements is kept as text nodes', () => {
  const root = parse('<a> <b/> </a>');
  assert.strictEqual(root.children.length, 3);
  assert.deepStrictEqual(plain(root.children[0]), { type: 'text', text: ' ' });
  assert.strictEqual(root.children[1].name, 'b');
  assert.deepStrictEqual(plain(root.children[2]), { type: 'text', text: ' ' });
});
