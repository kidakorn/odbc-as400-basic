'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { useTestEnv } = require('./helpers');

useTestEnv();

const {
  registerEndpoints, normalizeDefinition, validateQuery, parsePaging,
} = require('../src/routes/endpoint');

const isBadRequest = (message) => (err) => (
  err.statusCode === 400 && err.isOperational === true && err.message === message
);

const BASE = {
  path: '/api/test/T',
  sql: 'SELECT * FROM T WHERE A = :a',
  params: [{ name: 'a', required: true, maxLength: 10 }],
};

// Runs normalizeDefinition and returns the error message, or fails if it did not throw.
function rejection(def) {
  try {
    normalizeDefinition(def);
  } catch (err) {
    return err.message;
  }
  return assert.fail('expected the definition to be rejected');
}

// --- normalizeDefinition ---------------------------------------------------

test('the three shipped endpoint definitions are valid', () => {
  for (const file of ['mdvice', 'wgpgbl', 'mgpgst']) {
    assert.doesNotThrow(() => normalizeDefinition(require(`../src/routes/${file}`)), file);
  }
});

test('normalizeDefinition applies the default maxLength and freezes the result', () => {
  const endpoint = normalizeDefinition({ ...BASE, params: [{ name: 'a' }] });
  assert.equal(endpoint.params[0].maxLength, 100);
  assert.throws(() => { endpoint.path = '/api/other'; }, TypeError);
  assert.throws(() => { endpoint.params[0].name = 'b'; }, TypeError);
});

test('normalizeDefinition accepts a definition without params', () => {
  const endpoint = normalizeDefinition({ path: '/api/test/ALL', sql: 'SELECT * FROM T', fetchAll: true });
  assert.deepEqual(endpoint.params, []);
});

test('normalizeDefinition rejects a path outside /api/', () => {
  assert.match(rejection({ ...BASE, path: '/health' }), /path must start with \/api\//);
  assert.match(rejection({ ...BASE, path: undefined }), /path must start with \/api\//);
});

test('normalizeDefinition rejects missing or non-SELECT sql', () => {
  assert.match(rejection({ ...BASE, sql: '' }), /sql is required/);
  assert.match(rejection({ ...BASE, sql: undefined }), /sql is required/);
  assert.match(rejection({ ...BASE, sql: 'DELETE FROM T WHERE A = :a' }), /sql must start with SELECT/);
});

test('normalizeDefinition rejects a semicolon, which would allow a second statement', () => {
  assert.match(rejection({ ...BASE, sql: 'SELECT * FROM T WHERE A = :a; DROP TABLE T' }), /must not contain ';'/);
});

test('normalizeDefinition rejects data-changing keywords even inside a SELECT', () => {
  const sql = 'SELECT * FROM FINAL TABLE (INSERT INTO T VALUES (:a))';
  assert.match(rejection({ ...BASE, sql }), /keyword INSERT is not allowed/);
});

test('normalizeDefinition checks fetchAll and orderBy', () => {
  assert.match(rejection({ ...BASE, fetchAll: 'yes' }), /fetchAll must be boolean/);
  assert.match(rejection({ ...BASE, fetchAll: true, orderBy: 'A' }), /fetchAll cannot be combined with orderBy/);
  assert.match(rejection({ ...BASE, orderBy: 'A; DROP TABLE T' }), /orderBy must be column names/);
  assert.match(rejection({ ...BASE, orderBy: 'A, B DESC;' }), /orderBy must be column names/);
  assert.match(
    rejection({ ...BASE, sql: 'SELECT * FROM T WHERE A = :a ORDER BY B', orderBy: 'B' }),
    /must not contain ORDER BY when orderBy is set/,
  );
  assert.doesNotThrow(() => normalizeDefinition({ ...BASE, orderBy: 'A ASC, B DESC' }));
});

test('normalizeDefinition checks the params list', () => {
  assert.match(rejection({ ...BASE, params: 'a' }), /params must be an array/);
  assert.match(rejection({ ...BASE, params: [{ name: '1bad' }] }), /invalid param name/);
  assert.match(rejection({ ...BASE, params: [{ name: 'a' }, { name: 'a' }] }), /duplicate param a/);
  assert.match(rejection({ ...BASE, params: [{ name: 'a', required: 'yes' }] }), /required must be boolean/);
  assert.match(rejection({ ...BASE, params: [{ name: 'a', maxLength: 0 }] }), /maxLength must be a positive integer/);
  assert.match(rejection({ ...BASE, params: [{ name: 'a', maxLength: 1.5 }] }), /maxLength must be a positive integer/);
});

test('normalizeDefinition rejects a :marker that is not declared', () => {
  assert.match(
    rejection({ ...BASE, sql: 'SELECT * FROM T WHERE A = :a AND B = :b' }),
    /:b is used in sql but not declared in params/,
  );
});

test('normalizeDefinition rejects a declared param that sql never uses', () => {
  assert.match(
    rejection({ ...BASE, params: [{ name: 'a' }, { name: 'typo' }] }),
    /param typo is declared but never used in sql/,
  );
});

test('normalizeDefinition rejects a definition that is not an object', () => {
  assert.throws(() => normalizeDefinition(null), /definition must be an object/);
  assert.throws(() => normalizeDefinition('SELECT 1'), /definition must be an object/);
});

test('normalizeDefinition reports every problem in one error', () => {
  const message = rejection({ path: '/x', sql: 'SELECT * FROM T WHERE A = :a;', params: [{ name: 'z' }] });
  assert.match(message, /path must start with \/api\//);
  assert.match(message, /must not contain ';'/);
  assert.match(message, /:a is used in sql but not declared/);
  assert.match(message, /param z is declared but never used/);
});

// --- registerEndpoints -----------------------------------------------------

test('registerEndpoints registers one GET route per definition', () => {
  const paths = [];
  const router = { get: (path) => paths.push(path) };
  registerEndpoints(router, [BASE, { path: '/api/test/U', sql: 'SELECT * FROM U', fetchAll: true }]);
  assert.deepEqual(paths, ['/api/test/T', '/api/test/U']);
});

test('registerEndpoints rejects two endpoints with the same path', () => {
  const router = { get: () => {} };
  assert.throws(
    () => registerEndpoints(router, [BASE, { ...BASE }]),
    /duplicate path \/api\/test\/T/,
  );
});

// --- validateQuery ---------------------------------------------------------

const MDVICE = normalizeDefinition(require('../src/routes/mdvice'));
const PAGED = normalizeDefinition(require('../src/routes/mgpgst'));
const OPTIONAL = normalizeDefinition({
  path: '/api/test/OPT',
  sql: 'SELECT * FROM T WHERE A = :a AND B = :b',
  params: [{ name: 'a', required: true }, { name: 'b' }],
});

test('validateQuery returns the declared values', () => {
  assert.deepEqual(validateQuery(MDVICE, { cddevc: '11251' }), { cddevc: '11251' });
});

test('validateQuery rejects a missing or empty required parameter', () => {
  const expected = isBadRequest('Missing required parameter: cddevc');
  assert.throws(() => validateQuery(MDVICE, {}), expected);
  assert.throws(() => validateQuery(MDVICE, { cddevc: '' }), expected);
});

test('validateQuery rejects an unknown parameter', () => {
  assert.throws(
    () => validateQuery(MDVICE, { cddevc: '1', extra: 'x' }),
    isBadRequest('Unknown parameter: extra'),
  );
});

test('validateQuery rejects a repeated parameter (array) and a nested one (object)', () => {
  const expected = isBadRequest('Parameter cddevc must be given exactly once');
  assert.throws(() => validateQuery(MDVICE, { cddevc: ['1', '2'] }), expected);
  assert.throws(() => validateQuery(MDVICE, { cddevc: { x: '1' } }), expected);
});

test('validateQuery enforces maxLength', () => {
  assert.doesNotThrow(() => validateQuery(MDVICE, { cddevc: '1234567890' }));
  assert.throws(
    () => validateQuery(MDVICE, { cddevc: '12345678901' }),
    isBadRequest('Parameter cddevc exceeds 10 characters'),
  );
});

test('validateQuery binds NULL for an optional parameter that was omitted', () => {
  assert.deepEqual(validateQuery(OPTIONAL, { a: '1' }), { a: '1', b: null });
  assert.deepEqual(validateQuery(OPTIONAL, { a: '1', b: '' }), { a: '1', b: null });
});

test('validateQuery allows limit and offset only on paged endpoints', () => {
  assert.deepEqual(validateQuery(PAGED, { limit: '10', offset: '5' }), {});
  assert.throws(
    () => validateQuery(MDVICE, { cddevc: '1', limit: '10' }),
    isBadRequest('Unknown parameter: limit'),
  );
});

// --- parsePaging -----------------------------------------------------------

const BOUNDS = { pageSize: 100, rowLimit: 500 };

test('parsePaging returns null for an endpoint without orderBy', () => {
  assert.equal(parsePaging(MDVICE, { limit: '10' }, BOUNDS), null);
});

test('parsePaging uses PAGE_SIZE and offset 0 by default', () => {
  assert.deepEqual(parsePaging(PAGED, {}, BOUNDS), { limit: 100, offset: 0 });
  assert.deepEqual(parsePaging(PAGED, { limit: '', offset: '' }, BOUNDS), { limit: 100, offset: 0 });
});

test('parsePaging reads explicit values', () => {
  assert.deepEqual(parsePaging(PAGED, { limit: '25', offset: '50' }, BOUNDS), { limit: 25, offset: 50 });
  assert.deepEqual(parsePaging(PAGED, { limit: '500' }, BOUNDS), { limit: 500, offset: 0 });
});

test('parsePaging accepts digits only', () => {
  for (const bad of ['1e3', '-1', '0x10', ' 5', '5 ', '1.5', 'abc', '١٢']) {
    assert.throws(() => parsePaging(PAGED, { limit: bad }, BOUNDS), isBadRequest('limit must be an integer'), bad);
    assert.throws(() => parsePaging(PAGED, { offset: bad }, BOUNDS), isBadRequest('offset must be an integer'), bad);
  }
});

test('parsePaging enforces the range of limit and offset', () => {
  assert.throws(() => parsePaging(PAGED, { limit: '0' }, BOUNDS), isBadRequest('limit must be between 1 and 500'));
  assert.throws(() => parsePaging(PAGED, { limit: '501' }, BOUNDS), isBadRequest('limit must be between 1 and 500'));
  assert.throws(
    () => parsePaging(PAGED, { offset: '2147483648' }, BOUNDS),
    isBadRequest('offset must be between 0 and 2147483647'),
  );
  assert.deepEqual(parsePaging(PAGED, { offset: '2147483647' }, BOUNDS), { limit: 100, offset: 2147483647 });
});
