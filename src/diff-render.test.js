'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const { parseDiff, renderRich, EMPTY_TREE } = require('./diff-render');

describe('diff-render', () => {
  const SAMPLE = [
    'diff --git a/foo.txt b/foo.txt',
    'index 0000000..1111111 100644',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -1,2 +1,2 @@',
    ' context line',
    '-removed line',
    '+added line',
  ].join('\n');

  const TWO_FILE = [
    'diff --git a/foo.txt b/foo.txt',
    'index 0000000..1111111 100644',
    '--- a/foo.txt',
    '+++ b/foo.txt',
    '@@ -1,2 +1,2 @@',
    ' context line',
    '-removed line',
    '+added line',
    'diff --git a/bar.txt b/bar.txt',
    'index 2222222..3333333 100644',
    '--- a/bar.txt',
    '+++ b/bar.txt',
    '@@ -5,1 +5,2 @@',
    '+bar added',
  ].join('\n');

  const NEW_FILE = [
    'diff --git a/new.txt b/new.txt',
    'new file mode 100644',
    'index 0000000..abc1234',
    '--- /dev/null',
    '+++ b/new.txt',
    '@@ -0,0 +1,3 @@',
    '+line one',
    '+line two',
    '+line three',
  ].join('\n');

  const BINARY = [
    'diff --git a/x.png b/x.png',
    'index 1111111..2222222 100644',
    'Binary files a/x.png and b/x.png differ',
  ].join('\n');

  const GUTTER = [
    'diff --git a/g.txt b/g.txt',
    'index 1..2 100644',
    '--- a/g.txt',
    '+++ b/g.txt',
    '@@ -98,4 +98,4 @@',
    ' line98',
    ' line99',
    ' line100',
    ' line101',
  ].join('\n');

  test('parseDiff on single-file SAMPLE returns correct counts/types/newLineNo/meta', () => {
    const result = parseDiff(SAMPLE);
    assert.equal(result.added, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.files.length, 1);
    const lines = result.files[0].hunks[0].lines;
    assert.deepEqual(lines.map(l => l.type), ['ctx', 'del', 'add']);
    assert.deepEqual(lines.map(l => l.newLineNo), [1, null, 2]);
    assert.deepEqual(result.files[0].meta, []);
  });

  test('renderRich(SAMPLE, {color:false}) emits summary header, gutter rows, no ANSI', () => {
    const out = renderRich(SAMPLE, { color: false });
    const outLines = out.split('\n');
    assert.equal(outLines[0], 'Added 1 / removed 1');
    assert.equal(outLines[1], '');
    assert.ok(outLines.includes('1   context line'));
    assert.ok(outLines.includes('  - removed line'));
    assert.ok(outLines.includes('2 + added line'));
    assert.doesNotMatch(out, /\x1b/);
  });

  test('renderRich(SAMPLE, {color:true, width:40}) wraps add/del rows in full-row background codes', () => {
    const out = renderRich(SAMPLE, { color: true, width: 40 });
    assert.match(out, /\x1b\[48;5;22m/);
    assert.match(out, /\x1b\[48;5;52m/);
    const expectedAddRow = '\x1b[48;5;22m' + '2 + added line'.padEnd(40) + '\x1b[0m';
    assert.ok(out.includes(expectedAddRow));
  });

  test('a raw "--- sql comment" line inside a hunk is counted as a removal, not swallowed as a file header', () => {
    const fixture = [
      'diff --git a/x.sql b/x.sql',
      'index abc1111..def2222 100644',
      '--- a/x.sql',
      '+++ b/x.sql',
      '@@ -1,1 +1,1 @@',
      '--- sql comment',
    ].join('\n');
    const result = parseDiff(fixture);
    assert.equal(result.removed, 1);
    const delLine = result.files[0].hunks[0].lines[0];
    assert.equal(delLine.type, 'del');
    assert.equal(delLine.text, '-- sql comment');
  });

  test('a raw "+++ plus" line inside a hunk is counted as an addition', () => {
    const fixture = [
      'diff --git a/y.txt b/y.txt',
      'index abc1111..def2222 100644',
      '--- a/y.txt',
      '+++ b/y.txt',
      '@@ -1,1 +1,1 @@',
      '+++ plus',
    ].join('\n');
    const result = parseDiff(fixture);
    assert.equal(result.added, 1);
  });

  test('"\\ No newline at end of file" is dropped — not counted, not rendered', () => {
    const fixture = [
      'diff --git a/f.txt b/f.txt',
      'index 123..456 100644',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1,1 +1,1 @@',
      '+last line no newline',
      '\\ No newline at end of file',
    ].join('\n');
    const result = parseDiff(fixture);
    assert.equal(result.added, 1);
    assert.equal(result.removed, 0);
    assert.equal(result.files[0].hunks[0].lines.length, 1);
    const out = renderRich(fixture, { color: false });
    assert.doesNotMatch(out, /No newline at end of file/);
  });

  test('two-file diff: counts summed, exactly one blank line separates files', () => {
    const result = parseDiff(TWO_FILE);
    assert.equal(result.files.length, 2);
    assert.equal(result.added, 2);
    assert.equal(result.removed, 1);

    const out = renderRich(TWO_FILE, { color: false });
    const outLines = out.split('\n');
    const secondHeaderIdx = outLines.indexOf('diff --git a/bar.txt b/bar.txt');
    assert.ok(secondHeaderIdx > 0);
    assert.equal(outLines[secondHeaderIdx - 1], '');
    assert.notEqual(outLines[secondHeaderIdx - 2], '');
  });

  test('new-file diff: meta captures "new file mode", gutter numbers 1,2,3', () => {
    const result = parseDiff(NEW_FILE);
    assert.deepEqual(result.files[0].meta, ['new file mode 100644']);
    const out = renderRich(NEW_FILE, { color: false });
    assert.ok(out.includes('1 + line one'));
    assert.ok(out.includes('2 + line two'));
    assert.ok(out.includes('3 + line three'));
  });

  test('binary diff: added=0 removed=0, meta contains Binary line, rendered output contains it', () => {
    const result = parseDiff(BINARY);
    assert.equal(result.added, 0);
    assert.equal(result.removed, 0);
    assert.deepEqual(result.files[0].meta, ['Binary files a/x.png and b/x.png differ']);
    const out = renderRich(BINARY, { color: false });
    assert.ok(out.includes('Binary files a/x.png and b/x.png differ'));
  });

  test('gutter width is computed from the widest new-file line number (98..101 -> 3-char gutter)', () => {
    const out = renderRich(GUTTER, { color: false });
    assert.ok(out.includes(' 98   line98'));
    assert.ok(out.includes(' 99   line99'));
    assert.ok(out.includes('100   line100'));
    assert.ok(out.includes('101   line101'));
  });

  test('renderRich("") and renderRich(null) render exactly the no-changes message', () => {
    assert.equal(renderRich(''), 'Added 0 / removed 0\n\n(no changes)');
    assert.equal(renderRich(null), 'Added 0 / removed 0\n\n(no changes)');
  });

  test('EMPTY_TREE matches the canonical git empty-tree sha', () => {
    assert.equal(EMPTY_TREE, '4b825dc642cb6eb9a060e54bf8d69288fbee4904');
  });
});
