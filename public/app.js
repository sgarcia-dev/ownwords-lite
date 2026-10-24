/* Ownwords Lite page. Reads pieces through the server, writes only ui.json.
   No AI calls here. Uses window.OW.* from diff.js and timeline.js when present. */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var els = {
    hdr: $('hdr'), back: $('back'), title: $('title'), actions: $('actions'),
    btnTimeline: $('btn-timeline'), btnCopy: $('btn-copy'), btnPrompt: $('btn-prompt'), offline: $('offline'), btnReveal: $('btn-reveal'),
    home: $('home'), banner: $('banner'), doc: $('doc'), bar: $('selbar'),
    strip: $('strip'), stripText: $('strip-text'), btnRef: $('btn-ref'), stale: $('stale')
  };
  var panel = null;

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---------------------------------------------------------------- state
  var state;
  var snapCache = new Map();
  var busy = false;
  var mouseDown = false;
  var pendingRender = false;
  var ignoreUntil = 0;
  var saveTimer = null;
  var selTimer = null;
  var hoverMark = null;
  var fails = 0;
  var netErr = false; // set by poll() when a fetch itself fails (server gone)
  var pendingUi = {}; // slug -> latest ui body that could not be saved yet

  function resetState(slug) {
    state = {
      slug: slug, etag: null, doc: null, history: [], notFound: false,
      picks: {}, sel: null, anchor: null, hoverId: null,
      cmpFile: null, compare: {}, dir: null, canReveal: false, accBusy: false, accId: null, accMsg: '',
      tlBusy: false, tlMsg: '', staleOpen: {},
      showFile: null, showDoc: null, pieces: null, piecesKey: ''
    };
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (hasFb('load')) OW.feedback.load([]);
  }
  resetState(null);
  var tlOn = false;

  function liveBlocks() { return state.doc && Array.isArray(state.doc.blocks) ? state.doc.blocks : []; }
  function liveBlock(id) {
    var L = liveBlocks();
    for (var i = 0; i < L.length; i++) if (L[i].id === id) return L[i];
    return null;
  }
  function liveIndex(id) {
    var L = liveBlocks();
    for (var i = 0; i < L.length; i++) if (L[i].id === id) return i;
    return -1;
  }
  function hasOptions(b) { return b && Array.isArray(b.options) && b.options.length > 0; }
  function shownText(b) {
    var p = state.picks[b.id] || 0;
    if (p > 0 && hasOptions(b) && b.options[p - 1]) return String(b.options[p - 1].text || '');
    return String(b.text || '');
  }
  function liveText(id) { var b = liveBlock(id); return b ? shownText(b) : ''; }
  function viewing() { return !!(state.showFile && state.showDoc); }
  function comparing() { return !!state.cmpFile; }
  function interactive() { return !!state.doc && !viewing() && !comparing(); }
  function firstH1Id() {
    var L = liveBlocks();
    for (var i = 0; i < L.length; i++) if (L[i].kind === 'h1') return L[i].id;
    return null;
  }
  function isTitle(b) { return !!b && (b.title === true || (b.kind === 'h1' && b.id === firstH1Id())); }
  function hasOW(name) { return !!(window.OW && typeof window.OW[name] === 'function'); }
  function hasFb(name) { return !!(window.OW && OW.feedback && typeof OW.feedback[name] === 'function'); }

  // ---------------------------------------------------------------- sentences
  var ABBR = /(?:^|[\s(\["“'])(?:Mr|Mrs|Ms|Dr|Prof|Jr|Sr|St|vs|cf|etc|e\.g|i\.e)\.\s*$/;
  var segmenter = null;

  function splitSentences(text) {
    var raw = [];
    var i, m;
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      segmenter = segmenter || new Intl.Segmenter(undefined, { granularity: 'sentence' });
      var it = segmenter.segment(text)[Symbol.iterator]();
      var step;
      while (!(step = it.next()).done) {
        var seg = step.value;
        var prev = raw[raw.length - 1];
        var fullEnd = seg.index + seg.segment.length;
        if (prev && ABBR.test(text.slice(prev.start, prev.full))) prev.full = fullEnd;
        else raw.push({ start: seg.index, full: fullEnd });
      }
    } else {
      var re = /[^.!?]+[.!?]*\s*/g;
      while ((m = re.exec(text))) raw.push({ start: m.index, full: m.index + m[0].length });
    }
    var out = [];
    for (i = 0; i < raw.length; i++) {
      var e = raw[i].full;
      while (e > raw[i].start && /\s/.test(text[e - 1])) e--;
      if (e > raw[i].start) out.push({ start: raw[i].start, end: e });
    }
    return out;
  }

  var layoutCache = new Map();
  // Paragraphs of a block text, each with sentences. Offsets are into the block text.
  function layout(text) {
    var cached = layoutCache.get(text);
    if (cached) return cached;
    var paras = [];
    var re = /\n\s*\n/g;
    var last = 0, m;
    function push(s, e) {
      while (s < e && /\s/.test(text[s])) s++;
      while (e > s && /\s/.test(text[e - 1])) e--;
      if (e > s) paras.push({ start: s, end: e });
    }
    while ((m = re.exec(text))) { push(last, m.index); last = m.index + m[0].length; }
    push(last, text.length);
    paras.forEach(function (p) {
      p.sents = splitSentences(text.slice(p.start, p.end)).map(function (s) {
        return { start: p.start + s.start, end: p.start + s.end };
      });
    });
    if (layoutCache.size > 400) layoutCache.clear();
    layoutCache.set(text, paras);
    return paras;
  }

  // ---------------------------------------------------------------- selection model
  // sel = { scope, a:{block,off}, b:{block,off}, text, blocks, showing, at, native }
  function cmp(p, q) { return (liveIndex(p.block) - liveIndex(q.block)) || (p.off - q.off); }

  function textBetween(a, b) {
    var L = liveBlocks();
    var ia = liveIndex(a.block), ib = liveIndex(b.block);
    if (ia < 0 || ib < 0) return '';
    if (ia === ib) return liveText(a.block).slice(a.off, b.off);
    var parts = [];
    for (var i = ia; i <= ib; i++) {
      var t = shownText(L[i]);
      if (i === ia) t = t.slice(a.off);
      else if (i === ib) t = t.slice(0, b.off);
      parts.push(t);
    }
    return parts.join('\n\n');
  }

  function fillSel(s) {
    var L = liveBlocks();
    var ia = liveIndex(s.a.block), ib = liveIndex(s.b.block);
    s.blocks = L.slice(ia, ib + 1).map(function (b) { return b.id; });
    s.text = textBetween(s.a, s.b);
    s.showing = {};
    s.blocks.forEach(function (id) {
      if (hasOptions(liveBlock(id))) s.showing[id] = state.picks[id] || 0;
    });
    s.at = new Date().toISOString();
  }

  function wholeBlocks(first, last) {
    var L = liveBlocks();
    return { a: { block: L[first].id, off: 0 }, b: { block: L[last].id, off: shownText(L[last]).length } };
  }

  function setSel(scope, a, b, native, mark) {
    if (cmp(a, b) > 0) { var t = a; a = b; b = t; }
    var s = { scope: scope, a: a, b: b, native: !!native };
    if (mark) s.mark = mark;
    fillSel(s);
    if (!s.text.trim()) return;
    state.sel = s;
    if (!native) clearNative();
    scheduleSave();
    updateSelUI();
  }

  function clearNative() {
    var gs = window.getSelection();
    if (gs && gs.rangeCount) { ignoreUntil = performance.now() + 150; gs.removeAllRanges(); }
  }

  function clearSel() {
    if (!state.sel && !state.anchor) return;
    state.sel = null;
    state.anchor = null;
    clearNative();
    scheduleSave();
    updateSelUI();
  }

  // Re-find the selection after the doc or picks changed. Drop it if it is gone.
  function reconcile() {
    var s = state.sel;
    if (!s) return;
    var L = liveBlocks();
    var ok = false;
    if (L.length && s.blocks.every(function (id) { return liveIndex(id) >= 0; })) {
      if (s.scope === 'all') {
        var w = wholeBlocks(0, L.length - 1);
        s.a = w.a; s.b = w.b; ok = true;
      } else if (s.a && s.b && liveIndex(s.a.block) >= 0 && liveIndex(s.b.block) >= 0 &&
                 cmp(s.a, s.b) < 0 && textBetween(s.a, s.b) === s.text) {
        ok = true;
      } else if (s.blocks.length === 1) {
        var id = s.blocks[0];
        var i = liveText(id).indexOf(s.text);
        if (i >= 0) { s.a = { block: id, off: i }; s.b = { block: id, off: i + s.text.length }; ok = true; }
      } else {
        var f = liveIndex(s.blocks[0]), l = liveIndex(s.blocks[s.blocks.length - 1]);
        if (f >= 0 && l >= f) {
          var w2 = wholeBlocks(f, l);
          if (textBetween(w2.a, w2.b) === s.text) { s.a = w2.a; s.b = w2.b; ok = true; }
        }
      }
    }
    if (!ok) { state.sel = null; state.anchor = null; scheduleSave(); return; }
    var before = JSON.stringify([s.blocks, s.text, s.showing]);
    var at = s.at;
    fillSel(s);
    if (JSON.stringify([s.blocks, s.text, s.showing]) === before) s.at = at;
    else scheduleSave();
  }

  function normalizePicks() {
    var changed = false;
    var L = liveBlocks();
    var ids = {};
    L.forEach(function (b) {
      ids[b.id] = true;
      var p = state.picks[b.id];
      if (hasOptions(b)) {
        if (!(Number.isInteger(p) && p >= 0 && p <= b.options.length)) {
          if (p !== 0) changed = true;
          state.picks[b.id] = 0;
        }
      } else if (b.id in state.picks) {
        delete state.picks[b.id];
        changed = true;
      }
    });
    Object.keys(state.picks).forEach(function (k) {
      if (!ids[k]) { delete state.picks[k]; changed = true; }
    });
    var byId = {};
    L.forEach(function (b) { byId[b.id] = b; });
    Object.keys(state.compare).forEach(function (k) {
      var b = byId[k], c = state.compare[k];
      if (!hasOptions(b) || !c || typeof c !== 'object') { delete state.compare[k]; changed = true; return; }
      if (!(Number.isInteger(c.base) && c.base >= 0 && c.base <= b.options.length)) { c.base = 0; changed = true; }
    });
    if (changed) scheduleSave();
  }

  // ---------------------------------------------------------------- widen
  function paraAt(paras, off) {
    for (var i = 0; i < paras.length; i++) if (off <= paras[i].end) return paras[i];
    return paras[paras.length - 1];
  }

  function widen(scope) {
    var s = state.sel;
    if (!s || !interactive()) return;
    var L = liveBlocks();
    var ia = liveIndex(s.a.block), ib = liveIndex(s.b.block);
    if (ia < 0 || ib < 0) return;
    var w;
    if (scope === 'sentence') {
      var paras = layout(shownText(L[ia]));
      var sents = [];
      paras.forEach(function (p) { sents = sents.concat(p.sents); });
      if (!sents.length) return;
      var hit = sents[sents.length - 1];
      for (var i = 0; i < sents.length; i++) if (s.a.off < sents[i].end || (s.a.off === sents[i].end && i === sents.length - 1)) { hit = sents[i]; break; }
      state.anchor = { block: L[ia].id, start: hit.start, end: hit.end };
      setSel('sentence', { block: L[ia].id, off: hit.start }, { block: L[ia].id, off: hit.end });
    } else if (scope === 'paragraph') {
      var pa = layout(shownText(L[ia])), pb = layout(shownText(L[ib]));
      if (!pa.length || !pb.length) return;
      var p1 = paraAt(pa, s.a.off);
      var p2 = paraAt(pb, Math.max(s.b.off - 1, 0));
      setSel('paragraph', { block: L[ia].id, off: p1.start }, { block: L[ib].id, off: p2.end });
    } else if (scope === 'section') {
      var isHead = function (b) { return /^h[1-3]$/.test(b.kind); };
      var start = ia;
      while (start > 0 && !isHead(L[start])) start--;
      if (!isHead(L[start])) start = 0;
      var end = ib + 1;
      while (end < L.length && !isHead(L[end])) end++;
      w = wholeBlocks(start, end - 1);
      setSel('section', w.a, w.b);
    } else if (scope === 'all') {
      if (!L.length) return;
      w = wholeBlocks(0, L.length - 1);
      setSel('all', w.a, w.b);
    }
  }

  // ---------------------------------------------------------------- save ui.json
  function scheduleSave() {
    if (!state.slug || !state.doc) return;
    if (saveTimer) clearTimeout(saveTimer);
    var slug = state.slug;
    saveTimer = setTimeout(function () {
      saveTimer = null;
      if (slug !== state.slug) return;
      postUi(slug);
    }, 200);
  }

  function postUi(slug, sel) {
    if (sel === undefined) {
      sel = null;
      if (state.sel) {
        sel = {
          scope: state.sel.scope, blocks: state.sel.blocks, text: state.sel.text,
          showing: state.sel.showing, at: state.sel.at
        };
        if (state.sel.mark) sel.mark = state.sel.mark;
      }
    }
    var body = { selection: sel, picks: state.picks, compare: state.compare };
    if (hasFb('getAll')) body.feedback = OW.feedback.getAll();
    return sendUi(slug, JSON.stringify(body));
  }

  // A save that cannot reach the server is kept and sent again after the next good poll.
  function sendUi(slug, body) {
    return fetch('/api/ui/' + encodeURIComponent(slug), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body
    }).then(function (r) {
      if (pendingUi[slug] === body) delete pendingUi[slug];
    }, function () { pendingUi[slug] = body; });
  }

  function flushPending() {
    Object.keys(pendingUi).forEach(function (slug) {
      var body = pendingUi[slug];
      delete pendingUi[slug];
      sendUi(slug, body);
    });
  }

  // Post ui.json now, so the server sees the latest picks and marks.
  function flushSave() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!state.slug || !state.doc) return Promise.resolve();
    return postUi(state.slug);
  }

  // ---------------------------------------------------------------- DOM positions
  function blockEndOff(id) { return liveText(id).length; }

  function posOf(node, offset) {
    var e = node.nodeType === 3 ? node.parentElement : node;
    if (!e) return null;
    var blockEl = e.closest('.block');
    if (!blockEl) {
      if (e === els.doc) {
        var kid = els.doc.childNodes[offset];
        if (kid && kid.dataset) return { block: kid.dataset.block, off: 0 };
        var L = liveBlocks();
        return L.length ? { block: L[L.length - 1].id, off: blockEndOff(L[L.length - 1].id) } : null;
      }
      return null;
    }
    var id = blockEl.dataset.block;
    var p = e.closest('[data-pstart]');
    if (p && blockEl.contains(p)) {
      var r = document.createRange();
      r.selectNodeContents(p);
      try { r.setEnd(node, offset); } catch (err) { return null; }
      return { block: id, off: Number(p.dataset.pstart) + r.toString().length };
    }
    if (e.closest('.ver')) return { block: id, off: blockEndOff(id) };
    if (e.classList.contains('text')) {
      var k = e.children[offset];
      if (k && k.dataset && k.dataset.pstart) return { block: id, off: Number(k.dataset.pstart) };
      return { block: id, off: blockEndOff(id) };
    }
    return { block: id, off: offset === 0 ? 0 : blockEndOff(id) };
  }

  function domPos(pt) {
    var blockEl = els.doc.querySelector('.block[data-block="' + pt.block + '"]');
    if (!blockEl) return null;
    var ps = blockEl.querySelectorAll('[data-pstart]');
    var target = null;
    for (var i = 0; i < ps.length; i++) {
      var ps0 = Number(ps[i].dataset.pstart);
      var len = ps[i].textContent.length;
      if (pt.off <= ps0 + len) { target = ps[i]; if (pt.off < ps0) pt.off = ps0; break; }
    }
    if (!target) {
      target = ps[ps.length - 1];
      if (!target) return null;
      pt = { block: pt.block, off: Number(target.dataset.pstart) + target.textContent.length };
    }
    var rest = pt.off - Number(target.dataset.pstart);
    var walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    var n, lastNode = null;
    while ((n = walker.nextNode())) {
      lastNode = n;
      if (rest <= n.nodeValue.length) return [n, rest];
      rest -= n.nodeValue.length;
    }
    return lastNode ? [lastNode, lastNode.nodeValue.length] : null;
  }

  // ---------------------------------------------------------------- selection UI
  function paintSelection() {
    var s = state.sel;
    var paint = !!(s && !s.native && interactive());
    var blocks = els.doc.querySelectorAll('.block');
    var selIds = s ? s.blocks : [];
    var ia = s ? liveIndex(s.a.block) : -1, ib = s ? liveIndex(s.b.block) : -1;
    for (var i = 0; i < blocks.length; i++) {
      var be = blocks[i];
      var id = be.dataset.block;
      var bi = liveIndex(id);
      be.classList.toggle('has-sel', !!(s && selIds.indexOf(id) >= 0));
      var spans = be.querySelectorAll('.s');
      for (var j = 0; j < spans.length; j++) {
        var on = false;
        if (paint && bi >= ia && bi <= ib) {
          var st = Number(spans[j].dataset.s), en = Number(spans[j].dataset.e);
          var afterA = bi > ia || en > s.a.off;
          var beforeB = bi < ib || st < s.b.off;
          on = afterA && beforeB;
        }
        spans[j].classList.toggle('sel', on && !(s && s.mark));
      }
    }
    var pieces = els.doc.querySelectorAll('mark.fb');
    for (var k = 0; k < pieces.length; k++) {
      pieces[k].classList.toggle('fb-sel', !!(paint && s.mark && pieces[k].dataset.fb === s.mark));
    }
  }

  // Marks painted for one feedback mark id. A mark is split per sentence.
  function markPieces(id) {
    var all = els.doc.querySelectorAll('mark.fb');
    var out = [];
    for (var i = 0; i < all.length; i++) if (all[i].dataset.fb === id) out.push(all[i]);
    return out;
  }

  function setHoverMark(id) {
    if (id === hoverMark && !id) return;
    hoverMark = id;
    var all = els.doc.querySelectorAll('mark.fb');
    for (var i = 0; i < all.length; i++) {
      all[i].classList.toggle('fb-hover', !!id && all[i].dataset.fb === id);
    }
  }

  // After a render: a mark selection needs its mark. If the mark is gone, keep the text as a free selection.
  function checkMarkSel() {
    var s = state.sel;
    if (!s || !s.mark || !interactive()) return;
    var r = hasFb('rangeOf') && markPieces(s.mark).length ? OW.feedback.rangeOf(s.mark) : null;
    if (r && liveIndex(r.block) >= 0) {
      var same = s.a && s.b && s.a.block === r.block && s.b.block === r.block && s.a.off === r.start && s.b.off === r.end;
      s.a = { block: r.block, off: r.start };
      s.b = { block: r.block, off: r.end };
      s.scope = 'mark';
      if (!same) { var at = s.at; fillSel(s); s.at = at; }
      return;
    }
    delete s.mark;
    s.scope = 'free';
    scheduleSave();
  }

  function selRect() {
    var s = state.sel;
    if (!s) return null;
    var gs = window.getSelection();
    if (s.native && gs && gs.rangeCount && !gs.isCollapsed) {
      return gs.getRangeAt(0).getBoundingClientRect();
    }
    var marked = s.mark ? markPieces(s.mark) : els.doc.querySelectorAll('.s.sel');
    if (!marked.length) return null;
    var r = document.createRange();
    r.setStartBefore(marked[0]);
    r.setEndAfter(marked[marked.length - 1]);
    return r.getBoundingClientRect();
  }

  function placeBar() {
    if (hasFb('reposition')) OW.feedback.reposition();
    var s = state.sel;
    if (!s || !interactive()) { els.bar.hidden = true; return; }
    var rect = selRect();
    if (!rect || (!rect.width && !rect.height)) { els.bar.hidden = true; return; }
    els.bar.hidden = false;
    var bw = els.bar.offsetWidth, bh = els.bar.offsetHeight;
    var hdr = els.hdr.offsetHeight;
    var top = rect.top - bh - 8;
    if (top < hdr + 6) top = rect.bottom + 8;
    top = Math.max(hdr + 6, Math.min(top, window.innerHeight - bh - 60));
    var mainRight = window.innerWidth - (document.body.classList.contains('tl-open') && window.innerWidth >= 1000 ? panelWidth() : 0);
    var left = rect.left + rect.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, mainRight - bw - 8));
    els.bar.style.top = top + 'px';
    els.bar.style.left = left + 'px';
    Array.prototype.forEach.call(els.bar.querySelectorAll('button[data-scope]'), function (b) {
      b.classList.toggle('on', b.dataset.scope === s.scope);
    });
    if (hasFb('syncBar')) OW.feedback.syncBar();
  }

  function panelWidth() { return panel ? panel.offsetWidth : 0; }

  function oneLine(t, n) {
    t = String(t).replace(/\s+/g, ' ').trim();
    return t.length > n ? t.slice(0, n) + '…' : t;
  }

  function updateStrip() {
    var s = state.sel;
    if (!s || viewing() || comparing() || !state.doc) { els.strip.hidden = true; return; }
    els.strip.hidden = false;
    els.stripText.textContent = 'Selected: ' + s.scope + ' · "' + oneLine(s.text, 80) + '"';
  }

  function updateSelUI() {
    paintSelection();
    updateStrip();
    placeBar();
  }

  function referenceText() {
    var s = state.sel;
    if (!s) return '';
    return 'Piece ' + state.slug + ', block(s) ' + s.blocks.join(', ') + ', scope ' + s.scope + ': "' + s.text + '"';
  }

  // ---------------------------------------------------------------- native drag selection
  function handleNative() {
    if (!interactive()) return;
    var gs = window.getSelection();
    if (!gs || !gs.rangeCount || gs.isCollapsed) return;
    var range = gs.getRangeAt(0);
    var L = liveBlocks();
    if (!L.length) return;
    if (!(els.doc.contains(range.startContainer) || els.doc.contains(range.endContainer) || range.intersectsNode(els.doc))) return;
    var a = posOf(range.startContainer, range.startOffset);
    var b = posOf(range.endContainer, range.endOffset);
    if (!a && !b) {
      if (!range.intersectsNode(els.doc)) return;
    }
    if (!a) a = { block: L[0].id, off: 0 };
    if (!b) b = { block: L[L.length - 1].id, off: blockEndOff(L[L.length - 1].id) };
    if (cmp(a, b) > 0) { var t = a; a = b; b = t; }
    if (cmp(a, b) === 0) return;
    var cur = state.sel;
    if (cur && cur.native && cur.a.block === a.block && cur.a.off === a.off &&
        cur.b.block === b.block && cur.b.off === b.off) { placeBar(); return; }
    state.anchor = { block: a.block, start: a.off, end: a.off };
    setSel('free', a, b, true);
  }

  // ---------------------------------------------------------------- versions
  function cycle(id, dir) {
    var b = liveBlock(id);
    if (!hasOptions(b) || viewing() || comparing()) return;
    state.accMsg = '';
    var n = b.options.length + 1;
    state.picks[id] = (((state.picks[id] || 0) + dir) % n + n) % n;
    var s = state.sel;
    if (s && s.blocks.indexOf(id) >= 0) {
      var len = shownText(b).length;
      if (s.a.block === id) s.a.off = 0;
      if (s.b.block === id) s.b.off = len;
      if (s.blocks.length === 1) s.scope = 'paragraph';
      delete s.mark;
      s.native = false;
      fillSel(s);
    }
    scheduleSave();
    render();
  }

  function keyTarget() {
    var b = state.hoverId && liveBlock(state.hoverId);
    if (hasOptions(b)) return b.id;
    var s = state.sel;
    if (s) {
      for (var i = 0; i < s.blocks.length; i++) if (hasOptions(liveBlock(s.blocks[i]))) return s.blocks[i];
    }
    return null;
  }

  // ---------------------------------------------------------------- building blocks
  function optionLabel(b, i) {
    if (i === 0) return 'Version 1 (current)';
    var note = oneLine(b.options[i - 1].note || '', 40);
    return 'Version ' + (i + 1) + (note ? ': ' + note : '');
  }

  function buildVer(b, ctx) {
    var n = b.options.length + 1;
    var pick = state.picks[b.id] || 0;
    var note = pick === 0 ? 'current' : (b.options[pick - 1].note || '');
    var ver = el('div', 'ver');
    var prev = el('button', 'vbtn prev', '‹');
    prev.type = 'button';
    prev.setAttribute('aria-label', 'Previous version');
    var next = el('button', 'vbtn next', '›');
    next.type = 'button';
    next.setAttribute('aria-label', 'Next version');
    ver.appendChild(prev);
    ver.appendChild(el('span', 'vcount', (pick + 1) + '/' + n));
    ver.appendChild(next);
    if (note) ver.appendChild(el('span', 'vnote', note));
    if (ctx.marks && hasFb('versionButtons')) {
      var fb = OW.feedback.versionButtons(b.id, pick);
      if (fb) ver.appendChild(fb);
    }
    // Compare this version with another one of the same paragraph.
    var c = state.compare[b.id];
    var on = !!(c && c.on);
    var tg = el('button', 'cmp-toggle', 'Compare');
    tg.type = 'button';
    tg.setAttribute('aria-pressed', on ? 'true' : 'false');
    ver.appendChild(tg);
    if (on) {
      ver.appendChild(el('span', 'cmp-label', 'Version ' + (pick + 1) + ' vs'));
      var sel = el('select', 'cmp-sel');
      sel.setAttribute('aria-label', 'Version to compare with');
      for (var i = 0; i < n; i++) {
        var o = el('option', null, optionLabel(b, i));
        o.value = String(i);
        if (i === c.base) o.selected = true;
        sel.appendChild(o);
      }
      ver.appendChild(sel);
      if (pick === c.base) ver.appendChild(el('span', 'vnote', 'Same as the version you are comparing with.'));
    }
    var drop = pick === 0;
    var useLabel = drop ? 'Drop the other versions' : (isTitle(b) ? 'Use this title' : 'Use this version');
    var uv = el('button', drop ? 'ver-drop' : 'ver-use', state.accBusy && state.accId === b.id ? 'Saving…' : useLabel);
    uv.type = 'button';
    if (state.accBusy) uv.disabled = true;
    ver.appendChild(uv);
    if (state.accMsg && state.accId === b.id) ver.appendChild(el('span', 'vnote err', state.accMsg));
    return ver;
  }

  // ctx = { badge, marks, cmp, baseText }
  function buildBlock(b, text, ctx) {
    var wrap = el('div', 'block k-' + b.kind + (ctx.cmp ? ' cmp' : ''));
    wrap.dataset.block = b.id;
    var tag = /^h[1-3]$/.test(b.kind) ? b.kind : 'p';
    var box = el('div', 'text');

    if (ctx.cmp) {
      if (hasOW('renderDiff')) {
        var out = OW.renderDiff(ctx.baseText, text);
        if (out && out.nodeType === 1) box.appendChild(out);
        else box.innerHTML = out || ''; // renderDiff escapes its text and wraps output in <p>
      } else {
        box.appendChild(el(tag, null, text));
      }
    } else if (b.kind === 'code') {
      // Code stays whole: no sentence spans. data-pstart lets drag selection map offsets.
      var pre = el('pre');
      pre.dataset.pstart = 0;
      pre.appendChild(el('code', null, text));
      box.appendChild(pre);
    } else {
      var lay = layout(text);
      lay.forEach(function (para) {
        // Each paragraph shows by its own kind: a "## " line is a heading (marks hidden), else the block's tag
        // when it is the only paragraph, else a plain paragraph.
        var hm = /^(#{1,3})[ \t]+/.exec(text.slice(para.start, para.end));
        var ptag = hm ? 'h' + hm[1].length : (lay.length === 1 ? tag : 'p');
        var from = para.start + (hm ? hm[0].length : 0);
        var p = el(ptag, hm ? 'ph' : (ptag !== tag ? 'pl' : null)); // ph: own heading, pl: plain paragraph in a heading block
        p.dataset.pstart = from;
        var pos = from;
        para.sents.forEach(function (s) {
          if (s.end <= from) return;
          if (s.start < from) s = { start: from, end: s.end };
          if (s.start > pos) p.appendChild(document.createTextNode(text.slice(pos, s.start)));
          var sp = el('span', 's', text.slice(s.start, s.end));
          sp.dataset.s = s.start;
          sp.dataset.e = s.end;
          p.appendChild(sp);
          pos = s.end;
        });
        if (pos < para.end) p.appendChild(document.createTextNode(text.slice(pos, para.end)));
        box.appendChild(p);
      });
    }
    wrap.appendChild(box);
    if (ctx.marks && hasFb('paintBlock')) OW.feedback.paintBlock(wrap, b.id, state.picks[b.id] || 0, text);

    if (ctx.badge && hasOptions(b)) wrap.appendChild(buildVer(b, ctx));
    return wrap;
  }

  function fetchSnap(file) {
    var slug = state.slug;
    var key = slug + '/' + file;
    if (snapCache.has(key)) return Promise.resolve(snapCache.get(key));
    return fetch('/api/history/' + encodeURIComponent(slug) + '/' + encodeURIComponent(file), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('snapshot ' + r.status); return r.json(); })
      .then(function (d) {
        var doc = d && d.doc && d.doc.blocks ? d.doc : d;
        snapCache.set(key, doc);
        return doc;
      });
  }

  // ---------------------------------------------------------------- render
  function renderTimeline() {
    if (!panel || !(window.OW && OW.timeline && OW.timeline.render)) return;
    OW.timeline.render(state.history, {
      baseFile: state.cmpFile, showFile: state.showFile,
      canReveal: state.canReveal, busy: state.tlBusy, msg: state.tlMsg
    });
  }

  function renderHeader() {
    var piece = !!state.slug;
    els.back.hidden = !piece;
    els.actions.hidden = !piece || !state.doc;
    var title = piece && state.doc && state.doc.title ? state.doc.title : (piece ? state.slug : 'Ownwords Lite');
    els.title.textContent = title;
    document.title = piece && state.doc ? title + ' · Ownwords Lite' : 'Ownwords Lite';
    els.btnReveal.hidden = !state.canReveal;
    els.btnPrompt.hidden = !state.dir;
    els.title.title = piece && state.dir ? state.dir + '/' + state.slug + '.md' : '';
    els.btnTimeline.setAttribute('aria-pressed', tlOn ? 'true' : 'false');
  }

  function renderBanner() {
    if (state.showFile) {
      els.banner.hidden = false;
      els.banner.textContent = 'Viewing an old version. ';
      var b = el('button', null, 'Back to live');
      b.type = 'button';
      b.addEventListener('click', function () { showVersion(null); });
      els.banner.appendChild(b);
    } else if (comparing()) {
      var at = null;
      state.history.forEach(function (h) { if (h.file === state.cmpFile) at = h.at; });
      var when = at && window.OW && OW.timeline && OW.timeline.formatTime ? OW.timeline.formatTime(at) : '';
      els.banner.hidden = false;
      els.banner.textContent = 'Changes since ' + (when || 'the version you picked') + '. ';
      var sb = el('button', null, 'Stop comparing');
      sb.type = 'button';
      sb.addEventListener('click', function () { setBase(null); });
      els.banner.appendChild(sb);
    } else {
      els.banner.hidden = true;
      els.banner.textContent = '';
    }
  }

  function renderStale() {
    var st = state.doc && Array.isArray(state.doc.stale) ? state.doc.stale : [];
    if (!state.slug || !state.doc || state.notFound || viewing() || comparing() || !st.length) {
      els.stale.hidden = true;
      els.stale.textContent = '';
      return;
    }
    els.stale.hidden = false;
    els.stale.textContent = '';
    els.stale.appendChild(el('h2', null, 'Versions that no longer match the text'));
    els.stale.appendChild(el('p', 'note-msg', 'The text changed after these were written, so they are not shown in place.'));
    st.forEach(function (g) {
      var opts = Array.isArray(g.options) ? g.options : [];
      var d = el('details', 'stale-g');
      d.open = !!state.staleOpen[g.id];
      d.appendChild(el('summary', null, 'Was: ' + oneLine(g.original || '', 60) + ' (' + opts.length + ' version' + (opts.length === 1 ? '' : 's') + ')'));
      d.appendChild(el('blockquote', 'stale-orig', String(g.original || '')));
      var ol = el('ol');
      opts.forEach(function (o) {
        var li = el('li', null, String(o.text || ''));
        if (o.note) li.appendChild(el('span', 'vnote', ' ' + o.note));
        ol.appendChild(li);
      });
      d.appendChild(ol);
      d.addEventListener('toggle', function () { state.staleOpen[g.id] = d.open; });
      els.stale.appendChild(d);
    });
  }

  function renderHome() {
    renderHeader();
    renderBanner();
    els.doc.hidden = true;
    els.stale.hidden = true;
    els.bar.hidden = true;
    els.strip.hidden = true;
    els.home.hidden = false;
    els.home.textContent = '';
    els.home.appendChild(el('h2', null, 'Your pieces'));
    var list = state.pieces;
    if (list === null) { els.home.appendChild(el('p', 'note-msg', 'Loading…')); return; }
    if (!list.length) {
      els.home.appendChild(el('p', 'empty', 'No pieces yet. Ask your agent to start one.'));
      return;
    }
    var ul = el('ul');
    list.forEach(function (p) {
      var li = el('li');
      var a = el('a');
      a.href = '#' + encodeURIComponent(p.slug);
      a.appendChild(el('span', 't', p.title || p.slug));
      var d = p.updated ? new Date(p.updated) : null;
      if (d && !isNaN(d.getTime())) a.appendChild(el('span', 'd', d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
      li.appendChild(a);
      ul.appendChild(li);
    });
    els.home.appendChild(ul);
  }

  function render() {
    if (!state.slug) { renderHome(); return; }
    els.home.hidden = true;
    renderHeader();
    if (state.notFound) {
      els.doc.hidden = false;
      els.doc.classList.add('ro');
      els.doc.textContent = '';
      els.doc.appendChild(el('p', 'note-msg', 'This piece was not found. Go back to the list of pieces.'));
      els.stale.hidden = true;
      els.bar.hidden = true;
      els.strip.hidden = true;
      renderBanner();
      return;
    }
    if (!state.doc) {
      els.doc.hidden = false;
      els.doc.classList.add('ro');
      els.doc.textContent = '';
      els.doc.appendChild(el('p', 'note-msg', 'Loading…'));
      els.stale.hidden = true;
      return;
    }

    var y = window.scrollY;
    normalizePicks();
    if (hasFb('reconcile')) {
      OW.feedback.reconcile(liveBlocks().filter(function (b) { return !hasOptions(b); })
        .map(function (b) { return { id: b.id, text: String(b.text || '') }; }));
    }
    reconcile();
    renderBanner();

    var isView = viewing();
    var isCmp = comparing();
    var doc = isView ? state.showDoc : state.doc;
    var blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
    var frag = document.createDocumentFragment();
    var snap = null;
    if (isCmp) {
      snap = snapCache.get(state.slug + '/' + state.cmpFile) || null;
      if (!snap) {
        var cf = state.cmpFile, cs = state.slug;
        fetchSnap(cf).then(function () { if (cs === state.slug && cf === state.cmpFile) render(); }).catch(function () {});
      }
    }
    if (snap && Array.isArray(snap.blocks) && hasOW('renderDocDiff')) {
      // Whole-piece compare: file text on both sides, picks are ignored.
      frag.appendChild(OW.renderDocDiff(snap.blocks, blocks));
    } else {
      blocks.forEach(function (b) {
        var pick = state.picks[b.id] || 0;
        var c = state.compare[b.id];
        var ctx = { badge: !isView && !isCmp, marks: false, cmp: false, baseText: null };
        if (ctx.badge && hasOptions(b) && c && c.on && pick !== c.base) {
          ctx.cmp = true;
          ctx.baseText = c.base === 0 ? String(b.text || '') : String(b.options[c.base - 1].text || '');
        }
        ctx.marks = !isView && !isCmp && !ctx.cmp;
        frag.appendChild(buildBlock(b, isView ? String(b.text || '') : shownText(b), ctx));
      });
    }

    els.doc.hidden = false;
    els.doc.classList.toggle('ro', !interactive());
    els.doc.replaceChildren(frag);
    window.scrollTo(0, y);
    checkMarkSel();
    if (hoverMark) setHoverMark(hoverMark);

    // Restore a native (free) selection.
    var s = state.sel;
    if (s && s.native && interactive()) {
      var p1 = domPos({ block: s.a.block, off: s.a.off });
      var p2 = domPos({ block: s.b.block, off: s.b.off });
      if (p1 && p2) {
        var r = document.createRange();
        r.setStart(p1[0], p1[1]);
        r.setEnd(p2[0], p2[1]);
        var gs = window.getSelection();
        ignoreUntil = performance.now() + 150;
        gs.removeAllRanges();
        gs.addRange(r);
      } else {
        s.native = false;
      }
    }
    updateSelUI();
    renderStale();
    renderTimeline();
  }

  // ---------------------------------------------------------------- versions of the piece (timeline)
  function showVersion(file) {
    state.showFile = file || null;
    state.showDoc = null;
    state.cmpFile = null;
    if (!file) { render(); return; }
    var slug = state.slug;
    fetchSnap(file).then(function (d) {
      if (slug === state.slug && state.showFile === file) { state.showDoc = d; render(); }
    }).catch(function () {});
    render();
  }

  function setBase(file) {
    state.cmpFile = file || null;
    state.showFile = null;
    state.showDoc = null;
    if (file) {
      var slug = state.slug;
      fetchSnap(file).then(function () { if (slug === state.slug && state.cmpFile === file) render(); }).catch(function () {});
    }
    render();
  }

  // Accept a version of a group (pick > 0), or drop the other versions (pick 0).
  // For the title paragraph the server renames the file.
  async function useVersion(id) {
    var pick = state.picks[id] || 0;
    if (state.accBusy || viewing() || comparing()) return;
    var renames = isTitle(liveBlock(id)) && pick > 0;
    var slug = state.slug;
    state.accBusy = true;
    state.accId = id;
    state.accMsg = '';
    render();
    var msg = '';
    var data = null;
    try {
      await flushSave();
      var r = await fetch('/api/accept/' + encodeURIComponent(slug), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group: id, pick: pick, etag: state.etag })
      });
      if (r.ok) data = await r.json();
      else if (r.status === 409) msg = 'The file changed. Try again.';
      else msg = renames ? 'Could not rename. Nothing was changed.' : 'Could not save. Nothing was changed.';
    } catch (e) {
      msg = renames ? 'Could not rename. Nothing was changed.' : 'Could not save. Nothing was changed.';
    }
    if (slug !== state.slug) return;
    state.accBusy = false;
    state.etag = null;
    if (data && data.slug && data.slug !== slug) {
      location.hash = '#' + encodeURIComponent(data.slug); // route() starts the new piece
      return;
    }
    state.accMsg = msg;
    render();
    tick();
  }

  // ---------------------------------------------------------------- restore and reveal
  function tlNote(text) {
    var slug = state.slug;
    state.tlMsg = text;
    renderTimeline();
    if (text) setTimeout(function () {
      if (slug === state.slug && state.tlMsg === text) { state.tlMsg = ''; renderTimeline(); }
    }, 5000);
  }

  async function restoreVersion(file) {
    if (state.tlBusy || !state.slug) return;
    var slug = state.slug;
    state.tlBusy = true;
    tlNote('');
    var msg = '';
    var ok = false;
    try {
      var r = await fetch('/api/restore/' + encodeURIComponent(slug), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: file, etag: state.etag })
      });
      if (r.ok) ok = true;
      else if (r.status === 409) msg = 'The file changed. Try again.';
      else msg = 'Could not restore. Nothing was changed.';
    } catch (e) {
      msg = 'Could not restore. Nothing was changed.';
    }
    if (slug !== state.slug) return;
    state.tlBusy = false;
    if (ok) {
      state.etag = null;
      state.showFile = null;
      state.showDoc = null;
      render();
      tick();
    } else {
      tlNote(msg);
    }
  }

  async function reveal(file, btn) {
    if (!state.slug) return;
    var slug = state.slug;
    var ok = false;
    try {
      var r = await fetch('/api/reveal/' + encodeURIComponent(slug), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(file ? { file: file } : {})
      });
      ok = r.ok;
    } catch (e) { /* shown below */ }
    if (ok || slug !== state.slug) return;
    if (btn) {
      var old = btn.dataset.label || btn.textContent;
      btn.dataset.label = old;
      btn.textContent = 'Could not open';
      setTimeout(function () { btn.textContent = old; }, 1800);
    } else {
      tlNote('Could not open Finder.');
    }
  }

  // ---------------------------------------------------------------- copy
  function plainText() {
    var doc = viewing() ? state.showDoc : state.doc;
    if (!doc || !doc.blocks) return '';
    var live = !viewing();
    return doc.blocks.map(function (b) {
      var t = live ? shownText(b) : String(b.text || '');
      var m = /^h([1-3])$/.exec(b.kind);
      return m ? '#'.repeat(Number(m[1])) + ' ' + t : t;
    }).join('\n\n') + '\n';
  }

  function promptText() {
    var dir = state.dir;
    return 'Polish "' + state.slug + '.md" in "' + dir + '". First read "' + dir + '/OWNWORDS.md".';
  }

  function copy(text, btn, label) {
    function done() {
      var old = btn.dataset.label || btn.textContent;
      btn.dataset.label = old;
      btn.textContent = label;
      setTimeout(function () { btn.textContent = old; }, 1400);
    }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) {}
      document.body.removeChild(ta);
      handleNativeLater();
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  function handleNativeLater() { /* fallback copy changes the native selection; restore model view */ render(); }

  // ---------------------------------------------------------------- polling
  // fetch for the poll: remember that the failure was the network, not our own code
  function poll(url, opts) {
    return fetch(url, opts).catch(function (e) { netErr = true; throw e; });
  }

  async function loadPieces() {
    var r = await poll('/api/pieces', { cache: 'no-store' });
    if (!r.ok || state.slug) return;
    var list = await r.json();
    var key = JSON.stringify(list);
    if (key !== state.piecesKey || state.pieces === null) {
      state.pieces = list;
      state.piecesKey = key;
      if (!state.slug) renderHome();
    }
  }

  async function loadDoc() {
    var slug = state.slug;
    var headers = {};
    if (state.etag) headers['If-None-Match'] = state.etag;
    var r = await poll('/api/doc/' + encodeURIComponent(slug), { headers: headers, cache: 'no-store' });
    if (slug !== state.slug) return;
    if (r.status === 304) return;
    if (r.status === 404 || r.status === 400) {
      var gone = await r.json().catch(function () { return null; });
      if (gone && gone.movedTo) { location.hash = '#' + encodeURIComponent(gone.movedTo); return; }
      if (!state.notFound) { state.notFound = true; render(); }
      return;
    }
    if (!r.ok) return;
    var data = await r.json();
    if (slug !== state.slug) return;
    var first = !state.doc;
    state.notFound = false;
    state.etag = r.headers.get('ETag') || data.etag || null;
    state.doc = data.doc;
    state.dir = typeof data.dir === 'string' ? data.dir : null;
    state.canReveal = data.canReveal === true;
    state.history = Array.isArray(data.history) ? data.history : [];
    if (first) initFromUi(data.ui);
    if (mouseDown) { pendingRender = true; return; }
    render();
  }

  function initFromUi(ui) {
    ui = ui && typeof ui === 'object' ? ui : {};
    var picks = ui.picks && typeof ui.picks === 'object' ? ui.picks : {};
    Object.keys(picks).forEach(function (k) { if (Number.isInteger(picks[k])) state.picks[k] = picks[k]; });
    var cm = ui.compare && typeof ui.compare === 'object' ? ui.compare : {};
    Object.keys(cm).forEach(function (k) {
      var c = cm[k];
      if (c && typeof c === 'object') state.compare[k] = { on: !!c.on, base: Number.isInteger(c.base) ? c.base : 0 };
    });
    if (hasFb('load')) OW.feedback.load(Array.isArray(ui.feedback) ? ui.feedback : []);
    var s = ui.selection;
    if (s && typeof s.text === 'string' && Array.isArray(s.blocks) && s.blocks.length) {
      state.sel = {
        scope: s.scope === 'mark' && typeof s.mark !== 'string' ? 'free' : (s.scope || 'free'), a: null, b: null, text: s.text, blocks: s.blocks.slice(),
        showing: s.showing || {}, at: s.at || new Date().toISOString(), native: false
      };
      if (s.scope === 'mark' && typeof s.mark === 'string') state.sel.mark = s.mark;
    }
  }

  async function tick() {
    if (busy || state.accBusy) return;
    busy = true;
    try {
      if (state.slug) await loadDoc(); else await loadPieces();
      fails = 0;
      els.offline.hidden = true;
      flushPending();
    } catch (e) {
      if (netErr) {
        fails++; // two misses in a row (about 2 s) show the notice
        if (fails >= 2) els.offline.hidden = false;
      } else {
        // the server answered; our own code failed, so show it in the console
        fails = 0;
        els.offline.hidden = true;
        console.error(e);
      }
    }
    netErr = false;
    busy = false;
  }

  function route() {
    var h = location.hash.replace(/^#\/?/, '');
    try { h = decodeURIComponent(h); } catch (e) {}
    var slug = h && h[0] !== '.' && !/[\/\\\x00-\x1f\x7f]/.test(h) ? h : null;
    if (hasFb('closeWhy')) OW.feedback.closeWhy();
    resetState(slug);
    if (h && !slug) { state.slug = h; state.notFound = true; }
    window.scrollTo(0, 0);
    els.bar.hidden = true;
    els.strip.hidden = true;
    if (slug || state.notFound) render(); else { renderHome(); }
    renderTimeline();
    tick();
  }

  // ---------------------------------------------------------------- events
  function inChrome(t) { return !!(t && t.closest && t.closest('#selbar, #strip, #hdr, #timeline, #banner, #stale, #fbwhy')); }

  function setupEvents() {
    els.doc.addEventListener('mouseover', function (e) {
      var b = e.target.closest && e.target.closest('.block');
      state.hoverId = b ? b.dataset.block : null;
    });
    els.doc.addEventListener('mouseover', function (e) {
      var mk = e.target.closest && e.target.closest('mark.fb');
      var id = mk ? mk.dataset.fb : null;
      if (id !== hoverMark) setHoverMark(id);
    });
    els.doc.addEventListener('mouseout', function (e) {
      if (!hoverMark) return;
      var to = e.relatedTarget;
      var mk = to && to.closest ? to.closest('mark.fb') : null;
      if (!mk || mk.dataset.fb !== hoverMark) setHoverMark(null);
    });
    els.doc.addEventListener('mouseleave', function () { state.hoverId = null; setHoverMark(null); });

    document.addEventListener('mousedown', function (e) {
      var t = e.target.nodeType === 1 ? e.target : e.target.parentElement;
      if (!t) return;
      if (inChrome(t)) {
        if (t.closest('#selbar')) e.preventDefault();
        return;
      }
      mouseDown = true;
      if (t.closest('.ver') && !t.closest('select')) { e.preventDefault(); return; }
      if (e.shiftKey && interactive() && els.doc.contains(t)) e.preventDefault();
    });

    document.addEventListener('mouseup', function () {
      if (!mouseDown) return;
      mouseDown = false;
      setTimeout(function () {
        handleNative();
        if (pendingRender) { pendingRender = false; render(); }
      }, 0);
    });

    els.doc.addEventListener('change', function (e) {
      var sel = e.target.closest && e.target.closest('select.cmp-sel');
      if (!sel) return;
      var id = sel.closest('.block').dataset.block;
      var c = state.compare[id] || (state.compare[id] = { on: true, base: 0 });
      c.base = Number(sel.value) || 0;
      scheduleSave();
      render();
    });

    els.doc.addEventListener('click', function (e) {
      var tg = e.target.closest('.cmp-toggle');
      if (tg) {
        var cid = tg.closest('.block').dataset.block;
        var cc = state.compare[cid] || (state.compare[cid] = { on: false, base: 0 });
        cc.on = !cc.on;
        scheduleSave();
        render();
        return;
      }
      var uv = e.target.closest('.ver-use, .ver-drop');
      if (uv) { useVersion(uv.closest('.block').dataset.block); return; }
      var vb = e.target.closest('.vbtn');
      if (vb) {
        var be = vb.closest('.block');
        cycle(be.dataset.block, vb.classList.contains('next') ? 1 : -1);
        return;
      }
      if (!interactive()) return;
      var gs = window.getSelection();
      if (gs && !gs.isCollapsed) return;
      if (e.target.closest('.ver')) return;
      var mk = e.target.closest('mark.fb');
      if (mk && hasFb('rangeOf')) {
        var r = OW.feedback.rangeOf(mk.dataset.fb);
        if (r) {
          state.anchor = null;
          setSel('mark', { block: r.block, off: r.start }, { block: r.block, off: r.end }, false, mk.dataset.fb);
          return;
        }
      }
      var span = e.target.closest('.s');
      if (!span) { clearSel(); return; }
      var id = span.closest('.block').dataset.block;
      var s = Number(span.dataset.s), en = Number(span.dataset.e);
      if (e.shiftKey && (state.anchor || state.sel)) {
        var anc = state.anchor || { block: state.sel.a.block, start: state.sel.a.off, end: state.sel.a.off };
        state.anchor = anc;
        var c1 = { block: id, off: s }, c2 = { block: id, off: en };
        var a1 = { block: anc.block, off: anc.start }, a2 = { block: anc.block, off: anc.end };
        var A = cmp(a1, c1) <= 0 ? a1 : c1;
        var B = cmp(a2, c2) >= 0 ? a2 : c2;
        var same = A.block === B.block && A.off === s && B.off === en;
        setSel(same ? 'sentence' : 'free', A, B);
      } else {
        state.anchor = { block: id, start: s, end: en };
        setSel('sentence', { block: id, off: s }, { block: id, off: en });
      }
    });

    els.bar.addEventListener('click', function (e) {
      var act = e.target.closest('button[data-action]');
      if (act) { if (hasFb('voteSelection')) OW.feedback.voteSelection(act.dataset.action); return; }
      var b = e.target.closest('button[data-scope]');
      if (!b) return;
      if (b.dataset.scope === 'clear') clearSel(); else widen(b.dataset.scope);
    });

    els.btnRef.addEventListener('click', function () { copy(referenceText(), els.btnRef, 'Copied'); });
    els.btnCopy.addEventListener('click', function () { copy(plainText(), els.btnCopy, 'Copied'); });
    if (window.matchMedia) {
      var narrow = window.matchMedia('(max-width: 600px)');
      var setPromptLabel = function () { delete els.btnPrompt.dataset.label; els.btnPrompt.textContent = narrow.matches ? 'Prompt' : 'Copy prompt'; };
      setPromptLabel();
      if (narrow.addEventListener) narrow.addEventListener('change', setPromptLabel);
    }
    els.btnPrompt.addEventListener('click', function () { if (state.dir) copy(promptText(), els.btnPrompt, 'Copied'); });
    els.btnReveal.addEventListener('click', function () { reveal(null, els.btnReveal); });
    els.btnTimeline.addEventListener('click', function () {
      tlOn = !tlOn;
      document.body.classList.toggle('tl-open', tlOn);
      renderHeader();
      renderTimeline();
      placeBar();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        if (state.sel || state.anchor) { clearSel(); }
        return;
      }
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey &&
          state.doc && !viewing() && !comparing() && state.slug) {
        var t = e.target;
        if (t && /^(input|textarea|select)$/i.test(t.tagName)) return;
        var id = keyTarget();
        if (id) { e.preventDefault(); cycle(id, e.key === 'ArrowRight' ? 1 : -1); }
      }
    });

    document.addEventListener('selectionchange', function () {
      if (mouseDown || performance.now() < ignoreUntil) return;
      var gs = window.getSelection();
      if (!gs || gs.isCollapsed) return;
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(handleNative, 250);
    });

    var raf = 0;
    function reflow() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; placeBar(); });
    }
    window.addEventListener('scroll', reflow, { passive: true });
    window.addEventListener('resize', reflow);
    window.addEventListener('hashchange', route);
  }

  // ---------------------------------------------------------------- feedback host
  // The selection as one target per block: offsets into the text shown at that version.
  function fbSelection() {
    var s = state.sel;
    if (!s || !s.a || !s.b || !interactive()) return null;
    var L = liveBlocks();
    var ia = liveIndex(s.a.block), ib = liveIndex(s.b.block);
    if (ia < 0 || ib < 0) return null;
    var targets = [];
    for (var i = ia; i <= ib; i++) {
      var b = L[i];
      var c = state.compare[b.id];
      var pick = state.picks[b.id] || 0;
      if (hasOptions(b) && c && c.on && pick !== c.base) continue; // diff blocks carry no marks
      var t = shownText(b);
      var start = i === ia ? s.a.off : 0;
      var end = i === ib ? s.b.off : t.length;
      if (end > start) targets.push({ block: b.id, version: pick, start: start, end: end });
    }
    return targets.length ? { text: s.text, targets: targets } : null;
  }

  // ---------------------------------------------------------------- start
  function start() {
    panel = el('aside');
    panel.id = 'timeline';
    panel.setAttribute('aria-label', 'Timeline');
    document.body.appendChild(panel);
    if (window.OW && OW.timeline && OW.timeline.init) {
      OW.timeline.init(panel, {
        onBase: setBase, onShow: showVersion, onRestore: restoreVersion,
        onReveal: function (file) { reveal(file, null); }
      });
    } else {
      panel.textContent = 'Timeline is not available.';
    }
    if (hasFb('init')) {
      OW.feedback.init({
        bar: els.bar, doc: els.doc,
        host: { selection: fbSelection, changed: function () { scheduleSave(); render(); } }
      });
    }
    setupEvents();
    route();
    setInterval(tick, 1000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
