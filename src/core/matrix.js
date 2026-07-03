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
