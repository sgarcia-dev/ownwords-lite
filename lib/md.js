// Markdown paragraphs, group matching, doc building. Pure functions, no fs, no deps.

const HEAD = /^(#{1,3})[ \t]+/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const BLANK = /^\s*$/;
const FM_LINE = /^---[ \t]*$/;

// ---------- parseParas ----------

export function parseParas(text) {
  text = typeof text === 'string' ? text : '';
  // Lines with offsets in the original text. end excludes \n and a trailing \r.
  const lines = [];
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (pos < text.length) {
    let nl = text.indexOf('\n', pos);
    const next = nl === -1 ? text.length : nl + 1;
    if (nl === -1) nl = text.length;
    let end = nl;
    if (end > pos && text[end - 1] === '\r') end--;
    lines.push({ s: pos, e: end, t: text.slice(pos, end) });
    pos = next;
  }

  let i = 0;
  if (lines.length && FM_LINE.test(lines[0].t)) {
    for (let j = 1; j < lines.length; j++) {
      if (FM_LINE.test(lines[j].t)) { i = j + 1; break; }
    }
  }

  const paras = [];
  const emit = (kind, ls) => {
    const raw = ls.map((l) => l.t).join('\n');
    const m = kind === 'p' || kind === 'code' ? null : raw.match(HEAD);
    paras.push({
      kind,
      raw,
      text: m ? raw.slice(m[0].length) : raw,
      start: ls[0].s,
      end: ls[ls.length - 1].e,
    });
  };

  let cur = [];
  const flush = () => { if (cur.length) { emit('p', cur); cur = []; } };

  for (; i < lines.length; i++) {
    const l = lines[i];
    const f = l.t.match(FENCE_OPEN);
    if (f) {
      flush();
      const ch = f[1][0], len = f[1].length;
      const close = new RegExp('^ {0,3}' + (ch === '`' ? '`' : '~') + '{' + len + ',}[ \\t]*$');
      const ls = [l];
      let j = i + 1;
      for (; j < lines.length; j++) {
        ls.push(lines[j]);
        if (close.test(lines[j].t)) break;
      }
      emit('code', ls);
      i = j; // loop increments past the closing line (or past the end)
      continue;
    }
    if (BLANK.test(l.t)) { flush(); continue; }
    const h = l.t.match(HEAD);
    if (h) {
      flush();
      emit('h' + h[1].length, [l]);
      continue;
    }
    cur.push(l);
  }
  flush();
  return { paras };
}

// ---------- cleanVersions ----------

export function cleanVersions(raw) {
  const groups = [];
  const log = [];
  try {
    const seen = new Set();
    const gs = raw && Array.isArray(raw.groups) ? raw.groups : [];
    for (const g of gs) {
      if (!g || typeof g !== 'object') continue;
      if (typeof g.id !== 'string' || typeof g.original !== 'string') continue;
      if (seen.has(g.id)) continue;
      seen.add(g.id);
      const options = [];
      if (Array.isArray(g.options)) {
        for (const o of g.options) {
          if (!o || typeof o !== 'object' || typeof o.text !== 'string') continue;
          options.push({ text: o.text, note: typeof o.note === 'string' ? o.note : '' });
        }
      }
      groups.push({ id: g.id, original: g.original, options });
    }
    const ls = raw && Array.isArray(raw.log) ? raw.log : [];
    for (const e of ls) {
      if (!e || typeof e !== 'object' || typeof e.note !== 'string') continue;
      log.push({ at: typeof e.at === 'string' ? e.at : '', note: e.note });
    }
  } catch {
    // never throws
  }
  return { groups, log };
}

// ---------- matchGroups ----------

const norm = (s) => s.replace(/\s+/g, ' ').trim();
const exact = (s) => s;

export function matchGroups(paras, groups) {
  const claimed = new Array(paras.length).fill(false);
  const found = new Map();
  const origs = new Map();
  for (const g of groups) origs.set(g.id, parseParas(g.original).paras);
  for (const eq of [exact, norm]) {
    for (const g of groups) {
      if (found.has(g.id)) continue;
      const o = origs.get(g.id);
      const n = o.length;
      if (n === 0) continue;
      for (let i = 0; i + n <= paras.length; i++) {
        let ok = true;
        for (let k = 0; k < n; k++) {
          if (claimed[i + k]) { ok = false; break; }
        }
        if (!ok) continue;
        for (let k = 0; k < n; k++) {
          const p = paras[i + k];
          const want = eq(o[k].raw);
          if (!(eq(p.raw) === want || eq(p.text) === want)) { ok = false; break; }
        }
        if (!ok) continue;
        for (let k = 0; k < n; k++) claimed[i + k] = true;
        found.set(g.id, { first: i, count: n });
        break;
      }
    }
  }
  const stale = groups.filter((g) => !found.has(g.id));
  return { found, stale };
}

// ---------- buildDoc ----------

export function buildDoc(text, versions, slug) {
  const { paras } = parseParas(text);
  const { groups } = cleanVersions(versions);
  const { found, stale } = matchGroups(paras, groups);
  const titleIndex = paras.findIndex((p) => p.kind === 'h1');
  const t = titleIndex >= 0 ? paras[titleIndex].text : '';
  const title = t.trim() ? t : slug;

  const byFirst = new Map();
  for (const g of groups) {
    const f = found.get(g.id);
    if (f) byFirst.set(f.first, { g, count: f.count });
  }
  const blocks = [];
  for (let i = 0; i < paras.length; i++) {
    const hit = byFirst.get(i);
    if (hit) {
      const { g, count } = hit;
      const members = paras.slice(i, i + count);
      const b = {
        id: g.id,
        kind: count === 1 ? members[0].kind : 'p',
        // A group of several paragraphs keeps its `#` marks, so the page can show each paragraph by its kind.
        text: members.map((p) => (count === 1 ? p.text : p.raw)).join('\n\n'),
        options: g.options,
      };
      if (count === 1 && i === titleIndex) b.title = true;
      blocks.push(b);
      i += count - 1;
    } else {
      blocks.push({ id: 'p' + i, kind: paras[i].kind, text: paras[i].text });
    }
  }
  return {
    title,
    blocks,
    stale: stale.map((g) => ({ id: g.id, original: g.original, options: g.options })),
    titleIndex,
  };
}

// ---------- titles and slugs ----------

const DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/;

export function slugify(title) {
  let s = String(title ?? '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/^-+|-+$/g, '');
  if (!s) return 'untitled';
  if (DEVICE.test(s)) s += '-note';
  return s;
}

export function titleFromOption(optionText) {
  return String(optionText ?? '')
    .replace(/^\s*#{1,3}[ \t]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
    .trim();
}

export function replaceTitle(text, para, newTitle) {
  return text.slice(0, para.start) + '# ' + newTitle + text.slice(para.end);
}

export function replaceRange(text, paras, first, count, newText) {
  return text.slice(0, paras[first].start) + newText + text.slice(paras[first + count - 1].end);
}

// ---------- history ----------

export function historyNotes(files, log) {
  const entries = [];
  for (const e of log || []) {
    const t = Date.parse(e && e.at);
    if (!Number.isNaN(t) && typeof e.note === 'string') entries.push({ t, note: e.note });
  }
  const GRACE = 15000;
  const times = files.map((f) => Date.parse(f.at));
  return files.map((f, i) => {
    const hi = times[i] + GRACE;
    const lo = i === 0 || Number.isNaN(times[i - 1]) ? -Infinity : times[i - 1] + GRACE;
    let note = '';
    if (!Number.isNaN(times[i])) {
      for (const e of entries) if (e.t > lo && e.t <= hi) note = e.note;
    }
    return { file: f.file, at: f.at, note };
  });
}

// ---------- snapshot names ----------

export const SNAP = /^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)-(\d{3})\.md$/;

// Names are in UTC so snapName and snapAt round-trip.
export function snapAt(file) {
  const m = SNAP.exec(file);
  if (!m) return '';
  const [y, mo, d, h, mi, s, ms] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s, ms);
  return Number.isNaN(t) ? '' : new Date(t).toISOString();
}

export function snapName(date = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    p(date.getUTCFullYear(), 4) + p(date.getUTCMonth() + 1) + p(date.getUTCDate()) + '-' +
    p(date.getUTCHours()) + p(date.getUTCMinutes()) + p(date.getUTCSeconds()) + '-' +
    p(date.getUTCMilliseconds(), 3) + '.md'
  );
}
