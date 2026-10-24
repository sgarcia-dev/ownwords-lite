// package.json says "type": "module". feedback.js is a classic browser script,
// so importing it runs it and it attaches OW.feedback to globalThis.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/feedback.js';

const fb = globalThis.OW.feedback;
const { findQuote, nextScore } = fb._test;

const mk = (o) => Object.assign({ id: 'f1', block: 'p1', version: 0, quote: 'x', before: '', start: 0, score: 1, note: '', set: 's', at: '' }, o);

test('findQuote: one hit', () => {
  const text = 'The cat sat. The dog ran.';
  assert.deepEqual(findQuote(text, mk({ quote: 'dog ran' })), { start: 17, end: 24 });
});

test('findQuote: repeats are chosen by before', () => {
  const text = 'Red apples. Green apples. Blue apples.';
  const m = mk({ quote: 'apples', before: 'Green ', start: 0 });
  assert.deepEqual(findQuote(text, m), { start: 18, end: 24 });
  const m2 = mk({ quote: 'apples', before: 'Blue ', start: 0 });
  assert.deepEqual(findQuote(text, m2), { start: 31, end: 37 });
});

test('findQuote: ties on before go to the closest start', () => {
  const text = 'go. go. go.';
  assert.deepEqual(findQuote(text, mk({ quote: 'go', before: '', start: 4 })), { start: 4, end: 6 });
  assert.deepEqual(findQuote(text, mk({ quote: 'go', before: '', start: 9 })), { start: 8, end: 10 });
  assert.deepEqual(findQuote(text, mk({ quote: 'go', before: '', start: 100 })), { start: 8, end: 10 });
});

test('findQuote: whitespace fallback maps back to the original text', () => {
  const text = 'One two\n\nthree   four five.';
  const r = findQuote(text, mk({ quote: 'two three four' }));
  assert.ok(r);
  assert.equal(text.slice(r.start, r.end), 'two\n\nthree   four');
});

test('findQuote: lost when the words are gone, or for a whole version', () => {
  assert.equal(findQuote('Nothing here.', mk({ quote: 'missing words' })), null);
  assert.equal(findQuote('Nothing here.', mk({ quote: null })), null);
});

test('nextScore: full cycle for like', () => {
  assert.equal(nextScore(0, 'like'), 1);
  assert.equal(nextScore(1, 'like'), 2);
  assert.equal(nextScore(2, 'like'), 0);
  assert.equal(nextScore(-1, 'like'), 1);
  assert.equal(nextScore(-2, 'like'), 1);
});

test('nextScore: full cycle for dislike', () => {
  assert.equal(nextScore(0, 'dislike'), -1);
  assert.equal(nextScore(-1, 'dislike'), -2);
  assert.equal(nextScore(-2, 'dislike'), 0);
  assert.equal(nextScore(1, 'dislike'), -1);
  assert.equal(nextScore(2, 'dislike'), -1);
});

test('load drops bad entries and getAll returns copies', () => {
  fb.load([
    mk({ id: 'a' }),
    mk({ id: 'a' }),
    mk({ id: 'b', score: 0 }),
    mk({ id: 'c', score: 3 }),
    mk({ id: 'd', quote: '' }),
    mk({ id: 'e', quote: null, score: -2 }),
    mk({ id: 'f', version: -1 }),
    null,
    'x'
  ]);
  const all = fb.getAll();
  assert.deepEqual(all.map((m) => m.id), ['a', 'e']);
  all[0].score = 2;
  assert.equal(fb.getAll()[0].score, 1);
  fb.load('nope');
  assert.deepEqual(fb.getAll(), []);
});

test('reconcile re-points a p mark whose paragraph moved', () => {
  fb.load([mk({ id: 'a', block: 'p2', quote: 'blue door', before: 'the ', start: 4 })]);
  fb.reconcile([
    { id: 'p1', text: 'A new first paragraph.' },
    { id: 'p2', text: 'Something else now.' },
    { id: 'p3', text: 'Open the blue door slowly.' }
  ]);
  const m = fb.getAll()[0];
  assert.equal(m.block, 'p3');
  assert.equal(m.start, 9);
  assert.equal(m.before, 'Open the ');
});

test('reconcile keeps a mark that still matches in its own block, and keeps lost ones', () => {
  fb.load([
    mk({ id: 'a', block: 'p1', quote: 'cat' }),
    mk({ id: 'b', block: 'p1', quote: 'gone for good' })
  ]);
  fb.reconcile([{ id: 'p1', text: 'A cat.' }, { id: 'p2', text: 'A cat too.' }]);
  assert.deepEqual(fb.getAll().map((m) => [m.id, m.block]), [['a', 'p1'], ['b', 'p1']]);
});

test('voteSelection cycles one target through like, really like, clear', () => {
  let changes = 0;
  const target = { block: 'p1', version: 0, start: 4, end: 7 };
  fb.load([]);
  fb._test.remember('p1', 0, 'The cat sat.');
  fb.init({ bar: null, doc: null, host: { selection: () => ({ text: 'cat', targets: [target] }), changed: () => { changes++; } } });
  fb.voteSelection('like');
  assert.deepEqual(fb.getAll().map((m) => [m.quote, m.before, m.start, m.score]), [['cat', 'The ', 4, 1]]);
  fb.voteSelection('like');
  assert.equal(fb.getAll()[0].score, 2);
  fb.voteSelection('dislike');
  assert.equal(fb.getAll()[0].score, -1);
  fb.voteSelection('dislike');
  fb.voteSelection('dislike');
  assert.equal(fb.getAll().length, 0);
  assert.equal(changes, 5);
});

test('voteSelection with two blocks shares one set and agrees on score', () => {
  fb.load([]);
  fb._test.remember('p1', 0, 'First one.');
  fb._test.remember('p2', 0, 'Second one.');
  const targets = [
    { block: 'p1', version: 0, start: 0, end: 5 },
    { block: 'p2', version: 0, start: 0, end: 6 }
  ];
  fb.init({ bar: null, doc: null, host: { selection: () => ({ text: '', targets }), changed() {} } });
  fb.voteSelection('dislike');
  const all = fb.getAll();
  assert.equal(all.length, 2);
  assert.equal(all[0].set, all[1].set);
  assert.deepEqual(all.map((m) => m.score), [-1, -1]);
  fb.voteSelection('dislike');
  assert.deepEqual(fb.getAll().map((m) => m.score), [-2, -2]);
});

// ---- overlap rule
function setup(marksIn, text) {
  fb.load(marksIn);
  fb._test.remember('p1', 0, text);
  fb._test.remember('p1', 1, text);
}
const cat = () => mk({ id: 'a', quote: 'cat', before: 'The ', start: 4, score: 1 });
const TEXT = 'The cat sat.';

test('overlaps: partial overlap is blocked', () => {
  setup([cat()], TEXT);
  const { overlaps } = fb._test;
  assert.equal(overlaps({ block: 'p1', version: 0, start: 2, end: 5 }), true);
  assert.equal(overlaps({ block: 'p1', version: 0, start: 6, end: 9 }), true);
  assert.equal(overlaps({ block: 'p1', version: 0, start: 0, end: 12 }), true);
});

test('overlaps: exact same range is allowed and cycles', () => {
  let changes = 0;
  const target = { block: 'p1', version: 0, start: 4, end: 7 };
  setup([cat()], TEXT);
  assert.equal(fb._test.overlaps(target), false);
  fb.init({ bar: null, doc: null, host: { selection: () => ({ text: 'cat', targets: [target] }), changed: () => { changes++; } } });
  fb.voteSelection('like');
  assert.equal(fb.getAll()[0].score, 2);
  assert.equal(changes, 1);
});

test('overlaps: adjacent ranges are allowed', () => {
  setup([cat()], TEXT);
  const { overlaps } = fb._test;
  assert.equal(overlaps({ block: 'p1', version: 0, start: 0, end: 4 }), false);
  assert.equal(overlaps({ block: 'p1', version: 0, start: 7, end: 12 }), false);
});

test('overlaps: a whole-version mark never blocks', () => {
  setup([mk({ id: 'w', quote: null, start: 0, score: 1 })], TEXT);
  assert.equal(fb._test.overlaps({ block: 'p1', version: 0, start: 0, end: 12 }), false);
});

test('overlaps: a different version or block does not block', () => {
  setup([cat()], TEXT);
  const { overlaps } = fb._test;
  assert.equal(overlaps({ block: 'p1', version: 1, start: 4, end: 7 }), false);
  assert.equal(overlaps({ block: 'p2', version: 0, start: 4, end: 7 }), false);
});

test('voteSelection does nothing when the selection overlaps a mark', () => {
  let changes = 0;
  const target = { block: 'p1', version: 0, start: 2, end: 5 };
  setup([cat()], TEXT);
  fb.init({ bar: null, doc: null, host: { selection: () => ({ text: '', targets: [target] }), changed: () => { changes++; } } });
  fb.voteSelection('dislike');
  assert.deepEqual(fb.getAll().map((m) => [m.id, m.score]), [['a', 1]]);
  assert.equal(changes, 0);
});
