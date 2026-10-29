'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const BASE_ENV = {
  DB_HOST: 'test-host',
  DB_USER: 'test-user',
  DB_PASSWORD: 'test-password',
  DB_LIBRARY: 'TESTLIB',
  NODE_ENV: 'test',
};

// Replaces the native odbc module with a recorder, so these tests check how the code
// uses odbc without needing the driver or an IBM i system.
function installFakeOdbc() {
  const calls = { pool: [], connect: [], poolConnect: 0, poolClose: 0 };
  const fake = {
    pool: async (options) => {
      calls.pool.push(options);
      return {
        connect: async () => {
          calls.poolConnect += 1;
          return { kind: 'pooled' };
        },
        close: async () => {
          calls.poolClose += 1;
        },
      };
    },
    connect: async (options) => {
      calls.connect.push(options);
      return { kind: 'direct' };
    },
  };
  const id = require.resolve('odbc');
  require.cache[id] = { id, filename: id, loaded: true, exports: fake };
  return calls;
}

// config and pool read the environment when they load, so each test
// clears them from the module cache and loads fresh copies for its own mode.
function loadPool(mode) {
  for (const file of ['../src/config', '../src/db/pool']) {
    delete require.cache[require.resolve(file)];
  }
  Object.assign(process.env, BASE_ENV, { DB_CONNECTION_MODE: mode });
  return require('../src/db/pool');
}

let calls;
beforeEach(() => {
  calls = installFakeOdbc();
});

test('buildConnectionString contains every part and doubles } in the password', () => {
  const { buildConnectionString } = loadPool('pool');
  const text = buildConnectionString({
    driver: 'IBM i Access ODBC Driver',
    host: 'myhost',
    user: 'myuser',
    password: 'pa}ss}',
    library: 'MYLIB',
  });
  assert.equal(
    text,
    'DRIVER={IBM i Access ODBC Driver};SYSTEM=myhost;UID=myuser;PWD={pa}}ss}}};DBQ=MYLIB;NAM=0',
  );
});

test('pool mode: init creates one pool with the configured sizes and reuses it', async () => {
  const connections = loadPool('pool');
  await connections.init();
  await connections.init();

  assert.equal(calls.pool.length, 1);
  assert.equal(calls.pool[0].initialSize, 1);
  assert.equal(calls.pool[0].maxSize, 3);
  assert.equal(calls.pool[0].loginTimeout, 10);
  assert.match(calls.pool[0].connectionString, /^DRIVER=\{IBM i Access ODBC Driver\};SYSTEM=test-host;/);
});

test('pool mode: connections come from the pool and odbc.connect is never used', async () => {
  const connections = loadPool('pool');
  await connections.init();

  assert.deepEqual(await connections.getConnection(), { kind: 'pooled' });
  assert.deepEqual(await connections.getConnection(), { kind: 'pooled' });
  assert.equal(calls.poolConnect, 2);
  assert.equal(calls.connect.length, 0);
});

test('pool mode: getConnection before init fails with a clear message', async () => {
  const connections = loadPool('pool');
  await assert.rejects(connections.getConnection(), /Database pool is not initialized/);
});

test('pool mode: close shuts the pool once, and a second close does nothing', async () => {
  const connections = loadPool('pool');
  await connections.init();
  await connections.close();
  await connections.close();
  assert.equal(calls.poolClose, 1);
});

test('per-request mode: init creates no pool', async () => {
  const connections = loadPool('per-request');
  await connections.init();
  assert.equal(calls.pool.length, 0);
});

test('per-request mode: every call opens a new connection with the login timeout', async () => {
  const connections = loadPool('per-request');
  await connections.init();

  assert.deepEqual(await connections.getConnection(), { kind: 'direct' });
  assert.deepEqual(await connections.getConnection(), { kind: 'direct' });

  assert.equal(calls.connect.length, 2);
  assert.equal(calls.connect[0].loginTimeout, 10);
  assert.match(calls.connect[0].connectionString, /DBQ=TESTLIB;NAM=0$/);
  assert.equal(calls.poolConnect, 0);
});

test('per-request mode: close has nothing to shut down', async () => {
  const connections = loadPool('per-request');
  await connections.init();
  await connections.close();
  assert.equal(calls.poolClose, 0);
});
