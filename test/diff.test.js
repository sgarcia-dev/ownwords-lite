// package.json says "type": "module". diff.js is a classic browser script,
// so importing it runs it and it attaches OW to globalThis.
import test from 'node:test';
import assert from 'node:assert/strict';
import '../public/diff.js';

const OW = globalThis.OW;

const join = (parts, types) => parts.filter((p) => types.includes(p.type)).map((p) => p.text).join('');

test('identical text is one same part', () => {
  assert.deepEqual(OW.diffWords('Hello, world.', 'Hello, world.'), [{ type: 'same', text: 'Hello, world.' }]);
  assert.equal(OW.renderDiff('Hello', 'Hello'), '<p>Hello</p>');
});

test('one word changed shows only that word as del then add', () => {
  const parts = OW.diffWords('The quick brown fox', 'The slow brown fox');
  assert.deepEqual(parts, [
    { type: 'same', text: 'The ' },
    { type: 'del', text: 'quick' },
    { type: 'add', text: 'slow' },
    { type: 'same', text: ' brown fox' },
  ]);
  assert.equal(
    OW.renderDiff('The quick brown fox', 'The slow brown fox'),
    '<p>The <del class="ow-del">quick</del><ins class="ow-ins">slow</ins> brown fox</p>'
  );
});

test('punctuation change does not mark the word', () => {
  const parts = OW.diffWords('Well, yes', 'Well. yes');
  assert.deepEqual(parts, [
    { type: 'same', text: 'Well' },
    { type: 'del', text: ',' },
    { type: 'add', text: '.' },
    { type: 'same', text: ' yes' },
  ]);
});

test('insertion at start and end', () => {
  assert.deepEqual(OW.diffWords('world', 'Hello world'), [
    { type: 'add', text: 'Hello ' },
    { type: 'same', text: 'world' },
  ]);
  assert.deepEqual(OW.diffWords('Hello', 'Hello world'), [
    { type: 'same', text: 'Hello' },
    { type: 'add', text: ' world' },
  ]);
});

test('deletion keeps the old text recoverable', () => {
  const parts = OW.diffWords('one two three', 'one three');
  assert.equal(join(parts, ['same', 'del']), 'one two three');
  assert.equal(join(parts, ['same', 'add']), 'one three');
});

test('null old is all insertion, null new is all deletion', () => {
  assert.deepEqual(OW.diffWords(null, 'new text'), [{ type: 'add', text: 'new text' }]);
  assert.deepEqual(OW.diffWords('old text', null), [{ type: 'del', text: 'old text' }]);
  assert.equal(OW.renderDiff(null, 'new'), '<p><ins class="ow-ins">new</ins></p>');
  assert.equal(OW.renderDiff('old', null), '<p><del class="ow-del">old</del></p>');
  assert.equal(OW.renderDiff(null, null), '');
});

test('blank lines become paragraph breaks and single newlines become br', () => {
  assert.equal(OW.renderDiff('A\n\nB', 'A\n\nB'), '<p>A</p><p>B</p>');
  assert.equal(OW.renderDiff('A\nB', 'A\nB'), '<p>A<br>B</p>');
  assert.equal(OW.renderDiff('A\r\n\r\nB', 'A\r\n\r\nB'), '<p>A</p><p>B</p>');
});

test('breaks inside an insertion stay outside the tags', () => {
  const html = OW.renderDiff('A', 'A\n\nB');
  assert.equal(html, '<p>A</p><p><ins class="ow-ins">B</ins></p>');
});

test('HTML is escaped', () => {
  const html = OW.renderDiff('a <b>x</b> & "q"', 'a <i>x</i> & "q"');
  assert.ok(!html.includes('<b>'));
  assert.ok(!html.includes('<i>'));
  assert.ok(html.includes('&lt;<del class="ow-del">b</del><ins class="ow-ins">i</ins>&gt;x'));
  assert.ok(!/<(?!\/?(p|br|del|ins)\b)/.test(html));
  assert.equal(OW.renderDiff('<script>', '<script>'), '<p>&lt;script&gt;</p>');
  assert.ok(html.includes('&amp;'));
  assert.ok(html.includes('&quot;q&quot;'));
});

test('adjacent changed words merge into one del and one add', () => {
  const parts = OW.diffWords('a b c', 'x y c');
  assert.deepEqual(parts, [
    { type: 'del', text: 'a b' },
    { type: 'add', text: 'x y' },
    { type: 'same', text: ' c' },
  ]);
});

test('empty strings give no parts', () => {
  assert.deepEqual(OW.diffWords('', ''), []);
});

// ---------- diffDoc ----------

const P = (text, kind = 'p') => ({ kind, text });
const types = (r) => r.rows.map((x) => x.type);

test('diffDoc: identical documents are all same', () => {
  const doc = [P('Title', 'h1'), P('One.\n\nTwo.')];
  const r = OW.diffDoc(doc, doc);
  assert.deepEqual(types(r), ['same', 'same', 'same']);
  assert.deepEqual(r.stats, { added: 0, removed: 0, changed: 0 });
});

test('diffDoc: one edited paragraph is changed', () => {
  const r = OW.diffDoc(
    [P('Intro here.'), P('The quick brown fox jumps over the dog.'), P('End.')],
    [P('Intro here.'), P('The quick brown fox leaps over the dog.'), P('End.')]
  );
  assert.deepEqual(types(r), ['same', 'changed', 'same']);
  assert.equal(r.rows[1].oldText, 'The quick brown fox jumps over the dog.');
  assert.equal(r.rows[1].newText, 'The quick brown fox leaps over the dog.');
  assert.deepEqual(r.stats, { added: 0, removed: 0, changed: 1 });
});

test('diffDoc: inserted paragraph is added', () => {
  const r = OW.diffDoc([P('A one.'), P('C three.')], [P('A one.'), P('Totally new words'), P('C three.')]);
  assert.deepEqual(types(r), ['same', 'added', 'same']);
  assert.equal(r.rows[1].newText, 'Totally new words');
  assert.deepEqual(r.stats, { added: 1, removed: 0, changed: 0 });
});

test('diffDoc: deleted paragraph is removed', () => {
  const r = OW.diffDoc([P('A one.'), P('B two.'), P('C three.')], [P('A one.'), P('C three.')]);
  assert.deepEqual(types(r), ['same', 'removed', 'same']);
  assert.equal(r.rows[1].oldText, 'B two.');
  assert.deepEqual(r.stats, { added: 0, removed: 1, changed: 0 });
});

test('diffDoc: heading kind change is not same', () => {
  const r = OW.diffDoc([P('My Title', 'h2')], [P('My Title', 'h1')]);
  assert.notEqual(r.rows[0].type, 'same');
  assert.equal(r.rows[0].type, 'changed');
  assert.equal(r.rows[0].kind, 'h1');
  assert.equal(r.stats.changed, 1);
});

test('diffDoc: whitespace differences are ignored', () => {
  const r = OW.diffDoc([P('a  b\nc')], [P('a b c')]);
  assert.deepEqual(types(r), ['same']);
});

test('diffDoc: blank lines split a block into paragraphs', () => {
  const r = OW.diffDoc([P('One.\n\nTwo.')], [P('One.'), P('Two.')]);
  assert.deepEqual(types(r), ['same', 'same']);
});

test('diffDoc: fenced code stays whole', () => {
  const code = '```js\nlet a = 1;\n\nlet b = 2;\n```';
  const r = OW.diffDoc([P('Before.\n\n' + code)], [P('Before.\n\n' + code)]);
  assert.deepEqual(types(r), ['same', 'same']);
  assert.equal(r.rows[1].newText, code);
  const r2 = OW.diffDoc([P(code)], [P(code.replace('b = 2', 'b = 3'))]);
  assert.equal(r2.rows.length, 1);
  assert.equal(r2.rows[0].type, 'changed');
});

test('diffDoc: low overlap pair becomes removed then added', () => {
  const r = OW.diffDoc([P('apples oranges pears bananas')], [P('quantum entanglement is strange')]);
  assert.deepEqual(types(r), ['removed', 'added']);
  assert.deepEqual(r.stats, { added: 1, removed: 1, changed: 0 });
});

test('diffDoc: pairing keeps order and leaves leftovers', () => {
  const r = OW.diffDoc(
    [P('zzz yyy xxx'), P('red green blue yellow')],
    [P('red green blue purple'), P('brand new line')]
  );
  assert.deepEqual(types(r), ['removed', 'changed', 'added']);
});

test('diffDoc: empty inputs', () => {
  assert.deepEqual(OW.diffDoc([], []).rows, []);
  assert.deepEqual(OW.diffDoc(null, [P('x y')]).stats, { added: 1, removed: 0, changed: 0 });
});

test('renderDocDiff builds DOM with textContent', () => {
  class Node_ {
    constructor(tag) { this.tag = tag; this.children = []; this.className = ''; this._text = ''; }
    appendChild(c) { this.children.push(c); return c; }
    set textContent(t) { this._text = String(t); this.children = []; }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  }
  globalThis.document = {
    createElement: (t) => new Node_(t),
    createTextNode: (t) => { const n = new Node_('#text'); n._text = t; return n; },
  };
  try {
    const none = OW.renderDocDiff([P('a b')], [P('a b')]);
    assert.equal(none.className, 'ow-docdiff');
    assert.equal(none.children[0].className, 'ow-nochange');
    assert.equal(none.children[0].textContent, 'No changes since this version.');

    const d = OW.renderDocDiff(
      [P('Head', 'h1'), P('gone words here'), P('The quick brown fox')],
      [P('Head', 'h1'), P('The slow brown fox'), P('<b>new</b> stuff')]
    );
    assert.deepEqual(d.children.map((c) => c.tag + '.' + c.className), [
      'h1.ow-row ow-same', 'p.ow-row ow-removed', 'p.ow-row ow-changed', 'p.ow-row ow-added',
    ]);
    assert.equal(d.children[1].children[0].tag, 'del');
    assert.equal(d.children[3].children[0].tag, 'ins');
    assert.equal(d.children[3].textContent, '<b>new</b> stuff');
    assert.deepEqual(d.children[2].children.map((c) => c.tag), ['#text', 'del', 'ins', '#text']);
  } finally {
    delete globalThis.document;
  }
});
