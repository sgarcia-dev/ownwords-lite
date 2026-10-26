import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseParas, cleanVersions, matchGroups, buildDoc, slugify, titleFromOption,
  replaceTitle, replaceRange, historyNotes, SNAP, snapAt, snapName,
} from '../lib/md.js';

const P = (t) => parseParas(t).paras;

test('parseParas splits on blank lines and keeps offsets', () => {
  const t = 'one\ntwo\n\n  \nthree\n';
  const ps = P(t);
  assert.equal(ps.length, 2);
  assert.deepEqual(ps.map((p) => p.raw), ['one\ntwo', 'three']);
  assert.deepEqual(ps.map((p) => p.kind), ['p', 'p']);
  for (const p of ps) assert.equal(t.slice(p.start, p.end), p.raw);
  assert.deepEqual(P(''), []);
  assert.deepEqual(P('\n\n  \n'), []);
});

test('parseParas headings are own paragraphs; #### is text', () => {
  const t = 'intro\n# One\n## Two\n### Three\n#### Four\n#nospace\n';
  const ps = P(t);
  assert.deepEqual(ps.map((p) => p.kind), ['p', 'h1', 'h2', 'h3', 'p']);
  assert.equal(ps[1].raw, '# One');
  assert.equal(ps[1].text, 'One');
  assert.equal(ps[3].text, 'Three');
  assert.equal(ps[4].raw, '#### Four\n#nospace');
  assert.equal(ps[4].text, ps[4].raw);
});

test('parseParas keeps blank lines inside fences; unclosed fence takes the rest; different marker does not close', () => {
  const a = 'before\n```js\nx\n\ny\n```\nafter\n';
  const ps = P(a);
  assert.deepEqual(ps.map((p) => p.kind), ['p', 'code', 'p']);
  assert.equal(ps[1].raw, '```js\nx\n\ny\n```');
  assert.equal(a.slice(ps[1].start, ps[1].end), ps[1].raw);
  const b = 'a\n```\nx\n\ny\n';
  const pb = P(b);
  assert.equal(pb.length, 2);
  assert.equal(pb[1].kind, 'code');
  assert.equal(pb[1].raw, '```\nx\n\ny');
  const c = '```\nx\n~~~\n\ny\n```\nz';
  const pc = P(c);
  assert.deepEqual(pc.map((p) => p.kind), ['code', 'p']);
  assert.equal(pc[0].raw, '```\nx\n~~~\n\ny\n```');
  // a shorter fence does not close a longer one
  const pd = P('````\na\n```\nb\n````\n');
  assert.equal(pd.length, 1);
  assert.equal(pd[0].raw, '````\na\n```\nb\n````');
});

test('parseParas skips front matter; unclosed front matter is text', () => {
  const t = '---\ntitle: x\n---  \n\n# Hi\n\nbody\n';
  const ps = P(t);
  assert.deepEqual(ps.map((p) => p.kind), ['h1', 'p']);
  assert.equal(t.slice(ps[0].start, ps[0].end), '# Hi');
  const u = '---\ntitle: x\n\nbody\n';
  const pu = P(u);
  assert.equal(pu.length, 2);
  assert.equal(pu[0].raw, '---\ntitle: x');
  // front matter only at the start
  const v = '# A\n\n---\nx\n---\n';
  assert.equal(P(v).length, 2);
});

test('parseParas handles CRLF and a BOM: text has no CR, offsets slice the original', () => {
  const t = '﻿# Title\r\n\r\nline one\r\nline two\r\n\r\nlast';
  const ps = P(t);
  assert.deepEqual(ps.map((p) => p.raw), ['# Title', 'line one\nline two', 'last']);
  assert.equal(ps[0].text, 'Title');
  assert.equal(t.slice(ps[0].start, ps[0].end), '# Title');
  assert.equal(t.slice(ps[1].start, ps[1].end), 'line one\r\nline two');
  assert.equal(t.slice(ps[2].start, ps[2].end), 'last');
  for (const p of ps) assert.ok(!p.raw.includes('\r'));
});

test('matchGroups finds a 3-paragraph run, then a whitespace-changed one, and marks edited ones stale', () => {
  const t = 'intro\n\nA one\n\nA two\n\nA three\n\nB  spaced\nout\n\nend\n';
  const groups = [
    { id: 'g1', original: 'A one\n\nA two\n\nA three', options: [] },
    { id: 'g2', original: 'B spaced out', options: [] },
    { id: 'g3', original: 'Edited away', options: [] },
    { id: 'g4', original: '', options: [] },
  ];
  const { found, stale } = matchGroups(P(t), groups);
  assert.deepEqual(found.get('g1'), { first: 1, count: 3 });
  assert.deepEqual(found.get('g2'), { first: 4, count: 1 });
  assert.deepEqual(stale.map((g) => g.id), ['g3', 'g4']);
});

test('matchGroups does not claim one paragraph twice; duplicates go to the first free one in order', () => {
  const t = 'same\n\nother\n\nsame\n';
  const groups = [
    { id: 'g1', original: 'same', options: [] },
    { id: 'g2', original: 'same', options: [] },
    { id: 'g3', original: 'same', options: [] },
  ];
  const { found, stale } = matchGroups(P(t), groups);
  assert.deepEqual(found.get('g1'), { first: 0, count: 1 });
  assert.deepEqual(found.get('g2'), { first: 2, count: 1 });
  assert.equal(found.has('g3'), false);
  assert.deepEqual(stale.map((g) => g.id), ['g3']);
  // a run does not overlap a single claimed earlier
  const t2 = 'x\n\ny\n\nx\n\ny\n';
  const r = matchGroups(P(t2), [
    { id: 'a', original: 'y', options: [] },
    { id: 'b', original: 'x\n\ny', options: [] },
  ]);
  assert.deepEqual(r.found.get('a'), { first: 1, count: 1 });
  assert.deepEqual(r.found.get('b'), { first: 2, count: 2 });
});

test('buildDoc ids, kinds, title flag, stale list; heading original works with and without #', () => {
  const t = '# My Title\n\nintro\n\n## Sub\n\nOne\n\nTwo\n\n```\ncode\n```\n';
  const versions = {
    groups: [
      { id: 'g1', original: '# My Title', options: [{ text: '# Better' }, { text: 'Best', note: 'n' }] },
      { id: 'g2', original: 'Sub', options: [{ text: 'Sub two', note: '' }] },
      { id: 'g3', original: 'One\n\nTwo', options: [{ text: 'Uno\n\nDos', note: '' }] },
      { id: 'g4', original: 'gone', options: [{ text: 'x', note: '' }] },
      { id: 'g1', original: 'dup', options: [] },
      { original: 'no id' },
    ],
    log: [],
  };
  const d = buildDoc(t, versions, 'fallback');
  assert.equal(d.title, 'My Title');
  assert.equal(d.titleIndex, 0);
  assert.deepEqual(d.blocks.map((b) => b.id), ['g1', 'p1', 'g2', 'g3', 'p5']);
  assert.deepEqual(d.blocks.map((b) => b.kind), ['h1', 'p', 'h2', 'p', 'code']);
  assert.equal(d.blocks[0].title, true);
  assert.equal(d.blocks[0].text, 'My Title');
  assert.deepEqual(d.blocks[0].options, [{ text: '# Better', note: '' }, { text: 'Best', note: 'n' }]);
  assert.equal(d.blocks[1].options, undefined);
  assert.equal(d.blocks[1].title, undefined);
  assert.equal(d.blocks[2].title, undefined);
  assert.equal(d.blocks[2].text, 'Sub');
  assert.equal(d.blocks[3].text, 'One\n\nTwo');
  assert.equal(d.blocks[4].text, '```\ncode\n```');
  assert.deepEqual(d.stale.map((g) => g.id), ['g4']);
  assert.equal(d.stale[0].original, 'gone');
  // no h1: slug is the title, titleIndex -1
  const e = buildDoc('just text\n', null, 'my-slug');
  assert.equal(e.title, 'my-slug');
  assert.equal(e.titleIndex, -1);
  assert.deepEqual(e.blocks, [{ id: 'p0', kind: 'p', text: 'just text' }]);
});

test('slugify, titleFromOption, historyNotes (window edges and bad dates)', () => {
  assert.equal(slugify('Héllo, Wörld! 2026'), 'hello-world-2026');
  assert.equal(slugify('  --A  b--  '), 'a-b');
  assert.equal(slugify('日本語'), 'untitled');
  assert.equal(slugify(''), 'untitled');
  assert.equal(slugify('CON'), 'con-note');
  assert.equal(slugify('com1'), 'com1-note');
  assert.equal(slugify('console'), 'console');
  const long = slugify('word '.repeat(30));
  assert.ok(long.length <= 60 && !long.endsWith('-'));
  assert.equal(slugify('a'.repeat(59) + ' b'), 'a'.repeat(59));

  assert.equal(titleFromOption('## A  nice\n\n title '), 'A nice title');
  assert.equal(titleFromOption('Plain'), 'Plain');
  assert.equal(titleFromOption('#### four'), '#### four');
  assert.equal(titleFromOption('x'.repeat(300)).length, 200);

  const files = [
    { file: 'a.md', at: '2026-10-23T10:00:00.000Z' },
    { file: 'b.md', at: '2026-10-23T11:00:00.000Z' },
    { file: 'c.md', at: '2026-10-23T12:00:00.000Z' },
  ];
  const log = [
    { at: '2026-10-23T09:00:00.000Z', note: 'early' },       // before a: window of a (no lower bound)
    { at: '2026-10-23T10:00:15.000Z', note: 'a edge' },      // a hi edge, inclusive
    { at: '2026-10-23T10:00:15.001Z', note: 'b first' },     // just past a: belongs to b
    { at: '2026-10-23T11:00:15.000Z', note: 'b edge' },      // b hi edge, inclusive, last wins
    { at: 'not a date', note: 'bad' },
    { at: '2026-10-23T13:00:00.000Z', note: 'after all' },   // no window
  ];
  const n = historyNotes(files, log);
  assert.deepEqual(n.map((x) => x.note), ['a edge', 'b edge', '']);
  assert.deepEqual(n.map((x) => x.file), ['a.md', 'b.md', 'c.md']);
  assert.equal(n[0].at, files[0].at);
  assert.deepEqual(historyNotes([{ file: 'x.md', at: 'bad' }], log), [{ file: 'x.md', at: 'bad', note: '' }]);
  assert.deepEqual(historyNotes([], log), []);

  // snapshot names round-trip
  const d = new Date('2026-10-23T09:08:07.006Z');
  assert.equal(snapName(d), '20261023-090807-006.md');
  assert.ok(SNAP.test(snapName()));
  assert.equal(snapAt('20261023-090807-006.md'), d.toISOString());
  assert.equal(snapAt('nope.md'), '');
});

test('cleanVersions never throws and drops bad entries', () => {
  for (const x of [undefined, null, 5, 'x', [], {}, { groups: 3, log: 'x' }]) {
    assert.deepEqual(cleanVersions(x), { groups: [], log: [] });
  }
  const v = cleanVersions({
    groups: [{ id: 'g1', original: 'o', options: [{ text: 't' }, { note: 'n' }, null] }, null, { id: 1, original: 'x' }],
    log: [{ at: '2026-01-01', note: 'ok' }, { at: 5, note: 'num at' }, { at: 'x' }, null],
  });
  assert.deepEqual(v.groups, [{ id: 'g1', original: 'o', options: [{ text: 't', note: '' }] }]);
  assert.deepEqual(v.log, [{ at: '2026-01-01', note: 'ok' }, { at: '', note: 'num at' }]);
});

test('replaceTitle and replaceRange use paragraph offsets', () => {
  const t = '# Old\r\n\r\nA\r\n\r\nB\r\n\r\nC\r\n';
  const ps = P(t);
  assert.equal(replaceTitle(t, ps[0], 'New'), '# New\r\n\r\nA\r\n\r\nB\r\n\r\nC\r\n');
  assert.equal(replaceRange(t, ps, 1, 2, 'X\n\nY'), '# Old\r\n\r\nX\n\nY\r\n\r\nC\r\n');
  assert.equal(replaceRange(t, ps, 3, 1, 'Z'), '# Old\r\n\r\nA\r\n\r\nB\r\n\r\nZ\r\n');
  assert.equal(replaceRange(t, ps, 0, 4, 'all'), 'all\r\n');
});

test('buildDoc: a group spanning a heading keeps the # marks, so each paragraph has its own kind', () => {
  const t = '# Title\n\nIntro.\n\n## Part one\n\nBody one.\n\nEnd.\n';
  const original = 'Intro.\n\n## Part one\n\nBody one.';
  const d = buildDoc(t, { groups: [{ id: 'g1', original, options: [{ text: 'Short.\n\n## Part 1\n\nBody.' }] }] }, 's');
  assert.deepEqual(d.blocks.map((b) => b.id), ['p0', 'g1', 'p4']);
  const g = d.blocks[1];
  assert.equal(g.kind, 'p');
  assert.equal(g.text, original);
  assert.deepEqual(P(g.text).map((p) => p.kind), ['p', 'h2', 'p']);
  assert.deepEqual(P(g.options[0].text).map((p) => p.kind), ['p', 'h2', 'p']);
  // A single heading group keeps its plain text and kind.
  const one = buildDoc(t, { groups: [{ id: 'g2', original: '## Part one', options: [] }] }, 's').blocks[2];
  assert.deepEqual([one.kind, one.text], ['h2', 'Part one']);
});

test('buildDoc: three section groups (heading plus paragraphs) all show as blocks', () => {
  const t = 'Intro.\n\n## One\n\nOne a.\n\nOne b.\n\n## Two\n\nTwo a.\n\n## Three\n\nThree a.\n\nTail.\n';
  const groups = [
    { id: 's1', original: '## One\n\nOne a.\n\nOne b.', options: [] },
    { id: 's2', original: '## Two\n\nTwo a.', options: [] },
    { id: 's3', original: '## Three\n\nThree a.', options: [] },
  ];
  const d = buildDoc(t, { groups }, 's');
  assert.deepEqual(d.blocks.map((b) => b.id), ['p0', 's1', 's2', 's3', 'p8']);
  assert.equal(d.blocks[1].text, '## One\n\nOne a.\n\nOne b.');
  assert.equal(d.blocks[2].text, '## Two\n\nTwo a.');
  assert.equal(d.blocks[3].text, '## Three\n\nThree a.');
  assert.equal(d.blocks[0].text, 'Intro.');
  assert.equal(d.blocks[4].text, 'Tail.');
  assert.deepEqual(d.stale, []);
});

test('buildDoc: a group hidden by an open group is stale with hiddenBy; a changed group is not', () => {
  const t = 'Alpha.\n\nBeta.\n';
  const versions = {
    groups: [
      { id: 'whole', original: 'Alpha.\n\nBeta.', options: [] },
      { id: 'part', original: 'Beta.', options: [] },
      { id: 'spaced', original: 'Alpha.', options: [] },
      { id: 'changed', original: 'Gamma.', options: [] },
    ],
  };
  const d = buildDoc(t, versions, 's');
  assert.deepEqual(d.blocks.map((b) => b.id), ['whole']);
  assert.deepEqual(d.stale.map((g) => g.id), ['part', 'spaced', 'changed']);
  assert.equal(d.stale[0].hiddenBy, 'whole');
  assert.equal(d.stale[1].hiddenBy, 'whole');
  assert.equal('hiddenBy' in d.stale[2], false);
  // collapsed-whitespace match is also detected as hidden
  const e = buildDoc('A  b\n\nC\n', { groups: [
    { id: 'x', original: 'A  b\n\nC', options: [] },
    { id: 'y', original: 'A b', options: [] },
  ] }, 's');
  assert.equal(e.stale[0].hiddenBy, 'x');
});
