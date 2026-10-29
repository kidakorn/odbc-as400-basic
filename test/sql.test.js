'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  toPositional, withRowLimit, withPaging, prepareQuery, normalizeRow,
} = require('../src/db/sql');

test('toPositional replaces named markers in order and repeats values', () => {
  const { text, values } = toPositional(
    'SELECT * FROM T WHERE A = :a AND B = :b AND C = :a',
    { a: 'x', b: 'y' },
  );
  assert.equal(text, 'SELECT * FROM T WHERE A = ? AND B = ? AND C = ?');
  assert.deepEqual(values, ['x', 'y', 'x']);
});

test('toPositional never puts a value into the SQL text', () => {
  const hostile = "x' OR '1'='1";
  const { text, values } = toPositional('SELECT * FROM T WHERE A = :a', { a: hostile });
  assert.equal(text, 'SELECT * FROM T WHERE A = ?');
  assert.deepEqual(values, [hostile]);
});

test('toPositional accepts null for an optional parameter that was omitted', () => {
  const { values } = toPositional('SELECT * FROM T WHERE A = :a', { a: null });
  assert.deepEqual(values, [null]);
});

test('toPositional throws when a value is missing', () => {
  assert.throws(() => toPositional('SELECT * FROM T WHERE A = :a', {}), /Missing value for parameter :a/);
});

test('toPositional leaves SQL without markers untouched', () => {
  const { text, values } = toPositional('SELECT * FROM T', {});
  assert.equal(text, 'SELECT * FROM T');
  assert.deepEqual(values, []);
});

test('withRowLimit appends FETCH FIRST', () => {
  assert.equal(withRowLimit('SELECT * FROM T', 500), 'SELECT * FROM T FETCH FIRST 500 ROWS ONLY');
});

test('withRowLimit rejects anything that is not a positive integer', () => {
  for (const bad of [0, -1, 1.5, '10', NaN, null, undefined, '1; DROP TABLE T']) {
    assert.throws(() => withRowLimit('SELECT * FROM T', bad), TypeError, String(bad));
  }
});

test('withPaging appends ORDER BY, OFFSET and FETCH FIRST', () => {
  assert.equal(
    withPaging('SELECT * FROM T', 'A DESC', 50, 100),
    'SELECT * FROM T ORDER BY A DESC OFFSET 100 ROWS FETCH FIRST 50 ROWS ONLY',
  );
});

test('withPaging rejects a bad limit or offset', () => {
  assert.throws(() => withPaging('SELECT * FROM T', 'A', 0, 0), TypeError);
  assert.throws(() => withPaging('SELECT * FROM T', 'A', 10, -1), TypeError);
  assert.throws(() => withPaging('SELECT * FROM T', 'A', '10', 0), TypeError);
  assert.throws(() => withPaging('SELECT * FROM T', 'A', 10, '0; DROP'), TypeError);
});

test('prepareQuery applies ROW_LIMIT when the endpoint has no paging and no fetchAll', () => {
  const { text, values } = prepareQuery(
    { sql: 'SELECT * FROM T WHERE A = :a' },
    { a: '1' },
    null,
    500,
  );
  assert.equal(text, 'SELECT * FROM T WHERE A = ? FETCH FIRST 500 ROWS ONLY');
  assert.deepEqual(values, ['1']);
});

test('prepareQuery leaves the SQL unbounded when fetchAll is set', () => {
  const { text } = prepareQuery({ sql: 'SELECT * FROM T', fetchAll: true }, {}, null, 500);
  assert.equal(text, 'SELECT * FROM T');
});

test('prepareQuery pages when paging is given, ignoring ROW_LIMIT', () => {
  const { text } = prepareQuery(
    { sql: 'SELECT * FROM T', orderBy: 'CDPAKG' },
    {},
    { limit: 100, offset: 200 },
    500,
  );
  assert.equal(text, 'SELECT * FROM T ORDER BY CDPAKG OFFSET 200 ROWS FETCH FIRST 100 ROWS ONLY');
});

test('normalizeRow trims CHAR padding, stringifies BigInt, and keeps other types', () => {
  assert.deepEqual(
    normalizeRow({ NAME: 'ABC   ', COUNT: 12345678901234567890n, QTY: 3, NOTE: null, LEADING: '  x  ' }),
    { NAME: 'ABC', COUNT: '12345678901234567890', QTY: 3, NOTE: null, LEADING: '  x' },
  );
});

test('normalizeRow output can be passed to JSON.stringify', () => {
  assert.doesNotThrow(() => JSON.stringify(normalizeRow({ BIG: 1n })));
});
