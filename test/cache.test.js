'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createTtlCache } = require('../src/cache');

// A clock the test controls, so expiry is checked without waiting.
function fakeClock(start = 1000) {
  let time = start;
  return { now: () => time, advance: (ms) => { time += ms; } };
}

test('ttlSeconds 0 returns a cache that stores nothing', () => {
  const cache = createTtlCache({ ttlSeconds: 0 });
  assert.equal(cache.enabled, false);
  cache.set('k', { a: 1 });
  assert.equal(cache.get('k'), undefined);
});

test('a stored value is returned until the TTL passes', () => {
  const clock = fakeClock();
  const cache = createTtlCache({ ttlSeconds: 10, now: clock.now });
  const value = { rows: [1] };
  cache.set('k', value);

  assert.equal(cache.enabled, true);
  assert.equal(cache.get('k'), value);

  clock.advance(9999);
  assert.equal(cache.get('k'), value);

  clock.advance(1);
  assert.equal(cache.get('k'), undefined);
});

test('an unknown key returns undefined', () => {
  assert.equal(createTtlCache({ ttlSeconds: 10 }).get('missing'), undefined);
});

test('setting a key again restarts its TTL', () => {
  const clock = fakeClock();
  const cache = createTtlCache({ ttlSeconds: 10, now: clock.now });
  cache.set('k', 'first');
  clock.advance(8000);
  cache.set('k', 'second');
  clock.advance(8000);
  assert.equal(cache.get('k'), 'second');
});

test('the oldest entry is evicted when maxEntries is exceeded', () => {
  const cache = createTtlCache({ ttlSeconds: 10, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('c', 3);

  assert.equal(cache.get('a'), undefined);
  assert.equal(cache.get('b'), 2);
  assert.equal(cache.get('c'), 3);
});

test('re-setting a key makes it the newest, so it survives the next eviction', () => {
  const cache = createTtlCache({ ttlSeconds: 10, maxEntries: 2 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.set('a', 10);
  cache.set('c', 3);

  assert.equal(cache.get('a'), 10);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('c'), 3);
});
