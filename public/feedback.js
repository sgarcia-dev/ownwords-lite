/* Ownwords Lite: like, dislike and neutral note marks. Works in the browser (window.OW) and under Node (pure parts). */
(function (root) {
  'use strict';

  var OW = root.OW = root.OW || {};
  var HAS_DOM = typeof document !== 'undefined';
  var BEFORE_LEN = 24;
  var NOTE_MAX = 2000;

  var marks = [];          // saved marks, see section 3.5 of the plan
  var texts = {};          // "block\0version" -> shown text, filled by paintBlock
  var ranges = {};         // mark id -> { block, start, end } for painted marks
  var host = null;
  var barEl = null;
  var docEl = null;
  var why = null;          // the note box: { ids, pending, anchor, el, ta, hint, rm, last, dirty }

  // ---------------------------------------------------------------- finding a quote again

  function collapse(s) {
    var out = '';
    var from = [];
    var to = [];
    var i = 0;
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        var j = i;
        while (j < s.length && /\s/.test(s[j])) j++;
        out += ' ';
        from.push(i);
        to.push(j);
        i = j;
      } else {
        out += s[i];
        from.push(i);
        to.push(i + 1);
        i++;
      }
    }
    return { s: out, from: from, to: to };
  }

  function collapseStr(s) { return String(s).replace(/\s+/g, ' '); }

  function suffixLen(a, b) {
    var n = 0;
    while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
    return n;
  }

  function allIndexes(hay, needle) {
    var out = [];
    var i = hay.indexOf(needle);
    while (i !== -1) {
      out.push(i);
      i = hay.indexOf(needle, i + 1);
    }
    return out;
  }

  // Every place the quote sits in the text, each with a score for choosing.
  function hitsFor(text, mark) {
    if (typeof text !== 'string' || !mark || typeof mark.quote !== 'string' || !mark.quote) return [];
    var before = typeof mark.before === 'string' ? mark.before : '';
    var wanted = typeof mark.start === 'number' ? mark.start : 0;
    var q = mark.quote;
    var idx = allIndexes(text, q);
    var out = [];
    if (idx.length) {
      idx.forEach(function (i) {
        out.push({ start: i, end: i + q.length, suf: suffixLen(before, text.slice(0, i)), dist: Math.abs(i - wanted) });
      });
      return out;
    }
    var c = collapse(text);
    var cq = collapseStr(q);
    if (!cq) return [];
    var cb = collapseStr(before);
    allIndexes(c.s, cq).forEach(function (i) {
      var s = c.from[i];
      out.push({ start: s, end: c.to[i + cq.length - 1], suf: suffixLen(cb, c.s.slice(0, i)), dist: Math.abs(s - wanted) });
    });
    return out;
  }

  function better(a, b) {
    if (!b) return true;
    if (a.suf !== b.suf) return a.suf > b.suf;
    if (a.dist !== b.dist) return a.dist < b.dist;
    return a.start < b.start;
  }

  function bestOf(hits) {
    var best = null;
    hits.forEach(function (h) { if (better(h, best)) best = h; });
    return best;
  }

  function findQuote(text, mark) {
    var best = bestOf(hitsFor(text, mark));
    return best ? { start: best.start, end: best.end } : null;
  }

  // ---------------------------------------------------------------- scores

  function nextScore(cur, kind) {
    var sign = kind === 'dislike' ? -1 : 1;
    cur = Number(cur) || 0;
    if (cur * sign > 0) return Math.abs(cur) >= 2 ? 0 : 2 * sign;
    return sign;
  }

  function kindOf(score) { return score > 0 ? 'like' : score < 0 ? 'dislike' : null; }

  function titleFor(cur, kind) {
    var word = kind === 'like' ? 'like' : 'dislike';
    var Word = kind === 'like' ? 'Like' : 'Dislike';
    var n = nextScore(cur, kind);
    if (n === 0) return 'Clear ' + word;
    if (Math.abs(n) === 2) return 'Really ' + word;
    return Word;
  }

  function applyBtn(btn, score) {
    var kind = btn.dataset.action;
    var same = kindOf(score) === kind;
    btn.classList.toggle('on', same);
    btn.setAttribute('aria-pressed', same ? 'true' : 'false');
    if (same) btn.dataset.level = String(Math.abs(score)); else btn.removeAttribute('data-level');
    btn.title = titleFor(score, kind);
  }

  // ---------------------------------------------------------------- marks store

  function rid(n) {
    var s = '';
    while (s.length < n) s += Math.random().toString(36).slice(2);
    return s.slice(0, n);
  }

  function clean(m) {
    if (!m || typeof m !== 'object') return null;
    if (typeof m.id !== 'string' || !m.id) return null;
    if (typeof m.block !== 'string' || !m.block) return null;
    if (!Number.isInteger(m.version) || m.version < 0) return null;
    if (!Number.isInteger(m.score) || Math.abs(m.score) > 2) return null;
    if (m.quote !== null && (typeof m.quote !== 'string' || !m.quote)) return null;
    var note = typeof m.note === 'string' ? m.note.slice(0, NOTE_MAX) : '';
    if (m.score === 0 && !note.trim()) return null;   // a neutral mark exists only with a note
    return {
      id: m.id,
      block: m.block,
      version: m.version,
      quote: m.quote,
      before: typeof m.before === 'string' ? m.before : '',
      start: Number.isInteger(m.start) ? m.start : 0,
      score: m.score,
      note: note,
      set: typeof m.set === 'string' && m.set ? m.set : m.id,
      at: typeof m.at === 'string' ? m.at : ''
    };
  }

  function dropWhy() {
    var w = why;
    why = null;
    if (w && w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el);
  }

  function load(arr) {
    var seen = {};
    if (why) dropWhy();
    marks = [];
    texts = {};
    ranges = {};
    if (Array.isArray(arr)) {
      arr.forEach(function (raw) {
        var m = clean(raw);
        if (m && !seen[m.id]) { seen[m.id] = true; marks.push(m); }
      });
    }
  }

  function getAll() {
    return marks.map(function (m) { return Object.assign({}, m); });
  }

  function textKey(block, version) { return block + '\0' + version; }

  function rangeFor(m) {
    if (m.quote === null) return null;
    var text = texts[textKey(m.block, m.version)];
    if (typeof text !== 'string') return null;
    var r = findQuote(text, m);
    return r ? { block: m.block, start: r.start, end: r.end } : null;
  }

  function rangeOf(markId) {
    if (ranges[markId]) return ranges[markId];
    for (var i = 0; i < marks.length; i++) {
      if (marks[i].id === markId) return rangeFor(marks[i]);
    }
    return null;
  }

  // The mark that sits exactly on this target, if any.
  function markFor(t) {
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (m.block !== t.block || m.version !== t.version) continue;
      if (t.whole) {
        if (m.quote === null) return m;
      } else if (m.quote !== null) {
        var r = rangeFor(m);
        if (r && r.start === t.start && r.end === t.end) return m;
      }
    }
    return null;
  }

  function byId(id) {
    for (var i = 0; i < marks.length; i++) if (marks[i].id === id) return marks[i];
    return null;
  }

  // The target a mark sits on, or null if its quote is lost.
  function targetOf(m) {
    if (m.quote === null) return { block: m.block, version: m.version, whole: true };
    var r = rangeFor(m);
    return r ? { block: m.block, version: m.version, start: r.start, end: r.end } : null;
  }

  function buildMark(t, score, note, set, at) {
    var m = { id: 'f' + rid(8), block: t.block, version: t.version, quote: null, before: '', start: 0, score: score, note: note, set: set, at: at };
    if (!t.whole) {
      var text = texts[textKey(t.block, t.version)];
      if (typeof text !== 'string' || !(t.end > t.start)) return null;
      m.quote = text.slice(t.start, t.end);
      if (!m.quote) return null;
      m.before = text.slice(Math.max(0, t.start - BEFORE_LEN), t.start);
      m.start = t.start;
    }
    return m;
  }

  function removeMarks(ids) {
    ids.forEach(function (id) {
      var m = byId(id);
      if (m) marks.splice(marks.indexOf(m), 1);
    });
  }

  // The first span mark in the same block and version that crosses this target,
  // unless it sits on exactly the same range (that one cycles). Whole-version
  // marks never count.
  function overlapMark(t) {
    if (!t || t.whole) return null;
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i];
      if (m.block !== t.block || m.version !== t.version || m.quote === null) continue;
      var r = rangeFor(m);
      if (!r) continue;
      if (r.start === t.start && r.end === t.end) continue;
      if (r.start < t.end && t.start < r.end) return m;
    }
    return null;
  }

  function overlaps(t) { return !!overlapMark(t); }

  function anyOverlap(targets) {
    if (!Array.isArray(targets)) return false;
    for (var i = 0; i < targets.length; i++) if (overlaps(targets[i])) return true;
    return false;
  }

  function sharedScore(targets) {
    if (!targets.length) return 0;
    var first = null;
    for (var i = 0; i < targets.length; i++) {
      var m = markFor(targets[i]);
      var s = m ? m.score : 0;
      if (i === 0) first = s; else if (s !== first) return 0;
    }
    return first;
  }

  // ---------------------------------------------------------------- re-pointing p<n> marks

  function reconcile(blocks) {
    if (!Array.isArray(blocks)) return;
    var byId = {};
    blocks.forEach(function (b) { byId[b.id] = b; });
    marks.forEach(function (m) {
      if (m.quote === null || m.version !== 0 || !/^p\d+$/.test(m.block)) return;
      var own = byId[m.block];
      if (own && hitsFor(own.text, m).length) return;
      var best = null;
      var bestBlock = null;
      blocks.forEach(function (b) {
        if (b.id === m.block) return;
        var h = bestOf(hitsFor(b.text, m));
        if (h && better(h, best)) { best = h; bestBlock = b; }
      });
      if (!best) return;
      m.block = bestBlock.id;
      m.start = best.start;
      m.before = bestBlock.text.slice(Math.max(0, best.start - BEFORE_LEN), best.start);
    });
  }

  // ---------------------------------------------------------------- painting

  function paintBlock(blockEl, blockId, pick, text) {
    if (!HAS_DOM || !blockEl) return;
    texts[textKey(blockId, pick)] = text;
    var list = [];
    marks.forEach(function (m) {
      if (m.block !== blockId || m.version !== pick || m.quote === null) return;
      var r = rangeFor(m);
      if (!r) { delete ranges[m.id]; return; }
      ranges[m.id] = r;
      list.push({ m: m, start: r.start, end: r.end });
    });
    if (!list.length) return;

    // Cut the text into segments. In an overlap the later mark wins.
    var pts = [];
    list.forEach(function (x) { pts.push(x.start, x.end); });
    pts.sort(function (a, b) { return a - b; });
    var segs = [];
    for (var i = 0; i + 1 < pts.length; i++) {
      var a = pts[i], b = pts[i + 1];
      if (a === b) continue;
      var win = null;
      list.forEach(function (x) { if (x.start <= a && x.end >= b) win = x.m; });
      if (!win) continue;
      var last = segs[segs.length - 1];
      if (last && last.end === a && last.m === win) last.end = b;
      else segs.push({ start: a, end: b, m: win });
    }

    var lastPiece = {};
    var allPieces = {};
    Array.prototype.forEach.call(blockEl.querySelectorAll('[data-pstart]'), function (p) {
      var pos = Number(p.dataset.pstart);
      var nodes = [];
      var walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
      var n;
      while ((n = walker.nextNode())) nodes.push(n);
      nodes.forEach(function (node) {
        var s0 = pos;
        var s1 = pos + node.nodeValue.length;
        pos = s1;
        var hit = segs.filter(function (g) { return g.start < s1 && g.end > s0; });
        if (!hit.length) return;
        var val = node.nodeValue;
        var frag = document.createDocumentFragment();
        var at = s0;
        hit.forEach(function (g) {
          var a = Math.max(g.start, s0), b = Math.min(g.end, s1);
          if (a > at) frag.appendChild(document.createTextNode(val.slice(at - s0, a - s0)));
          var el = document.createElement('mark');
          var s = g.m.score;
          el.className = 'fb ' + (s > 0 ? 'fb-like' : s < 0 ? 'fb-dis' : 'fb-neutral') + ' fb-s' + Math.abs(s);
          el.dataset.fb = g.m.id;
          if (g.m.note) el.title = g.m.note;
          el.textContent = val.slice(a - s0, b - s0);
          frag.appendChild(el);
          lastPiece[g.m.id] = el;
          at = b;
        });
        if (at < s1) frag.appendChild(document.createTextNode(val.slice(at - s0)));
        node.parentNode.replaceChild(frag, node);
      });
    });
    Object.keys(lastPiece).forEach(function (id) {
      var el = lastPiece[id];
      el.classList.add('fb-last');
      var m = marks.filter(function (x) { return x.id === id; })[0];
      if (m && m.note) el.classList.add('fb-note');
    });
  }

  // ---------------------------------------------------------------- voting

  function vote(targets, kind, anchor) {
    if (anyOverlap(targets)) return;
    closeWhy();                                   // keeps the typed note
    var next = nextScore(sharedScore(targets), kind);
    var set = rid(6), at = new Date().toISOString(), ids = [];
    targets.forEach(function (t) {
      var old = markFor(t);
      if (old) {                                  // same object: id and note stay
        if (next === 0 && !old.note) { marks.splice(marks.indexOf(old), 1); return; }
        old.score = next; old.set = set; old.at = at;   // note with score 0 = neutral, kept
        ids.push(old.id);
        return;
      }
      if (next === 0) return;
      var m = buildMark(t, next, '', set, at);
      if (m) { marks.push(m); ids.push(m.id); }
    });
    if (ids.length) openWhy({ ids: ids, anchor: anchor });
    if (host && host.changed) host.changed();
    if (why) { reposition(); focusWhy(); }
  }

  function voteSelection(kind) {
    if (!host) return;
    var sel = host.selection();
    if (!sel || !Array.isArray(sel.targets)) return;
    var targets = sel.targets.filter(function (t) { return t && t.end > t.start; });
    if (!targets.length) return;
    vote(targets, kind, { type: 'bar' });
  }

  // 💬 from the bar or the badge row: open the note of the marks it covers, or wait for a first character.
  function openNote(targets, anchor) {
    closeWhy();
    var ids = [];
    targets.forEach(function (t) {
      var m = markFor(t) || overlapMark(t);       // stays enabled over an overlap: open the covering mark
      if (m && ids.indexOf(m.id) < 0) ids.push(m.id);
    });
    openWhy({ ids: ids, pending: ids.length ? null : targets, anchor: anchor });
    reposition();
    focusWhy();
  }

  function noteSelection() {
    if (!host) return;
    var sel = host.selection();
    if (!sel || !Array.isArray(sel.targets)) return;
    var t = sel.targets.filter(function (x) { return x && x.end > x.start; });
    if (t.length) openNote(t, { type: 'bar' });
  }

  function pieceIndex(id, el) {
    if (!HAS_DOM || !docEl || !el) return 0;
    var ps = Array.prototype.filter.call(docEl.querySelectorAll('mark.fb'), function (e) { return e.dataset.fb === id; });
    var i = ps.indexOf(el);
    return i < 0 ? 0 : i;
  }

  // A click on a painted mark (app.js): show its note.
  function openMark(id, pieceEl) {
    if (!byId(id)) return;
    closeWhy();
    openWhy({ ids: [id], anchor: { type: 'mark', id: id, idx: pieceIndex(id, pieceEl) } });
    reposition();
    focusWhy();
  }

  function setNoteBtn(b, has) {
    b.classList.toggle('on', has);
    b.setAttribute('aria-pressed', has ? 'true' : 'false');
    b.title = has ? 'Edit note' : 'Add note';
  }

  function versionButtons(blockId, pick) {
    var wrap = document.createElement('span');
    wrap.className = 'fb-ver';
    wrap.dataset.block = blockId;
    wrap.dataset.version = String(pick);
    var target = { block: blockId, version: pick, whole: true };
    var m = markFor(target);
    var score = m ? m.score : 0;
    ['like', 'dislike'].forEach(function (kind) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'fb-btn';
      b.dataset.action = kind;
      b.textContent = kind === 'like' ? '👍' : '👎';
      b.setAttribute('aria-label', (kind === 'like' ? 'Like' : 'Dislike') + ' this version');
      applyBtn(b, score);
      b.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        vote([target], kind, { type: 'ver', block: blockId });
      });
      wrap.appendChild(b);
    });
    var nb = document.createElement('button');
    nb.type = 'button';
    nb.className = 'fb-btn';
    nb.dataset.note = '';
    nb.textContent = '💬';
    nb.setAttribute('aria-label', 'Note on this version');
    setNoteBtn(nb, !!(m && m.note));              // lit when the whole-version mark has a note
    nb.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openNote([target], { type: 'ver', block: blockId });
    });
    wrap.appendChild(nb);
    return wrap;
  }

  function syncBar() {
    if (!barEl || !host) return;
    var sel = host.selection();
    var score = sel && Array.isArray(sel.targets) ? sharedScore(sel.targets) : 0;
    var blocked = !!sel && anyOverlap(sel.targets);
    Array.prototype.forEach.call(barEl.querySelectorAll('.fb-btn[data-action]'), function (b) {
      applyBtn(b, score);
      if (blocked) {
        b.disabled = true;
        b.title = 'Overlaps a mark. Click it to change it.';
      } else {
        b.disabled = false;
      }
    });
    var nb = barEl.querySelector('[data-note]');
    if (nb) {
      var has = !!sel && Array.isArray(sel.targets) && sel.targets.some(function (t) {
        var m = markFor(t) || overlapMark(t);
        return m && m.note;
      });
      setNoteBtn(nb, has);
    }
  }

  // ---------------------------------------------------------------- the note box

  function setHint(s) { if (why && why.hint) why.hint.textContent = s; }

  function openWhy(o) {
    var first = o.ids && o.ids.length ? byId(o.ids[0]) : null;
    why = { ids: o.ids || [], pending: o.pending || null, anchor: o.anchor, el: null, ta: null, hint: null, rm: null, dirty: false, last: first ? first.note.trim() : '' };
    if (!HAS_DOM) return;
    var el = document.createElement('div');
    el.id = 'fbwhy';
    var ta = document.createElement('textarea');
    ta.rows = 3;
    ta.maxLength = NOTE_MAX;
    ta.placeholder = 'Note (optional)';
    ta.setAttribute('aria-label', 'Note');
    ta.value = first ? first.note : '';
    var row = document.createElement('div');
    row.className = 'fb-row';
    var hint = document.createElement('span');
    hint.className = 'fb-hint';
    var rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'fb-remove';
    rm.textContent = '× Remove';
    rm.title = 'Remove this mark';
    rm.hidden = !why.ids.length;
    row.appendChild(hint);
    row.appendChild(rm);
    el.appendChild(ta);
    el.appendChild(row);
    ta.addEventListener('input', function () { if (why && why.ta === ta) applyText(ta.value); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        closeWhy();
      }
    });
    ta.addEventListener('blur', function () { if (why && why.ta === ta) applyText(ta.value); });
    rm.addEventListener('click', function (e) { e.preventDefault(); removeWhy(); });
    document.body.appendChild(el);
    why.el = el; why.ta = ta; why.hint = hint; why.rm = rm;
  }

  // The one place a note changes. Typing, blur and close all come here.
  function applyText(raw) {
    if (!why) return false;
    var text = String(raw).trim().slice(0, NOTE_MAX);
    if (text === why.last) return false;
    why.last = text;
    var rebuild = false;
    if (!why.ids.length) {                        // lazy neutral: the first non-empty character creates the mark
      if (!text || !why.pending || !why.pending.length) return false;
      var set = rid(6), at = new Date().toISOString();
      why.pending.forEach(function (t) {
        var m = buildMark(t, 0, text, set, at);
        if (m) { marks.push(m); why.ids.push(m.id); }
      });
      if (!why.ids.length) return false;
      why.pending = null;
      rebuild = true;
    } else {
      var gone = [];
      why.ids.forEach(function (id) {
        var m = byId(id);
        if (!m) return;
        if (m.score === 0 && !text) gone.push(m); else m.note = text;
      });
      if (gone.length) {                          // an empty neutral is not stored
        var back = gone.map(targetOf).filter(Boolean);
        removeMarks(gone.map(function (m) { return m.id; }));
        why.ids = why.ids.filter(function (id) { return !!byId(id); });
        if (!why.ids.length) {
          why.pending = back;
          why.anchor = back[0] && back[0].whole ? { type: 'ver', block: back[0].block } : { type: 'bar' };
        }
        rebuild = true;
      }
    }
    why.dirty = true;
    setHint('Saving…');
    if (why.rm) why.rm.hidden = !why.ids.length;
    patchNotes(why.ids);
    if (rebuild) { if (host && host.changed) host.changed(); } else if (host && host.markChanged) host.markChanged();
    return true;
  }

  // Called by the host after a good save with nothing newer waiting.
  function saved() {
    if (why && why.dirty) { why.dirty = false; setHint('Saved'); }
  }

  function removeWhy() {
    var w = why;
    why = null;                                   // before removing: a focused node fires blur
    if (w && w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el);
    if (w && w.ids.length) {
      removeMarks(w.ids);
      if (host && host.changed) host.changed();
    }
  }

  function focusWhy() {
    if (why && why.ta && why.el.style.display !== 'none') {
      try { why.ta.focus({ preventScroll: true }); } catch (e) { why.ta.focus(); }
    }
  }

  function anchorEl() {
    if (!why) return null;
    if (why.anchor.type === 'bar') return barEl && !barEl.hidden ? barEl : null;
    if (!docEl) return null;
    if (why.anchor.type === 'mark') {
      var ps = Array.prototype.filter.call(docEl.querySelectorAll('mark.fb'), function (e) { return e.dataset.fb === why.anchor.id; });
      return ps[why.anchor.idx] || ps[0] || null;
    }
    var list = docEl.querySelectorAll('.block');
    for (var i = 0; i < list.length; i++) {
      if (list[i].dataset.block === why.anchor.block) return list[i].querySelector('.fb-ver');
    }
    return null;
  }

  function reposition() {
    if (!why || !why.el) return;
    var a = anchorEl();
    var rect = a ? a.getBoundingClientRect() : null;
    if (!rect || (!rect.width && !rect.height)) { why.el.style.display = 'none'; return; }
    why.el.style.display = '';
    var w = why.el.offsetWidth, h = why.el.offsetHeight;
    var top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    var left = Math.max(8, Math.min(rect.left, window.innerWidth - w - 8));
    why.el.style.top = top + 'px';
    why.el.style.left = left + 'px';
  }

  function patchNotes(ids) {
    if (!HAS_DOM || !docEl) return;
    ids.forEach(function (id) {
      var m = byId(id);
      if (!m) return;
      if (m.quote === null) {
        Array.prototype.forEach.call(docEl.querySelectorAll('.fb-ver'), function (v) {
          if (v.dataset.block !== m.block || v.dataset.version !== String(m.version)) return;
          var b = v.querySelector('[data-note]');
          if (b) setNoteBtn(b, !!m.note);
        });
        return;
      }
      Array.prototype.forEach.call(docEl.querySelectorAll('mark.fb'), function (el) {
        if (el.dataset.fb !== m.id) return;
        if (m.note) el.title = m.note; else el.removeAttribute('title');
        if (el.classList.contains('fb-last')) el.classList.toggle('fb-note', !!m.note);
      });
    });
  }

  // Save what is typed, then drop the box. Nothing typed is thrown away.
  function closeWhy() {
    if (!why) return;
    if (why.ta) applyText(why.ta.value);          // blur or Esc without an input event, IME, paste
    var w = why;
    why = null;
    if (w.el && w.el.parentNode) w.el.parentNode.removeChild(w.el);
  }

  // ---------------------------------------------------------------- setup

  function init(opts) {
    opts = opts || {};
    barEl = opts.bar || null;
    docEl = opts.doc || null;
    host = opts.host || null;
    if (!HAS_DOM) return;
    document.addEventListener('mousedown', function (e) {
      if (!why) return;
      var t = e.target && e.target.nodeType === 1 ? e.target : e.target && e.target.parentElement;
      if (t && t.closest && t.closest('#fbwhy, #selbar, .fb-ver')) return;
      closeWhy();
    }, true);
  }

  OW.feedback = {
    init: init,
    load: load,
    getAll: getAll,
    reconcile: reconcile,
    paintBlock: paintBlock,
    versionButtons: versionButtons,
    syncBar: syncBar,
    voteSelection: voteSelection,
    noteSelection: noteSelection,
    openMark: openMark,
    saved: saved,
    reposition: reposition,
    closeWhy: closeWhy,
    rangeOf: rangeOf,
    _test: {
      findQuote: findQuote,
      nextScore: nextScore,
      overlaps: overlaps,
      type: applyText,
      removeNote: removeWhy,
      remember: function (block, version, text) { texts[textKey(block, version)] = text; }
    }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = OW;
})(typeof window !== 'undefined' ? window : globalThis);
