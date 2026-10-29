'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { useTestEnv, listen } = require('./helpers');

// The limiter reads these when the app loads, so this test has its own file (and process).
useTestEnv({ RATE_LIMIT_MAX: '2', RATE_LIMIT_WINDOW_MS: '60000' });

const app = require('../src/app');

let server;
before(async () => { server = await listen(app); });
after(async () => { await server.close(); });

test('requests beyond RATE_LIMIT_MAX get a JSON 429 with rate limit headers', async () => {
  // /api/unknown answers 404 without touching the database, which is all this test needs.
  const first = await fetch(`${server.base}/api/unknown`);
  const second = await fetch(`${server.base}/api/unknown`);
  const third = await fetch(`${server.base}/api/unknown`);

  assert.equal(first.status, 404);
  assert.equal(second.status, 404);
  assert.equal(third.status, 429);
  assert.deepEqual(await third.json(), { success: false, error: 'Too many requests' });
  assert.ok(third.headers.get('ratelimit'), 'standard RateLimit header should be present');
});
