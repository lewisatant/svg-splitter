/*
 * SVG Splitter 0.1.0
 * Splits a Figma-exported SVG into After Effects shape layers.
 *
 * Install: copy this file into
 *   <AE>/Scripts/ScriptUI Panels/   (dockable panel)
 * or run via File > Scripts > Run Script File... (floating palette).
 *
 * Gradient stop injection adapts the .ffx technique from Google AEUX
 * (https://github.com/google/AEUX, Apache-2.0).
 *
 * Generated file - edit src/ and run `node build.js`.
 */

(function svgSplitterMain(thisObj) {

var SVGSPLIT = {};

// ---- src/core/matrix.js ----
// 2D affine matrices in SVG order: [a, b, c, d, e, f]
// maps (x, y) -> (a*x + c*y + e, b*x + d*y + f)
// ES3 only - runs in ExtendScript and Node.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.matrix = (function () {
  var DEG = Math.PI / 180;

  function identity() {
    return [1, 0, 0, 1, 0, 0];
  }

  // multiply(m1, m2): apply m2 to the point first, then m1 (matrix product m1*m2).
  function multiply(m1, m2) {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  function apply(m, x, y) {
    return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  }

  function translate(tx, ty) {
    return [1, 0, 0, 1, tx, ty];
  }

  function scale(sx, sy) {
    return [sx, 0, 0, sy, 0, 0];
  }

  function rotate(deg) {
    var c = Math.cos(deg * DEG);
    var s = Math.sin(deg * DEG);
    return [c, s, -s, c, 0, 0];
  }

  function rotateAt(deg, cx, cy) {
    return multiply(multiply(translate(cx, cy), rotate(deg)), translate(-cx, -cy));
  }

  function skewX(deg) {
    return [1, 0, Math.tan(deg * DEG), 1, 0, 0];
  }

  function skewY(deg) {
    return [1, Math.tan(deg * DEG), 0, 1, 0, 0];
  }

  function det(m) {
    return m[0] * m[3] - m[1] * m[2];
  }

  // Uniform length-scale factor for stroke widths under this transform.
  function strokeScale(m) {
    var d = det(m);
    return Math.sqrt(d < 0 ? -d : d);
  }

  // True when the linear part is (rotation + uniform scale + optional flip):
  // circles stay circles, centered strokes stay exact.
  function isConformal(m, eps) {
    if (eps === undefined) eps = 1e-6;
    var sx = Math.sqrt(m[0] * m[0] + m[1] * m[1]);
    var sy = Math.sqrt(m[2] * m[2] + m[3] * m[3]);
    var maxs = sx > sy ? sx : sy;
    if (maxs === 0) return true;
    var shear = (m[0] * m[2] + m[1] * m[3]) / (maxs * maxs);
    var stretch = (sx - sy) / maxs;
    if (stretch < 0) stretch = -stretch;
    if (shear < 0) shear = -shear;
    return stretch <= eps && shear <= eps;
  }

  // Parses an SVG `transform` attribute value into one composed matrix.
  // Supports matrix / translate / scale / rotate (1- and 3-arg) / skewX / skewY.
  function parse(text) {
    var m = identity();
    if (!text) return m;
    var re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
    var match;
    while ((match = re.exec(text)) !== null) {
      var fn = match[1];
      // tokenize numbers directly - SVGO-style packed args ("10-5", ".5.5")
      // use the sign/dot as separator, which whitespace splitting misses
      var pieces = match[2].match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g);
      var args = [];
      if (pieces) {
        for (var i = 0; i < pieces.length; i++) args[args.length] = parseFloat(pieces[i]);
      }
      var t = null;
      if (fn === 'matrix' && args.length === 6) {
        t = [args[0], args[1], args[2], args[3], args[4], args[5]];
      } else if (fn === 'translate' && args.length >= 1) {
        t = translate(args[0], args.length > 1 ? args[1] : 0);
      } else if (fn === 'scale' && args.length >= 1) {
        t = scale(args[0], args.length > 1 ? args[1] : args[0]);
      } else if (fn === 'rotate' && args.length === 1) {
        t = rotate(args[0]);
      } else if (fn === 'rotate' && args.length === 3) {
        t = rotateAt(args[0], args[1], args[2]);
      } else if (fn === 'skewX' && args.length === 1) {
        t = skewX(args[0]);
      } else if (fn === 'skewY' && args.length === 1) {
        t = skewY(args[0]);
      }
      if (t) m = multiply(m, t);
    }
    return m;
  }

  return {
    identity: identity,
    multiply: multiply,
    apply: apply,
    translate: translate,
    scale: scale,
    rotate: rotate,
    rotateAt: rotateAt,
    skewX: skewX,
    skewY: skewY,
    det: det,
    strokeScale: strokeScale,
    isConformal: isConformal,
    parse: parse
  };
})();

// ---- src/core/color.js ----
// CSS color parsing for SVG paint values. ES3 only.
// parse() returns one of:
//   { r, g, b, a }        components in 0..1
//   { none: true }        for 'none' / 'transparent'-as-paint semantics kept as rgba(0,0,0,0)
//   { currentColor: true }
//   null                  unparseable

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.color = (function () {
  var NAMED = {
    aliceblue: 'f0f8ff', antiquewhite: 'faebd7', aqua: '00ffff', aquamarine: '7fffd4',
    azure: 'f0ffff', beige: 'f5f5dc', bisque: 'ffe4c4', black: '000000',
    blanchedalmond: 'ffebcd', blue: '0000ff', blueviolet: '8a2be2', brown: 'a52a2a',
    burlywood: 'deb887', cadetblue: '5f9ea0', chartreuse: '7fff00', chocolate: 'd2691e',
    coral: 'ff7f50', cornflowerblue: '6495ed', cornsilk: 'fff8dc', crimson: 'dc143c',
    cyan: '00ffff', darkblue: '00008b', darkcyan: '008b8b', darkgoldenrod: 'b8860b',
    darkgray: 'a9a9a9', darkgreen: '006400', darkgrey: 'a9a9a9', darkkhaki: 'bdb76b',
    darkmagenta: '8b008b', darkolivegreen: '556b2f', darkorange: 'ff8c00',
    darkorchid: '9932cc', darkred: '8b0000', darksalmon: 'e9967a', darkseagreen: '8fbc8f',
    darkslateblue: '483d8b', darkslategray: '2f4f4f', darkslategrey: '2f4f4f',
    darkturquoise: '00ced1', darkviolet: '9400d3', deeppink: 'ff1493',
    deepskyblue: '00bfff', dimgray: '696969', dimgrey: '696969', dodgerblue: '1e90ff',
    firebrick: 'b22222', floralwhite: 'fffaf0', forestgreen: '228b22', fuchsia: 'ff00ff',
    gainsboro: 'dcdcdc', ghostwhite: 'f8f8ff', gold: 'ffd700', goldenrod: 'daa520',
    gray: '808080', green: '008000', greenyellow: 'adff2f', grey: '808080',
    honeydew: 'f0fff0', hotpink: 'ff69b4', indianred: 'cd5c5c', indigo: '4b0082',
    ivory: 'fffff0', khaki: 'f0e68c', lavender: 'e6e6fa', lavenderblush: 'fff0f5',
    lawngreen: '7cfc00', lemonchiffon: 'fffacd', lightblue: 'add8e6', lightcoral: 'f08080',
    lightcyan: 'e0ffff', lightgoldenrodyellow: 'fafad2', lightgray: 'd3d3d3',
    lightgreen: '90ee90', lightgrey: 'd3d3d3', lightpink: 'ffb6c1', lightsalmon: 'ffa07a',
    lightseagreen: '20b2aa', lightskyblue: '87cefa', lightslategray: '778899',
    lightslategrey: '778899', lightsteelblue: 'b0c4de', lightyellow: 'ffffe0',
    lime: '00ff00', limegreen: '32cd32', linen: 'faf0e6', magenta: 'ff00ff',
    maroon: '800000', mediumaquamarine: '66cdaa', mediumblue: '0000cd',
    mediumorchid: 'ba55d3', mediumpurple: '9370db', mediumseagreen: '3cb371',
    mediumslateblue: '7b68ee', mediumspringgreen: '00fa9a', mediumturquoise: '48d1cc',
    mediumvioletred: 'c71585', midnightblue: '191970', mintcream: 'f5fffa',
    mistyrose: 'ffe4e1', moccasin: 'ffe4b5', navajowhite: 'ffdead', navy: '000080',
    oldlace: 'fdf5e6', olive: '808000', olivedrab: '6b8e23', orange: 'ffa500',
    orangered: 'ff4500', orchid: 'da70d6', palegoldenrod: 'eee8aa', palegreen: '98fb98',
    paleturquoise: 'afeeee', palevioletred: 'db7093', papayawhip: 'ffefd5',
    peachpuff: 'ffdab9', peru: 'cd853f', pink: 'ffc0cb', plum: 'dda0dd',
    powderblue: 'b0e0e6', purple: '800080', rebeccapurple: '663399', red: 'ff0000',
    rosybrown: 'bc8f8f', royalblue: '4169e1', saddlebrown: '8b4513', salmon: 'fa8072',
    sandybrown: 'f4a460', seagreen: '2e8b57', seashell: 'fff5ee', sienna: 'a0522d',
    silver: 'c0c0c0', skyblue: '87ceeb', slateblue: '6a5acd', slategray: '708090',
    slategrey: '708090', snow: 'fffafa', springgreen: '00ff7f', steelblue: '4682b4',
    tan: 'd2b48c', teal: '008080', thistle: 'd8bfd8', tomato: 'ff6347',
    turquoise: '40e0d0', violet: 'ee82ee', wheat: 'f5deb3', white: 'ffffff',
    whitesmoke: 'f5f5f5', yellow: 'ffff00', yellowgreen: '9acd32'
  };

  function trim(s) {
    return s.replace(/^\s+|\s+$/g, '');
  }

  function clamp01(v) {
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function hexPair(str, i) {
    return parseInt(str.substring(i, i + 2), 16);
  }

  function parseHex(hex) {
    if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
    var r, g, b, a = 1;
    if (hex.length === 3 || hex.length === 4) {
      r = parseInt(hex.charAt(0) + hex.charAt(0), 16);
      g = parseInt(hex.charAt(1) + hex.charAt(1), 16);
      b = parseInt(hex.charAt(2) + hex.charAt(2), 16);
      if (hex.length === 4) a = parseInt(hex.charAt(3) + hex.charAt(3), 16) / 255;
    } else if (hex.length === 6 || hex.length === 8) {
      r = hexPair(hex, 0);
      g = hexPair(hex, 2);
      b = hexPair(hex, 4);
      if (hex.length === 8) a = hexPair(hex, 6) / 255;
    } else {
      return null;
    }
    if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) return null;
    return { r: r / 255, g: g / 255, b: b / 255, a: a };
  }

  function parseComponent(s, max) {
    s = trim(s);
    if (s.charAt(s.length - 1) === '%') {
      return clamp01(parseFloat(s.substring(0, s.length - 1)) / 100) * max;
    }
    return parseFloat(s);
  }

  function hueToRgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }

  function parse(text) {
    if (text === null || text === undefined) return null;
    var s = trim(String(text)).toLowerCase();
    if (s.length === 0) return null;
    if (s === 'none') return { none: true };
    if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    if (s === 'currentcolor') return { currentColor: true };

    if (s.charAt(0) === '#') return parseHex(s.substring(1));

    var m = /^rgba?\(([^)]*)\)$/.exec(s);
    if (m) {
      var parts = m[1].split(/[,\s\/]+/);
      var vals = [];
      for (var i = 0; i < parts.length; i++) {
        if (trim(parts[i]).length > 0) vals[vals.length] = parts[i];
      }
      if (vals.length < 3) return null;
      var r = parseComponent(vals[0], 255) / 255;
      var g = parseComponent(vals[1], 255) / 255;
      var b = parseComponent(vals[2], 255) / 255;
      var a = vals.length > 3 ? parseComponent(vals[3], 1) : 1;
      if (isNaN(r) || isNaN(g) || isNaN(b) || isNaN(a)) return null;
      return { r: clamp01(r), g: clamp01(g), b: clamp01(b), a: clamp01(a) };
    }

    m = /^hsla?\(([^)]*)\)$/.exec(s);
    if (m) {
      var hparts = m[1].split(/[,\s\/]+/);
      var hvals = [];
      for (var j = 0; j < hparts.length; j++) {
        if (trim(hparts[j]).length > 0) hvals[hvals.length] = hparts[j];
      }
      if (hvals.length < 3) return null;
      var h = parseFloat(hvals[0]) / 360;
      h = h - Math.floor(h);
      var sat = parseComponent(hvals[1], 1);
      var lig = parseComponent(hvals[2], 1);
      var al = hvals.length > 3 ? parseComponent(hvals[3], 1) : 1;
      if (isNaN(h) || isNaN(sat) || isNaN(lig) || isNaN(al)) return null;
      var rr, gg, bb;
      if (sat === 0) {
        rr = gg = bb = lig;
      } else {
        var q = lig < 0.5 ? lig * (1 + sat) : lig + sat - lig * sat;
        var p = 2 * lig - q;
        rr = hueToRgb(p, q, h + 1 / 3);
        gg = hueToRgb(p, q, h);
        bb = hueToRgb(p, q, h - 1 / 3);
      }
      return { r: clamp01(rr), g: clamp01(gg), b: clamp01(bb), a: clamp01(al) };
    }

    if (NAMED.hasOwnProperty(s)) return parseHex(NAMED[s]);
    return null;
  }

  return { parse: parse };
})();

// ---- src/core/xml.js ----
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

// ---- src/core/path.js ----
// SVG path data parser. ES3 only.
//
// parse(d) -> { contours: [contour] }
// contour: { closed: bool, points: [ { x, y, ix, iy, ox, oy } ] }
//   ix/iy: absolute incoming bezier control point (from previous anchor)
//   ox/oy: absolute outgoing bezier control point (toward next anchor)
//   Straight segments have controls equal to their anchors (zero tangents).
// All commands are converted to absolute cubics; arcs and quadratics are
// approximated/converted to cubics. Contours split at every M.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.path = (function () {
  var EPS = 1e-9;

  function Scanner(text) {
    this.text = text;
    this.pos = 0;
    this.len = text.length;
  }

  Scanner.prototype.skipSep = function () {
    while (this.pos < this.len) {
      var ch = this.text.charAt(this.pos);
      if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') this.pos++;
      else break;
    }
  };

  Scanner.prototype.atEnd = function () {
    this.skipSep();
    return this.pos >= this.len;
  };

  function isDigit(ch) {
    return ch >= '0' && ch <= '9';
  }

  Scanner.prototype.peekNumberStart = function () {
    this.skipSep();
    var ch = this.text.charAt(this.pos);
    return isDigit(ch) || ch === '+' || ch === '-' || ch === '.';
  };

  Scanner.prototype.fail = function (msg) {
    throw new Error('path parse error at index ' + this.pos + ': ' + msg +
      ' (near "' + this.text.substring(this.pos, this.pos + 12) + '")');
  };

  Scanner.prototype.nextNumber = function () {
    this.skipSep();
    var t = this.text;
    var start = this.pos;
    var p = this.pos;
    var ch = t.charAt(p);
    if (ch === '+' || ch === '-') p++;
    var digitsBefore = 0;
    while (isDigit(t.charAt(p))) { p++; digitsBefore++; }
    var digitsAfter = 0;
    if (t.charAt(p) === '.') {
      p++;
      while (isDigit(t.charAt(p))) { p++; digitsAfter++; }
    }
    if (digitsBefore === 0 && digitsAfter === 0) this.fail('expected number');
    ch = t.charAt(p);
    if (ch === 'e' || ch === 'E') {
      var q = p + 1;
      ch = t.charAt(q);
      if (ch === '+' || ch === '-') q++;
      var expDigits = 0;
      while (isDigit(t.charAt(q))) { q++; expDigits++; }
      if (expDigits > 0) p = q;
    }
    this.pos = p;
    return parseFloat(t.substring(start, p));
  };

  // Arc flags are single characters and may be run together ("011" = 0,1,1-start).
  Scanner.prototype.nextFlag = function () {
    this.skipSep();
    var ch = this.text.charAt(this.pos);
    if (ch !== '0' && ch !== '1') this.fail('expected arc flag');
    this.pos++;
    return ch === '1' ? 1 : 0;
  };

  Scanner.prototype.nextCommand = function () {
    this.skipSep();
    var ch = this.text.charAt(this.pos);
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
      this.pos++;
      return ch;
    }
    return null;
  };

  function Builder() {
    this.contours = [];
    this.points = null; // current contour's points
    this.closedFlag = false;
  }

  Builder.prototype.startContour = function (x, y) {
    this.finishContour();
    this.points = [{ x: x, y: y, ix: x, iy: y, ox: x, oy: y }];
    this.closedFlag = false;
  };

  Builder.prototype.finishContour = function () {
    if (this.points && (this.points.length > 1 || this.closedFlag && this.points.length > 0)) {
      this.contours[this.contours.length] = { closed: this.closedFlag, points: this.points };
    }
    this.points = null;
    this.closedFlag = false;
  };

  Builder.prototype.last = function () {
    return this.points[this.points.length - 1];
  };

  Builder.prototype.lineTo = function (x, y) {
    if (!this.points) this.startContour(0, 0);
    this.points[this.points.length] = { x: x, y: y, ix: x, iy: y, ox: x, oy: y };
  };

  Builder.prototype.cubicTo = function (c1x, c1y, c2x, c2y, x, y) {
    if (!this.points) this.startContour(0, 0);
    var prev = this.last();
    prev.ox = c1x;
    prev.oy = c1y;
    this.points[this.points.length] = { x: x, y: y, ix: c2x, iy: c2y, ox: x, oy: y };
  };

  Builder.prototype.close = function () {
    if (!this.points || this.points.length === 0) return;
    var first = this.points[0];
    var last = this.last();
    var dx = last.x - first.x;
    var dy = last.y - first.y;
    if (this.points.length > 1 && dx * dx + dy * dy < EPS) {
      // merge coincident closing anchor into the first anchor
      first.ix = last.ix;
      first.iy = last.iy;
      this.points.length = this.points.length - 1;
    }
    this.closedFlag = true;
    this.finishContour();
  };

  // --- arc conversion (SVG spec F.6.5/F.6.6) ---
  function arcToCubics(builder, x1, y1, rx, ry, phiDeg, laf, sf, x2, y2) {
    if (Math.abs(x1 - x2) < EPS && Math.abs(y1 - y2) < EPS) return;
    rx = Math.abs(rx);
    ry = Math.abs(ry);
    if (rx < EPS || ry < EPS) {
      builder.lineTo(x2, y2);
      return;
    }
    var phi = (phiDeg % 360) * Math.PI / 180;
    var cosPhi = Math.cos(phi);
    var sinPhi = Math.sin(phi);
    var dx2 = (x1 - x2) / 2;
    var dy2 = (y1 - y2) / 2;
    var x1p = cosPhi * dx2 + sinPhi * dy2;
    var y1p = -sinPhi * dx2 + cosPhi * dy2;
    var lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    if (lambda > 1) {
      var lam = Math.sqrt(lambda);
      rx *= lam;
      ry *= lam;
    }
    var rx2 = rx * rx;
    var ry2 = ry * ry;
    var num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
    if (num < 0) num = 0;
    var den = rx2 * y1p * y1p + ry2 * x1p * x1p;
    var coef = den < EPS ? 0 : Math.sqrt(num / den);
    if (laf === sf) coef = -coef;
    var cxp = coef * rx * y1p / ry;
    var cyp = -coef * ry * x1p / rx;
    var cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
    var cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

    function angle(ux, uy, vx, vy) {
      var dot = ux * vx + uy * vy;
      var lenp = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
      var v = dot / lenp;
      if (v > 1) v = 1;
      if (v < -1) v = -1;
      var a = Math.acos(v);
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    }

    var theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
    var dtheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
    var TWO_PI = Math.PI * 2;
    if (!sf && dtheta > 0) dtheta -= TWO_PI;
    if (sf && dtheta < 0) dtheta += TWO_PI;

    var segs = Math.ceil(Math.abs(dtheta) / (Math.PI / 2));
    if (segs === 0) return;
    var delta = dtheta / segs;
    var k = 4 / 3 * Math.tan(delta / 4);

    function pointAt(theta) {
      var px = rx * Math.cos(theta);
      var py = ry * Math.sin(theta);
      return [cx + cosPhi * px - sinPhi * py, cy + sinPhi * px + cosPhi * py];
    }
    function derivAt(theta) {
      var px = -rx * Math.sin(theta);
      var py = ry * Math.cos(theta);
      return [cosPhi * px - sinPhi * py, sinPhi * px + cosPhi * py];
    }

    var theta = theta1;
    for (var i = 0; i < segs; i++) {
      var thetaNext = theta + delta;
      var p0 = pointAt(theta);
      var p3 = pointAt(thetaNext);
      var d0 = derivAt(theta);
      var d3 = derivAt(thetaNext);
      // snap segment endpoints to the exact command endpoints
      if (i === 0) { p0 = [x1, y1]; }
      if (i === segs - 1) { p3 = [x2, y2]; }
      builder.cubicTo(
        p0[0] + k * d0[0], p0[1] + k * d0[1],
        p3[0] - k * d3[0], p3[1] - k * d3[1],
        p3[0], p3[1]
      );
      theta = thetaNext;
    }
  }

  function parse(d) {
    var scanner = new Scanner(String(d === null || d === undefined ? '' : d));
    var builder = new Builder();
    var cx = 0, cy = 0;         // current point
    var sx = 0, sy = 0;         // subpath start
    var lastCmd = null;
    var lastC2x = 0, lastC2y = 0; // last cubic control2 (for S)
    var lastQx = 0, lastQy = 0;   // last quad control (for T)
    var afterClose = false;

    function ensureContour() {
      // after Z, drawing continues from the subpath start in a new contour
      if (afterClose || !builder.points) {
        builder.startContour(cx, cy);
        afterClose = false;
      }
    }

    while (!scanner.atEnd()) {
      var cmd = scanner.nextCommand();
      if (cmd === null) {
        if (lastCmd === null) scanner.fail('expected command');
        // implicit command repetition
        cmd = lastCmd;
        if (cmd === 'M') cmd = 'L';
        if (cmd === 'm') cmd = 'l';
        // Z takes no arguments, so trailing data after Z can never be
        // consumed as a repetition - that's malformed path data.
        if (cmd === 'Z' || cmd === 'z') scanner.fail('unexpected data after Z');
      }
      var rel = cmd >= 'a' && cmd <= 'z';
      var CMD = rel ? cmd.toUpperCase() : cmd;
      var x, y, x1, y1, x2, y2;

      if (CMD === 'M') {
        x = scanner.nextNumber();
        y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        cx = x; cy = y; sx = x; sy = y;
        afterClose = false;
        builder.startContour(x, y);
      } else if (CMD === 'L') {
        x = scanner.nextNumber();
        y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        ensureContour();
        builder.lineTo(x, y);
        cx = x; cy = y;
      } else if (CMD === 'H') {
        x = scanner.nextNumber();
        if (rel) x += cx;
        ensureContour();
        builder.lineTo(x, cy);
        cx = x;
      } else if (CMD === 'V') {
        y = scanner.nextNumber();
        if (rel) y += cy;
        ensureContour();
        builder.lineTo(cx, y);
        cy = y;
      } else if (CMD === 'C') {
        x1 = scanner.nextNumber(); y1 = scanner.nextNumber();
        x2 = scanner.nextNumber(); y2 = scanner.nextNumber();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x1 += cx; y1 += cy; x2 += cx; y2 += cy; x += cx; y += cy; }
        ensureContour();
        builder.cubicTo(x1, y1, x2, y2, x, y);
        lastC2x = x2; lastC2y = y2;
        cx = x; cy = y;
      } else if (CMD === 'S') {
        x2 = scanner.nextNumber(); y2 = scanner.nextNumber();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x2 += cx; y2 += cy; x += cx; y += cy; }
        var prevWasCubic = lastCmd !== null && /[CcSs]/.test(lastCmd);
        x1 = prevWasCubic ? 2 * cx - lastC2x : cx;
        y1 = prevWasCubic ? 2 * cy - lastC2y : cy;
        ensureContour();
        builder.cubicTo(x1, y1, x2, y2, x, y);
        lastC2x = x2; lastC2y = y2;
        cx = x; cy = y;
      } else if (CMD === 'Q') {
        x1 = scanner.nextNumber(); y1 = scanner.nextNumber();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x1 += cx; y1 += cy; x += cx; y += cy; }
        ensureContour();
        builder.cubicTo(
          cx + 2 / 3 * (x1 - cx), cy + 2 / 3 * (y1 - cy),
          x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y),
          x, y
        );
        lastQx = x1; lastQy = y1;
        cx = x; cy = y;
      } else if (CMD === 'T') {
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        var prevWasQuad = lastCmd !== null && /[QqTt]/.test(lastCmd);
        x1 = prevWasQuad ? 2 * cx - lastQx : cx;
        y1 = prevWasQuad ? 2 * cy - lastQy : cy;
        ensureContour();
        builder.cubicTo(
          cx + 2 / 3 * (x1 - cx), cy + 2 / 3 * (y1 - cy),
          x + 2 / 3 * (x1 - x), y + 2 / 3 * (y1 - y),
          x, y
        );
        lastQx = x1; lastQy = y1;
        cx = x; cy = y;
      } else if (CMD === 'A') {
        var rx = scanner.nextNumber();
        var ry = scanner.nextNumber();
        var rot = scanner.nextNumber();
        var laf = scanner.nextFlag();
        var sf = scanner.nextFlag();
        x = scanner.nextNumber(); y = scanner.nextNumber();
        if (rel) { x += cx; y += cy; }
        ensureContour();
        arcToCubics(builder, cx, cy, rx, ry, rot, laf, sf, x, y);
        cx = x; cy = y;
      } else if (CMD === 'Z') {
        builder.close();
        cx = sx; cy = sy;
        afterClose = true;
      }
      lastCmd = cmd;
    }
    builder.finishContour();
    return { contours: builder.contours };
  }

  // Exact bounding box of contours (accounts for bezier extrema).
  function bounds(contours) {
    var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    function acc(x, y) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    function cubicAxisExtrema(p0, p1, p2, p3, cb) {
      // derivative: 3[(p1-p0) + 2t(p2-2p1+p0) + t^2(p3-3p2+3p1-p0)]
      var a = p3 - 3 * p2 + 3 * p1 - p0;
      var b = 2 * (p2 - 2 * p1 + p0);
      var c = p1 - p0;
      var ts = [];
      if (Math.abs(a) < EPS) {
        if (Math.abs(b) > EPS) ts[ts.length] = -c / b;
      } else {
        var disc = b * b - 4 * a * c;
        if (disc >= 0) {
          var sq = Math.sqrt(disc);
          ts[ts.length] = (-b + sq) / (2 * a);
          ts[ts.length] = (-b - sq) / (2 * a);
        }
      }
      for (var i = 0; i < ts.length; i++) {
        var t = ts[i];
        if (t > 0 && t < 1) {
          var mt = 1 - t;
          cb(mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3);
        }
      }
    }
    for (var cj = 0; cj < contours.length; cj++) {
      var cpts = contours[cj].points;
      var m = cpts.length;
      for (var j = 0; j < m; j++) {
        var pp = cpts[j];
        acc(pp.x, pp.y);
        var last = j === m - 1;
        if (last && !contours[cj].closed) continue;
        var qq = cpts[last ? 0 : j + 1];
        cubicAxisExtrema(pp.x, pp.ox, qq.ix, qq.x, function (vx) {
          if (vx < minX) minX = vx;
          if (vx > maxX) maxX = vx;
        });
        cubicAxisExtrema(pp.y, pp.oy, qq.iy, qq.y, function (vy) {
          if (vy < minY) minY = vy;
          if (vy > maxY) maxY = vy;
        });
      }
    }
    if (minX === Infinity) return null;
    return { minX: minX, minY: minY, maxX: maxX, maxY: maxY };
  }

  return { parse: parse, bounds: bounds };
})();

// ---- src/core/shapes.js ----
// SVG shape primitives -> contours (same format as SVGSPLIT.path). ES3 only.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.shapes = (function () {
  // Circle kappa: control-point offset factor for a 90-degree bezier arc.
  var KAPPA = 0.5522847498307936;

  function num(attrs, name, fallback) {
    var v = attrs[name];
    if (v === undefined || v === null || v === '') return fallback;
    var f = parseFloat(v);
    return isNaN(f) ? fallback : f;
  }

  function pt(x, y) {
    return { x: x, y: y, ix: x, iy: y, ox: x, oy: y };
  }

  // Full ellipse as 4 bezier quadrants, starting at (cx+rx, cy), clockwise
  // in the SVG y-down coordinate system.
  function ellipseContour(cx, cy, rx, ry) {
    var kx = rx * KAPPA;
    var ky = ry * KAPPA;
    var p0 = pt(cx + rx, cy);
    var p1 = pt(cx, cy + ry);
    var p2 = pt(cx - rx, cy);
    var p3 = pt(cx, cy - ry);
    p0.ox = cx + rx; p0.oy = cy + ky; p0.ix = cx + rx; p0.iy = cy - ky;
    p1.ix = cx + kx; p1.iy = cy + ry; p1.ox = cx - kx; p1.oy = cy + ry;
    p2.ix = cx - rx; p2.iy = cy + ky; p2.ox = cx - rx; p2.oy = cy - ky;
    p3.ix = cx - kx; p3.iy = cy - ry; p3.ox = cx + kx; p3.oy = cy - ry;
    return { closed: true, points: [p0, p1, p2, p3] };
  }

  function rectContours(attrs) {
    var x = num(attrs, 'x', 0);
    var y = num(attrs, 'y', 0);
    var w = num(attrs, 'width', 0);
    var h = num(attrs, 'height', 0);
    if (w <= 0 || h <= 0) return [];
    var rx = num(attrs, 'rx', -1);
    var ry = num(attrs, 'ry', -1);
    if (rx < 0 && ry >= 0) rx = ry;
    if (ry < 0 && rx >= 0) ry = rx;
    if (rx < 0) rx = 0;
    if (ry < 0) ry = 0;
    if (rx > w / 2) rx = w / 2;
    if (ry > h / 2) ry = h / 2;

    if (rx === 0 || ry === 0) {
      return [{
        closed: true,
        points: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)]
      }];
    }

    var kx = rx * KAPPA;
    var ky = ry * KAPPA;
    // clockwise from top-left corner end
    var pts = [];
    function add(px, py, inx, iny, outx, outy) {
      var p = pt(px, py);
      p.ix = inx; p.iy = iny; p.ox = outx; p.oy = outy;
      pts[pts.length] = p;
    }
    add(x + rx, y, x + rx - kx, y, x + rx, y); // top-left arc end
    add(x + w - rx, y, x + w - rx, y, x + w - rx + kx, y); // top-right arc start
    add(x + w, y + ry, x + w, y + ry - ky, x + w, y + ry);
    add(x + w, y + h - ry, x + w, y + h - ry, x + w, y + h - ry + ky);
    add(x + w - rx, y + h, x + w - rx + kx, y + h, x + w - rx, y + h);
    add(x + rx, y + h, x + rx, y + h, x + rx - kx, y + h);
    add(x, y + h - ry, x, y + h - ry + ky, x, y + h - ry);
    add(x, y + ry, x, y + ry, x, y + ry - ky);
    return [{ closed: true, points: pts }];
  }

  function circleContours(attrs) {
    var r = num(attrs, 'r', 0);
    if (r <= 0) return [];
    return [ellipseContour(num(attrs, 'cx', 0), num(attrs, 'cy', 0), r, r)];
  }

  function ellipseContours(attrs) {
    var rx = num(attrs, 'rx', 0);
    var ry = num(attrs, 'ry', 0);
    if (rx <= 0 || ry <= 0) return [];
    return [ellipseContour(num(attrs, 'cx', 0), num(attrs, 'cy', 0), rx, ry)];
  }

  function lineContours(attrs) {
    return [{
      closed: false,
      points: [
        pt(num(attrs, 'x1', 0), num(attrs, 'y1', 0)),
        pt(num(attrs, 'x2', 0), num(attrs, 'y2', 0))
      ]
    }];
  }

  function parsePoints(text) {
    var out = [];
    if (!text) return out;
    var pieces = text.replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
    for (var i = 0; i + 1 < pieces.length; i += 2) {
      var px = parseFloat(pieces[i]);
      var py = parseFloat(pieces[i + 1]);
      if (!isNaN(px) && !isNaN(py)) out[out.length] = pt(px, py);
    }
    return out;
  }

  function polylineContours(attrs, close) {
    var pts = parsePoints(attrs.points);
    if (pts.length < 2) return [];
    return [{ closed: !!close, points: pts }];
  }

  // Returns contours for a drawable primitive element, or null when the
  // element name is not a primitive this module handles.
  function contoursFor(name, attrs) {
    if (name === 'rect') return rectContours(attrs);
    if (name === 'circle') return circleContours(attrs);
    if (name === 'ellipse') return ellipseContours(attrs);
    if (name === 'line') return lineContours(attrs);
    if (name === 'polyline') return polylineContours(attrs, false);
    if (name === 'polygon') return polylineContours(attrs, true);
    return null;
  }

  return {
    contoursFor: contoursFor,
    ellipseContour: ellipseContour,
    parsePoints: parsePoints
  };
})();

// ---- src/core/style.js ----
// Style resolution: presentation attributes, inline style="", and a minimal
// <style> sheet (single simple selectors: tag / .class / #id), with SVG
// inheritance semantics. ES3 only.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.style = (function () {
  function trim(s) {
    return s.replace(/^\s+|\s+$/g, '');
  }

  // Properties we track. inherit: SVG 1.1 inheritance flag.
  var PROPS = {
    'fill': { inherit: true, initial: 'black' },
    'fill-opacity': { inherit: true, initial: '1' },
    'fill-rule': { inherit: true, initial: 'nonzero' },
    'stroke': { inherit: true, initial: 'none' },
    'stroke-width': { inherit: true, initial: '1' },
    'stroke-opacity': { inherit: true, initial: '1' },
    'stroke-linecap': { inherit: true, initial: 'butt' },
    'stroke-linejoin': { inherit: true, initial: 'miter' },
    'stroke-miterlimit': { inherit: true, initial: '4' },
    'stroke-dasharray': { inherit: true, initial: 'none' },
    'stroke-dashoffset': { inherit: true, initial: '0' },
    'color': { inherit: true, initial: 'black' },
    'clip-rule': { inherit: true, initial: 'nonzero' },
    'visibility': { inherit: true, initial: 'visible' },
    'opacity': { inherit: false, initial: '1' },
    'display': { inherit: false, initial: 'inline' },
    'mix-blend-mode': { inherit: false, initial: 'normal' },
    'font-family': { inherit: true, initial: '' },
    'font-size': { inherit: true, initial: '16' },
    'font-weight': { inherit: true, initial: '400' },
    'font-style': { inherit: true, initial: 'normal' },
    'letter-spacing': { inherit: true, initial: '0' }
  };

  var PROP_NAMES = [
    'fill', 'fill-opacity', 'fill-rule',
    'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
    'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset',
    'color', 'clip-rule', 'visibility', 'opacity', 'display', 'mix-blend-mode',
    'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing'
  ];

  function parseInline(styleText) {
    var out = {};
    if (!styleText) return out;
    var decls = styleText.split(';');
    for (var i = 0; i < decls.length; i++) {
      var idx = decls[i].indexOf(':');
      if (idx === -1) continue;
      var key = trim(decls[i].substring(0, idx)).toLowerCase();
      var val = trim(decls[i].substring(idx + 1));
      if (key.length > 0 && val.length > 0) out[key] = val;
    }
    return out;
  }

  // Minimal stylesheet parser. Returns { rules: [...], warnings: [...] }.
  // rule: { sel: {kind: 'tag'|'class'|'id', name: str}, decls: {..}, order: n }
  function parseSheet(cssText) {
    var rules = [];
    var warnings = [];
    if (!cssText) return { rules: rules, warnings: warnings };
    var text = cssText.replace(/\/\*[\s\S]*?\*\//g, '');
    var re = /([^{}]+)\{([^{}]*)\}/g;
    var m;
    var order = 0;
    while ((m = re.exec(text)) !== null) {
      var decls = parseInline(m[2]);
      var selectors = m[1].split(',');
      for (var i = 0; i < selectors.length; i++) {
        var sel = trim(selectors[i]);
        if (sel.length === 0) continue;
        var rule = null;
        if (/^\.[\w-]+$/.test(sel)) {
          rule = { kind: 'class', name: sel.substring(1) };
        } else if (/^#[\w-]+$/.test(sel)) {
          rule = { kind: 'id', name: sel.substring(1) };
        } else if (/^[a-zA-Z][\w-]*$/.test(sel)) {
          rule = { kind: 'tag', name: sel.toLowerCase() };
        } else if (sel === '*') {
          rule = { kind: 'tag', name: '*' };
        }
        if (rule) {
          rules[rules.length] = { sel: rule, decls: decls, order: order++ };
        } else {
          warnings[warnings.length] = 'unsupported CSS selector "' + sel + '" ignored';
        }
      }
    }
    return { rules: rules, warnings: warnings };
  }

  function selectorMatches(sel, node) {
    if (sel.kind === 'tag') return sel.name === '*' || sel.name === node.name.toLowerCase();
    if (sel.kind === 'id') return node.attrs.id === sel.name;
    if (sel.kind === 'class') {
      var cls = node.attrs['class'];
      if (!cls) return false;
      var parts = cls.split(/\s+/);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i] === sel.name) return true;
      }
      return false;
    }
    return false;
  }

  function specificity(kind) {
    if (kind === 'id') return 2;
    if (kind === 'class') return 1;
    return 0;
  }

  // Computes the cascaded+inherited style for a node.
  // parentComputed: computed style of the parent (or null at the root).
  // sheet: result of parseSheet (or null).
  function compute(node, parentComputed, sheet) {
    var inline = parseInline(node.attrs.style);
    var out = {};
    for (var i = 0; i < PROP_NAMES.length; i++) {
      var prop = PROP_NAMES[i];
      var meta = PROPS[prop];
      var value = null;

      if (inline.hasOwnProperty(prop)) {
        value = inline[prop];
      } else if (sheet && sheet.rules.length > 0) {
        var best = null;
        var bestScore = -1;
        for (var r = 0; r < sheet.rules.length; r++) {
          var rule = sheet.rules[r];
          if (!rule.decls.hasOwnProperty(prop)) continue;
          if (!selectorMatches(rule.sel, node)) continue;
          var score = specificity(rule.sel.kind) * 100000 + rule.order;
          if (score > bestScore) {
            bestScore = score;
            best = rule.decls[prop];
          }
        }
        if (best !== null) value = best;
      }

      if (value === null && node.attrs.hasOwnProperty(prop)) {
        var attrVal = trim(String(node.attrs[prop]));
        if (attrVal.length > 0) value = attrVal;
      }

      if (value === 'inherit') {
        // explicit 'inherit' takes the parent value even for
        // non-inherited properties
        value = parentComputed ? parentComputed[prop] : meta.initial;
      } else if (value === null) {
        if (meta.inherit && parentComputed) {
          value = parentComputed[prop];
        } else {
          value = meta.initial;
        }
      }
      out[prop] = value;
    }
    return out;
  }

  // "2" | "2px" -> 2 ; anything unparseable -> fallback
  function parseLength(value, fallback) {
    if (value === null || value === undefined) return fallback;
    var m = /^\s*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*(px)?\s*$/.exec(String(value));
    if (!m) return fallback;
    return parseFloat(m[1]);
  }

  // dasharray -> array of numbers or null for 'none'/invalid.
  // Per spec an odd count is repeated to make it even.
  function parseDashArray(value) {
    if (!value || value === 'none') return null;
    var pieces = trim(String(value)).split(/[\s,]+/);
    var nums = [];
    for (var i = 0; i < pieces.length; i++) {
      var n = parseLength(pieces[i], NaN);
      if (isNaN(n) || n < 0) return null; // spec: any negative -> render as none
      nums[nums.length] = n;
    }
    if (nums.length === 0) return null;
    if (nums.length % 2 === 1) nums = nums.concat(nums);
    var allZero = true;
    for (var j = 0; j < nums.length; j++) {
      if (nums[j] > 0) allZero = false;
    }
    return allZero ? null : nums;
  }

  return {
    compute: compute,
    parseInline: parseInline,
    parseSheet: parseSheet,
    parseLength: parseLength,
    parseDashArray: parseDashArray,
    PROP_NAMES: PROP_NAMES
  };
})();

// ---- src/core/scene.js ----
// Scene builder: walks a parsed SVG document and produces flat,
// AE-agnostic layer specs with world-space (comp-space) geometry.
// ES3 only.
//
// SVGSPLIT.scene.build(svgText, opts) -> {
//   width, height,
//   layers: [layerSpec],      // document order (first = bottom in AE)
//   tree:   [node]|null,      // set only in 'nested' split mode (see below)
//   warnings: [string]
// }
//
// In 'nested' split mode the builder additionally returns `tree`: the root
// comp's children in document order, where each Figma group (<g>) becomes a
// groupNode and each drawable/text a layerSpec. `layers` still holds the flat
// list of every leaf layer (used for counts/progress). The AE builder turns
// each groupNode into a precomposition.
//   groupNode: { type:'group', name, children:[node], effects:[effect],
//                blendMode: string|null, opacity: number(0..1), warnings:[string] }
//
// layerSpec: {
//   name, kind: 'shape'|'text',
//   items: [item],            // document order (first = painted first)
//   textRuns: [run]|null,
//   effects: [effect],
//   blendMode: string|null,
//   bbox: {minX,minY,maxX,maxY},
//   warnings: [string]
// }
// item: {
//   name, contours, fillRule ('nonzero'|'evenodd'),
//   fill:   null|paint, stroke: null|strokeSpec,
//   clips:  [ [contour] ]     // baked clip contour sets to merge-intersect
// }
// paint: {type:'solid', color:{r,g,b}, opacity}
//      | {type:'gradient', kind:'linear'|'radial', stops:[{offset,color,opacity}],
//         start:[x,y], end:[x,y], hilite:{length,angleDeg}|null}
//      | {type:'placeholder'}   // unsupported paint (image/pattern)

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.scene = (function () {
  var matrix = SVGSPLIT.matrix;
  var colorMod = SVGSPLIT.color;
  var xmlMod = SVGSPLIT.xml;
  var pathMod = SVGSPLIT.path;
  var shapesMod = SVGSPLIT.shapes;
  var styleMod = SVGSPLIT.style;

  var DRAWABLES = {
    path: 1, rect: 1, circle: 1, ellipse: 1, line: 1, polyline: 1, polygon: 1
  };
  // element names that never render as part of the tree walk
  var NON_RENDERED = {
    defs: 1, style: 1, title: 1, desc: 1, metadata: 1, symbol: 1, marker: 1,
    clipPath: 1, mask: 1, linearGradient: 1, radialGradient: 1, pattern: 1,
    filter: 1, script: 1
  };

  function localName(node) {
    var n = node.name;
    var idx = n.indexOf(':');
    return idx === -1 ? n : n.substring(idx + 1);
  }

  function isElement(node) {
    return node.type === 'element';
  }

  function textContent(node) {
    var out = '';
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.type === 'text') out += c.text;
      else if (c.type === 'element') out += textContent(c);
    }
    return out;
  }

  function attrOr(node, name, fallback) {
    var v = node.attrs[name];
    return v === undefined || v === null || v === '' ? fallback : v;
  }

  function hrefOf(node) {
    var h = node.attrs['href'];
    if (h === undefined) h = node.attrs['xlink:href'];
    return h;
  }

  function urlRefId(value) {
    if (!value) return null;
    var m = /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value);
    return m ? m[1] : null;
  }

  function transformContours(contours, m) {
    var out = [];
    for (var i = 0; i < contours.length; i++) {
      var src = contours[i].points;
      var pts = [];
      for (var j = 0; j < src.length; j++) {
        var p = src[j];
        var a = matrix.apply(m, p.x, p.y);
        var bIn = matrix.apply(m, p.ix, p.iy);
        var bOut = matrix.apply(m, p.ox, p.oy);
        pts[pts.length] = { x: a[0], y: a[1], ix: bIn[0], iy: bIn[1], ox: bOut[0], oy: bOut[1] };
      }
      out[out.length] = { closed: contours[i].closed, points: pts };
    }
    return out;
  }

  function boundsUnion(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      minX: a.minX < b.minX ? a.minX : b.minX,
      minY: a.minY < b.minY ? a.minY : b.minY,
      maxX: a.maxX > b.maxX ? a.maxX : b.maxX,
      maxY: a.maxY > b.maxY ? a.maxY : b.maxY
    };
  }

  // True when contours form a single axis-aligned rectangle (no curves).
  function rectOf(contours) {
    if (contours.length !== 1) return null;
    var c = contours[0];
    if (!c.closed || c.points.length !== 4) return null;
    for (var i = 0; i < 4; i++) {
      var p = c.points[i];
      if (p.ix !== p.x || p.iy !== p.y || p.ox !== p.x || p.oy !== p.y) return null;
    }
    var xs = [c.points[0].x, c.points[1].x, c.points[2].x, c.points[3].x];
    var ys = [c.points[0].y, c.points[1].y, c.points[2].y, c.points[3].y];
    // each x must appear exactly twice for an axis-aligned rect
    xs.sort(function (u, v) { return u - v; });
    ys.sort(function (u, v) { return u - v; });
    if (xs[0] !== xs[1] || xs[2] !== xs[3] || ys[0] !== ys[1] || ys[2] !== ys[3]) return null;
    if (xs[0] === xs[2] || ys[0] === ys[2]) return null;
    return { minX: xs[0], minY: ys[0], maxX: xs[2], maxY: ys[2] };
  }

  function bboxInside(inner, outer, eps) {
    if (!inner || !outer) return false;
    if (eps === undefined) eps = 0.01;
    return inner.minX >= outer.minX - eps && inner.minY >= outer.minY - eps &&
      inner.maxX <= outer.maxX + eps && inner.maxY <= outer.maxY + eps;
  }

  // ---------- gradient parsing ----------

  function parseOffset(v) {
    if (v === undefined || v === null || v === '') return 0;
    var s = String(v);
    var isPct = s.charAt(s.length - 1) === '%';
    var f = parseFloat(s);
    if (isNaN(f)) return 0;
    if (isPct) f /= 100;
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    return f;
  }

  function gradientStops(gradNode, defs, depth) {
    var stops = [];
    for (var i = 0; i < gradNode.children.length; i++) {
      var c = gradNode.children[i];
      if (!isElement(c) || localName(c) !== 'stop') continue;
      var inline = styleMod.parseInline(c.attrs.style);
      var colorStr = inline['stop-color'] || attrOr(c, 'stop-color', '#000');
      var opacityStr = inline['stop-opacity'] || attrOr(c, 'stop-opacity', '1');
      var col = colorMod.parse(colorStr);
      if (!col || col.none || col.currentColor) col = { r: 0, g: 0, b: 0, a: 1 };
      var op = parseFloat(opacityStr);
      if (isNaN(op)) op = 1;
      stops[stops.length] = {
        offset: parseOffset(c.attrs.offset),
        color: { r: col.r, g: col.g, b: col.b },
        opacity: op * col.a
      };
    }
    if (stops.length === 0 && depth < 4) {
      var href = hrefOf(gradNode);
      if (href && href.charAt(0) === '#') {
        var target = defs[href.substring(1)];
        if (target) return gradientStops(target, defs, depth + 1);
      }
    }
    // enforce non-decreasing offsets (spec)
    var maxSeen = 0;
    for (var j = 0; j < stops.length; j++) {
      if (stops[j].offset < maxSeen) stops[j].offset = maxSeen;
      else maxSeen = stops[j].offset;
    }
    return stops;
  }

  function lenOf(vx, vy) {
    return Math.sqrt(vx * vx + vy * vy);
  }

  // Resolve a gradient def to a baked paint.
  // ctm: element's full CTM; userBBox: element bbox in its own user space;
  // viewport: [width, height] for percentage coordinates.
  function resolveGradient(gradNode, defs, ctm, userBBox, warn, viewport) {
    var kind = localName(gradNode) === 'radialGradient' ? 'radial' : 'linear';
    var stops = gradientStops(gradNode, defs, 0);
    if (stops.length === 0) {
      warn('gradient "' + attrOr(gradNode, 'id', '?') + '" has no stops; using black');
      stops = [{ offset: 0, color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
    }
    if (stops.length === 1) {
      return { type: 'solid', color: stops[0].color, opacity: stops[0].opacity };
    }
    var units = attrOr(gradNode, 'gradientUnits', 'objectBoundingBox');
    var m = ctm;
    if (units === 'objectBoundingBox') {
      if (!userBBox) {
        warn('objectBoundingBox gradient on element without geometry; using black fill');
        return { type: 'solid', color: stops[0].color, opacity: stops[0].opacity };
      }
      m = matrix.multiply(ctm, [
        userBBox.maxX - userBBox.minX, 0, 0,
        userBBox.maxY - userBBox.minY, userBBox.minX, userBBox.minY
      ]);
    }
    var gt = matrix.parse(gradNode.attrs.gradientTransform);
    m = matrix.multiply(m, gt);

    var spread = attrOr(gradNode, 'spreadMethod', 'pad');
    if (spread !== 'pad') {
      warn('gradient spreadMethod="' + spread + '" not supported; treating as pad');
    }

    var isObb = units === 'objectBoundingBox';

    // Gradient coordinate: percentages (and the spec's percentage DEFAULTS,
    // passed as fractions) resolve against the bbox for objectBoundingBox
    // units, or against the user-unit viewport for userSpaceOnUse.
    function gradCoord(attrName, defFraction, viewportSize) {
      var v = gradNode.attrs[attrName];
      if (v === undefined || v === null || v === '') {
        return isObb ? defFraction : defFraction * viewportSize;
      }
      var s = String(v);
      var f = parseFloat(s);
      if (isNaN(f)) return isObb ? defFraction : defFraction * viewportSize;
      if (s.indexOf('%') !== -1) return isObb ? f / 100 : f / 100 * viewportSize;
      return f;
    }
    var vpW = viewport[0];
    var vpH = viewport[1];
    var vpDiag = Math.sqrt((vpW * vpW + vpH * vpH) / 2);

    // spec defaults: x1=0% y1=0% x2=100% y2=0%; cx=cy=r=50%; fx/fy default to cx/cy
    if (kind === 'linear') {
      var x1 = gradCoord('x1', 0, vpW);
      var y1 = gradCoord('y1', 0, vpH);
      var x2 = gradCoord('x2', 1, vpW);
      var y2 = gradCoord('y2', 0, vpH);
      var start = matrix.apply(m, x1, y1);
      var end = matrix.apply(m, x2, y2);
      return { type: 'gradient', kind: 'linear', stops: stops, start: start, end: end, hilite: null };
    }

    // radial
    var cx = gradCoord('cx', 0.5, vpW);
    var cy = gradCoord('cy', 0.5, vpH);
    var r = gradCoord('r', 0.5, vpDiag);
    var fx = gradNode.attrs.fx === undefined ? cx : gradCoord('fx', 0.5, vpW);
    var fy = gradNode.attrs.fy === undefined ? cy : gradCoord('fy', 0.5, vpH);
    var center = matrix.apply(m, cx, cy);
    var rp1 = matrix.apply(m, cx + r, cy);
    var rp2 = matrix.apply(m, cx, cy + r);
    var rA = lenOf(rp1[0] - center[0], rp1[1] - center[1]);
    var rB = lenOf(rp2[0] - center[0], rp2[1] - center[1]);
    var radius = (rA + rB) / 2;
    if (radius > 0 && Math.abs(rA - rB) / radius > 0.01) {
      warn('elliptical radial gradient approximated as circular (radii ' +
        rA.toFixed(1) + ' vs ' + rB.toFixed(1) + ')');
    }
    var hilite = null;
    if (fx !== cx || fy !== cy) {
      var f = matrix.apply(m, fx, fy);
      var flen = lenOf(f[0] - center[0], f[1] - center[1]);
      if (radius > 0 && flen > 1e-6) {
        hilite = {
          length: flen / radius,
          angleDeg: Math.atan2(f[1] - center[1], f[0] - center[0]) * 180 / Math.PI
        };
      }
    }
    return {
      type: 'gradient', kind: 'radial', stops: stops,
      start: center, end: [center[0] + radius, center[1]], hilite: hilite
    };
  }

  // ---------- filter decoding (Figma signatures) ----------

  function parseColorMatrixValues(text) {
    if (!text) return null;
    var pieces = text.replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
    if (pieces.length !== 20) return null;
    var vals = [];
    for (var i = 0; i < 20; i++) {
      var f = parseFloat(pieces[i]);
      if (isNaN(f)) return null;
      vals[vals.length] = f;
    }
    return vals;
  }

  // Returns { effects: [...], warnings: [...] }
  // Figma chains multiple effects in one filter (id like filter0_dd_...) -
  // each drop-shadow chain ends in a feBlend, so the accumulator resets there.
  function decodeFilter(filterNode) {
    var prims = [];
    for (var i = 0; i < filterNode.children.length; i++) {
      if (isElement(filterNode.children[i])) prims[prims.length] = filterNode.children[i];
    }
    var effects = [];
    var warnings = [];
    var fid = attrOr(filterNode, 'id', '?');

    var hasBlur = false;
    var lastStd = 0;
    var innerCount = 0;
    var chain = null;

    function freshChain() {
      return {
        dx: 0, dy: 0, std: 0, hasOffset: false, hasCompositeOut: false,
        inner: false, morph: false,
        color: { r: 0, g: 0, b: 0 }, opacity: 1
      };
    }
    chain = freshChain();

    function flushChain() {
      if (chain.inner) {
        innerCount++;
      } else if (chain.hasOffset || chain.hasCompositeOut) {
        effects[effects.length] = {
          type: 'dropShadow', dx: chain.dx, dy: chain.dy, stdDeviation: chain.std,
          color: chain.color, opacity: chain.opacity
        };
        if (chain.morph) {
          warnings[warnings.length] = 'shadow spread (feMorphology, filter #' + fid + ') approximated without spread';
        }
      }
      chain = freshChain();
    }

    for (var p = 0; p < prims.length; p++) {
      var prim = prims[p];
      var pname = localName(prim);
      if (pname === 'feOffset') {
        chain.hasOffset = true;
        chain.dx = parseFloat(attrOr(prim, 'dx', '0')) || 0;
        chain.dy = parseFloat(attrOr(prim, 'dy', '0')) || 0;
      } else if (pname === 'feGaussianBlur') {
        hasBlur = true;
        var sd = String(attrOr(prim, 'stdDeviation', '0')).replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
        chain.std = parseFloat(sd[0]) || 0;
        lastStd = chain.std;
      } else if (pname === 'feComposite') {
        var op = attrOr(prim, 'operator', 'over');
        if (op === 'out') chain.hasCompositeOut = true;
        if (op === 'arithmetic' && parseFloat(attrOr(prim, 'k2', '0')) === -1) chain.inner = true;
      } else if (pname === 'feColorMatrix') {
        if (attrOr(prim, 'in', '') !== 'SourceAlpha') {
          var vals = parseColorMatrixValues(prim.attrs.values);
          if (vals) {
            chain.color = { r: vals[4], g: vals[9], b: vals[14] };
            chain.opacity = vals[18];
          }
        }
      } else if (pname === 'feMorphology') {
        chain.morph = true;
      } else if (pname === 'feDropShadow') {
        var fc = colorMod.parse(attrOr(prim, 'flood-color', 'black'));
        var fo = parseFloat(attrOr(prim, 'flood-opacity', '1'));
        effects[effects.length] = {
          type: 'dropShadow',
          dx: parseFloat(attrOr(prim, 'dx', '2')) || 0,
          dy: parseFloat(attrOr(prim, 'dy', '2')) || 0,
          stdDeviation: parseFloat(attrOr(prim, 'stdDeviation', '2')) || 0,
          color: fc && !fc.none ? { r: fc.r, g: fc.g, b: fc.b } : { r: 0, g: 0, b: 0 },
          opacity: (isNaN(fo) ? 1 : fo) * (fc && fc.a !== undefined ? fc.a : 1)
        };
      } else if (pname === 'feBlend') {
        flushChain();
      }
    }
    flushChain();

    if (innerCount > 0) {
      warnings[warnings.length] = 'inner shadow (filter #' + fid + ') not supported; skipped';
    }
    if (effects.length === 0 && innerCount === 0 && hasBlur) {
      // background blur renders as a plain blur warning; foreground blur converts
      if (/_b_|backgroundBlur/.test(fid) || filterHasBackgroundBlurResult(prims)) {
        warnings[warnings.length] = 'background blur (filter #' + fid + ') not supported; skipped';
      } else {
        effects[effects.length] = { type: 'gaussianBlur', stdDeviation: lastStd };
      }
    } else if (effects.length === 0 && innerCount === 0 && prims.length > 0) {
      warnings[warnings.length] = 'filter #' + fid + ' not recognized; skipped';
    }
    return { effects: effects, warnings: warnings };
  }

  function filterHasBackgroundBlurResult(prims) {
    for (var i = 0; i < prims.length; i++) {
      if (/backgroundBlur/.test(attrOr(prims[i], 'result', ''))) return true;
    }
    return false;
  }

  // ---------- main walk ----------

  function build(svgText, opts) {
    opts = opts || {};
    var splitMode = 'toplevel';
    if (opts.splitMode === 'leaf') splitMode = 'leaf';
    else if (opts.splitMode === 'nested') splitMode = 'nested';
    var globalWarnings = [];

    function warnGlobal(msg) {
      globalWarnings[globalWarnings.length] = msg;
    }

    var root = xmlMod.parse(svgText);
    if (localName(root) !== 'svg') {
      throw new Error('root element is <' + root.name + '>, expected <svg>');
    }

    // ----- viewport -----
    var vb = null;
    if (root.attrs.viewBox) {
      var vbParts = root.attrs.viewBox.replace(/^[\s,]+|[\s,]+$/g, '').split(/[\s,]+/);
      if (vbParts.length === 4) {
        vb = [parseFloat(vbParts[0]), parseFloat(vbParts[1]), parseFloat(vbParts[2]), parseFloat(vbParts[3])];
        if (isNaN(vb[0]) || isNaN(vb[1]) || vb[2] <= 0 || vb[3] <= 0) vb = null;
      }
    }
    function attrLen(name) {
      var v = root.attrs[name];
      if (!v || String(v).indexOf('%') !== -1) return null;
      var f = parseFloat(v);
      return isNaN(f) || f <= 0 ? null : f;
    }
    var attrW = attrLen('width');
    var attrH = attrLen('height');
    var width, height;
    var rootMatrix = matrix.identity();
    if (vb) {
      width = attrW !== null ? attrW : vb[2];
      height = attrH !== null ? attrH : vb[3];
      var sx = width / vb[2];
      var sy = height / vb[3];
      if (Math.abs(sx - sy) > 1e-6) {
        // preserveAspectRatio default is uniform 'meet'; Figma always matches, guard rail only
        var s = sx < sy ? sx : sy;
        warnGlobal('svg width/height aspect differs from viewBox; using uniform scale');
        sx = s; sy = s;
      }
      rootMatrix = matrix.multiply(matrix.scale(sx, sy), matrix.translate(-vb[0], -vb[1]));
    } else {
      width = attrW !== null ? attrW : 300;
      height = attrH !== null ? attrH : 150;
      if (attrW === null || attrH === null) warnGlobal('svg has no usable viewBox/width/height; defaulting viewport');
    }

    // ----- defs index + stylesheet -----
    var defs = {};
    var cssTexts = [];
    (function indexTree(node) {
      if (node.attrs.id !== undefined && node.attrs.id !== '') {
        if (defs[node.attrs.id] === undefined) defs[node.attrs.id] = node;
      }
      if (localName(node) === 'style') cssTexts[cssTexts.length] = textContent(node);
      for (var i = 0; i < node.children.length; i++) {
        if (isElement(node.children[i])) indexTree(node.children[i]);
      }
    })(root);
    var sheet = styleMod.parseSheet(cssTexts.join('\n'));
    for (var w = 0; w < sheet.warnings.length; w++) warnGlobal(sheet.warnings[w]);

    var viewBoxBounds = { minX: 0, minY: 0, maxX: width, maxY: height };

    // viewport in USER units (pre-rootMatrix): percentage lengths and
    // userSpaceOnUse gradient defaults resolve against these, not comp pixels.
    var userW = vb ? vb[2] : width;
    var userH = vb ? vb[3] : height;
    var userDiag = Math.sqrt((userW * userW + userH * userH) / 2);

    // Resolve a clip-path reference into baked contour sets.
    // Returns {contoursSets: [contours], unclipped: bool(viewBox no-op)} or null.
    function resolveClip(refId, ctm, warn) {
      var clipNode = defs[refId];
      if (!clipNode || localName(clipNode) !== 'clipPath') {
        warn('clip-path #' + refId + ' not found; ignored');
        return null;
      }
      if (attrOr(clipNode, 'clipPathUnits', 'userSpaceOnUse') !== 'userSpaceOnUse') {
        warn('clipPathUnits="objectBoundingBox" not supported; clip #' + refId + ' ignored');
        return null;
      }
      var contours = [];
      var clipWarn = [];
      (function walkClip(node, m, depth) {
        if (depth > 16) {
          clipWarn[clipWarn.length] = 'clipPath #' + refId + ' nests <use> too deeply (cycle?); truncated';
          return;
        }
        for (var i = 0; i < node.children.length; i++) {
          var c = node.children[i];
          if (!isElement(c)) continue;
          var cm = matrix.multiply(m, matrix.parse(c.attrs.transform));
          var name = localName(c);
          var got = null;
          if (name === 'path') got = pathMod.parse(attrOr(c, 'd', '')).contours;
          else if (DRAWABLES[name]) got = shapesMod.contoursFor(name, c.attrs);
          else if (name === 'use') {
            var href = hrefOf(c);
            var target = href && href.charAt(0) === '#' ? defs[href.substring(1)] : null;
            if (target) {
              var um = matrix.multiply(cm, matrix.translate(
                parseFloat(attrOr(c, 'x', '0')) || 0, parseFloat(attrOr(c, 'y', '0')) || 0));
              walkClip({ children: [target], attrs: {} }, um, depth + 1);
            }
            continue;
          } else if (name === 'g') {
            walkClip(c, cm, depth + 1);
            continue;
          } else {
            clipWarn[clipWarn.length] = 'unsupported element <' + name + '> in clipPath #' + refId;
            continue;
          }
          if (got && got.length > 0) {
            var baked = transformContours(got, cm);
            for (var b = 0; b < baked.length; b++) contours[contours.length] = baked[b];
          }
          if ((c.attrs['clip-rule'] || '') === 'evenodd' || /clip-rule\s*:\s*evenodd/.test(attrOr(c, 'style', ''))) {
            clipWarn[clipWarn.length] = 'clip-rule="evenodd" in clipPath #' + refId + ' may merge differently in AE';
          }
        }
      })(clipNode, matrix.multiply(ctm, matrix.parse(clipNode.attrs.transform)), 0);
      for (var cw = 0; cw < clipWarn.length; cw++) warn(clipWarn[cw]);
      if (contours.length === 0) {
        warn('clipPath #' + refId + ' has no usable geometry; clip ignored');
        return null;
      }
      return contours;
    }

    // A clip whose merged geometry is a rect covering the whole viewBox is a no-op.
    function clipIsViewBoxNoop(clipContours) {
      var r = rectOf(clipContours);
      return r !== null && bboxInside(viewBoxBounds, r, 0.51);
    }

    function resolvePaint(paintStr, computed, ctm, userBBox, warn) {
      if (!paintStr || paintStr === 'none') return null;
      var refId = urlRefId(paintStr);
      if (refId !== null) {
        var def = defs[refId];
        if (!def) {
          warn('paint reference #' + refId + ' not found; skipped');
          return null;
        }
        var defName = localName(def);
        if (defName === 'linearGradient' || defName === 'radialGradient') {
          return resolveGradient(def, defs, ctm, userBBox, warn, [userW, userH]);
        }
        if (defName === 'pattern') {
          warn('image/pattern fill #' + refId + ' not supported; using gray placeholder');
          return { type: 'placeholder' };
        }
        warn('unsupported paint reference <' + defName + '> #' + refId + '; skipped');
        return null;
      }
      var col = colorMod.parse(paintStr);
      if (!col) {
        warn('unparseable paint "' + paintStr + '"; skipped');
        return null;
      }
      if (col.none) return null;
      if (col.currentColor) {
        col = colorMod.parse(computed.color);
        if (!col || col.none || col.currentColor) col = { r: 0, g: 0, b: 0, a: 1 };
      }
      return { type: 'solid', color: { r: col.r, g: col.g, b: col.b }, opacity: col.a };
    }

    // ---- item collection ----
    // ctx: { m, style, opacity, clips, name, depth }
    function collectItems(node, ctx, sink) {
      if (!isElement(node)) return;
      var name = localName(node);
      if (NON_RENDERED[name]) return;

      var computed = styleMod.compute(node, ctx.style, sheet);
      if (computed.display === 'none') return;

      var m = matrix.multiply(ctx.m, matrix.parse(node.attrs.transform));
      var opacity = ctx.opacity * clampOpacity(computed.opacity);

      var clips = ctx.clips;
      var clipRef = urlRefId(node.attrs['clip-path'] || styleMod.parseInline(node.attrs.style)['clip-path']);
      if (clipRef !== null) {
        var clipContours = resolveClip(clipRef, m, sink.warn);
        if (clipContours && !clipIsViewBoxNoop(clipContours)) {
          clips = clips.concat([clipContours]);
        }
      }

      if (node.attrs.mask !== undefined || styleMod.parseInline(node.attrs.style).mask) {
        sink.warn('mask on <' + name + (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
          '> not supported; content imported unmasked');
      }

      var ownEffects = [];
      var filterRef = urlRefId(node.attrs.filter || styleMod.parseInline(node.attrs.style).filter);
      if (filterRef !== null) {
        var filterNode = defs[filterRef];
        if (filterNode && localName(filterNode) === 'filter') {
          var decoded = decodeFilter(filterNode);
          for (var dw = 0; dw < decoded.warnings.length; dw++) sink.warn(decoded.warnings[dw]);
          for (var de = 0; de < decoded.effects.length; de++) {
            sink.effect(decoded.effects[de]);
            ownEffects[ownEffects.length] = decoded.effects[de];
          }
        } else {
          sink.warn('filter #' + filterRef + ' not found; ignored');
        }
      }

      var blend = computed['mix-blend-mode'];
      if (blend && blend !== 'normal') sink.blend(blend);

      var childCtx = {
        m: m, style: computed, opacity: opacity, clips: clips,
        name: node.attrs.id || ctx.name, depth: ctx.depth,
        // effects/blend scoped to this subtree - consumed by leaf split mode
        effects: ownEffects.length > 0 ? ctx.effects.concat(ownEffects) : ctx.effects,
        blend: blend && blend !== 'normal' ? blend : ctx.blend
      };

      if (name === 'g' || name === 'svg' || name === 'a') {
        if (name === 'svg' && node !== root) {
          sink.warn('nested <svg> treated as group (inner viewBox ignored)');
        }
        if (opacity < 1 && countRenderedChildren(node) > 1) {
          sink.warn('group opacity ' + computed.opacity + ' on <g' +
            (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
            '> flattened into children (overlap may differ)');
        }
        for (var i = 0; i < node.children.length; i++) {
          collectItems(node.children[i], childCtx, sink);
        }
        return;
      }

      if (name === 'use') {
        if (ctx.depth > 24) {
          sink.warn('<use> nesting too deep; skipped');
          return;
        }
        var href = hrefOf(node);
        var target = href && href.charAt(0) === '#' ? defs[href.substring(1)] : null;
        if (!target) {
          sink.warn('<use> target "' + (href || '') + '" not found; skipped');
          return;
        }
        var ux = parseFloat(attrOr(node, 'x', '0')) || 0;
        var uy = parseFloat(attrOr(node, 'y', '0')) || 0;
        var useCtx = {
          m: matrix.multiply(m, matrix.translate(ux, uy)),
          style: computed, opacity: opacity, clips: clips,
          name: node.attrs.id || ctx.name, depth: ctx.depth + 1,
          effects: childCtx.effects, blend: childCtx.blend
        };
        collectItems(target, useCtx, sink);
        return;
      }

      // hidden leaves render nothing (groups above still recurse because
      // children may set visibility back to visible)
      if (computed.visibility !== 'visible') return;

      if (name === 'text') {
        collectText(node, childCtx, computed, sink);
        return;
      }

      if (name === 'image') {
        sink.warn('<image> not supported; gray placeholder rectangle created');
        var iw = parseFloat(attrOr(node, 'width', '0')) || 0;
        var ih = parseFloat(attrOr(node, 'height', '0')) || 0;
        if (iw > 0 && ih > 0) {
          var rectAttrs = { x: attrOr(node, 'x', '0'), y: attrOr(node, 'y', '0'), width: String(iw), height: String(ih) };
          sink.item(makeItem(node, shapesMod.contoursFor('rect', rectAttrs), m, computed,
            { type: 'placeholder' }, null, opacity, clips, ctx, sink.warn), childCtx);
        }
        return;
      }

      var contours = null;
      if (name === 'path') {
        var d = attrOr(node, 'd', '');
        if (d) {
          try {
            contours = pathMod.parse(d).contours;
          } catch (ePath) {
            sink.warn('bad path data on <path' + (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
              '>: ' + ePath.message + '; element skipped');
            return;
          }
        }
      } else if (DRAWABLES[name]) {
        contours = shapesMod.contoursFor(name, resolvePercentAttrs(node.attrs));
      } else {
        sink.warn('<' + name + '> not supported; skipped');
        return;
      }
      if (!contours || contours.length === 0) return;

      var userBBox = pathMod.bounds(contours);
      var fill = resolvePaint(computed.fill, computed, m, userBBox, sink.warn);
      var stroke = resolvePaint(computed.stroke, computed, m, userBBox, sink.warn);
      sink.item(makeItem(node, contours, m, computed, fill, stroke, opacity, clips, ctx, sink.warn), childCtx);
    }

    // Resolves percentage lengths on shape-primitive attributes against the
    // user-unit viewport (parseFloat alone would read "50%" as 50 units).
    var PCT_X = { x: 1, width: 1, cx: 1, rx: 1, x1: 1, x2: 1 };
    var PCT_Y = { y: 1, height: 1, cy: 1, ry: 1, y1: 1, y2: 1 };
    var PCT_KEYS = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'rx', 'ry', 'x1', 'y1', 'x2', 'y2'];
    function resolvePercentAttrs(attrs) {
      var needs = false;
      var k;
      for (k = 0; k < PCT_KEYS.length; k++) {
        var v0 = attrs[PCT_KEYS[k]];
        if (v0 !== undefined && String(v0).indexOf('%') !== -1) needs = true;
      }
      if (!needs) return attrs;
      var out = {};
      for (k = 0; k < PCT_KEYS.length; k++) {
        var key = PCT_KEYS[k];
        var v = attrs[key];
        if (v === undefined) continue;
        var s = String(v);
        if (s.indexOf('%') !== -1) {
          var f = parseFloat(s) / 100;
          var basis = PCT_X[key] ? userW : PCT_Y[key] ? userH : userDiag;
          out[key] = String(f * basis);
        } else {
          out[key] = v;
        }
      }
      if (attrs.points !== undefined) out.points = attrs.points;
      return out;
    }

    function clampOpacity(v) {
      var f = parseFloat(v);
      if (isNaN(f)) return 1;
      if (f < 0) return 0;
      if (f > 1) return 1;
      return f;
    }

    function countRenderedChildren(node) {
      var n = 0;
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (isElement(c) && !NON_RENDERED[localName(c)]) n++;
      }
      return n;
    }

    function makeItem(node, contours, m, computed, fill, stroke, opacity, clips, ctx, warn) {
      var baked = transformContours(contours, m);
      var strokeSpec = null;
      if (stroke) {
        var swScale = matrix.strokeScale(m);
        if (!matrix.isConformal(m, 1e-3)) {
          warn('non-uniform transform on stroked <' + localName(node) +
            (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') + '>; stroke width approximated');
        }
        var dashes = styleMod.parseDashArray(computed['stroke-dasharray']);
        if (dashes) {
          for (var di = 0; di < dashes.length; di++) dashes[di] *= swScale;
        }
        strokeSpec = {
          paint: stroke,
          width: styleMod.parseLength(computed['stroke-width'], 1) * swScale,
          cap: computed['stroke-linecap'],
          join: computed['stroke-linejoin'],
          miterLimit: styleMod.parseLength(computed['stroke-miterlimit'], 4),
          dashes: dashes,
          dashOffset: styleMod.parseLength(computed['stroke-dashoffset'], 0) * swScale,
          opacity: opacity * clampOpacity(computed['stroke-opacity']) * (stroke.opacity !== undefined ? stroke.opacity : 1)
        };
        if (clips.length > 0) {
          warn('stroked element <' + localName(node) +
            (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
            '> is clipped; stroke will follow clipped geometry (may differ from SVG)');
        }
      }
      var fillSpec = null;
      if (fill) {
        fillSpec = {
          paint: fill,
          opacity: opacity * clampOpacity(computed['fill-opacity']) * (fill.opacity !== undefined && fill.type === 'solid' ? fill.opacity : 1)
        };
      }
      return {
        name: node.attrs.id || localName(node),
        contours: baked,
        fillRule: computed['fill-rule'] === 'evenodd' ? 'evenodd' : 'nonzero',
        fill: fillSpec,
        stroke: strokeSpec,
        clips: clips
      };
    }

    function collectText(node, ctx, computed, sink) {
      var runs = [];
      var hasTspan = false;
      for (var i = 0; i < node.children.length; i++) {
        var c = node.children[i];
        if (isElement(c) && localName(c) === 'tspan') {
          hasTspan = true;
          var tspanStyle = styleMod.compute(c, computed, sheet);
          runs[runs.length] = makeRun(textContent(c), c.attrs, node.attrs, tspanStyle, ctx, sink);
        }
      }
      if (!hasTspan) {
        var raw = textContent(node);
        if (raw.replace(/\s+/g, '').length > 0) {
          runs[runs.length] = makeRun(raw, node.attrs, node.attrs, computed, ctx, sink);
        }
      }
      if (runs.length > 0) {
        sink.warn('<text> converted to AE text layer(s); font metrics may differ (Figma usually outlines text on export)');
        for (var r = 0; r < runs.length; r++) sink.text(runs[r]);
      }
    }

    function makeRun(text, attrs, parentAttrs, computed, ctx, sink) {
      var x = parseFloat(attrs.x !== undefined ? attrs.x : parentAttrs.x || '0') || 0;
      var y = parseFloat(attrs.y !== undefined ? attrs.y : parentAttrs.y || '0') || 0;
      var pos = matrix.apply(ctx.m, x, y);
      var col = colorMod.parse(computed.fill);
      if (!col || col.none || col.currentColor) col = { r: 0, g: 0, b: 0, a: 1 };
      var fontScale = matrix.strokeScale(ctx.m);
      return {
        text: text,
        pos: pos,
        fontFamily: computed['font-family'].replace(/^['"]|['"]$/g, ''),
        fontSize: styleMod.parseLength(computed['font-size'], 16) * fontScale,
        fontWeight: computed['font-weight'],
        fontStyle: computed['font-style'],
        letterSpacing: styleMod.parseLength(computed['letter-spacing'], 0) * fontScale,
        color: { r: col.r, g: col.g, b: col.b },
        opacity: ctx.opacity * clampOpacity(computed['fill-opacity']) * col.a
      };
    }

    // ----- determine top-level candidates (with no-op clip wrapper unwrap) -----
    function topLevelCandidates(svgNode) {
      var out = [];
      for (var i = 0; i < svgNode.children.length; i++) {
        var c = svgNode.children[i];
        if (!isElement(c)) continue;
        var name = localName(c);
        if (NON_RENDERED[name]) continue;
        if (name === 'g' && isNoopClipWrapper(c)) {
          var inner = topLevelCandidates(c);
          for (var j = 0; j < inner.length; j++) out[out.length] = inner[j];
          continue;
        }
        out[out.length] = c;
      }
      return out;
    }

    // True when the group carries nothing that affects rendering or
    // inheritance (only an id is allowed) - anything else (transform, filter,
    // mask, class, or ANY presentation attribute incl. visibility/display)
    // makes it a real group that must not be flattened away.
    var WRAPPER_BLOCKING_ATTRS = ['transform', 'filter', 'mask', 'style', 'class']
      .concat(styleMod.PROP_NAMES);
    function hasNoWrapperAttrs(gNode) {
      var attrs = gNode.attrs;
      for (var i = 0; i < WRAPPER_BLOCKING_ATTRS.length; i++) {
        if (attrs[WRAPPER_BLOCKING_ATTRS[i]] !== undefined && attrs[WRAPPER_BLOCKING_ATTRS[i]] !== '') return false;
      }
      return true;
    }

    function isNoopClipWrapper(gNode) {
      // A wrapper is a no-op when its ONLY effect is a viewBox-covering clip.
      if (!hasNoWrapperAttrs(gNode)) return false;
      var clipRef = urlRefId(gNode.attrs['clip-path']);
      if (clipRef === null) return false;
      var silent = function () {};
      var clipContours = resolveClip(clipRef, rootMatrix, silent);
      return clipContours !== null && clipIsViewBoxNoop(clipContours);
    }

    // When the document's only renderable top-level element is a passthrough
    // group (Figma wraps the exported frame in <g id="Frame Name"> when
    // "Include id" is on), split on its children instead - otherwise the
    // whole design becomes a single layer.
    function unwrapSoloWrappers(candidates) {
      var guard = 0;
      while (candidates.length === 1 && guard++ < 16) {
        var only = candidates[0];
        if (localName(only) !== 'g' || !hasNoWrapperAttrs(only)) break;
        var clipRef = urlRefId(only.attrs['clip-path']);
        if (clipRef !== null && !isNoopClipWrapper(only)) break;
        var inner = topLevelCandidates(only);
        if (inner.length === 0) break;
        candidates = inner;
      }
      return candidates;
    }

    // ----- build layers -----
    var layers = [];

    function newLayerAccumulator(fallbackName) {
      var layer = {
        name: fallbackName, kind: 'shape', items: [], textRuns: [],
        effects: [], blendMode: null, bbox: null, warnings: []
      };
      var sink = {
        item: function (item) {
          layer.items[layer.items.length] = item;
          var bb = pathMod.bounds(item.contours);
          if (item.stroke && bb) {
            var half = item.stroke.width / 2;
            bb = { minX: bb.minX - half, minY: bb.minY - half, maxX: bb.maxX + half, maxY: bb.maxY + half };
          }
          layer.bbox = boundsUnion(layer.bbox, bb);
        },
        text: function (run) {
          layer.textRuns[layer.textRuns.length] = run;
        },
        effect: function (e) {
          layer.effects[layer.effects.length] = e;
        },
        blend: function (mode) {
          if (layer.blendMode && layer.blendMode !== mode) {
            layer.warnings[layer.warnings.length] = 'multiple blend modes in one layer; using ' + mode;
          }
          layer.blendMode = mode;
        },
        warn: function (msg) {
          layer.warnings[layer.warnings.length] = msg;
        }
      };
      return { layer: layer, sink: sink };
    }

    var candidates = unwrapSoloWrappers(topLevelCandidates(root));
    var rootStyle = styleMod.compute(root, null, sheet);
    var baseCtx = {
      m: rootMatrix, style: rootStyle, opacity: 1, clips: [],
      name: null, depth: 0, effects: [], blend: null
    };

    var tree = null;

    if (splitMode === 'toplevel') {
      for (var ci = 0; ci < candidates.length; ci++) {
        var cand = candidates[ci];
        var acc = newLayerAccumulator(cand.attrs.id || localName(cand) + ' ' + (ci + 1));
        collectItems(cand, baseCtx, acc.sink);
        finishLayer(acc.layer);
      }
    } else if (splitMode === 'leaf') {
      // leaf mode: every produced item/text run becomes its own layer
      for (var li = 0; li < candidates.length; li++) {
        var leafCand = candidates[li];
        var counter = { n: 0 };
        collectItemsLeafMode(leafCand, baseCtx, leafCand.attrs.id || localName(leafCand) + ' ' + (li + 1), counter);
      }
    } else {
      // nested mode: preserve the Figma group hierarchy as a tree. Each <g>
      // becomes a groupNode (a precomp downstream); each drawable/text becomes
      // its own layerSpec. Group opacity/blend/effects live on the groupNode.
      tree = [];
      var groupCtx = { m: baseCtx.m, style: baseCtx.style, clips: baseCtx.clips };
      for (var gi = 0; gi < candidates.length; gi++) {
        buildNestedNode(candidates[gi], groupCtx, tree);
      }
    }

    // Build 0+ nodes from an element into `outChildren`, preserving order.
    function buildNestedNode(node, gctx, outChildren) {
      if (!isElement(node)) return;
      var name = localName(node);
      if (NON_RENDERED[name]) return;

      if (name === 'g' || name === 'svg' || name === 'a') {
        // A no-op clip wrapper contributes nothing; inline its children so it
        // doesn't produce a redundant precomp.
        if (name === 'g' && isNoopClipWrapper(node)) {
          for (var k = 0; k < node.children.length; k++) {
            buildNestedNode(node.children[k], gctx, outChildren);
          }
          return;
        }
        var g = makeGroupNode(node, gctx, name);
        if (g) outChildren[outChildren.length] = g;
        return;
      }

      // Leaf element: reuse collectItems (handles use/image/text/drawables plus
      // the element's own transform/clip/filter/opacity) and emit one layer per
      // produced item/run, in place.
      collectLeafLayers(node, gctx, outChildren);
    }

    function makeGroupNode(node, gctx, name) {
      var computed = styleMod.compute(node, gctx.style, sheet);
      if (computed.display === 'none') return null;

      var m = matrix.multiply(gctx.m, matrix.parse(node.attrs.transform));

      var clips = gctx.clips;
      var clipRef = urlRefId(node.attrs['clip-path'] || styleMod.parseInline(node.attrs.style)['clip-path']);
      if (clipRef !== null) {
        var clipContours = resolveClip(clipRef, m, warnGlobal);
        if (clipContours && !clipIsViewBoxNoop(clipContours)) clips = clips.concat([clipContours]);
      }

      if (node.attrs.mask !== undefined || styleMod.parseInline(node.attrs.style).mask) {
        warnGlobal('mask on group <' + name + (node.attrs.id ? ' id="' + node.attrs.id + '"' : '') +
          '> not supported; content imported unmasked');
      }
      if (name === 'svg' && node !== root) {
        warnGlobal('nested <svg> treated as group/precomp (inner viewBox ignored)');
      }

      var ownEffects = [];
      var filterRef = urlRefId(node.attrs.filter || styleMod.parseInline(node.attrs.style).filter);
      if (filterRef !== null) {
        var filterNode = defs[filterRef];
        if (filterNode && localName(filterNode) === 'filter') {
          var decoded = decodeFilter(filterNode);
          for (var dw = 0; dw < decoded.warnings.length; dw++) warnGlobal(decoded.warnings[dw]);
          ownEffects = decoded.effects;
        } else {
          warnGlobal('filter #' + filterRef + ' not found; ignored');
        }
      }

      var blend = computed['mix-blend-mode'];
      var groupNode = {
        type: 'group',
        name: node.attrs.id || name || 'Group',
        children: [],
        effects: ownEffects,
        blendMode: blend && blend !== 'normal' ? blend : null,
        opacity: clampOpacity(computed.opacity),
        warnings: []
      };

      // Children inherit geometry/clips but NOT opacity/blend/effects: those are
      // realized on the precomp layer, so the leaves must not re-apply them.
      var childCtx = { m: m, style: computed, clips: clips };
      for (var i = 0; i < node.children.length; i++) {
        buildNestedNode(node.children[i], childCtx, groupNode.children);
      }
      if (groupNode.children.length === 0) return null;
      return groupNode;
    }

    // A leaf's own opacity/blend/effects still belong to it, so seed a fresh
    // per-leaf context (opacity 1, no inherited effects/blend) and let
    // collectItems read the element's own presentation attributes.
    function collectLeafLayers(node, gctx, outChildren) {
      var leafCtx = {
        m: gctx.m, style: gctx.style, opacity: 1, clips: gctx.clips,
        name: null, depth: 0, effects: [], blend: null
      };
      var sink = {
        item: function (item, itemCtx) {
          var acc = newLayerAccumulator(item.name);
          acc.layer.effects = itemCtx && itemCtx.effects ? itemCtx.effects.slice() : [];
          acc.layer.blendMode = itemCtx ? itemCtx.blend : null;
          acc.sink.item(item);
          finishLayer(acc.layer, outChildren);
        },
        text: function (run) {
          var acc = newLayerAccumulator(textLayerName(run.text));
          acc.sink.text(run);
          finishLayer(acc.layer, outChildren);
        },
        effect: function () {},
        blend: function () {},
        warn: function (msg) { warnGlobal(msg); }
      };
      collectItems(node, leafCtx, sink);
    }

    function textLayerName(text) {
      var t = String(text || '').replace(/\s+/g, ' ').replace(/^ | $/g, '');
      if (t.length === 0) return 'Text';
      return t.length > 32 ? t.substring(0, 32) : t;
    }

    function collectItemsLeafMode(node, ctx, baseName, counter) {
      // Effects and blend modes are read from the emitting context so they
      // stay scoped to the filtered subtree instead of leaking onto later
      // sibling leaves.
      var sink = {
        item: function (item, itemCtx) {
          counter.n++;
          var acc = newLayerAccumulator(baseName + ' / ' + item.name + ' ' + counter.n);
          acc.layer.effects = acc.layer.effects.concat(itemCtx && itemCtx.effects ? itemCtx.effects : []);
          acc.layer.blendMode = itemCtx ? itemCtx.blend : null;
          acc.sink.item(item);
          finishLayer(acc.layer);
        },
        text: function (run) {
          counter.n++;
          var acc = newLayerAccumulator(baseName + ' / text ' + counter.n);
          acc.sink.text(run);
          finishLayer(acc.layer);
        },
        effect: function () {},
        blend: function () {},
        warn: function (msg) { warnGlobal(msg); }
      };
      collectItems(node, ctx, sink);
    }

    // Registers a finished layer in the flat `layers` list (used for counts and
    // for the flat split modes). When `target` is given (nested mode), the layer
    // is ALSO appended there so it keeps its place in the group's child order.
    function finishLayer(layer, target) {
      var hasContent = layer.items.length > 0 || layer.textRuns.length > 0;
      if (!hasContent) {
        for (var i = 0; i < layer.warnings.length; i++) warnGlobal(layer.warnings[i]);
        return;
      }
      // 'text' only when there is nothing else; a mixed layer keeps its shape
      // items and the builder additionally creates text layers for the runs.
      layer.kind = layer.items.length === 0 ? 'text' : 'shape';
      if (layer.kind === 'shape' && !layer.bbox) {
        layer.bbox = { minX: 0, minY: 0, maxX: width, maxY: height };
      }
      layers[layers.length] = layer;
      if (target) target[target.length] = layer;
    }

    return {
      width: Math.ceil(width),
      height: Math.ceil(height),
      layers: layers,
      tree: tree,
      warnings: globalWarnings
    };
  }

  return { build: build };
})();

// ---- src/ae/grad-canonical.jsx ----
// Canonical AE 2026 gradient-fill preset (Save Animation Preset of a
// G-Fill group), split around its Gradient Color Data XML. Generated by
// tools/gen-grad-template.js - do not edit by hand.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.gradCanonical = {
  head: "RIFX\u0000\u0000\u0016\u00D8FaFXhead\u0000\u0000\u0000\u0010\u0000\u0000\u0000\u0003\u0000\u0000\u0000a\u0000\u0000\u0000\u0005\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0016\u00B4bescbeso\u0000\u0000\u00008\u0000\u0000\u0000\u0001\u0000\u0000\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000x\u0000\u0000\u001E\u0000\u0000\u0000\u0000\u0000\u0004\u0000\u0001\u0000\u0001\u0000d\u0000d?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u00FF\u00FF\u00FF\u00FFLIST\u0000\u0000\u0001<tdsptdot\u0000\u0000\u0000\u0004\u00FF\u00FF\u00FF\u00FFtdpl\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0004LIST\u0000\u0000\u0000@tdsitdix\u0000\u0000\u0000\u0004\u00FF\u00FF\u00FF\u00FFtdmn\u0000\u0000\u0000(ADBE Root Vectors Group\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000@tdsitdix\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Group\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000@tdsitdix\u0000\u0000\u0000\u0004\u00FF\u00FF\u00FF\u00FFtdmn\u0000\u0000\u0000(ADBE Vectors Group\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000@tdsitdix\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdmn\u0000\u0000\u0000(ADBE Vector Graphic - G-Fill\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdsn\u0000\u0000\u0000\u0018Utf8\u0000\u0000\u0000\u000FGradient Fill 1\u0000LIST\u0000\u0000\u0000dtdsptdot\u0000\u0000\u0000\u0004\u00FF\u00FF\u00FF\u00FFtdpl\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001LIST\u0000\u0000\u0000@tdsitdix\u0000\u0000\u0000\u0004\u00FF\u00FF\u00FF\u00FFtdmn\u0000\u0000\u0000(ADBE End of path sentinel\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0014\u0098tdgptdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u0018Utf8\u0000\u0000\u0000\u000FGradient Fill 1\u0000tdmn\u0000\u0000\u0000(ADBE Vector Blend Mode\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00DAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0003tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u0000\u0002\u0000\u0000\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0004\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Composite Order\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00DAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u0000\u0002\u0000\u0000\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0004\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Fill Rule\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00DAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u0000\u0002\u0000\u0000\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0004\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad Type\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00DAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u0000\u0002\u0000\u0000\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0004\u0004\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad Start Pt\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00E2tdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0002\u0000\u000F\u0000\u0003\u00FF\u00FF\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0008\t\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u00000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad End Pt\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00E2tdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0002\u0000\u000F\u0000\u0003\u00FF\u00FF\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0008\t\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u00000@Y\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad HiLite Length\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00FAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0003tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u00FF\u00FF\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0004\u0008\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdum\u0000\u0000\u0000\u0008\u00C0Y\u0000\u0000\u0000\u0000\u0000\u0000tduM\u0000\u0000\u0000\u0008@Y\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad HiLite Angle\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00DAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0003tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u0000\u0002\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0008\t\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad Scale\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0001\"tdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0002\u0000\u0001\u0000\u0000\u00FF\u00FF\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0008\t\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000P@Y\u0000\u0000\u0000\u0000\u0000\u0000@Y\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdum\u0000\u0000\u0000\u0008\u00C0\u00DF@\u0000\u0000\u0000\u0000\u0000tduM\u0000\u0000\u0000\u0008@\u00DF@\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad Rotation\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00DAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u0000\u0002\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0008\t\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Vector Grad Colors\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0007\u00A2GCstLIST\u0000\u0000\u0000\u00B6tdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0007\u0000\u0000\u00FF\u00FF\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0001\u0000\u0008\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0006\u00D8GCkyUtf8\u0000\u0000\u0006\u00CC<?xml version='1.0'?>\n",
  tail: "\ntdmn\u0000\u0000\u0000(ADBE Vector Fill Opacity\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000LIST\u0000\u0000\u0000\u00FAtdbstdsb\u0000\u0000\u0000\u0004\u0000\u0000\u0000\u0001tdsn\u0000\u0000\u0000\u000EUtf8\u0000\u0000\u0000\u0006-_0_/-tdb4\u0000\u0000\u0000|\u00DB\u0099\u0000\u0001\u0000\u0001\u0000\u0000\u00FF\u00FF\u00FF\u00FF\u0000\u0000x\u0000?\u001A6\u00E2\u00EB\u001CC-?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000?\u00F0\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0004\u0008\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000cdat\u0000\u0000\u0000(@Y\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tdum\u0000\u0000\u0000\u0008\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000tduM\u0000\u0000\u0000\u0008@Y\u0000\u0000\u0000\u0000\u0000\u0000tdmn\u0000\u0000\u0000(ADBE Group End\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000<?xpacket begin=\"\u00EF\u00BB\u00BF\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>\n<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"Adobe XMP Core 10.0-c000 25.G.ef72e4e, 2025/06/27-18:54:05        \">\n   <rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\n      <rdf:Description rdf:about=\"\"\n            xmlns:dc=\"http://purl.org/dc/elements/1.1/\"\n            xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\"\n            xmlns:xmpMM=\"http://ns.adobe.com/xap/1.0/mm/\"\n            xmlns:stEvt=\"http://ns.adobe.com/xap/1.0/sType/ResourceEvent#\">\n         <dc:format>application/vnd.adobe.aftereffects.preset-animation</dc:format>\n         <xmp:CreatorTool>Adobe After Effects 2026 (Macintosh)</xmp:CreatorTool>\n         <xmp:CreateDate>2026-07-03T15:06:41-04:00</xmp:CreateDate>\n         <xmp:MetadataDate>2026-07-03T15:06:41-04:00</xmp:MetadataDate>\n         <xmp:ModifyDate>2026-07-03T15:06:41-04:00</xmp:ModifyDate>\n         <xmpMM:InstanceID>xmp.iid:0496777b-39ba-4b50-904d-a17e466e93dd</xmpMM:InstanceID>\n         <xmpMM:DocumentID>xmp.did:0496777b-39ba-4b50-904d-a17e466e93dd</xmpMM:DocumentID>\n         <xmpMM:OriginalDocumentID>xmp.did:0496777b-39ba-4b50-904d-a17e466e93dd</xmpMM:OriginalDocumentID>\n         <xmpMM:History>\n            <rdf:Seq>\n               <rdf:li rdf:parseType=\"Resource\">\n                  <stEvt:action>created</stEvt:action>\n                  <stEvt:instanceID>xmp.iid:0496777b-39ba-4b50-904d-a17e466e93dd</stEvt:instanceID>\n                  <stEvt:when>2026-07-03T15:06:41-04:00</stEvt:when>\n                  <stEvt:softwareAgent>Adobe After Effects 2026 (Macintosh)</stEvt:softwareAgent>\n               </rdf:li>\n            </rdf:Seq>\n         </xmpMM:History>\n      </rdf:Description>\n   </rdf:RDF>\n</x:xmpmeta>\n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                                                                                                    \n                           \n<?xpacket end=\"w\"?>",
  xmlLength: 1717
};

// ---- src/ae/gradients.jsx ----
// Gradient stop injection for shape-layer Gradient Fill / Gradient Stroke.
// AE does not expose 'ADBE Vector Grad Colors' to scripting (NO_VALUE through
// AE 26.x), so stops are written via a generated .ffx preset and applyPreset()
// with the target property selected (technique popularized by Google AEUX).
//
// The preset container is a canonical AE 2026-authored G-Fill group preset
// (src/ae/grad-canonical.jsx, generated by tools/gen-grad-template.js). We
// splice freshly generated Gradient Color Data XML into its Utf8 chunk and
// patch the RIFX ancestor chunk sizes by the length delta. Geometry (type,
// start/end, highlight) is set via normal scripting AFTER the preset applies,
// since the preset also carries those properties.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.aegrad = (function () {
  var MAX_STOPS = 32;
  var tempFfxFile = null;

  // Resample gradient stops down to n evenly spaced entries.
  function resampleStops(stops, n) {
    if (stops.length <= n) return stops;
    var out = [];
    for (var i = 0; i < n; i++) {
      var t = i / (n - 1);
      // clamp outside the stop range (pad semantics), never extrapolate
      var lo = stops[0];
      var hi = stops[0];
      if (t >= stops[stops.length - 1].offset) {
        lo = hi = stops[stops.length - 1];
      } else if (t > stops[0].offset) {
        for (var j = 0; j < stops.length - 1; j++) {
          if (stops[j].offset <= t && stops[j + 1].offset >= t) {
            lo = stops[j];
            hi = stops[j + 1];
            break;
          }
        }
      }
      var span = hi.offset - lo.offset;
      var f = span > 0 ? (t - lo.offset) / span : 0;
      out[out.length] = {
        offset: t,
        color: {
          r: lo.color.r + (hi.color.r - lo.color.r) * f,
          g: lo.color.g + (hi.color.g - lo.color.g) * f,
          b: lo.color.b + (hi.color.b - lo.color.b) * f
        },
        opacity: lo.opacity + (hi.opacity - lo.opacity) * f
      };
    }
    return out;
  }

  function floatXml(v) {
    // match AE's own compact float formatting closely enough
    var s = String(Math.round(v * 100000000) / 100000000);
    return '<float>' + s + '</float>';
  }

  // Generates the Gradient Color Data <prop.map> XML for the given stops,
  // in the exact shape AE 2026 writes (see probe-canonical.ffx).
  function buildStopsXml(stops) {
    var i;
    var alpha = '';
    for (i = 0; i < stops.length; i++) {
      alpha += '<prop.pair>\n<key>Stop-' + i + '</key>\n<prop.list>\n<prop.pair>\n' +
        '<key>Stops Alpha</key>\n<array>\n<array.type><float/></array.type>\n' +
        floatXml(stops[i].offset) + '\n' +
        floatXml(0.5) + '\n' +
        floatXml(stops[i].opacity) + '\n' +
        '</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n';
    }
    var color = '';
    for (i = 0; i < stops.length; i++) {
      color += '<prop.pair>\n<key>Stop-' + i + '</key>\n<prop.list>\n<prop.pair>\n' +
        '<key>Stops Color</key>\n<array>\n<array.type><float/></array.type>\n' +
        floatXml(stops[i].offset) + '\n' +
        floatXml(0.5) + '\n' +
        floatXml(stops[i].color.r) + '\n' +
        floatXml(stops[i].color.g) + '\n' +
        floatXml(stops[i].color.b) + '\n' +
        '<float>1</float>\n' +
        '</array>\n</prop.pair>\n</prop.list>\n</prop.pair>\n';
    }
    var sizeInt = '<prop.pair>\n<key>Stops Size</key>\n' +
      "<int type='unsigned' size='32'>" + stops.length + '</int>\n</prop.pair>\n';
    return "<prop.map version='4'>\n<prop.list>\n<prop.pair>\n" +
      '<key>Gradient Color Data</key>\n<prop.list>\n' +
      '<prop.pair>\n<key>Alpha Stops</key>\n<prop.list>\n' +
      '<prop.pair>\n<key>Stops List</key>\n<prop.list>\n' + alpha +
      '</prop.list>\n</prop.pair>\n' + sizeInt +
      '</prop.list>\n</prop.pair>\n' +
      '<prop.pair>\n<key>Color Stops</key>\n<prop.list>\n' +
      '<prop.pair>\n<key>Stops List</key>\n<prop.list>\n' + color +
      '</prop.list>\n</prop.pair>\n' + sizeInt +
      '</prop.list>\n</prop.pair>\n' +
      '</prop.list>\n</prop.pair>\n' +
      '<prop.pair>\n<key>Gradient Colors</key>\n<string>1.0</string>\n</prop.pair>\n' +
      '</prop.list>\n</prop.map>';
  }

  function be32(v) {
    return String.fromCharCode((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255);
  }

  function readBe32(s, off) {
    return s.charCodeAt(off) * 16777216 + s.charCodeAt(off + 1) * 65536 +
      s.charCodeAt(off + 2) * 256 + s.charCodeAt(off + 3);
  }

  // Builds the complete .ffx byte string for the given stops.
  function buildFfx(stops) {
    var base = SVGSPLIT.gradCanonical;
    var xml = buildStopsXml(stops);
    // keep parity with the canonical XML so RIFF chunk padding stays aligned
    if ((xml.length - base.xmlLength) % 2 !== 0) xml += '\n';
    var delta = xml.length - base.xmlLength;
    var head = base.head;

    if (delta !== 0) {
      // find the ancestor chunk chain containing the XML (walk over head bytes;
      // canonical sizes are correct, so the walk is reliable)
      var target = head.length;
      var sizeOffsets = [];
      function walk(off, end) {
        while (off + 8 <= end) {
          var id = head.substring(off, off + 4);
          if (off + 8 > head.length) return;
          var size = readBe32(head, off + 4);
          var dataStart = off + 8;
          var dataEnd = dataStart + size;
          if (target >= dataStart && target < dataEnd) {
            sizeOffsets[sizeOffsets.length] = off + 4;
            if (id === 'RIFX' || id === 'LIST') walk(dataStart + 4, dataEnd);
            return;
          }
          off = dataEnd + (size % 2);
        }
      }
      // Utf8 leaf: its header sits immediately before the XML
      walk(0, head.length + 1);
      // also patch the Utf8 chunk itself (last 'Utf8' id before XML)
      var utf8Off = head.lastIndexOf('Utf8');
      if (utf8Off !== -1) {
        var found = false;
        for (var k = 0; k < sizeOffsets.length; k++) {
          if (sizeOffsets[k] === utf8Off + 4) found = true;
        }
        if (!found) sizeOffsets[sizeOffsets.length] = utf8Off + 4;
      }
      for (var i = 0; i < sizeOffsets.length; i++) {
        var so = sizeOffsets[i];
        head = head.substring(0, so) + be32(readBe32(head, so) + delta) + head.substring(so + 4);
      }
    }
    return head + xml + base.tail;
  }

  function writeFfx(stops) {
    if (stops.length < 2) return null;
    if (stops.length > MAX_STOPS) stops = resampleStops(stops, MAX_STOPS);
    var data = buildFfx(stops);
    var file = new File(Folder.temp.fsName + '/svg-splitter-grad.ffx');
    file.encoding = 'BINARY';
    if (!file.open('w')) return null;
    file.write(data);
    file.close();
    tempFfxFile = file;
    return file;
  }

  function deselectAll(comp) {
    var sel = comp.selectedProperties;
    for (var i = sel.length - 1; i >= 0; i--) {
      sel[i].selected = false;
    }
    var selLayers = comp.selectedLayers;
    for (var j = selLayers.length - 1; j >= 0; j--) {
      selLayers[j].selected = false;
    }
  }

  // Applies gradient stops + geometry to a freshly created G-Fill/G-Stroke
  // property. Applying the preset REPLACES the property (the old reference
  // becomes invalid), so we re-resolve it from the parent group afterwards.
  // Returns { applied: bool, prop: Property } - prop is the live property to
  // keep using; when applied is false the caller should fall back to solid.
  // paint: scene gradient paint {kind, stops, start, end, hilite}
  // toLayerSpace: function([x,y]) -> [x,y] mapping comp coords to layer coords.
  function apply(comp, layer, gradProp, paint, toLayerSpace, warn) {
    var applied = false;
    if (paint.stops.length > MAX_STOPS) {
      warn('gradient has ' + paint.stops.length + ' stops; resampled to ' + MAX_STOPS);
    }

    var parent = gradProp.parentProperty;
    var propIndex = gradProp.propertyIndex;
    var matchName = gradProp.matchName;

    var ffx = null;
    try {
      ffx = writeFfx(paint.stops);
    } catch (eWrite) {
      ffx = null;
    }
    if (ffx) {
      try {
        deselectAll(comp);
        gradProp.selected = true;
        layer.applyPreset(ffx);
        layer.selected = false;
        applied = true;
      } catch (eApply) {
        warn('gradient preset failed to apply (' + eApply.toString() + '); using first-stop solid');
      }
    } else {
      warn('could not write gradient preset (enable "Allow Scripts to Write Files and Access Network" in Preferences > Scripting & Expressions); using first-stop solid');
    }

    // Re-resolve: the preset apply may have replaced the property.
    var live = null;
    try {
      var candidate = propIndex <= parent.numProperties ? parent.property(propIndex) : null;
      if (candidate !== null && candidate.matchName === matchName) {
        live = candidate;
      } else {
        for (var pi = parent.numProperties; pi >= 1; pi--) {
          if (parent.property(pi).matchName === matchName) {
            live = parent.property(pi);
            break;
          }
        }
      }
    } catch (eResolve) {
      live = null;
    }
    if (live === null) {
      warn('gradient property lost after preset apply; recreating');
      live = parent.addProperty(matchName);
      applied = false;
    }

    // Geometry after the preset so our values win.
    var start = toLayerSpace(paint.start);
    var end = toLayerSpace(paint.end);
    live.property('ADBE Vector Grad Type').setValue(paint.kind === 'radial' ? 2 : 1);
    live.property('ADBE Vector Grad Start Pt').setValue(start);
    live.property('ADBE Vector Grad End Pt').setValue(end);
    if (paint.kind === 'radial' && paint.hilite) {
      try {
        live.property('ADBE Vector Grad HiLite Length').setValue(paint.hilite.length * 100);
        live.property('ADBE Vector Grad HiLite Angle').setValue(paint.hilite.angleDeg);
      } catch (eHilite) {
        warn('radial focal point not applied: ' + eHilite.toString());
      }
    }
    return { applied: applied, prop: live };
  }

  function cleanup() {
    if (tempFfxFile !== null) {
      try {
        tempFfxFile.remove();
      } catch (e) {
        // best effort
      }
      tempFfxFile = null;
    }
  }

  return {
    apply: apply,
    cleanup: cleanup,
    resampleStops: resampleStops,
    buildStopsXml: buildStopsXml,
    buildFfx: buildFfx
  };
})();

// ---- src/ae/builder.jsx ----
// AE-side builder: turns scene layer specs into shape/text layers.

var SVGSPLIT = SVGSPLIT || {};

SVGSPLIT.ae = (function () {
  // Enum values verified empirically by the E2E probe (probe.jsx):
  // line caps/joins 1..3, fill rule 2 = even-odd, merge mode 4 = intersect.
  var CAPS = { butt: 1, round: 2, square: 3 };
  var JOINS = { miter: 1, round: 2, bevel: 3 };
  var FILL_RULE_NONZERO = 1;
  var FILL_RULE_EVENODD = 2;
  var MERGE_MERGE = 1;
  var MERGE_ADD = 2;
  var MERGE_INTERSECT = 4;

  // Empirical render-match factors (calibrated in E2E against Chrome):
  // AE Drop Shadow "Softness" and Gaussian Blur "Blurriness" per SVG stdDeviation.
  var SHADOW_SOFTNESS_PER_STD = 3.0;
  var BLUR_PER_STD = 3.0;

  function blendEnum(cssName) {
    var map = {
      multiply: BlendingMode.MULTIPLY,
      screen: BlendingMode.SCREEN,
      overlay: BlendingMode.OVERLAY,
      darken: BlendingMode.DARKEN,
      lighten: BlendingMode.LIGHTEN,
      'color-dodge': BlendingMode.CLASSIC_COLOR_DODGE,
      'color-burn': BlendingMode.CLASSIC_COLOR_BURN,
      'hard-light': BlendingMode.HARD_LIGHT,
      'soft-light': BlendingMode.SOFT_LIGHT,
      difference: BlendingMode.DIFFERENCE,
      exclusion: BlendingMode.EXCLUSION,
      hue: BlendingMode.HUE,
      saturation: BlendingMode.SATURATION,
      color: BlendingMode.COLOR,
      luminosity: BlendingMode.LUMINOSITY
    };
    return map.hasOwnProperty(cssName) ? map[cssName] : null;
  }

  function contourToShape(contour, offsetX, offsetY) {
    var vertices = [];
    var inT = [];
    var outT = [];
    var pts = contour.points;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      vertices[i] = [p.x - offsetX, p.y - offsetY];
      inT[i] = [p.ix - p.x, p.iy - p.y];
      outT[i] = [p.ox - p.x, p.oy - p.y];
    }
    var shape = new Shape();
    shape.vertices = vertices;
    shape.inTangents = inT;
    shape.outTangents = outT;
    shape.closed = contour.closed;
    return shape;
  }

  function addContour(contents, contour, offsetX, offsetY, nameHint) {
    var prop = contents.addProperty('ADBE Vector Shape - Group');
    if (nameHint) {
      try { prop.name = nameHint; } catch (eName) { /* keep default */ }
    }
    prop.property('ADBE Vector Shape').setValue(contourToShape(contour, offsetX, offsetY));
    return prop;
  }

  // Adds a set of contours as ONE merge-paths operand: a single path directly,
  // or a nested group whose own Merge combines the contours into one compound
  // path (innerMode: MERGE_MERGE preserves subpath/hole structure for shape
  // content, MERGE_ADD unions overlapping clip children).
  function addContourSet(contents, contours, innerMode, nameHint) {
    if (contours.length === 1) {
      addContour(contents, contours[0], 0, 0, nameHint);
      return;
    }
    var group = contents.addProperty('ADBE Vector Group');
    try { group.name = nameHint; } catch (eName) { /* keep default */ }
    var inner = group.property('ADBE Vectors Group');
    for (var i = 0; i < contours.length; i++) {
      addContour(inner, contours[i], 0, 0, null);
    }
    var merge = inner.addProperty('ADBE Vector Filter - Merge');
    merge.property('ADBE Vector Merge Type').setValue(innerMode);
  }

  function setDashes(strokeProp, dashes, dashOffset, warn) {
    if (!dashes || dashes.length === 0) return;
    var dashGroup = strokeProp.property('ADBE Vector Stroke Dashes');
    var pairs = Math.ceil(dashes.length / 2);
    if (pairs > 3) {
      warn('stroke-dasharray has ' + dashes.length + ' values; AE supports 3 dash/gap pairs, truncating');
      pairs = 3;
    }
    for (var i = 0; i < pairs; i++) {
      var dashVal = dashes[i * 2];
      var gapVal = i * 2 + 1 < dashes.length ? dashes[i * 2 + 1] : dashes[i * 2];
      var d = dashGroup.addProperty('ADBE Vector Stroke Dash ' + (i + 1));
      d.setValue(dashVal);
      var g = dashGroup.addProperty('ADBE Vector Stroke Gap ' + (i + 1));
      g.setValue(gapVal);
    }
    if (dashOffset) {
      var off = dashGroup.addProperty('ADBE Vector Stroke Offset');
      off.setValue(dashOffset);
    }
  }

  function solidColorOf(paint) {
    // First-stop color for gradient fallback; direct color for solids.
    if (paint.type === 'gradient') {
      var s = paint.stops[0];
      return [s.color.r, s.color.g, s.color.b];
    }
    if (paint.type === 'placeholder') return [0.5, 0.5, 0.5];
    return [paint.color.r, paint.color.g, paint.color.b];
  }

  function buildShapeLayer(comp, spec, opts, warn) {
    var layer = comp.layers.addShape();
    layer.name = spec.name;
    var contents = layer.property('ADBE Root Vectors Group');

    var cx = (spec.bbox.minX + spec.bbox.maxX) / 2;
    var cy = (spec.bbox.minY + spec.bbox.maxY) / 2;
    // With anchor == position, layer space coincides with comp space, so we
    // subtract the anchor from baked vertices and placement is pixel-exact.
    var transform = layer.property('ADBE Transform Group');
    transform.property('ADBE Anchor Point').setValue([cx, cy]);
    transform.property('ADBE Position').setValue([cx, cy]);

    function toLayerSpace(pt) {
      return [pt[0], pt[1]];
    }

    // addProperty appends to the BOTTOM of the Contents list and lower items
    // render BEHIND - so add groups in reverse document order to keep SVG
    // paint order (later elements in front).
    for (var ii = spec.items.length - 1; ii >= 0; ii--) {
      var item = spec.items[ii];
      var group = contents.addProperty('ADBE Vector Group');
      try { group.name = item.name; } catch (eGname) { /* keep default */ }
      var groupContents = group.property('ADBE Vectors Group');

      var ci;
      if (item.clips.length === 0) {
        for (ci = 0; ci < item.contours.length; ci++) {
          addContour(groupContents, item.contours[ci], 0, 0, null);
        }
      } else {
        // Clip emulation. Merge Paths Intersect consumes ALL paths above it,
        // so multi-contour operands must first be combined into ONE compound
        // path each (in a nested group with its own Merge) - otherwise the
        // item's own subpaths would be intersected with each other.
        addContourSet(groupContents, item.contours, MERGE_MERGE, 'Shape');
        for (var cs = 0; cs < item.clips.length; cs++) {
          // clip children combine as a union per SVG clipping semantics
          addContourSet(groupContents, item.clips[cs], MERGE_ADD, 'Clip');
          var merge = groupContents.addProperty('ADBE Vector Filter - Merge');
          merge.property('ADBE Vector Merge Type').setValue(MERGE_INTERSECT);
        }
      }

      // Stroke first so it renders above the fill (SVG paint order).
      if (item.stroke) {
        var strokePaint = item.stroke.paint;
        var strokeProp;
        var strokeIsGradient = strokePaint.type === 'gradient' && opts.gradients !== 'solid';
        if (strokeIsGradient) {
          strokeProp = groupContents.addProperty('ADBE Vector Graphic - G-Stroke');
          var strokeResult = SVGSPLIT.aegrad.apply(comp, layer, strokeProp, strokePaint, toLayerSpace, warn);
          strokeProp = strokeResult.prop;
          if (!strokeResult.applied) {
            strokeIsGradient = false;
            strokeProp.remove();
          }
        }
        if (!strokeIsGradient) {
          strokeProp = groupContents.addProperty('ADBE Vector Graphic - Stroke');
          strokeProp.property('ADBE Vector Stroke Color').setValue(solidColorOf(strokePaint));
          if (strokePaint.type === 'gradient') warn('gradient stroke fell back to first-stop solid on "' + spec.name + '"');
        }
        strokeProp.property('ADBE Vector Stroke Width').setValue(item.stroke.width);
        strokeProp.property('ADBE Vector Stroke Opacity').setValue(item.stroke.opacity * 100);
        strokeProp.property('ADBE Vector Stroke Line Cap').setValue(CAPS.hasOwnProperty(item.stroke.cap) ? CAPS[item.stroke.cap] : 1);
        var joinKind = JOINS.hasOwnProperty(item.stroke.join) ? item.stroke.join : 'miter';
        strokeProp.property('ADBE Vector Stroke Line Join').setValue(JOINS[joinKind]);
        // Miter Limit is hidden (unsettable) unless the join is Miter.
        if (joinKind === 'miter') {
          strokeProp.property('ADBE Vector Stroke Miter Limit').setValue(item.stroke.miterLimit);
        }
        setDashes(strokeProp, item.stroke.dashes, item.stroke.dashOffset, warn);
      }

      if (item.fill) {
        var fillPaint = item.fill.paint;
        var fillProp;
        var fillIsGradient = fillPaint.type === 'gradient' && opts.gradients !== 'solid';
        if (fillIsGradient) {
          fillProp = groupContents.addProperty('ADBE Vector Graphic - G-Fill');
          var fillResult = SVGSPLIT.aegrad.apply(comp, layer, fillProp, fillPaint, toLayerSpace, warn);
          fillProp = fillResult.prop;
          if (!fillResult.applied) {
            fillIsGradient = false;
            fillProp.remove();
          }
        }
        if (!fillIsGradient) {
          fillProp = groupContents.addProperty('ADBE Vector Graphic - Fill');
          fillProp.property('ADBE Vector Fill Color').setValue(solidColorOf(fillPaint));
          if (fillPaint.type === 'gradient') warn('gradient fill fell back to first-stop solid on "' + spec.name + '"');
        }
        fillProp.property('ADBE Vector Fill Opacity').setValue(item.fill.opacity * 100);
        try {
          fillProp.property('ADBE Vector Fill Rule').setValue(
            item.fillRule === 'evenodd' ? FILL_RULE_EVENODD : FILL_RULE_NONZERO);
        } catch (eRule) {
          // G-Fill exposes the same property; if missing, non-zero default stands
          if (item.fillRule === 'evenodd') warn('could not set even-odd fill rule on "' + spec.name + '"');
        }
      }
    }
    return layer;
  }

  function buildTextLayers(comp, spec, warn) {
    var created = [];
    for (var i = 0; i < spec.textRuns.length; i++) {
      var run = spec.textRuns[i];
      var layer = comp.layers.addText(run.text);
      layer.name = spec.name + (spec.textRuns.length > 1 ? ' ' + (i + 1) : '');
      var textProp = layer.property('ADBE Text Properties').property('ADBE Text Document');
      var doc = textProp.value;
      doc.fontSize = run.fontSize;
      doc.fillColor = [run.color.r, run.color.g, run.color.b];
      if (run.fontFamily) {
        try {
          doc.font = run.fontFamily;
        } catch (eFont) {
          warn('font "' + run.fontFamily + '" not found; using default');
        }
      }
      try {
        doc.tracking = run.letterSpacing && run.fontSize > 0 ? run.letterSpacing / run.fontSize * 1000 : 0;
      } catch (eTrack) { /* older AE */ }
      textProp.setValue(doc);
      // AE text layers anchor at the baseline start - same as the SVG x/y.
      layer.property('ADBE Transform Group').property('ADBE Position').setValue([run.pos[0], run.pos[1]]);
      layer.property('ADBE Transform Group').property('ADBE Opacity').setValue(run.opacity * 100);
      created[created.length] = layer;
    }
    return created;
  }

  function addEffects(layer, spec, warn) {
    for (var i = 0; i < spec.effects.length; i++) {
      var fx = spec.effects[i];
      var parade = layer.property('ADBE Effect Parade');
      if (fx.type === 'dropShadow') {
        var shadow = parade.addProperty('ADBE Drop Shadow');
        shadow.property('ADBE Drop Shadow-0001').setValue([fx.color.r, fx.color.g, fx.color.b, 1]);
        shadow.property('ADBE Drop Shadow-0002').setValue(fx.opacity * 255);
        var angle = 90 + Math.atan2(fx.dy, fx.dx) * 180 / Math.PI;
        shadow.property('ADBE Drop Shadow-0003').setValue(angle);
        shadow.property('ADBE Drop Shadow-0004').setValue(Math.sqrt(fx.dx * fx.dx + fx.dy * fx.dy));
        shadow.property('ADBE Drop Shadow-0005').setValue(fx.stdDeviation * SHADOW_SOFTNESS_PER_STD);
      } else if (fx.type === 'gaussianBlur') {
        var blur = parade.addProperty('ADBE Gaussian Blur 2');
        blur.property('ADBE Gaussian Blur 2-0001').setValue(fx.stdDeviation * BLUR_PER_STD);
      }
    }
  }

  // Builds one shape/text layer from a leaf layer spec and applies its own
  // blend mode, effects, and per-layer warnings. Returns the created layer.
  function buildOneLayer(comp, spec, opts, warn) {
    var layer = null;
    // A spec can carry both shape items and text runs (e.g. a Figma frame with
    // a background shape and live text) - build both.
    if (spec.items.length > 0) {
      layer = buildShapeLayer(comp, spec, opts, warn);
    }
    if (spec.textRuns.length > 0) {
      var textLayers = buildTextLayers(comp, spec, warn);
      if (!layer) layer = textLayers.length > 0 ? textLayers[0] : null;
    }
    if (layer) {
      if (spec.blendMode) {
        var be = blendEnum(spec.blendMode);
        if (be !== null) layer.blendingMode = be;
        else warn('blend mode "' + spec.blendMode + '" not mapped; left normal');
      }
      addEffects(layer, spec, warn);
    }
    for (var wi = 0; wi < spec.warnings.length; wi++) {
      warn('[' + spec.name + '] ' + spec.warnings[wi]);
    }
    return layer;
  }

  // Keeps precomp names unique in the project panel so repeated Figma group
  // names ("Group", "Icon") don't all collapse to one confusing entry.
  function uniqueName(base, counts) {
    base = base || 'Group';
    if (!counts.hasOwnProperty(base)) {
      counts[base] = 1;
      return base;
    }
    counts[base]++;
    return base + ' ' + counts[base];
  }

  // Builds a nested-mode child list into `comp`, in document order. AE adds
  // each new layer at the TOP of the stack, so iterating first->last leaves the
  // last (front-most in SVG paint order) on top - matching the source.
  function buildChildren(comp, children, scene, opts, warn, progress, total, counts) {
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (child.type === 'group') {
        buildGroupComp(comp, child, scene, opts, warn, progress, total, counts);
      } else {
        progress.n++;
        if (opts.onProgress) opts.onProgress(progress.n, total, child.name);
        buildOneLayer(comp, child, opts, warn);
      }
    }
  }

  // Turns a Figma group node into a precomposition (same size as the root comp,
  // so world-space geometry lands pixel-exact when the precomp layer is centered
  // in its parent) and adds it as a layer carrying the group's blend/opacity/fx.
  function buildGroupComp(parentComp, groupNode, scene, opts, warn, progress, total, counts) {
    var pre = app.project.items.addComp(
      uniqueName(groupNode.name, counts),
      Math.max(scene.width, 4),
      Math.max(scene.height, 4),
      1.0,
      opts.duration || 10,
      opts.frameRate || 30
    );
    buildChildren(pre, groupNode.children, scene, opts, warn, progress, total, counts);

    var layer = parentComp.layers.add(pre);
    if (groupNode.blendMode) {
      var be = blendEnum(groupNode.blendMode);
      if (be !== null) layer.blendingMode = be;
      else warn('blend mode "' + groupNode.blendMode + '" on group "' + groupNode.name + '" not mapped; left normal');
    }
    if (groupNode.opacity !== undefined && groupNode.opacity < 1) {
      layer.property('ADBE Transform Group').property('ADBE Opacity').setValue(groupNode.opacity * 100);
    }
    if (groupNode.effects && groupNode.effects.length > 0) {
      addEffects(layer, { effects: groupNode.effects }, warn);
    }
    return layer;
  }

  // scene: result of SVGSPLIT.scene.build
  // opts: { newComp: bool, compName: str, duration: sec, frameRate: fps,
  //         gradients: 'ffx'|'solid', onProgress: fn(i,total,name)|null }
  // Returns { comp, layerCount, warnings: [str] }
  function buildComp(scene, opts) {
    opts = opts || {};
    var warnings = [];
    function warn(msg) {
      warnings[warnings.length] = msg;
    }

    var totalLayers = scene.layers.length;
    if (totalLayers === 0) {
      throw new Error('No convertible layers found in this SVG.');
    }
    if (totalLayers > 400 && opts.confirmLarge) {
      if (!opts.confirmLarge(totalLayers)) {
        throw new Error('Import cancelled (' + totalLayers + ' layers).');
      }
    }

    var comp;
    app.beginUndoGroup('SVG Splitter Import');
    try {
      if (opts.newComp === false && app.project.activeItem instanceof CompItem) {
        comp = app.project.activeItem;
      } else {
        comp = app.project.items.addComp(
          opts.compName || 'SVG Import',
          Math.max(scene.width, 4),
          Math.max(scene.height, 4),
          1.0,
          opts.duration || 10,
          opts.frameRate || 30
        );
      }

      if (scene.tree) {
        // nested mode: build the group hierarchy as precomps into the root comp
        buildChildren(comp, scene.tree, scene, opts, warn, { n: 0 }, totalLayers, {});
      } else {
        for (var i = 0; i < scene.layers.length; i++) {
          var spec = scene.layers[i];
          if (opts.onProgress) opts.onProgress(i + 1, totalLayers, spec.name);
          buildOneLayer(comp, spec, opts, warn);
        }
      }
    } finally {
      SVGSPLIT.aegrad.cleanup();
      app.endUndoGroup();
    }
    for (var gw = 0; gw < scene.warnings.length; gw++) {
      warnings[warnings.length] = scene.warnings[gw];
    }
    return { comp: comp, layerCount: totalLayers, warnings: warnings };
  }

  // Capability probe: can scripts write files? "Full gradients" writes a temp
  // .ffx preset (src/ae/gradients.jsx), which AE gates behind Preferences >
  // Scripting & Expressions > "Allow Scripts to Write Files and Access Network".
  // A real temp write is version-proof and predicts the exact operation the
  // gradient path needs, unlike reading a pref key that can change across AE
  // versions. Returns true if a tiny temp file can be written (and removed).
  function canWriteFiles() {
    try {
      var f = new File(Folder.temp.fsName + '/svg-splitter-probe.tmp');
      f.encoding = 'UTF-8';
      if (!f.open('w')) return false;
      f.write('ok');
      f.close();
      var ok = f.exists;
      try { f.remove(); } catch (eRm) {}
      return ok;
    } catch (e) {
      return false;
    }
  }

  // Reads an SVG from disk and imports it. Entry point shared by the panel
  // and the E2E harness.
  function importFile(path, opts) {
    opts = opts || {};
    var file = new File(path);
    if (!file.exists) throw new Error('File not found: ' + path);
    file.encoding = 'UTF-8';
    if (!file.open('r')) throw new Error('Cannot open: ' + path);
    var text = file.read();
    file.close();
    var scene = SVGSPLIT.scene.build(text, { splitMode: opts.splitMode || 'toplevel' });
    if (!opts.compName) {
      opts.compName = decodeURIComponent(file.name).replace(/\.svg$/i, '');
    }
    return buildComp(scene, opts);
  }

  return { buildComp: buildComp, importFile: importFile, canWriteFiles: canWriteFiles };
})();

// ---- src/ae/panel.jsx ----
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

$.global.SVGSPLIT = SVGSPLIT;

})(this);
