/* Ownwords Lite: word diff. Works in the browser (window.OW) and under Node. */
(function (root) {
  'use strict';

  var OW = root.OW = root.OW || {};

  // Tokens: paragraph break, single newline, horizontal whitespace run,
  // a word (letters, digits, underscore, inner apostrophes), or one punctuation char.
  var TOKEN_RE = /\n{2,}|\n|[^\S\n]+|[\p{L}\p{N}_]+(?:['’][\p{L}\p{N}_]+)*|[^\s]/gu;
  var MAX_CELLS = 25e6;

  function norm(s) {
    return s == null ? '' : String(s).replace(/\r\n?/g, '\n');
  }

  function tokenize(s) {
    return norm(s).match(TOKEN_RE) || [];
  }

  function isSpace(t) {
    return /^[^\S\n]+$/.test(t);
  }

  // Returns per-token ops: { type: 'same'|'add'|'del', text }.
  function lcsOps(a, b) {
    var ops = [];
    var start = 0;
    var endA = a.length;
    var endB = b.length;
    while (start < endA && start < endB && a[start] === b[start]) start++;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }

    var i;
    for (i = 0; i < start; i++) ops.push({ type: 'same', text: a[i] });

    var n = endA - start;
    var m = endB - start;
    if (n === 0 || m === 0 || (n + 1) * (m + 1) > MAX_CELLS) {
      // Nothing to align, or too big for the table: replace the middle.
      for (i = start; i < endA; i++) ops.push({ type: 'del', text: a[i] });
      for (i = start; i < endB; i++) ops.push({ type: 'add', text: b[i] });
    } else {
      var w = m + 1;
      var dp = new Int32Array((n + 1) * w);
      var x, y;
      for (x = n - 1; x >= 0; x--) {
        for (y = m - 1; y >= 0; y--) {
          if (a[start + x] === b[start + y]) {
            dp[x * w + y] = dp[(x + 1) * w + y + 1] + 1;
          } else {
            var down = dp[(x + 1) * w + y];
            var right = dp[x * w + y + 1];
            dp[x * w + y] = down >= right ? down : right;
          }
        }
      }
      x = 0; y = 0;
      while (x < n && y < m) {
        if (a[start + x] === b[start + y]) {
          ops.push({ type: 'same', text: a[start + x] });
          x++; y++;
        } else if (dp[(x + 1) * w + y] >= dp[x * w + y + 1]) {
          ops.push({ type: 'del', text: a[start + x] });
          x++;
        } else {
          ops.push({ type: 'add', text: b[start + y] });
          y++;
        }
      }
      while (x < n) { ops.push({ type: 'del', text: a[start + x] }); x++; }
      while (y < m) { ops.push({ type: 'add', text: b[start + y] }); y++; }
    }

    for (i = endA; i < a.length; i++) ops.push({ type: 'same', text: a[i] });
    return ops;
  }

  function diffWords(a, b) {
    var ops = lcsOps(tokenize(a), tokenize(b));

    // A lone space kept between two changes reads better as part of the change.
    var k;
    for (k = 1; k < ops.length - 1; k++) {
      if (ops[k].type === 'same' && isSpace(ops[k].text) &&
          ops[k - 1].type !== 'same' && ops[k + 1].type !== 'same') {
        ops[k] = { type: 'both', text: ops[k].text };
      }
    }

    // Group: each change region becomes one deletion then one insertion.
    var parts = [];
    function push(type, text) {
      if (!text) return;
      var last = parts[parts.length - 1];
      if (last && last.type === type) last.text += text;
      else parts.push({ type: type, text: text });
    }
    var same = '';
    var del = '';
    var add = '';
    function flushChange() {
      push('del', del);
      push('add', add);
      del = '';
      add = '';
    }
    for (k = 0; k < ops.length; k++) {
      var op = ops[k];
      if (op.type === 'same') {
        flushChange();
        push('same', op.text);
      } else {
        if (op.type === 'del' || op.type === 'both') del += op.text;
        if (op.type === 'add' || op.type === 'both') add += op.text;
      }
    }
    flushChange();
    return parts;
  }

  function esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function renderDiff(oldText, newText) {
    var parts = diffWords(oldText, newText);
    if (!parts.length) return '';
    var html = '<p>';
    parts.forEach(function (part) {
      var open = '';
      var close = '';
      if (part.type === 'del') { open = '<del class="ow-del">'; close = '</del>'; }
      else if (part.type === 'add') { open = '<ins class="ow-ins">'; close = '</ins>'; }
      // Breaks go outside the tags so the HTML stays well nested.
      part.text.split(/(\n{2,}|\n)/).forEach(function (seg) {
        if (!seg) return;
        if (seg.charAt(0) === '\n') html += seg.length > 1 ? '</p><p>' : '<br>';
        else html += open + esc(seg) + close;
      });
    });
    return html + '</p>';
  }

  // ---------- Whole-piece diff ----------

  var JACCARD_MIN = 0.4;

  // Split blocks into paragraphs. Blank lines split, a ``` fence stays whole.
  function flatten(blocks) {
    var out = [];
    (Array.isArray(blocks) ? blocks : []).forEach(function (b) {
      if (!b) return;
      var kind = b.kind || 'p';
      var lines = norm(b.text).split('\n');
      var cur = [];
      var fenced = false;
      function flush() {
        var text = cur.join('\n').replace(/^\n+|\n+$/g, '');
        if (text.trim()) out.push({ kind: kind, text: text });
        cur = [];
      }
      lines.forEach(function (line) {
        if (/^\s*```/.test(line)) fenced = !fenced;
        if (!fenced && !line.trim() && !/^\s*```/.test(line)) flush();
        else cur.push(line);
      });
      flush();
    });
    return out;
  }

  function keyOf(p) {
    return p.kind + '\0' + p.text.replace(/\s+/g, ' ').trim();
  }

  function wordSet(text) {
    var set = {};
    var m = String(text).toLowerCase().match(/[\p{L}\p{N}_]+/gu) || [];
    m.forEach(function (w) { set[w] = true; });
    return set;
  }

  function jaccard(a, b) {
    var sa = wordSet(a);
    var sb = wordSet(b);
    var inter = 0;
    var na = 0;
    var nb = 0;
    var w;
    for (w in sa) { na++; if (sb[w]) inter++; }
    for (w in sb) nb++;
    var union = na + nb - inter;
    return union ? inter / union : 0;
  }

  function diffDoc(oldBlocks, newBlocks) {
    var a = flatten(oldBlocks);
    var b = flatten(newBlocks);
    var ops = lcsOps(a.map(keyOf), b.map(keyOf));
    // lcsOps works on strings; map each op back to a paragraph in order.
    var ia = 0;
    var ib = 0;
    var rows = [];
    var dels = [];
    var adds = [];
    var stats = { added: 0, removed: 0, changed: 0 };

    function removed(p) {
      stats.removed++;
      rows.push({ type: 'removed', kind: p.kind, oldText: p.text, newText: '' });
    }
    function flushRun() {
      var cursor = 0;
      var pending = [];
      function emitAdded(add) {
        stats.added++;
        rows.push({ type: 'added', kind: add.kind, oldText: '', newText: add.text });
      }
      adds.forEach(function (add) {
        var found = -1;
        for (var d = cursor; d < dels.length; d++) {
          if (jaccard(dels[d].text, add.text) >= JACCARD_MIN) { found = d; break; }
        }
        if (found < 0) { pending.push(add); return; }
        for (var k = cursor; k < found; k++) removed(dels[k]);
        pending.forEach(emitAdded);
        pending = [];
        stats.changed++;
        rows.push({
          type: 'changed', kind: add.kind, oldKind: dels[found].kind,
          oldText: dels[found].text, newText: add.text,
        });
        cursor = found + 1;
      });
      for (var r = cursor; r < dels.length; r++) removed(dels[r]);
      pending.forEach(emitAdded);
      dels = [];
      adds = [];
    }

    ops.forEach(function (op) {
      if (op.type === 'same') {
        flushRun();
        var p = b[ib];
        rows.push({ type: 'same', kind: p.kind, oldText: a[ia].text, newText: p.text });
        ia++; ib++;
      } else if (op.type === 'del') {
        dels.push(a[ia++]);
      } else {
        adds.push(b[ib++]);
      }
    });
    flushRun();
    return { rows: rows, stats: stats };
  }

  var TAGS = { h1: 'h1', h2: 'h2', h3: 'h3' };

  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function renderDocDiff(oldBlocks, newBlocks) {
    var res = diffDoc(oldBlocks, newBlocks);
    var wrap = mk('div', 'ow-docdiff');
    var s = res.stats;
    if (!s.added && !s.removed && !s.changed) {
      wrap.appendChild(mk('p', 'ow-nochange', 'No changes since this version.'));
      return wrap;
    }
    res.rows.forEach(function (row) {
      var el = mk(TAGS[row.kind] || 'p', 'ow-row ow-' + row.type);
      if (row.type === 'same') {
        el.textContent = row.newText;
      } else if (row.type === 'added') {
        el.appendChild(mk('ins', 'ow-ins', row.newText));
      } else if (row.type === 'removed') {
        el.appendChild(mk('del', 'ow-del', row.oldText));
      } else {
        diffWords(row.oldText, row.newText).forEach(function (part) {
          if (part.type === 'same') el.appendChild(document.createTextNode(part.text));
          else el.appendChild(mk(part.type === 'del' ? 'del' : 'ins', 'ow-' + (part.type === 'del' ? 'del' : 'ins'), part.text));
        });
      }
      wrap.appendChild(el);
    });
    return wrap;
  }

  OW.diffWords = diffWords;
  OW.renderDiff = renderDiff;
  OW.diffDoc = diffDoc;
  OW.renderDocDiff = renderDocDiff;

  if (typeof module !== 'undefined' && module.exports) module.exports = OW;
})(typeof window !== 'undefined' ? window : globalThis);
