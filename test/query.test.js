'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Set before requiring the db layer, because config reads the environment when it loads.
Object.assign(process.env, {
  DB_HOST: 'test-host',
  DB_USER: 'test-user',
  DB_PASSWORD: 'test-password',
  DB_LIBRARY: 'TESTLIB',
  NODE_ENV: 'test',
});

const connections = require('../src/db/pool');
const { createLimiter, runSelect, ping } = require('../src/db/query');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const isBusy = (err) => err.statusCode === 503 && err.isOperational === true;

// A stand-in for an odbc connection that records what the code under test does with it.
function fakeConnection({ rows = [], queryError = null, closeError = null } = {}) {
  const fake = { queries: [], closed: 0 };
  fake.query = async (sql, values, options) => {
    fake.queries.push({ sql, values, options });
    if (queryError) throw queryError;
    return rows;
  };
  fake.close = async () => {
    fake.closed += 1;
    if (closeError) throw closeError;
  };
  return fake;
}

test('limiter runs up to max at once and makes the rest wait', async () => {
  const limiter = createLimiter(2, 5);
  await limiter.acquire();
  await limiter.acquire();

  let thirdStarted = false;
  const third = limiter.acquire().then(() => { thirdStarted = true; });
  await tick();
  assert.equal(thirdStarted, false);

  limiter.release();
  await third;
  assert.equal(thirdStarted, true);
});

test('limiter rejects with 503 when the waiting line is full', async () => {
  const limiter = createLimiter(1, 1);
  await limiter.acquire();
  const waiting = limiter.acquire();
  await assert.rejects(limiter.acquire(), isBusy);

  limiter.release();
  await waiting;
});

test('limiter with queueMax 0 rejects immediately once max is reached', async () => {
  const limiter = createLimiter(1, 0);
  await limiter.acquire();
  await assert.rejects(limiter.acquire(), isBusy);
});

test('a released slot goes straight to the next waiter, so max is never exceeded', async () => {
  const limiter = createLimiter(1, 5);
  await limiter.acquire();

  let secondStarted = false;
  const second = limiter.acquire().then(() => { secondStarted = true; });
  limiter.release();
  await second;
  assert.equal(secondStarted, true);

  // The slot now belongs to the second caller, so a newcomer must still wait.
  let thirdStarted = false;
  const third = limiter.acquire().then(() => { thirdStarted = true; });
  await tick();
  assert.equal(thirdStarted, false);

  limiter.release();
  await third;
  limiter.release();

  // Everything is free again, so this one is immediate.
  await limiter.acquire();
});

test('runSelect sends bound values, the row cap and the query timeout, and normalizes rows', async (t) => {
  const connection = fakeConnection({ rows: [{ CDDEVC: '11251  ', QTY: 2 }] });
  t.mock.method(connections, 'getConnection', async () => connection);

  const rows = await runSelect({ sql: 'SELECT * FROM MDVICE WHERE CDDEVC = :cddevc' }, { cddevc: '11251' }, null);

  assert.deepEqual(rows, [{ CDDEVC: '11251', QTY: 2 }]);
  assert.equal(connection.queries.length, 1);
  assert.equal(connection.queries[0].sql, 'SELECT * FROM MDVICE WHERE CDDEVC = ? FETCH FIRST 500 ROWS ONLY');
  assert.deepEqual(connection.queries[0].values, ['11251']);
  assert.deepEqual(connection.queries[0].options, { timeout: 15 });
  assert.equal(connection.closed, 1);
});

test('the connection is closed even when the query fails', async (t) => {
  const boom = new Error('SQL0204 table not found');
  const connection = fakeConnection({ queryError: boom });
  t.mock.method(connections, 'getConnection', async () => connection);

  await assert.rejects(runSelect({ sql: 'SELECT * FROM T' }, {}, null), boom);
  assert.equal(connection.closed, 1);
});

test('a failure while closing does not hide the original query error', async (t) => {
  const boom = new Error('query failed');
  const connection = fakeConnection({ queryError: boom, closeError: new Error('close failed') });
  t.mock.method(connections, 'getConnection', async () => connection);
  t.mock.method(console, 'error', () => {});

  await assert.rejects(runSelect({ sql: 'SELECT * FROM T' }, {}, null), boom);
});

test('a failure while closing does not turn a successful query into an error', async (t) => {
  const connection = fakeConnection({ rows: [{ A: 1 }], closeError: new Error('close failed') });
  t.mock.method(connections, 'getConnection', async () => connection);
  t.mock.method(console, 'error', () => {});

  assert.deepEqual(await runSelect({ sql: 'SELECT * FROM T' }, {}, null), [{ A: 1 }]);
});

test('the slot is given back when getConnection fails', async (t) => {
  t.mock.method(connections, 'getConnection', async () => { throw new Error('login failed'); });

  // More failures than DB_POOL_MAX (3). If a slot leaked on every failure,
  // the later calls would hang forever instead of failing with the same error.
  for (let i = 0; i < 6; i += 1) {
    await assert.rejects(ping(), /login failed/);
  }
});

test('ping runs the probe statement', async (t) => {
  const connection = fakeConnection({ rows: [{ 1: 1 }] });
  t.mock.method(connections, 'getConnection', async () => connection);

  await ping();
  assert.equal(connection.queries[0].sql, 'SELECT 1 FROM SYSIBM.SYSDUMMY1');
});
