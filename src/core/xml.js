// Minimal non-validating XML parser sufficient for SVG documents.
// Hand-rolled because ExtendScript's E4X does not exist in Node and we want
// one parser shared by tests and the AE runtime. ES3 only.
//
// parse(text) -> root element node:
//   { type: 'element', name: 'svg', attrs: {..}, children: [node|text] }
//   text nodes: { type: 'text', text: '...' }

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.xml = (function () {
  // Strips BOM and control characters (Figma text exports can contain
  // raw 0x03) while keeping tab/newline/carriage return.
  function sanitize(text) {
    if (text.charCodeAt(0) === 0xFEFF) text = text.substring(1);
    return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  function decodeEntities(s) {
    if (s.indexOf('&') === -1) return s;
    return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, function (whole, body) {
      if (body.charAt(0) === '#') {
        var code;
        if (body.charAt(1) === 'x' || body.charAt(1) === 'X') {
          code = parseInt(body.substring(2), 16);
        } else {
          code = parseInt(body.substring(1), 10);
        }
        if (isNaN(code) || code < 32 && code !== 9 && code !== 10 && code !== 13) return '';
        return String.fromCharCode(code);
      }
      if (body === 'amp') return '&';
      if (body === 'lt') return '<';
      if (body === 'gt') return '>';
      if (body === 'quot') return '"';
      if (body === 'apos') return "'";
      return whole; // unknown named entity: keep literal
    });
  }

  function ParseState(text) {
    this.text = text;
    this.pos = 0;
    this.len = text.length;
  }

  function fail(state, msg) {
    var line = 1;
    for (var i = 0; i < state.pos && i < state.len; i++) {
      if (state.text.charAt(i) === '\n') line++;
    }
    throw new Error('XML parse error (line ' + line + '): ' + msg);
  }

  function isSpace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  function skipSpace(state) {
    while (state.pos < state.len && isSpace(state.text.charAt(state.pos))) state.pos++;
  }

  function isNameChar(ch) {
    return /[^\s=\/>'"<]/.test(ch);
  }

  function readName(state) {
    var start = state.pos;
    while (state.pos < state.len && isNameChar(state.text.charAt(state.pos))) state.pos++;
    if (state.pos === start) fail(state, 'expected name');
    return state.text.substring(start, state.pos);
  }

  // Skips <?...?>, <!--...-->, <!DOCTYPE ...> (with optional internal subset).
  // Returns true if something was consumed.
  function skipMisc(state) {
    var t = state.text;
    if (t.charAt(state.pos) !== '<') return false;
    var next = t.charAt(state.pos + 1);
    if (next === '?') {
      var endPi = t.indexOf('?>', state.pos + 2);
      if (endPi === -1) fail(state, 'unterminated processing instruction');
      state.pos = endPi + 2;
      return true;
    }
    if (next === '!') {
      if (t.substring(state.pos, state.pos + 4) === '<!--') {
        var endC = t.indexOf('-->', state.pos + 4);
        if (endC === -1) fail(state, 'unterminated comment');
        state.pos = endC + 3;
        return true;
      }
      if (t.substring(state.pos, state.pos + 9) === '<![CDATA[') {
        return false; // handled as content, not misc
      }
      // DOCTYPE (or other declaration): skip to matching '>', honoring [...]
      var i = state.pos + 2;
      var depth = 0;
      while (i < state.len) {
        var ch = t.charAt(i);
        if (ch === '[') depth++;
        else if (ch === ']') depth--;
        else if (ch === '>' && depth <= 0) {
          state.pos = i + 1;
          return true;
        }
        i++;
      }
      fail(state, 'unterminated declaration');
    }
    return false;
  }

  function readAttributes(state, node) {
    var t = state.text;
    for (;;) {
      skipSpace(state);
      var ch = t.charAt(state.pos);
      if (ch === '>' || ch === '/' || state.pos >= state.len) return;
      var name = readName(state);
      skipSpace(state);
      var value = '';
      if (t.charAt(state.pos) === '=') {
        state.pos++;
        skipSpace(state);
        var quote = t.charAt(state.pos);
        if (quote !== '"' && quote !== "'") fail(state, 'expected quoted attribute value for ' + name);
        state.pos++;
        var end = t.indexOf(quote, state.pos);
        if (end === -1) fail(state, 'unterminated attribute value for ' + name);
        value = decodeEntities(t.substring(state.pos, end));
        state.pos = end + 1;
      }
      node.attrs[name] = value;
    }
  }

  function parseElement(state) {
    var t = state.text;
    if (t.charAt(state.pos) !== '<') fail(state, 'expected element');
    state.pos++;
    var node = { type: 'element', name: readName(state), attrs: {}, children: [] };
    readAttributes(state, node);
    if (t.charAt(state.pos) === '/') {
      state.pos++;
      if (t.charAt(state.pos) !== '>') fail(state, 'malformed self-closing tag ' + node.name);
      state.pos++;
      return node;
    }
    if (t.charAt(state.pos) !== '>') fail(state, 'malformed start tag ' + node.name);
    state.pos++;
    parseContent(state, node);
    // now positioned at '</'
    state.pos += 2;
    var closeName = readName(state);
    if (closeName !== node.name) fail(state, 'mismatched close tag: <' + node.name + '> vs </' + closeName + '>');
    skipSpace(state);
    if (t.charAt(state.pos) !== '>') fail(state, 'malformed close tag ' + closeName);
    state.pos++;
    return node;
  }

  function pushText(node, text) {
    if (text.length === 0) return;
    var kids = node.children;
    kids[kids.length] = { type: 'text', text: text };
  }

  function parseContent(state, node) {
    var t = state.text;
    var textStart = state.pos;
    while (state.pos < state.len) {
      if (t.charAt(state.pos) !== '<') {
        state.pos++;
        continue;
      }
      // flush pending text
      var pending = t.substring(textStart, state.pos);
      if (t.substring(state.pos, state.pos + 2) === '</') {
        pushText(node, decodeEntities(pending));
        return;
      }
      if (t.substring(state.pos, state.pos + 9) === '<![CDATA[') {
        var endCd = t.indexOf(']]>', state.pos + 9);
        if (endCd === -1) fail(state, 'unterminated CDATA');
        pushText(node, decodeEntities(pending) + t.substring(state.pos + 9, endCd));
        state.pos = endCd + 3;
        textStart = state.pos;
        continue;
      }
      if (skipMisc(state)) {
        pushText(node, decodeEntities(pending));
        textStart = state.pos;
        continue;
      }
      pushText(node, decodeEntities(pending));
      var child = parseElement(state);
      node.children[node.children.length] = child;
      textStart = state.pos;
    }
    fail(state, 'unexpected end of input inside <' + node.name + '>');
  }

  function parse(text) {
    var state = new ParseState(sanitize(text));
    for (;;) {
      skipSpace(state);
      if (state.pos >= state.len) fail(state, 'no root element');
      if (!skipMisc(state)) break;
    }
    var root = parseElement(state);
    return root;
  }

  return {
    parse: parse,
    sanitize: sanitize,
    decodeEntities: decodeEntities
  };
})();
