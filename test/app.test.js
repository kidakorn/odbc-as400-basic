'use strict';

const { test, before, after, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { useTestEnv, listen } = require('./helpers');

useTestEnv();

const db = require('../src/db/query');
const { AppError } = require('../src/errors');
const app = require('../src/app');

let server;
let runSelect;
let ping;

before(async () => { server = await listen(app); });
after(async () => { await server.close(); });

// The database layer is replaced, so these tests check the HTTP contract on its own.
beforeEach(() => {
  runSelect = mock.method(db, 'runSelect', async () => []);
  ping = mock.method(db, 'ping', async () => {});
});
afterEach(() => { mock.restoreAll(); });

async function get(path, headers) {
  const res = await fetch(`${server.base}${path}`, { headers });
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
}

// --- MDVICE (lookup by key) ------------------------------------------------

test('MDVICE returns the rows with P_ISFOUND 1', async () => {
  runSelect.mock.mockImplementation(async () => [{ CDDEVC: '11251', NMDEVC: 'DEVICE' }]);

  const res = await get('/api/web/services/MDVICE?cddevc=11251');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { P_ISFOUND: '1', rows: [{ CDDEVC: '11251', NMDEVC: 'DEVICE' }] });

  const [endpoint, values, paging] = runSelect.mock.calls[0].arguments;
  assert.equal(endpoint.sql, 'SELECT * FROM MDVICE WHERE CDDEVC = :cddevc');
  assert.deepEqual(values, { cddevc: '11251' });
  assert.equal(paging, null);
});

test('MDVICE with no match is 200 with P_ISFOUND 0, not 404', async () => {
  const res = await get('/api/web/services/MDVICE?cddevc=NOPE');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { P_ISFOUND: '0', rows: [] });
});

test('MDVICE without cddevc is 400 and never reaches the database', async () => {
  const res = await get('/api/web/services/MDVICE');
  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { success: false, error: 'Missing required parameter: cddevc' });
  assert.equal(runSelect.mock.callCount(), 0);
});

test('MDVICE with a repeated parameter is 400', async () => {
  const res = await get('/api/web/services/MDVICE?cddevc=1&cddevc=2');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Parameter cddevc must be given exactly once');
});

test('MDVICE with a value that is too long is 400', async () => {
  const res = await get('/api/web/services/MDVICE?cddevc=12345678901');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Parameter cddevc exceeds 10 characters');
});

test('MDVICE does not accept paging parameters', async () => {
  const res = await get('/api/web/services/MDVICE?cddevc=1&limit=5');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'Unknown parameter: limit');
});

test('a hostile value is passed along as data, not rejected or executed', async () => {
  // Kept within the 10 character maxLength of cddevc, so it reaches the database layer
  // as a bound value (the SQL text itself is covered in sql.test.js).
  const hostile = "1' OR 1=1";
  const res = await get(`/api/web/services/MDVICE?cddevc=${encodeURIComponent(hostile)}`);
  assert.equal(res.status, 200);
  assert.deepEqual(runSelect.mock.calls[0].arguments[1], { cddevc: hostile });
});

// --- WGPGBL (all rows) -----------------------------------------------------

test('WGPGBL is not capped by ROW_LIMIT because the endpoint sets fetchAll', async () => {
  runSelect.mock.mockImplementation(async () => [{ A: 1 }, { A: 2 }]);

  const res = await get('/api/web/services/WGPGBL');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { P_ISFOUND: '1', rows: [{ A: 1 }, { A: 2 }] });
  const [endpoint, , paging] = runSelect.mock.calls[0].arguments;
  assert.equal(endpoint.fetchAll, true);
  assert.equal(paging, null);
});

// --- MGPGST (paged) --------------------------------------------------------

test('MGPGST uses the default page size and offset, and echoes them back', async () => {
  runSelect.mock.mockImplementation(async () => [{ CDPAKG: 'A' }]);

  const res = await get('/api/web/services/MGPGST');

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { P_ISFOUND: '1', rows: [{ CDPAKG: 'A' }], limit: 100, offset: 0 });
  assert.deepEqual(runSelect.mock.calls[0].arguments[2], { limit: 100, offset: 0 });
});

test('MGPGST honors limit and offset', async () => {
  const res = await get('/api/web/services/MGPGST?limit=5&offset=10');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { P_ISFOUND: '0', rows: [], limit: 5, offset: 10 });
  assert.deepEqual(runSelect.mock.calls[0].arguments[2], { limit: 5, offset: 10 });
});

test('MGPGST rejects a limit above ROW_LIMIT and a non-integer offset', async () => {
  const tooBig = await get('/api/web/services/MGPGST?limit=501');
  assert.equal(tooBig.status, 400);
  assert.equal(tooBig.body.error, 'limit must be between 1 and 500');

  const notInteger = await get('/api/web/services/MGPGST?offset=1e3');
  assert.equal(notInteger.status, 400);
  assert.equal(notInteger.body.error, 'offset must be an integer');

  assert.equal(runSelect.mock.callCount(), 0);
});

// --- health ----------------------------------------------------------------

test('health is 200 when the database answers', async () => {
  const res = await get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
  assert.equal(res.body.datasource, 'odbc');
  assert.ok(!Number.isNaN(Date.parse(res.body.timestamp)));
  assert.equal(ping.mock.callCount(), 1);
});

test('health is 503 with a generic message when the database fails', async () => {
  ping.mock.mockImplementation(async () => { throw new Error('SQL30082 login failed for user secret-user'); });
  mock.method(console, 'error', () => {});

  const res = await get('/api/health');

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { success: false, error: 'Database unavailable' });
});

// --- errors ----------------------------------------------------------------

test('an unknown route is a JSON 404', async () => {
  const res = await get('/api/unknown');
  assert.equal(res.status, 404);
  assert.deepEqual(res.body, { success: false, error: 'Route not found: GET /api/unknown' });
});

test('only GET is routed', async () => {
  const res = await fetch(`${server.base}/api/health`, { method: 'POST' });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { success: false, error: 'Route not found: POST /api/health' });
});

test('an unexpected error is a generic 500 that leaks nothing', async () => {
  runSelect.mock.mockImplementation(async () => { throw new Error('SQL0204 MDVICE in TESTLIB not found'); });
  mock.method(console, 'error', () => {});

  const res = await get('/api/web/services/MDVICE?cddevc=1');

  assert.equal(res.status, 500);
  assert.deepEqual(res.body, { success: false, error: 'Internal server error' });
});

test('an operational error such as a full queue keeps its status and message', async () => {
  runSelect.mock.mockImplementation(async () => { throw new AppError('Server busy, try again later', 503); });

  const res = await get('/api/web/services/MDVICE?cddevc=1');

  assert.equal(res.status, 503);
  assert.deepEqual(res.body, { success: false, error: 'Server busy, try again later' });
});

// --- security headers ------------------------------------------------------

test('responses carry helmet headers and do not advertise Express', async () => {
  const res = await get('/api/health');
  assert.equal(res.headers.get('x-powered-by'), null);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
});

// --- 304 ------------------------------------------------------------------

// node:http is used here instead of fetch. fetch() adds "Cache-Control: no-cache" whenever a
// conditional header is present, and Express then never answers 304. A browser pressing F5
// sends "Cache-Control: max-age=0" instead, which is what this helper imitates.
function rawGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${server.base}${path}`, { headers }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
    }).on('error', reject);
  });
}

test('a 304 response still runs the query: the ETag is computed after the handler', async () => {
  runSelect.mock.mockImplementation(async () => [{ CDDEVC: '11251' }]);
  const path = '/api/web/services/MDVICE?cddevc=11251';

  const first = await rawGet(path);
  assert.equal(first.status, 200);
  assert.ok(first.headers.etag, 'Express should send an ETag');

  // What a browser sends when the user presses F5.
  const refresh = await rawGet(path, { 'If-None-Match': first.headers.etag, 'Cache-Control': 'max-age=0' });

  assert.equal(refresh.status, 304);
  // This is why pressing F5 reaches IBM i even when the browser shows 304.
  // CACHE_TTL_SECONDS (see app.cache.test.js) is what avoids the repeated query.
  assert.equal(runSelect.mock.callCount(), 2);
});
