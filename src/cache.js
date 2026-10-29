'use strict';

// A small in-memory cache with a time-to-live, used so that repeated identical requests
// (for example a user pressing F5) do not query IBM i every time.
//
// Note on HTTP 304: Express builds the ETag after the handler has run, so a 304 response
// still means the query ran. This cache is what actually saves IBM i from the repeat work.
//
// ttlSeconds = 0 returns a cache that stores nothing, so callers never need an "is it on" branch
// other than the optional `enabled` flag used for the X-Cache debug header.
function createTtlCache({ ttlSeconds, maxEntries = 200, now = Date.now }) {
  if (!ttlSeconds) {
    return { enabled: false, get: () => undefined, set: () => {} };
  }

  const ttlMs = ttlSeconds * 1000;
  const store = new Map();

  return {
    enabled: true,
    get(key) {
      const entry = store.get(key);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        store.delete(key);
        return undefined;
      }
      return entry.value;
    },
    set(key, value) {
      // Delete first so the key moves to the newest position in the Map's insertion order.
      store.delete(key);
      store.set(key, { value, expiresAt: now() + ttlMs });
      // Keys include client-supplied values, so without a cap anyone could grow memory
      // without limit. The oldest entry is evicted first.
      while (store.size > maxEntries) {
        store.delete(store.keys().next().value);
      }
    },
  };
}

module.exports = { createTtlCache };
