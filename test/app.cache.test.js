'use strict';

const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { useTestEnv, listen } = require('./helpers');

// The cache reads CACHE_TTL_SECONDS when the app loads, so it needs its own file (and process).
useTestEnv({ CACHE_TTL_SECONDS: '60' });

const db = require('../src/db/query');
const app = require('../src/app');

let server;
let runSelect;

before(async () => { server = await listen(app); });
after(async () => { await server.close(); });
beforeEach(() => { runSelect = mock.method(db, 'runSelect', async () => [{ CDDEVC: '1' }]); });
afterEach(() => { mock.restoreAll(); });

async function get(path) {
  const res = await fetch(`${server.base}${path}`);
  return { status: res.status, cache: res.headers.get('x-cache'), body: await res.json() };
}

test('the second identical request is served from memory without querying', async () => {
  const first = await get('/api/web/services/MDVICE?cddevc=A1');
  const second = await get('/api/web/services/MDVICE?cddevc=A1');

  assert.equal(first.cache, 'MISS');
  assert.equal(second.cache, 'HIT');
  assert.deepEqual(second.body, first.body);
  assert.equal(runSelect.mock.callCount(), 1);
});

test('different parameter values are cached separately', async () => {
  await get('/api/web/services/MDVICE?cddevc=B1');
  await get('/api/web/services/MDVICE?cddevc=B2');
  await get('/api/web/services/MDVICE?cddevc=B1');

  assert.equal(runSelect.mock.callCount(), 2);
});

test('different pages of a paged endpoint are cached separately', async () => {
  const page1 = await get('/api/web/services/MGPGST?limit=5&offset=0');
  const page2 = await get('/api/web/services/MGPGST?limit=5&offset=5');
  const page1Again = await get('/api/web/services/MGPGST?limit=5&offset=0');

  assert.equal(page1.cache, 'MISS');
  assert.equal(page2.cache, 'MISS');
  assert.equal(page1Again.cache, 'HIT');
  assert.equal(page1Again.body.offset, 0);
  assert.equal(runSelect.mock.callCount(), 2);
});

test('the same query string on different endpoints does not collide', async () => {
  await get('/api/web/services/MDVICE?cddevc=C1');
  const other = await get('/api/web/services/WGPGBL');

  assert.equal(other.cache, 'MISS');
  assert.equal(runSelect.mock.callCount(), 2);
});

test('a failed query is not cached, so the next request tries again', async () => {
  mock.method(console, 'error', () => {});
  runSelect.mock.mockImplementationOnce(async () => { throw new Error('temporary failure'); });

  const failed = await get('/api/web/services/MDVICE?cddevc=D1');
  const retried = await get('/api/web/services/MDVICE?cddevc=D1');

  assert.equal(failed.status, 500);
  assert.equal(retried.status, 200);
  assert.equal(retried.cache, 'MISS');
  assert.equal(runSelect.mock.callCount(), 2);
});

test('validation errors are never cached and never reach the database', async () => {
  const first = await get('/api/web/services/MDVICE');
  const second = await get('/api/web/services/MDVICE');

  assert.equal(first.status, 400);
  assert.equal(second.status, 400);
  assert.equal(runSelect.mock.callCount(), 0);
});
