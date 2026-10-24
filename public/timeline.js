/* Ownwords Lite: history timeline panel. Plain DOM, text set with textContent. */
(function (root) {
  'use strict';

  var OW = root.OW = root.OW || {};
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  var panel = null;
  var handlers = {};

  function pad(n) { return n < 10 ? '0' + n : String(n); }

  function formatTime(at) {
    var d = new Date(at);
    if (isNaN(d.getTime())) return String(at == null ? '' : at);
    var now = new Date();
    var hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
    if (d.toDateString() === now.toDateString()) return hm;
    var day = MONTHS[d.getMonth()] + ' ' + d.getDate();
    if (d.getFullYear() !== now.getFullYear()) day += ', ' + d.getFullYear();
    return day + ', ' + hm;
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function button(label, cls, onClick, pressed) {
    var b = el('button', 'ow-tl-btn ' + cls, label);
    b.type = 'button';
    if (pressed != null) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    b.addEventListener('click', onClick);
    return b;
  }

  function init(panelEl, h) {
    panel = panelEl;
    handlers = h || {};
    if (panel) panel.classList.add('ow-timeline');
  }

  function render(history, state) {
    if (!panel) return;
    state = state || {};
    history = Array.isArray(history) ? history : [];
    while (panel.firstChild) panel.removeChild(panel.firstChild);

    var head = el('div', 'ow-tl-head');
    head.appendChild(el('h2', 'ow-tl-title', 'History'));
    if (state.showFile) {
      head.appendChild(button('Back to live', 'ow-tl-live', function () {
        if (handlers.onShow) handlers.onShow(null);
      }));
    }
    panel.appendChild(head);
    panel.appendChild(el('p', 'ow-tl-copy', 'Each row is a saved state of the file. Versions you flip through are not saved until you use one.'));
    if (state.msg) panel.appendChild(el('p', 'ow-tl-msg', state.msg));

    if (!history.length) {
      panel.appendChild(el('p', 'ow-tl-empty', 'No history yet.'));
      return;
    }

    var list = el('ol', 'ow-tl-list');
    var lastIndex = history.length - 1;
    for (var i = lastIndex; i >= 0; i--) {
      list.appendChild(row(history[i], i === lastIndex, state));
    }
    panel.appendChild(list);
  }

  function row(item, isCurrent, state) {
    var file = item.file;
    var isBase = state.baseFile === file;
    var isShown = state.showFile === file;
    var cls = 'ow-tl-row';
    if (isCurrent) cls += ' is-current';
    if (isBase) cls += ' is-base';
    if (isShown) cls += ' is-shown';
    var li = el('li', cls);

    var top = el('div', 'ow-tl-meta');
    top.appendChild(el('span', 'ow-tl-time', formatTime(item.at)));
    if (isCurrent) top.appendChild(el('span', 'ow-tl-now', 'now'));
    li.appendChild(top);

    li.appendChild(el('div', 'ow-tl-note', item.note ? item.note : 'Edited'));

    var actions = el('div', 'ow-tl-actions');
    if (!isCurrent) {
      actions.appendChild(button(isBase ? 'Stop comparing' : 'Compare', 'ow-tl-compare', function () {
        if (handlers.onBase) handlers.onBase(isBase ? null : file);
      }, isBase));
    }
    actions.appendChild(button('View', 'ow-tl-view', function () {
      if (handlers.onShow) handlers.onShow(file);
    }, isShown));
    if (!isCurrent) {
      var rb = button('Restore', 'ow-tl-restore', function () {
        if (handlers.onRestore) handlers.onRestore(file);
      });
      if (state.busy) rb.disabled = true;
      actions.appendChild(rb);
    }
    if (state.canReveal) {
      actions.appendChild(button('Show in Finder', 'ow-tl-reveal', function () {
        if (handlers.onReveal) handlers.onReveal(file);
      }));
    }
    li.appendChild(actions);
    return li;
  }

  OW.timeline = { init: init, render: render, formatTime: formatTime };
})(typeof window !== 'undefined' ? window : globalThis);
