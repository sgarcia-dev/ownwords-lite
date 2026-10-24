// Ownwords Lite server. Node, no dependencies. See CONTRACT.md.
import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseParas, cleanVersions, matchGroups, buildDoc, slugify, titleFromOption,
  replaceTitle, replaceRange, historyNotes, SNAP, snapAt, snapName,
} from './lib/md.js';

// Folder: argument, OWNWORDS_DIR, first non-empty line of ~/.ownwords-lite, else ~/Desktop/Ownwords.
function pickDir() {
  const home = os.homedir();
  if (process.argv[2]) return process.argv[2];
  if (process.env.OWNWORDS_DIR) return process.env.OWNWORDS_DIR;
  try {
    const line = readFileSync(path.join(home, '.ownwords-lite'), 'utf8').split(/\r?\n/).map((l) => l.trim()).find(Boolean);
    if (line) return line === '~' ? home : line.startsWith('~/') ? path.join(home, line.slice(2)) : line;
  } catch {}
  return path.join(home, 'Desktop', 'Ownwords');
}
const DIR = path.resolve(pickDir());
const PORT = Number(process.env.PORT ?? 4646);
const APP = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(process.env.OWNWORDS_LITE_PUBLIC || path.join(APP, 'public'));
const IDLE_MS = Number(process.env.OWNWORDS_IDLE_MS ?? 10 * 60_000); // 0 = never stop when idle
let lastSeen = Date.now();
// A piece id is a file name without .md: not empty, no leading dot, no slash, no control characters.
const validId = (id) => typeof id === 'string' && id !== '' && !id.startsWith('.') && !/[\/\\\x00-\x1f\x7f]/.test(id);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};
const SIDE = (slug) => path.join(DIR, '.ownwords', slug);
const MD = (slug) => path.join(DIR, slug + '.md');
const VFILE = (slug) => path.join(SIDE(slug), 'versions.json');
const CFILE = (slug) => path.join(SIDE(slug), 'closed.json');

// slug -> { key, mdKey, updated, text, vtext, vraw, versions, etag, doc, history: [{ file, at }] }
const good = new Map();

const sha = (text) => `"${crypto.createHash('sha1').update(text).digest('base64url')}"`;
const fail = (status, message) => Object.assign(new Error(message), { status });
const isObject = (x) => x && typeof x === 'object' && !Array.isArray(x);

// One writer at a time per piece, so a change makes one snapshot and an accept never races a refresh.
const queue = new Map();
const withLock = (slug, fn) => {
  const run = (queue.get(slug) ?? Promise.resolve()).then(fn);
  queue.set(slug, run.catch(() => {}));
  return run;
};

// Every atomic write is tracked, so a stop waits for the ones in flight.
const pending = new Set();
function writeAtomic(file, data) {
  const run = (async () => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    try { await fs.writeFile(tmp, data); await fs.rename(tmp, file); }
    catch (e) { await fs.rm(tmp, { force: true }).catch(() => {}); throw e; }
  })();
  const done = run.catch(() => {}).finally(() => pending.delete(done));
  pending.add(done);
  return run;
}

const statKey = async (file) => {
  try { const s = await fs.stat(file); return { key: `${s.mtimeMs}:${s.size}:${s.ino}`, mtime: s.mtime }; }
  catch { return { key: 'none' }; }
};
async function probe(slug) {
  const [md, v] = await Promise.all([statKey(MD(slug)), statKey(VFILE(slug))]);
  return { md, key: `${md.key}|${v.key}` };
}

async function readHistory(slug) {
  const files = (await fs.readdir(path.join(SIDE(slug), 'history')).catch(() => [])).filter((f) => SNAP.test(f)).sort();
  return files.map((file) => ({ file, at: snapAt(file) }));
}

// Re-read the .md and versions.json only when a stat changed. Keep the last good read on any trouble.
async function doRefresh(slug) {
  const prev = good.get(slug);
  const s = await probe(slug);
  if (s.md.key === 'none') { good.delete(slug); return null; }
  if (prev?.key === s.key) return prev;
  const text = await fs.readFile(MD(slug), 'utf8').catch(() => null);
  const vtext = await fs.readFile(VFILE(slug), 'utf8').catch(() => null);
  if (text === null || (await probe(slug)).key !== s.key) return prev ?? null; // changed mid-read
  const blank = !text.trim();
  if (blank && prev?.text.trim()) return prev; // emptied while saving: keep the last good text
  let vraw = prev?.vraw ?? {}, vgood = prev?.vtext ?? '';
  if (vtext === null) { vraw = {}; vgood = ''; }
  else { try { vraw = JSON.parse(vtext); vgood = vtext; } catch {} } // broken JSON: keep the last good
  const versions = cleanVersions(vraw);
  const { titleIndex, ...built } = buildDoc(text, vraw, slug);
  let history = prev?.history ?? await readHistory(slug);
  let snap = false;
  if (!blank) {
    if (prev) snap = text !== prev.text;
    else {
      const last = history.at(-1);
      snap = !last || (await fs.readFile(path.join(SIDE(slug), 'history', last.file), 'utf8').catch(() => null)) !== text;
    }
  }
  if (snap) {
    const file = snapName();
    await fs.mkdir(path.join(SIDE(slug), 'history'), { recursive: true });
    await fs.writeFile(path.join(SIDE(slug), 'history', file), text);
    history = [...history, { file, at: snapAt(file) }];
  }
  const entry = {
    key: s.key, mdKey: s.md.key, updated: s.md.mtime.toISOString(), text, vtext: vgood, vraw, versions,
    etag: sha(text + '\0' + vgood), doc: { ...built, log: versions.log }, history,
  };
  good.set(slug, entry);
  return entry;
}
const refresh = (slug) => withLock(slug, () => doRefresh(slug));

// The instructions file Ownwords writes into the folder is not a piece. A file the user made with the
// same name (no marker on its first line) stays a piece and is never overwritten.
const MARKER = '<!-- Generated by Ownwords';
const isGenerated = (text) => text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].startsWith(MARKER);
async function isInstructions(name) {
  if (name.toLowerCase() !== 'ownwords.md') return false;
  const text = await fs.readFile(path.join(DIR, name), 'utf8').catch(() => null);
  return text !== null && isGenerated(text);
}

async function slugs() {
  const items = await fs.readdir(DIR, { withFileTypes: true }).catch(() => []);
  const list = [];
  for (const d of items) {
    if (!d.isFile() || !d.name.endsWith('.md') || !validId(d.name.slice(0, -3))) continue;
    if (await isInstructions(d.name)) continue;
    list.push(d.name.slice(0, -3));
  }
  return list;
}

// Write <dir>/OWNWORDS.md from templates/OWNWORDS.md. Never throws. Never touches a file the user made.
async function writeInstructions() {
  try {
    const tpl = await fs.readFile(path.join(APP, 'templates', 'OWNWORDS.md'), 'utf8');
    const text = tpl.split('{{DIR}}').join(DIR).split('{{APP}}').join(APP);
    const file = path.join(DIR, 'OWNWORDS.md');
    const old = await fs.readFile(file, 'utf8').catch(() => null);
    if (old !== null && !isGenerated(old)) { console.log('Ownwords Lite: Kept your OWNWORDS.md; it may be stale.'); return; }
    if (old === text) return;
    await writeAtomic(file, text);
  } catch (e) {
    console.error(`Ownwords Lite: could not write OWNWORDS.md: ${e.message}`);
  }
}

// ~/.ownwords-lite: line 1 is the pieces folder (the user's), line 2 is this app folder (ours).
// Only when line 1 exists, so a skill can find the app. Never throws.
async function rememberApp() {
  try {
    const file = path.join(os.homedir(), '.ownwords-lite');
    const lines = (await fs.readFile(file, 'utf8').catch(() => '')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length || lines[1] === APP) return;
    await writeAtomic(file, [lines[0], APP, ...lines.slice(2)].join('\n') + '\n');
  } catch (e) {
    console.error(`Ownwords Lite: could not update ~/.ownwords-lite: ${e.message}`);
  }
}

const send = (res, status, body, headers = {}) => {
  const json = typeof body !== 'string' && body !== undefined;
  res.writeHead(status, { 'cache-control': 'no-store', ...(json && { 'content-type': TYPES['.json'] }), ...headers });
  res.end(json ? JSON.stringify(body) : body);
};

async function readBody(req, limit = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > limit) throw Object.assign(new Error('too large'), { status: 413 }); chunks.push(c); }
  return Buffer.concat(chunks).toString('utf8');
}

async function readObject(req) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { throw e.status ? e : fail(400, 'bad json'); }
  if (!isObject(body)) throw fail(400, 'body must be an object');
  return body;
}

// First free slug for a new title, like base, base-2, base-3. Compares lowercase NFC.
async function freeSlug(slug, base) {
  if (base === slug) return slug;
  const key = (n) => n.normalize('NFC').toLowerCase();
  const files = new Set((await fs.readdir(DIR).catch(() => [])).map(key));
  const sides = new Set((await fs.readdir(path.join(DIR, '.ownwords')).catch(() => [])).map(key));
  let s = base;
  for (let n = 2; files.has(s + '.md') || sides.has(s); n++) s = `${base}-${n}`;
  return s;
}

// Write the new text under the new name, then drop the old file. Undo the renames if it fails.
const renamed = new Map(); // old id -> new id after a title rename, so an open page can follow

async function swapMd(slug, newSlug, text) {
  const moved = newSlug !== slug && await fs.rename(SIDE(slug), SIDE(newSlug)).then(() => true, (e) => {
    if (e.code !== 'ENOENT') throw e;
    return false;
  });
  try {
    await writeAtomic(MD(newSlug), text);
    if (newSlug !== slug) await fs.unlink(MD(slug));
  } catch {
    if (newSlug !== slug) await fs.rm(MD(newSlug), { force: true }).catch(() => {});
    if (moved) await fs.rename(SIDE(newSlug), SIDE(slug)).catch(() => {});
    throw fail(500, 'could not save the piece');
  }
}

// Use one option. A title group renames the piece. Any other group replaces its paragraphs.
async function accept(req, slug) {
  const b = await readObject(req);
  if (typeof b.group !== 'string' || !Number.isInteger(b.pick) || b.pick < 0 || (b.etag !== undefined && typeof b.etag !== 'string')) {
    throw fail(400, 'need group and pick (0 or more); etag is optional but must be a string');
  }
  return withLock(slug, async () => {
    const e = await doRefresh(slug);
    if (!e) throw fail(404, 'no such piece');
    if (b.etag !== undefined && e.etag !== b.etag) throw fail(409, 'changed'); // no etag: no stale check
    const { paras } = parseParas(e.text);
    const g = e.versions.groups.find((x) => x.id === b.group);
    const f = g && matchGroups(paras, e.versions.groups).found.get(g.id);
    if (!f) throw fail(404, 'no such group');
    const drop = b.pick === 0;
    const opt = drop ? null : g.options[b.pick - 1];
    if (!drop && !opt) throw fail(400, 'pick out of range');
    const words = g.original.trim().split(/\s+/).slice(0, 6).join(' ');
    let newSlug = slug, newText = null, note, reply = { slug };
    if (drop) {
      note = `Dropped other versions of "${words}…"`;
    } else if (f.count === 1 && f.first === paras.findIndex((p) => p.kind === 'h1')) {
      const title = titleFromOption(opt.text);
      if (!title) throw fail(400, 'empty title');
      newText = replaceTitle(e.text, paras[f.first], title);
      newSlug = await freeSlug(slug, slugify(title));
      note = 'Title: ' + title;
      reply = { slug: newSlug, title };
    } else {
      if (!opt.text.trim()) throw fail(400, 'empty option');
      newText = replaceRange(e.text, paras, f.first, f.count, opt.text.trim());
      note = `Used version ${b.pick + 1} of "${words}…"` + (opt.note ? ` (${opt.note})` : '');
    }
    // closed.json holds the closed groups. An old versions.json may still have a closed array: move it over.
    const v = isObject(e.vraw) ? e.vraw : {};
    const raw = await fs.readFile(CFILE(slug), 'utf8').catch(() => null);
    let past = [];
    if (raw !== null) {
      try { past = JSON.parse(raw); } catch { past = null; }
      if (!Array.isArray(past)) throw fail(500, 'closed.json is not a list');
    }
    if ((await probe(slug)).key !== e.key) throw fail(409, 'changed'); // an editor or the agent wrote meanwhile
    if (newText !== null) await swapMd(slug, newSlug, newText); // a drop leaves the .md alone
    const at = new Date().toISOString();
    const { closed: old, ...rest } = v; // versions.json keeps only groups and log (and unknown keys)
    const out = {
      ...rest,
      groups: (Array.isArray(v.groups) ? v.groups : []).filter((x) => x?.id !== g.id),
      log: [...(Array.isArray(v.log) ? v.log : []), { at, note }],
    };
    // On failure there is no rollback: the group just shows as stale.
    const closed = [...past, ...(Array.isArray(old) ? old : []), {
      id: g.id, original: g.original, options: g.options, result: drop ? 'dropped' : 'used', pick: b.pick, at,
    }];
    await writeAtomic(CFILE(newSlug), JSON.stringify(closed, null, 2) + '\n').catch(() => { throw fail(500, 'saved the text but not closed.json'); });
    await writeAtomic(VFILE(newSlug), JSON.stringify(out, null, 2) + '\n').catch(() => { throw fail(500, 'saved the text but not versions.json'); });
    if (newSlug !== slug) { good.delete(slug); renamed.set(slug, newSlug); await refresh(newSlug); } else await doRefresh(slug);
    return reply;
  });
}

// Put an old snapshot back as the .md. Logs the restore, never renames. The refresh makes the new snapshot.
async function restore(req, slug) {
  const b = await readObject(req);
  if (typeof b.file !== 'string' || !SNAP.test(b.file)) throw fail(400, 'bad file');
  if (typeof b.etag !== 'string') throw fail(400, 'need file and etag');
  return withLock(slug, async () => {
    const e = await doRefresh(slug);
    if (!e) throw fail(404, 'no such piece');
    const text = await fs.readFile(path.join(SIDE(slug), 'history', b.file), 'utf8').catch(() => null);
    if (text === null) throw fail(404, 'no such snapshot');
    if (e.etag !== b.etag) throw fail(409, 'changed');
    if ((await probe(slug)).key !== e.key) throw fail(409, 'changed');
    const t = new Date(snapAt(b.file));
    const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    const v = isObject(e.vraw) ? e.vraw : {};
    const out = { ...v, log: [...(Array.isArray(v.log) ? v.log : []), { at: new Date().toISOString(), note: `Restored ${hhmm}` }] };
    await writeAtomic(VFILE(slug), JSON.stringify(out, null, 2) + '\n').catch(() => { throw fail(500, 'could not save versions.json'); });
    await writeAtomic(MD(slug), text).catch(() => { throw fail(500, 'could not save the piece'); });
    await doRefresh(slug);
    return { ok: true };
  });
}

// Show the .md or one snapshot in Finder (macOS only).
async function reveal(req, slug) {
  if (process.platform !== 'darwin') throw fail(501, 'reveal works on macOS only');
  let b = {};
  const raw = await readBody(req);
  if (raw.trim()) {
    try { b = JSON.parse(raw); } catch { throw fail(400, 'bad json'); }
    if (!isObject(b)) throw fail(400, 'body must be an object');
  }
  let target = MD(slug);
  if (b.file !== undefined && b.file !== null) {
    if (typeof b.file !== 'string' || !SNAP.test(b.file)) throw fail(400, 'bad file');
    target = path.join(SIDE(slug), 'history', b.file);
  }
  if (!(await statKey(target)).mtime) throw fail(404, 'not found');
  if (process.env.OWNWORDS_LITE_NO_OPEN !== '1') {
    await new Promise((ok, no) => execFile('open', ['-R', target], (err) => (err ? no(fail(500, 'could not open Finder')) : ok())));
  }
  return { ok: true };
}

async function api(req, res, parts, query) {
  const [, kind, rawSlug, file] = parts; // ['', 'doc', slug, file]
  let slug = rawSlug;
  try { if (slug) slug = decodeURIComponent(slug); } catch { slug = ''; }
  if (kind === 'info' && req.method === 'GET') {
    return send(res, 200, { app: 'ownwords-lite', dir: await fs.realpath(DIR).catch(() => DIR), pid: process.pid });
  }
  if (kind === 'stop') {
    if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' });
    if (req.headers['x-ownwords'] !== 'stop') return send(res, 403, { error: 'forbidden' });
    res.on('finish', () => shutdown('stopped by request'));
    return send(res, 200, { ok: true, dir: DIR });
  }
  if (kind === 'pieces' && req.method === 'GET') {
    const list = [];
    for (const s of await slugs()) {
      const e = await refresh(s);
      if (e) list.push({ slug: s, title: e.doc.title, updated: e.updated });
    }
    return send(res, 200, list.sort((a, b) => b.updated.localeCompare(a.updated)));
  }
  if (!['doc', 'history', 'ui', 'accept', 'restore', 'reveal'].includes(kind)) return send(res, 404, { error: 'not found' });
  if (!validId(slug) || await isInstructions(slug + '.md')) return send(res, 400, { error: 'bad slug' });
  if (kind === 'doc' && req.method === 'GET') {
    const e = await refresh(slug);
    if (!e) return send(res, 404, { error: 'no such piece', movedTo: renamed.get(slug) });
    if (req.headers['if-none-match'] === e.etag) return send(res, 304, undefined, { etag: e.etag });
    let ui = await fs.readFile(path.join(SIDE(slug), 'ui.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (!isObject(ui)) ui = { selection: null, picks: {} };
    return send(res, 200, { doc: e.doc, ui, etag: e.etag, history: historyNotes(e.history, e.doc.log), dir: DIR, canReveal: process.platform === 'darwin' }, { etag: e.etag });
  }
  if (kind === 'history' && req.method === 'GET') {
    if (!file || !SNAP.test(file)) return send(res, 400, { error: 'bad file' });
    const text = await fs.readFile(path.join(SIDE(slug), 'history', file), 'utf8').catch(() => null);
    if (text === null) return send(res, 404, { error: 'not found' });
    if (query.get('raw') === '1') return send(res, 200, text, { 'content-type': TYPES['.md'] });
    const { title, blocks } = buildDoc(text, null, slug);
    return send(res, 200, { title, blocks });
  }
  if (['ui', 'accept', 'restore', 'reveal'].includes(kind) && req.method === 'POST') {
    if (!(await statKey(MD(slug))).mtime) return send(res, 404, { error: 'no such piece' });
    if (kind === 'accept') return send(res, 200, await accept(req, slug));
    if (kind === 'restore') return send(res, 200, await restore(req, slug));
    if (kind === 'reveal') return send(res, 200, await reveal(req, slug));
    const ui = JSON.stringify(await readObject(req), null, 2); // stored as is
    await withLock(slug, () => writeAtomic(path.join(SIDE(slug), 'ui.json'), ui));
    return send(res, 200, { ok: true });
  }
  send(res, 405, { error: 'method not allowed' });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed');
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return send(res, 400, 'bad path'); }
  if (rel.includes('\0')) return send(res, 400, 'bad path');
  const file = path.resolve(PUBLIC, '.' + (rel.endsWith('/') ? rel + 'index.html' : rel));
  if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep)) return send(res, 403, 'forbidden');
  const data = await fs.readFile(file).catch(() => null);
  if (data === null) return send(res, 404, 'not found');
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  res.end(req.method === 'HEAD' ? undefined : data);
}

// Stop cleanly: no new connections, wait for every write in flight, exit.
let closing = false;
async function shutdown(why, code = 0) {
  if (closing) return;
  closing = true;
  setTimeout(() => process.exit(code), 3000).unref();
  server.close();
  server.closeIdleConnections?.();
  for (let i = 0; i < 10; i++) {
    await Promise.allSettled([...queue.values(), ...pending]);
    if (!pending.size) break;
  }
  console.log(`Ownwords Lite: stopped (${why})`);
  process.exit(code);
}
process.on('SIGINT', () => shutdown('signal'));
process.on('SIGTERM', () => shutdown('signal'));

const JSON_TYPE = /^application\/json\s*(;|$)/i;
const server = http.createServer(async (req, res) => {
  try {
    // Only this machine's own page may talk to the server (stops DNS rebinding from other sites).
    const port = server.address()?.port;
    if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) return send(res, 403, { error: 'forbidden host' });
    const { pathname, searchParams } = new URL(req.url, 'http://localhost');
    if (pathname !== '/api/info') lastSeen = Date.now(); // the probe a second starter sends must not keep us alive
    if (req.method === 'POST' && !JSON_TYPE.test(req.headers['content-type'] ?? '')) return send(res, 415, { error: 'content-type must be application/json' });
    if (pathname.startsWith('/api/')) return await api(req, res, pathname.slice(4).split('/'), searchParams);
    await serveStatic(req, res, pathname);
  } catch (e) {
    if (!res.headersSent) send(res, e.status ?? 500, { error: e.status ? e.message : 'server error' });
    else res.end();
  }
});

async function onListening() {
  await rememberApp();
  await writeInstructions();
  console.log(`Ownwords Lite: http://127.0.0.1:${server.address().port}`); // tests and the launcher wait for this shape
  lastSeen = Date.now();
  setInterval(() => slugs().then((l) => Promise.all(l.map(refresh))).catch(() => {}), 1000);
  if (IDLE_MS > 0) {
    let tickAt = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - tickAt > 60_000) lastSeen = now; // the Mac slept: give the page time to poll
      tickAt = now;
      if (now - lastSeen > IDLE_MS) shutdown(`idle ${Math.round(IDLE_MS / 6000) / 10} min`);
    }, Math.min(30_000, Math.max(50, IDLE_MS / 4))).unref();
  }
}

// Port taken: the same folder is already served (exit 0), our server on another folder is asked to stop
// and we take the port, anything else is an error. Retries last up to 5 s.
let giveUpAt = 0;
const ask = (p, opt) => fetch(`http://127.0.0.1:${PORT}${p}`, { signal: AbortSignal.timeout(1000), ...opt });
const listenAgain = () => setTimeout(() => server.listen(PORT, '127.0.0.1'), 200);
server.on('error', async (e) => {
  if (e.code !== 'EADDRINUSE') { console.error(`Ownwords Lite: ${e.message}`); process.exit(1); }
  giveUpAt ||= Date.now() + 5000;
  const more = Date.now() < giveUpAt;
  let info = null, answered = false;
  try {
    const r = await ask('/api/info');
    answered = true;
    info = r.ok ? await r.json().catch(() => null) : null;
  } catch {} // refused or timed out: the holder is busy or going away
  if (info?.app === 'ownwords-lite') {
    if (info.dir === await fs.realpath(DIR).catch(() => DIR)) { console.log(`Ownwords Lite already running: http://127.0.0.1:${PORT}`); process.exit(0); }
    if (more) {
      await ask('/api/stop', { method: 'POST', headers: { 'x-ownwords': 'stop', 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
      return listenAgain();
    }
    console.error('Ownwords Lite: could not stop the other Ownwords server.');
    process.exit(1);
  }
  if (!answered && more) return listenAgain();
  console.error(`Ownwords Lite: port ${PORT} is used by another program. Stop it or set PORT to a free port.`);
  process.exit(1);
});

await fs.mkdir(DIR, { recursive: true });
server.on('listening', onListening);
server.listen(PORT, '127.0.0.1');
