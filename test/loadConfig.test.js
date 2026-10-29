'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadConfig } = require('../src/loadConfig');

const REQUIRED_ENV = {
  DB_HOST: 'host',
  DB_USER: 'user',
  DB_PASSWORD: 'secret',
  DB_LIBRARY: 'MYLIB',
};

const withEnv = (extra = {}) => ({ ...REQUIRED_ENV, ...extra });

test('defaults match the old project, so an existing .env keeps working', () => {
  const config = loadConfig(withEnv());
  assert.equal(config.env, 'production');
  assert.equal(config.port, 3099);
  assert.equal(config.corsOrigin, false);
  assert.equal(config.rowLimit, 500);
  assert.equal(config.pageSize, 100);
  assert.deepEqual(config.rateLimit, { windowMs: 60000, max: 120 });
  assert.equal(config.db.driver, 'IBM i Access ODBC Driver');
  assert.equal(config.db.poolInitial, 1);
  assert.equal(config.db.poolMax, 3);
  assert.equal(config.db.queueMax, 50);
  assert.equal(config.db.loginTimeout, 10);
  assert.equal(config.db.queryTimeout, 15);
});

test('new optional settings default to the old behavior', () => {
  const config = loadConfig(withEnv());
  assert.equal(config.db.connectionMode, 'pool');
  assert.equal(config.cacheTtlSeconds, 0);
});

test('missing required variables are all reported at once', () => {
  assert.throws(
    () => loadConfig({ DB_HOST: 'host' }),
    /Missing required environment variables: DB_USER, DB_PASSWORD, DB_LIBRARY/,
  );
});

test('empty required variables count as missing', () => {
  assert.throws(() => loadConfig(withEnv({ DB_PASSWORD: '' })), /DB_PASSWORD/);
});

test('DB_LIBRARY must follow IBM i naming rules', () => {
  for (const bad of ['TOOLONGLIBRARY', 'MY LIB', "LIB;DROP", 'LIB}']) {
    assert.throws(() => loadConfig(withEnv({ DB_LIBRARY: bad })), /DB_LIBRARY must be 1-10/);
  }
  for (const good of ['A', 'MYLIB', 'LIB_1', 'L#B@$']) {
    assert.doesNotThrow(() => loadConfig(withEnv({ DB_LIBRARY: good })));
  }
});

test('integer settings reject non-integers and out-of-range values', () => {
  const cases = [
    ['ROW_LIMIT', '0'],
    ['ROW_LIMIT', '1001'],
    ['ROW_LIMIT', 'abc'],
    ['ROW_LIMIT', '1.5'],
    ['PORT', '70000'],
    ['DB_QUEUE_MAX', '-1'],
    ['CACHE_TTL_SECONDS', '3601'],
  ];
  for (const [name, value] of cases) {
    assert.throws(
      () => loadConfig(withEnv({ [name]: value })),
      new RegExp(`${name} must be an integer`),
      `${name}=${value}`,
    );
  }
});

test('zero is accepted where it means "off"', () => {
  const config = loadConfig(withEnv({ DB_QUEUE_MAX: '0', CACHE_TTL_SECONDS: '0' }));
  assert.equal(config.db.queueMax, 0);
  assert.equal(config.cacheTtlSeconds, 0);
});

test('PAGE_SIZE cannot exceed ROW_LIMIT', () => {
  assert.throws(
    () => loadConfig(withEnv({ ROW_LIMIT: '50', PAGE_SIZE: '51' })),
    /PAGE_SIZE must be an integer between 1 and 50/,
  );
  assert.equal(loadConfig(withEnv({ ROW_LIMIT: '50', PAGE_SIZE: '50' })).pageSize, 50);
});

test('DB_POOL_INITIAL must not exceed DB_POOL_MAX', () => {
  assert.throws(
    () => loadConfig(withEnv({ DB_POOL_INITIAL: '5', DB_POOL_MAX: '2' })),
    /DB_POOL_INITIAL must not exceed DB_POOL_MAX/,
  );
});

test('DB_CONNECTION_MODE accepts only pool or per-request', () => {
  assert.equal(loadConfig(withEnv({ DB_CONNECTION_MODE: 'per-request' })).db.connectionMode, 'per-request');
  assert.throws(
    () => loadConfig(withEnv({ DB_CONNECTION_MODE: 'forever' })),
    /DB_CONNECTION_MODE must be one of: pool, per-request/,
  );
});

test('CORS_ORIGIN is split on commas, trimmed, and empty entries dropped', () => {
  const config = loadConfig(withEnv({ CORS_ORIGIN: ' http://a.test , http://b.test ,, ' }));
  assert.deepEqual(config.corsOrigin, ['http://a.test', 'http://b.test']);
});

test('several problems are reported in one error', () => {
  try {
    loadConfig({ DB_HOST: 'h', DB_LIBRARY: 'BAD LIB', ROW_LIMIT: '0' });
    assert.fail('expected loadConfig to throw');
  } catch (err) {
    assert.match(err.message, /Missing required environment variables: DB_USER, DB_PASSWORD/);
    assert.match(err.message, /DB_LIBRARY must be 1-10/);
    assert.match(err.message, /ROW_LIMIT must be an integer/);
  }
});

test('the returned config is deeply frozen', () => {
  const config = loadConfig(withEnv());
  assert.throws(() => { config.port = 1; }, TypeError);
  assert.throws(() => { config.db.host = 'other'; }, TypeError);
});
