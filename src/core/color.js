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
