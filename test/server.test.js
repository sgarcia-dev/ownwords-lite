import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let dir, pub, home, child, base;

const mdPath = (slug) => path.join(dir, slug + '.md');
const side = (slug, ...p) => path.join(dir, '.ownwords', slug, ...p);
const put = (slug, text) => fs.writeFile(mdPath(slug), text);
const putV = async (slug, v) => {
  await fs.mkdir(side(slug), { recursive: true });
  await fs.writeFile(side(slug, 'versions.json'), typeof v === 'string' ? v : JSON.stringify(v));
};
const readV = async (slug) => JSON.parse(await fs.readFile(side(slug, 'versions.json'), 'utf8'));
const readC = async (slug) => JSON.parse(await fs.readFile(side(slug, 'closed.json'), 'utf8'));
const exists = (f) => fs.stat(f).then(() => true, () => false);
const get = (p, headers = {}) => fetch(base + p, { headers });
const getDoc = async (slug) => (await get('/api/doc/' + slug)).json();
const JSON_HEADERS = { 'content-type': 'application/json' };
const post = (p, body) => fetch(base + p, { method: 'POST', headers: JSON_HEADERS, body: typeof body === 'string' ? body : JSON.stringify(body) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fetch() would tidy "..", so send traversal paths raw.
const raw = (p) => new Promise((resolve, reject) => {
  const { port } = new URL(base);
  http.get({ host: '127.0.0.1', port, path: p }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
});

const start = (args, env) => new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, ['server.js', ...args], { cwd: root, env: { ...process.env, OWNWORDS_LITE_PUBLIC: pub, OWNWORDS_LITE_NO_OPEN: '1', PORT: '0', OWNWORDS_IDLE_MS: '0', HOME: home, ...env } });
  let out = '';
  proc.stdout.on('data', (d) => { out += d; const m = out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) resolve({ proc, url: m[0] }); });
  proc.on('exit', (c) => reject(new Error(`server exited ${c}`)));
});

before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ow lite ünï-')); // a space and non-ASCII on purpose
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-home-')); // never touch the real ~/.ownwords-lite
  pub = path.join(dir, 'public-probe');
  await fs.mkdir(pub);
  await put('alpha', '# Alpha\n\nHello.\n');
  await sleep(20);
  await put('beta', 'No heading here.\n');
  await put('.hidden', '# Nope\n');
  await fs.writeFile(path.join(dir, 'notes.txt'), 'nope');
  ({ proc: child, url: base } = await start([dir]));
});

after(async () => {
  child?.kill();
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(home, { recursive: true, force: true });
});

test('lists pieces newest first, title from first h1, ignores dot files and non-md files', async () => {
  const list = await (await get('/api/pieces')).json();
  assert.ok(Array.isArray(list));
  assert.deepEqual(list.map((p) => [p.slug, p.title]), [['beta', 'beta'], ['alpha', 'Alpha']]);
  assert.ok(!Number.isNaN(Date.parse(list[0].updated)));
});

test('get doc: exact fields, etag header equals body, 304, dir', async () => {
  const res = await get('/api/doc/alpha');
  assert.equal(res.status, 200);
  const etag = res.headers.get('etag');
  const body = await res.json();
  assert.deepEqual(Object.keys(body).sort(), ['canReveal', 'dir', 'doc', 'etag', 'history', 'ui']);
  assert.deepEqual(Object.keys(body.doc).sort(), ['blocks', 'log', 'stale', 'title']);
  assert.equal(body.etag, etag);
  assert.equal(body.dir, dir);
  assert.equal(body.doc.title, 'Alpha');
  assert.deepEqual(body.doc.blocks, [{ id: 'p0', kind: 'h1', text: 'Alpha' }, { id: 'p1', kind: 'p', text: 'Hello.' }]);
  assert.deepEqual(body.ui, { selection: null, picks: {} });
  assert.equal(body.history.length, 1);
  assert.equal((await get('/api/doc/alpha', { 'if-none-match': etag })).status, 304);
  assert.equal((await get('/api/doc/nothere')).status, 404);
});

test('groups: option block, multi-paragraph group, stale group listed in doc.stale', async () => {
  await put('groups', '# Groups\n\nOne.\n\nTwo.\n\nThree.\n\nTail.\n');
  await putV('groups', {
    groups: [
      { id: 'g1', original: 'One.\n\nTwo.\n\nThree.', options: [{ text: 'A.\n\nB.', note: 'short' }] },
      { id: 'g2', original: 'Gone paragraph.', options: [{ text: 'x', note: 'n' }] },
      { id: 'g3', original: 'Tail.', options: [{ text: 'End.' }] },
    ],
    log: [],
  });
  const { doc } = await getDoc('groups');
  assert.deepEqual(doc.blocks, [
    { id: 'p0', kind: 'h1', text: 'Groups' },
    { id: 'g1', kind: 'p', text: 'One.\n\nTwo.\n\nThree.', options: [{ text: 'A.\n\nB.', note: 'short' }] },
    { id: 'g3', kind: 'p', text: 'Tail.', options: [{ text: 'End.', note: '' }] },
  ]);
  assert.deepEqual(doc.stale, [{ id: 'g2', original: 'Gone paragraph.', options: [{ text: 'x', note: 'n' }] }]);
});

test('edit changes etag, makes one .md snapshot with the log note; history get returns blocks and ?raw=1 Markdown', async () => {
  await put('edit', '# Edit\n\nFirst.\n');
  await putV('edit', { groups: [], log: [{ at: '2000-01-01T00:00:00Z', note: 'first' }] });
  const one = await getDoc('edit');
  assert.equal(one.history.length, 1);
  assert.equal(one.history[0].note, 'first');
  assert.match(one.history[0].file, /^\d{8}-\d{6}-\d{3}\.md$/);
  await sleep(600);
  // The log entry for the next snapshot sits inside its window: after the first snapshot + 15 s.
  const at = new Date(Date.parse(one.history[0].at) + 15_500).toISOString();
  await putV('edit', { groups: [], log: [{ at: '2000-01-01T00:00:00Z', note: 'first' }, { at, note: 'second' }] });
  await put('edit', '# Edit\n\nSecond.\n');
  const two = await getDoc('edit');
  assert.notEqual(two.etag, one.etag);
  assert.deepEqual(two.history.map((h) => h.note), ['first', 'second']);
  assert.equal((await fs.readdir(side('edit', 'history'))).length, 2);
  const snap = await (await get(`/api/history/edit/${two.history[0].file}`)).json();
  assert.deepEqual(snap, { title: 'Edit', blocks: [{ id: 'p0', kind: 'h1', text: 'Edit' }, { id: 'p1', kind: 'p', text: 'First.' }] });
  const md = await get(`/api/history/edit/${two.history[0].file}?raw=1`);
  assert.match(md.headers.get('content-type'), /^text\/markdown/);
  assert.equal(await md.text(), '# Edit\n\nFirst.\n');
  assert.equal((await get('/api/history/edit/20200101-000000-000.md')).status, 404);
});

test('empty file keeps last good doc and makes no snapshot', async () => {
  await put('empty', '# Empty\n\nBody.\n');
  const one = await getDoc('empty');
  await put('empty', '');
  const during = await getDoc('empty');
  assert.equal(during.etag, one.etag);
  assert.equal(during.doc.title, 'Empty');
  await put('empty', '  \n\n');
  assert.equal((await getDoc('empty')).etag, one.etag);
  assert.equal((await fs.readdir(side('empty', 'history'))).length, 1);
  await put('empty', '# Empty\n\nBack.\n');
  const back = await getDoc('empty');
  assert.equal(back.history.length, 2);
  assert.notEqual(back.etag, one.etag);
});

test('versions.json change changes etag but makes no snapshot; broken versions.json keeps last good', async () => {
  await put('vers', '# Vers\n\nText.\n');
  await putV('vers', { groups: [{ id: 'g1', original: 'Text.', options: [{ text: 'Other.' }] }], log: [] });
  const one = await getDoc('vers');
  assert.equal(one.doc.blocks[1].id, 'g1');
  await putV('vers', { groups: [{ id: 'g1', original: 'Text.', options: [{ text: 'Other.' }] }], log: [{ at: '2026-10-23T10:00:00Z', note: 'n' }] });
  const two = await getDoc('vers');
  assert.notEqual(two.etag, one.etag);
  assert.equal(two.history.length, 1);
  assert.equal((await fs.readdir(side('vers', 'history'))).length, 1);
  await putV('vers', '{"groups": [');
  const three = await getDoc('vers');
  assert.equal(three.etag, two.etag);
  assert.equal(three.doc.blocks[1].id, 'g1');
});

test('ui POST stores the body as is, keeps etag, no snapshot, no .tmp files; 404 unknown piece; default ui', async () => {
  await put('uipiece', '# Ui\n\nHi.\n');
  const before = await getDoc('uipiece');
  const ui = {
    selection: { scope: 'all', text: 'Hi', at: '2026-10-23T10:00:00Z' }, picks: { g1: 2 },
    compare: { a: 'x', b: 'y' }, feedback: { items: [{ id: 'f1', quote: 'Hi' }] },
  };
  const res = await post('/api/ui/uipiece', ui);
  assert.deepEqual(await res.json(), { ok: true });
  await sleep(1200); // let the 1 s interval run too
  const after = await getDoc('uipiece');
  assert.equal(after.etag, before.etag);
  assert.deepEqual(after.ui, ui);
  assert.equal(after.history.length, 1);
  assert.equal((await fs.readdir(side('uipiece', 'history'))).length, 1);
  for (const d of [dir, side('uipiece')]) assert.equal((await fs.readdir(d)).filter((f) => f.endsWith('.tmp')).length, 0);
  assert.equal((await get('/api/doc/uipiece', { 'if-none-match': before.etag })).status, 304);
  assert.equal((await post('/api/ui/nothere', {})).status, 404);
  assert.equal((await post('/api/ui/uipiece', '[1]')).status, 400);
  assert.equal((await post('/api/ui/uipiece', 'nope')).status, 400);
  await fs.writeFile(side('uipiece', 'ui.json'), '{broken');
  assert.deepEqual((await getDoc('uipiece')).ui, { selection: null, picks: {} });
});

const titlePiece = async (slug, extra = '') => {
  await put(slug, `# Old Name\n\nBody.\n${extra}`);
  await putV(slug, {
    groups: [{ id: 'g1', original: '# Old Name', options: [{ text: '# A Better Title!', note: 'n' }, { text: 'Second  Option', note: '' }] }],
    log: [],
  });
  await fs.writeFile(side(slug, 'ui.json'), JSON.stringify({ selection: null, picks: { g1: 1 } }));
  return getDoc(slug);
};

test('title accept: renames .md and sidecar, rewrites the line, removes group, logs, returns slug', async () => {
  const d = await titlePiece('oldname');
  const res = await post('/api/accept/oldname', { group: 'g1', pick: 1, etag: d.etag });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { slug: 'a-better-title', title: 'A Better Title!' });
  assert.equal(await exists(mdPath('oldname')), false);
  assert.equal(await exists(side('oldname')), false);
  assert.equal(await fs.readFile(mdPath('a-better-title'), 'utf8'), '# A Better Title!\n\nBody.\n');
  assert.ok(await exists(side('a-better-title', 'ui.json')));
  const v = await readV('a-better-title');
  assert.deepEqual(v.groups, []);
  assert.equal(v.log.at(-1).note, 'Title: A Better Title!');
  assert.equal('closed' in v, false);
  assert.equal((await readC('a-better-title'))[0].result, 'used'); // closed.json moved with the sidecar
  assert.equal(await exists(side('oldname', 'closed.json')), false);
  const nd = await getDoc('a-better-title');
  assert.equal(nd.doc.title, 'A Better Title!');
  assert.deepEqual(nd.doc.stale, []);
  assert.equal(nd.doc.blocks.length, 2);
  assert.equal(nd.doc.log.at(-1).note, 'Title: A Better Title!');
  assert.equal(nd.history.length, 2); // old text plus new text
  assert.equal((await fs.readdir(side('a-better-title', 'history'))).length, 2);
  assert.equal((await get('/api/doc/oldname')).status, 404);
  assert.equal((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp')).length, 0);
});

test('title accept: slug clash gives -2, and pick 2 cleans the text', async () => {
  await put('clash-title', '# Clash Title\n\nx\n');
  const d = await titlePiece('clasher');
  await putV('clasher', { groups: [{ id: 'g1', original: '# Old Name', options: [{ text: '# Clash   Title' }] }], log: [] });
  const d2 = await getDoc('clasher');
  assert.notEqual(d2.etag, d.etag);
  const res = await post('/api/accept/clasher', { group: 'g1', pick: 1, etag: d2.etag });
  assert.deepEqual(await res.json(), { slug: 'clash-title-2', title: 'Clash Title' });
  assert.equal(await fs.readFile(mdPath('clash-title'), 'utf8'), '# Clash Title\n\nx\n');
  assert.equal(await fs.readFile(mdPath('clash-title-2'), 'utf8'), '# Clash Title\n\nBody.\n');
  const e = await titlePiece('plain');
  const r2 = await post('/api/accept/plain', { group: 'g1', pick: 2, etag: e.etag });
  assert.deepEqual(await r2.json(), { slug: 'second-option', title: 'Second Option' });
});

test('paragraph accept: replaces a 3-paragraph group with a 2-paragraph option and logs', async () => {
  await put('para', '# Para\n\nOne.\n\nTwo.\n\nThree.\n\nTail.\n');
  await putV('para', {
    groups: [{ id: 'g1', original: 'One.\n\nTwo.\n\nThree.', options: [{ text: 'First.\n\nSecond.', note: 'tighter' }] }],
    log: [{ at: '2026-10-23T09:00:00Z', note: 'earlier' }],
    extra: 'kept',
  });
  const d = await getDoc('para');
  const res = await post('/api/accept/para', { group: 'g1', pick: 1, etag: d.etag });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { slug: 'para' });
  assert.equal(await fs.readFile(mdPath('para'), 'utf8'), '# Para\n\nFirst.\n\nSecond.\n\nTail.\n');
  const v = await readV('para');
  assert.deepEqual(v.groups, []);
  assert.deepEqual(v.log.map((l) => l.note), ['earlier', 'Used version 2 of "One. Two. Three.…" (tighter)']);
  assert.equal(v.extra, 'kept');
  assert.equal('closed' in v, false);
  const c = await readC('para');
  assert.equal(c.length, 1);
  assert.deepEqual({ ...c[0], at: 0 }, {
    id: 'g1', original: 'One.\n\nTwo.\n\nThree.', options: [{ text: 'First.\n\nSecond.', note: 'tighter' }], result: 'used', pick: 1, at: 0,
  });
  assert.ok(Date.parse(c[0].at));
  const nd = await getDoc('para');
  assert.deepEqual(nd.doc.blocks.map((b) => b.text), ['Para', 'First.', 'Second.', 'Tail.']);
  assert.equal(nd.history.length, 2);
  assert.notEqual(nd.etag, d.etag);
});

test('drop: pick 0 closes the group, leaves the .md and history alone, keeps unknown keys', async () => {
  await put('dropme', '# Drop Me\n\nOne two three four five six seven.\n');
  await putV('dropme', {
    groups: [{ id: 'g1', original: 'One two three four five six seven.', options: [{ text: 'Uno.' }] }],
    log: [], extra: 'kept', closed: [{ id: 'old', result: 'used' }],
  });
  const d = await getDoc('dropme');
  assert.equal(d.history.length, 1);
  const res = await post('/api/accept/dropme', { group: 'g1', pick: 0, etag: d.etag });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { slug: 'dropme' });
  assert.equal(await fs.readFile(mdPath('dropme'), 'utf8'), '# Drop Me\n\nOne two three four five six seven.\n');
  const v = await readV('dropme');
  assert.deepEqual(v.groups, []);
  assert.equal(v.extra, 'kept');
  assert.equal('closed' in v, false); // an old closed array moves to closed.json
  const c = await readC('dropme');
  assert.equal(c.length, 2);
  assert.equal(c[0].id, 'old');
  assert.equal(c[1].result, 'dropped');
  assert.equal(c[1].pick, 0);
  assert.deepEqual(c[1].options, [{ text: 'Uno.', note: '' }]);
  assert.equal(v.log.at(-1).note, 'Dropped other versions of "One two three four five six…"');
  const nd = await getDoc('dropme');
  assert.equal(nd.history.length, 1);
  assert.equal((await fs.readdir(side('dropme', 'history'))).length, 1);
  assert.equal(nd.doc.blocks.length, 2);
});

test('drop on a title group: no rename, group closed as dropped', async () => {
  const d = await titlePiece('keepname');
  const res = await post('/api/accept/keepname', { group: 'g1', pick: 0, etag: d.etag });
  assert.deepEqual(await res.json(), { slug: 'keepname' });
  assert.equal(await fs.readFile(mdPath('keepname'), 'utf8'), '# Old Name\n\nBody.\n');
  assert.equal(await exists(mdPath('a-better-title-2')), false);
  const v = await readV('keepname');
  assert.equal((await readC('keepname'))[0].result, 'dropped');
  assert.match(v.log.at(-1).note, /^Dropped other versions of "# Old Name…"$/);
});

test('use then another use: closed grows, log has the notes', async () => {
  await put('twice', '# Twice\n\nAlpha.\n\nBeta.\n');
  await putV('twice', { groups: [
    { id: 'g1', original: 'Alpha.', options: [{ text: 'A1.', note: 'short' }] },
    { id: 'g2', original: 'Beta.', options: [{ text: 'B1.' }] },
  ], log: [] });
  const d = await getDoc('twice');
  assert.equal((await post('/api/accept/twice', { group: 'g1', pick: 1, etag: d.etag })).status, 200);
  const d2 = await getDoc('twice');
  assert.equal((await post('/api/accept/twice', { group: 'g2', pick: 1, etag: d2.etag })).status, 200);
  const v = await readV('twice');
  assert.deepEqual((await readC('twice')).map((c) => c.id), ['g1', 'g2']);
  assert.deepEqual(v.log.map((l) => l.note), ['Used version 2 of "Alpha.…" (short)', 'Used version 2 of "Beta.…"']);
});

test('accept without etag skips the stale check; a wrong etag is still 409; closed.json appends', async () => {
  await put('noetag', '# No Etag\n\nOne.\n\nTwo.\n');
  await putV('noetag', { groups: [
    { id: 'g1', original: 'One.', options: [{ text: 'Uno.' }] },
    { id: 'g2', original: 'Two.', options: [{ text: 'Dos.' }] },
  ], log: [] });
  await getDoc('noetag');
  assert.equal((await post('/api/accept/noetag', { group: 'g1', pick: 1, etag: '"stale"' })).status, 409);
  assert.equal((await post('/api/accept/noetag', { group: 'g1', pick: 1, etag: 5 })).status, 400);
  assert.equal((await post('/api/accept/noetag', { group: 'g1', pick: 1 })).status, 200);
  assert.equal((await post('/api/accept/noetag', { group: 'g2', pick: 0 })).status, 200);
  assert.equal(await fs.readFile(mdPath('noetag'), 'utf8'), '# No Etag\n\nUno.\n\nTwo.\n');
  assert.deepEqual((await readC('noetag')).map((c) => [c.id, c.result]), [['g1', 'used'], ['g2', 'dropped']]);
  assert.deepEqual(Object.keys(await readV('noetag')).sort(), ['groups', 'log']);
});

test('a file with spaces and capitals is a piece: list, get, ui, accept, title rename', async () => {
  await put('My Draft', 'No heading here.\n\nOne.\n');
  await putV('My Draft', { groups: [{ id: 'g1', original: 'One.', options: [{ text: 'Uno.' }] }], log: [] });
  const list = await (await get('/api/pieces')).json();
  const me = list.find((x) => x.slug === 'My Draft');
  assert.equal(me.title, 'My Draft');
  const url = (kind) => `/api/${kind}/${encodeURIComponent('My Draft')}`;
  const d = await (await get(url('doc'))).json();
  assert.equal(d.doc.title, 'My Draft');
  assert.equal((await post(url('ui'), { picks: { g1: 1 } })).status, 200);
  assert.ok(await exists(side('My Draft', 'ui.json')));
  assert.equal((await post(url('accept'), { group: 'g1', pick: 1, etag: d.etag })).status, 200);
  assert.equal(await fs.readFile(mdPath('My Draft'), 'utf8'), 'No heading here.\n\nUno.\n');
  assert.equal((await readC('My Draft'))[0].id, 'g1');
  // A title accept renames to the slug of the title and moves the sidecar.
  await put('Big Title', '# Old\n\nBody.\n');
  await putV('Big Title', { groups: [{ id: 'g1', original: '# Old', options: [{ text: 'Fresh Start' }] }], log: [] });
  const d2 = await (await get('/api/doc/' + encodeURIComponent('Big Title'))).json();
  const r = await post('/api/accept/' + encodeURIComponent('Big Title'), { group: 'g1', pick: 1, etag: d2.etag });
  assert.deepEqual(await r.json(), { slug: 'fresh-start', title: 'Fresh Start' });
  assert.equal(await exists(mdPath('Big Title')), false);
  assert.equal(await exists(side('Big Title')), false);
  assert.equal((await readC('fresh-start'))[0].result, 'used');
});

test('odd names: dot files, slashes and traversal are not pieces', async () => {
  const list = await (await get('/api/pieces')).json();
  assert.equal(list.some((x) => x.slug.startsWith('.')), false);
  assert.equal((await get('/api/doc/%2Ehidden')).status, 400);
  assert.equal((await get('/api/doc/a%2Fb')).status, 400);
  assert.equal((await get('/api/doc/..%2F..%2Fetc')).status, 400);
  assert.equal((await get('/api/doc/bad%00name')).status, 400);
  assert.equal((await get('/api/doc/%E0%A4%A')).status, 400); // broken escape
  assert.equal((await post('/api/accept/a%2Fb', { group: 'g1', pick: 0 })).status, 400);
});

test('restore: writes the snapshot back, logs it, makes a new history row', async () => {
  // Old snapshots (more than 15 s apart from now), so the note lands on the new row.
  await put('rest', '# Rest\n\nSecond text.\n');
  await putV('rest', { groups: [], log: [], extra: 'kept' });
  await fs.mkdir(side('rest', 'history'), { recursive: true });
  await fs.writeFile(side('rest', 'history', '20200101-103000-000.md'), '# Rest\n\nFirst text.\n');
  await fs.writeFile(side('rest', 'history', '20200101-113000-000.md'), '# Rest\n\nSecond text.\n');
  const d = await getDoc('rest');
  assert.equal(d.history.length, 2);
  const first = d.history[0];
  const res = await post('/api/restore/rest', { file: first.file, etag: d.etag });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(await fs.readFile(mdPath('rest'), 'utf8'), '# Rest\n\nFirst text.\n');
  const t = new Date(first.at);
  const hhmm = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
  const nd = await getDoc('rest');
  assert.equal(nd.history.length, 3);
  assert.equal(nd.history.at(-1).note, 'Restored ' + hhmm);
  assert.equal((await readV('rest')).extra, 'kept');
  assert.equal(await exists(mdPath('rest')), true);
});

test('restore errors: stale etag 409, bad file 400, missing file 404, no piece 404', async () => {
  await put('rest2', '# Rest Two\n\nOne.\n');
  const d0 = await getDoc('rest2');
  await sleep(20);
  await put('rest2', '# Rest Two\n\nTwo.\n');
  const d = await getDoc('rest2');
  const file = d.history[0].file;
  const code = async (body, slug = 'rest2') => (await post('/api/restore/' + slug, body)).status;
  assert.equal(await code({ file, etag: d0.etag }), 409);
  assert.equal(await code({ file, etag: '"old"' }), 409);
  assert.equal(await code({ file: '../../alpha.md', etag: d.etag }), 400);
  assert.equal(await code({ file: '..%2falpha.md', etag: d.etag }), 400);
  assert.equal(await code({ file: 'alpha.md', etag: d.etag }), 400);
  assert.equal(await code({ etag: d.etag }), 400);
  assert.equal(await code({ file: '20200101-000000-000.md', etag: d.etag }), 404);
  assert.equal(await code({ file, etag: d.etag }, 'nothere'), 404);
  assert.equal((await get('/api/restore/rest2')).status, 405);
  assert.equal(await fs.readFile(mdPath('rest2'), 'utf8'), '# Rest Two\n\nTwo.\n');
});

test('reveal: 200 for the .md and a snapshot (no Finder in tests), 404 or 400 for a bad file', async (t) => {
  const d = await getDoc('alpha');
  assert.equal(d.canReveal, process.platform === 'darwin');
  if (process.platform !== 'darwin') return t.skip('macOS only');
  assert.equal((await post('/api/reveal/alpha', {})).status, 200);
  assert.equal((await fetch(base + '/api/reveal/alpha', { method: 'POST', headers: JSON_HEADERS })).status, 200);
  assert.equal((await post('/api/reveal/alpha', { file: d.history[0].file })).status, 200);
  assert.equal((await post('/api/reveal/alpha', { file: '20200101-000000-000.md' })).status, 404);
  assert.equal((await post('/api/reveal/alpha', { file: '../../beta.md' })).status, 400);
  assert.equal((await post('/api/reveal/nothere', {})).status, 404);
  assert.equal((await get('/api/reveal/alpha')).status, 405);
});

test('folder: ~/.ownwords-lite names the folder when no argument or OWNWORDS_DIR', async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-lite-home-'));
  try {
    const target = path.join(home, 'My Pieces');
    await fs.mkdir(target);
    await fs.writeFile(path.join(target, 'from-file.md'), '# From File\n');
    const doc = async (env) => {
      const { proc, url } = await start([], { HOME: home, OWNWORDS_DIR: '', ...env });
      try { return (await (await fetch(url + '/api/doc/from-file')).json()); } finally { proc.kill(); }
    };
    await fs.writeFile(path.join(home, '.ownwords-lite'), '\n  ~/My Pieces  \nignored\n');
    assert.equal((await doc()).dir, target);
    await fs.writeFile(path.join(home, '.ownwords-lite'), target + '\n');
    assert.equal((await doc()).dir, target);
    assert.equal((await doc({ OWNWORDS_DIR: path.join(home, 'env-dir') })).error, 'no such piece'); // env beats the file
    assert.equal(await exists(path.join(home, 'env-dir')), true);
    await fs.rm(path.join(home, '.ownwords-lite'));
    assert.equal((await doc()).error, 'no such piece'); // default folder under the temp HOME
    assert.equal(await exists(path.join(home, 'Desktop', 'Ownwords')), true);
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test('accept errors: stale etag 409, bad pick 400, stale group 404, no piece 404', async () => {
  await put('errs', '# Errs\n\nOne.\n');
  await putV('errs', {
    groups: [
      { id: 'g1', original: 'One.', options: [{ text: 'Uno.' }] },
      { id: 'g2', original: 'Not in the text.', options: [{ text: 'Nope.' }] },
    ],
    log: [],
  });
  const d = await getDoc('errs');
  const ok = { group: 'g1', pick: 1, etag: d.etag };
  const code = async (body) => (await post('/api/accept/errs', body)).status;
  assert.equal(await code({ ...ok, etag: '"old"' }), 409);
  assert.equal(await code({ ...ok, pick: -1 }), 400);
  assert.equal(await code({ ...ok, pick: 2 }), 400);
  assert.equal(await code({ ...ok, pick: 1.5 }), 400);
  assert.equal(await code({ group: 'g1' }), 400);
  assert.equal(await code('nope'), 400);
  assert.equal(await code({ ...ok, group: 'g2' }), 404); // stale group
  assert.equal(await code({ ...ok, group: 'g9' }), 404);
  assert.equal((await post('/api/accept/nothere', ok)).status, 404);
  assert.equal((await post('/api/accept/.dot', ok)).status, 400);
  assert.equal((await get('/api/accept/errs')).status, 405);
  assert.equal(await fs.readFile(mdPath('errs'), 'utf8'), '# Errs\n\nOne.\n'); // nothing changed
  assert.equal((await readV('errs')).groups.length, 2);
  assert.equal(await code(ok), 200);
});

test('bad slugs 400, traversal blocked', async () => {
  assert.equal((await get('/api/doc/Bad_Slug')).status, 404); // any file name is a piece id now
  assert.equal((await get('/api/doc/.a')).status, 400);
  assert.equal((await post('/api/ui/UP', {})).status, 404);
  assert.equal((await get('/api/history/.bad/x.md')).status, 400);
  assert.equal((await get('/api/doc/..%2f..%2fetc')).status, 400);
  await fs.writeFile(path.join(dir, 'secret.txt'), 'secret'); // sits next to public-probe
  for (const p of ['/../secret.txt', '/%2e%2e/secret.txt', '/..%2fsecret.txt', '/..%2f..%2fetc%2fpasswd']) {
    const status = await raw(p);
    assert.ok([400, 403, 404].includes(status), `${p} gave ${status}`);
  }
  assert.equal(await raw('/api/history/alpha/..%2falpha.md'), 400);
  assert.equal(await raw('/api/history/alpha/..%2f..%2fbeta.md'), 400);
  assert.equal(await raw('/api/history/alpha/20200101-000000-000.json'), 400);
});

test('static files get the right content type', async () => {
  for (const [name, type] of [['index.html', 'text/html'], ['a.css', 'text/css'], ['a.js', 'text/javascript'], ['a.json', 'application/json'], ['a.svg', 'image/svg+xml'], ['a.webmanifest', 'application/manifest+json'], ['a.png', 'image/png']]) {
    await fs.writeFile(path.join(pub, name), 'x');
    const res = await get(name === 'index.html' ? '/' : '/' + name);
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type').startsWith(type), name);
  }
  assert.equal((await get('/nope.txt')).status, 404);
});

test('dir argument beats OWNWORDS_DIR', async () => {
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'ow-lite-other-'));
  const envDir = path.join(other, 'from-env'); // must stay uncreated
  const argDir = path.join(other, 'from-arg');
  await fs.mkdir(argDir);
  await fs.writeFile(path.join(argDir, 'only-here.md'), '# Only Here\n');
  const { proc, url } = await start([argDir], { OWNWORDS_DIR: envDir });
  try {
    const list = await (await fetch(url + '/api/pieces')).json();
    assert.deepEqual(list.map((p) => p.slug), ['only-here']);
    assert.equal((await (await fetch(url + '/api/doc/only-here')).json()).dir, argDir);
    assert.equal(await exists(envDir), false);
  } finally {
    proc.kill();
    await fs.rm(other, { recursive: true, force: true });
  }
});

// ---- lifecycle, instructions file, host and content-type checks ----

const exitOf = (proc) => new Promise((r) => (proc.exitCode !== null ? r(proc.exitCode) : proc.on('exit', r)));
const freePort = () => new Promise((resolve) => {
  const s = http.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
const tmpDir = (name) => fs.mkdtemp(path.join(os.tmpdir(), name));
const rmAll = (...d) => Promise.all(d.map((x) => fs.rm(x, { recursive: true, force: true })));
// Like start(), but also collects stdout and stderr and keeps the exit code.
const spawnServer = (args, env = {}) => {
  const proc = spawn(process.execPath, ['server.js', ...args], { cwd: root, env: { ...process.env, OWNWORDS_LITE_NO_OPEN: '1', PORT: '0', OWNWORDS_IDLE_MS: '0', HOME: home, ...env } });
  const o = { proc, out: '', err: '', url: null };
  o.ready = new Promise((r) => { o.onReady = r; });
  proc.stdout.on('data', (d) => { o.out += d; const m = o.out.match(/http:\/\/127\.0\.0\.1:\d+/); if (m && !o.url && /Ownwords Lite: http/.test(o.out)) { o.url = m[0]; o.onReady(m[0]); } });
  proc.stderr.on('data', (d) => { o.err += d; });
  o.exit = exitOf(proc);
  return o;
};
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error('timeout: ' + what); })]);

test('GET /api/info names the app, the real folder and the pid', async () => {
  const body = await (await get('/api/info')).json();
  assert.deepEqual(Object.keys(body).sort(), ['app', 'dir', 'pid']);
  assert.equal(body.app, 'ownwords-lite');
  assert.equal(body.dir, await fs.realpath(dir));
  assert.equal(body.pid, child.pid);
});

test('POST /api/stop needs its header, then exits 0 and frees the port', async () => {
  const d = await tmpDir('ow-stop-');
  const a = spawnServer([d]);
  try {
    const url = await within(a.ready, 5000, 'start');
    const port = new URL(url).port;
    const no = await fetch(url + '/api/stop', { method: 'POST', headers: JSON_HEADERS, body: '{}' });
    assert.equal(no.status, 403);
    assert.equal((await fetch(url + '/api/info')).status, 200);
    assert.equal((await fetch(url + '/api/stop')).status, 405);
    const ok = await fetch(url + '/api/stop', { method: 'POST', headers: { ...JSON_HEADERS, 'x-ownwords': 'stop' }, body: '{}' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, dir: d });
    assert.equal(await within(a.exit, 5000, 'exit'), 0);
    assert.match(a.out, /stopped \(stopped by request\)/);
    const b = spawnServer([d], { PORT: port });
    try { assert.equal(await within(b.ready, 5000, 'restart on the same port'), url); } finally { b.proc.kill(); await b.exit; }
  } finally { a.proc.kill(); await rmAll(d); }
});

test('SIGTERM stops cleanly with exit 0', async () => {
  const d = await tmpDir('ow-term-');
  const a = spawnServer([d]);
  try {
    await within(a.ready, 5000, 'start');
    a.proc.kill('SIGTERM');
    assert.equal(await within(a.exit, 5000, 'exit'), 0);
  } finally { a.proc.kill(); await rmAll(d); }
});

test('second start: same folder is quiet exit 0, another program is exit 1', async () => {
  const d = await tmpDir('ow-second-');
  const port = await freePort();
  const a = spawnServer([d], { PORT: String(port) });
  try {
    await within(a.ready, 5000, 'start');
    const b = spawnServer([d], { PORT: String(port) });
    assert.equal(await within(b.exit, 8000, 'second exit'), 0);
    assert.match(b.out, /already running/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/api/info`)).status, 200); // the first one is still up
    a.proc.kill();
    await a.exit;
    const other = http.createServer((q, r) => r.end('hi'));
    await new Promise((r) => other.listen(port, '127.0.0.1', r));
    try {
      const c = spawnServer([d], { PORT: String(port) });
      assert.equal(await within(c.exit, 8000, 'other-program exit'), 1);
      assert.match(c.err, /another program/);
    } finally { other.close(); }
  } finally { a.proc.kill(); await rmAll(d); }
});

test('second start on another folder takes the port from our server', async () => {
  const [d1, d2] = [await tmpDir('ow-take1-'), await tmpDir('ow-take2-')];
  const port = await freePort();
  const a = spawnServer([d1], { PORT: String(port) });
  let b;
  try {
    await within(a.ready, 5000, 'start A');
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/info`)).json()).dir, await fs.realpath(d1));
    b = spawnServer([d2], { PORT: String(port) });
    await within(b.ready, 8000, 'B ready');
    assert.equal(await within(a.exit, 5000, 'A exit'), 0);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/info`)).json()).dir, await fs.realpath(d2));
  } finally { a.proc.kill(); b?.proc.kill(); await rmAll(d1, d2); }
});

test('idle stop: exits 0 with no *.tmp left; requests keep it alive; /api/info does not', async () => {
  const d = await tmpDir('ow-idle-');
  try {
    const a = spawnServer([d], { OWNWORDS_IDLE_MS: '300' });
    await within(a.ready, 5000, 'start');
    assert.equal(await within(a.exit, 3000, 'idle exit'), 0);
    assert.match(a.out, /stopped \(idle/);
    const tmps = [];
    const walk = async (p) => { for (const e of await fs.readdir(p, { withFileTypes: true })) { const f = path.join(p, e.name); if (e.isDirectory()) await walk(f); else if (f.endsWith('.tmp')) tmps.push(f); } };
    await walk(d);
    assert.deepEqual(tmps, []);

    const b = spawnServer([d], { OWNWORDS_IDLE_MS: '600' });
    const url = await within(b.ready, 5000, 'start B');
    for (let i = 0; i < 15; i++) { assert.equal((await fetch(url + '/api/pieces')).status, 200); await sleep(100); } // 1.5 s > 600 ms
    assert.equal(b.proc.exitCode, null);
    assert.equal(await within(b.exit, 4000, 'B idle exit'), 0);

    const c = spawnServer([d], { OWNWORDS_IDLE_MS: '600' });
    const curl = await within(c.ready, 5000, 'start C');
    let alive = true;
    c.exit.then(() => { alive = false; });
    for (let i = 0; i < 40 && alive; i++) { await fetch(curl + '/api/info').catch(() => {}); await sleep(100); }
    assert.equal(alive, false, 'polling /api/info must not keep the server alive');
    assert.equal(await c.exit, 0);
  } finally { await rmAll(d); }
});

test('OWNWORDS.md: written from the template, never a piece, user file kept, stale one rewritten', async () => {
  const d = await tmpDir('ow instr ünï-');
  const file = path.join(d, 'OWNWORDS.md');
  const readyFile = async () => { for (let i = 0; i < 50; i++) { const t = await fs.readFile(file, 'utf8').catch(() => null); if (t !== null) return t; await sleep(100); } throw new Error('no OWNWORDS.md'); };
  try {
    let a = spawnServer([d]);
    const url = await within(a.ready, 5000, 'start');
    const text = await readyFile();
    assert.ok(text.startsWith('<!-- Generated by Ownwords'));
    assert.ok(text.includes(d));
    assert.ok(text.includes(root));
    assert.ok(!text.includes('{{'));
    assert.deepEqual(await (await fetch(url + '/api/pieces')).json(), []);
    assert.equal((await fetch(url + '/api/doc/OWNWORDS')).status, 400);
    assert.equal((await fetch(url + '/api/ui/OWNWORDS', { method: 'POST', headers: JSON_HEADERS, body: '{}' })).status, 400);
    a.proc.kill(); await a.exit;

    await fs.writeFile(file, 'mine');                       // the user's own file stays
    a = spawnServer([d]);
    const url2 = await within(a.ready, 5000, 'restart 1');
    assert.equal(await fs.readFile(file, 'utf8'), 'mine');
    assert.match(a.out, /Kept your OWNWORDS\.md/);
    assert.deepEqual((await (await fetch(url2 + '/api/pieces')).json()).map((p) => p.slug), ['OWNWORDS']); // and it is a normal piece
    a.proc.kill(); await a.exit;

    await fs.writeFile(file, '﻿<!-- Generated by Ownwords old -->\njunk');  // stale generated file is rewritten
    a = spawnServer([d]);
    await within(a.ready, 5000, 'restart 2');
    assert.equal(await fs.readFile(file, 'utf8'), text);
    a.proc.kill(); await a.exit;
  } finally { await rmAll(d); }
});

test('~/.ownwords-lite: line 2 gets the app folder, line 1 stays, nothing is made if the file is missing', async () => {
  const h = await tmpDir('ow-home2-'), d = await tmpDir('ow-d2-');
  const f = path.join(h, '.ownwords-lite');
  try {
    let a = spawnServer([d], { HOME: h });
    await within(a.ready, 5000, 'start 1');
    assert.equal(await fs.stat(f).catch(() => null), null);
    a.proc.kill(); await a.exit;
    await fs.writeFile(f, '~/Desktop/Mine\n');
    a = spawnServer([d], { HOME: h });
    await within(a.ready, 5000, 'start 2');
    assert.equal(await fs.readFile(f, 'utf8'), `~/Desktop/Mine\n${root}\n`);
    a.proc.kill(); await a.exit;
    await fs.writeFile(f, '~/Desktop/Mine\n/old/place\n');
    a = spawnServer([d], { HOME: h });
    await within(a.ready, 5000, 'start 3');
    assert.equal(await fs.readFile(f, 'utf8'), `~/Desktop/Mine\n${root}\n`);
    a.proc.kill(); await a.exit;
  } finally { await rmAll(h, d); }
});

test('Host must be this machine; every POST needs content-type application/json', async () => {
  const { port } = new URL(base);
  const status = (headers, method = 'GET', p = '/api/pieces') => new Promise((resolve, reject) => {
    const q = http.request({ host: '127.0.0.1', port, path: p, method, headers }, (res) => { res.resume(); resolve(res.statusCode); });
    q.on('error', reject); q.end(method === 'POST' ? '{}' : undefined);
  });
  assert.equal(await status({ host: `127.0.0.1:${port}` }), 200);
  assert.equal(await status({ host: `localhost:${port}` }), 200);
  assert.equal(await status({ host: `evil.example:${port}` }), 403);
  assert.equal(await status({ host: 'localhost' }), 403);
  assert.equal(await status({ host: `evil.example:${port}` }, 'GET', '/'), 403);
  assert.equal(await status({ host: `127.0.0.1:${port}` }, 'POST', '/api/ui/alpha'), 415);
  assert.equal(await status({ host: `127.0.0.1:${port}`, 'content-type': 'text/plain' }, 'POST', '/api/ui/alpha'), 415);
  assert.equal(await status({ host: `127.0.0.1:${port}`, 'content-type': 'application/json; charset=utf-8' }, 'POST', '/api/ui/alpha'), 200);
});
