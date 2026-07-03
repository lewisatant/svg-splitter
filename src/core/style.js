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

      if (value === 'inherit') value = null;

      if (value === null) {
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
    parseDashArray: parseDashArray
  };
})();
