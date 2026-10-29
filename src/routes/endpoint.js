'use strict';

const config = require('../config');
// Called as db.runSelect(...) through the module object, never destructured, so tests
// can replace runSelect with a stub and exercise the whole HTTP layer without IBM i.
const db = require('../db/query');
const { createTtlCache } = require('../cache');
const { AppError } = require('../errors');

// ---------------------------------------------------------------------------
// Endpoint definition
//
// Each endpoint is a plain object (see mdvice.js for an example):
//   path        required  URL path, must start with /api/
//   sql         required  a single SELECT, with :name markers for client values
//   params      optional  [{ name, required?, maxLength? }], one entry per :name in sql
//   orderBy     optional  turns on paging (limit/offset); do not put ORDER BY in sql
//   fetchAll    optional  true = no row cap at all (use with care on big tables)
//   description optional  free text for humans
// ---------------------------------------------------------------------------

const FORBIDDEN_KEYWORD = /\b(INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|CALL)\b/i;
const PLACEHOLDER = /:([A-Za-z_][A-Za-z0-9_]*)/g;
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const ORDER_BY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?(\s*,\s*[A-Za-z_][A-Za-z0-9_]*(\s+(ASC|DESC))?)*$/i;
const DEFAULT_MAX_LENGTH = 100;
const PAGING_KEYS = ['limit', 'offset'];
const MAX_OFFSET = 2147483647;
const CACHE_MAX_ENTRIES = 200;

// Runs when the server starts, so a typo in an endpoint stops the boot with a clear message
// instead of failing on the first live request.
function normalizeDefinition(def) {
  const errors = [];
  const label = def && def.path ? def.path : '(no path)';
  const fail = (message) => errors.push(`${label}: ${message}`);

  if (!def || typeof def !== 'object') throw new Error('Invalid endpoint: definition must be an object');

  if (typeof def.path !== 'string' || !def.path.startsWith('/api/')) fail('path must start with /api/');

  if (typeof def.sql !== 'string' || !def.sql.trim()) {
    fail('sql is required');
    throw new Error(`Invalid endpoint:\n - ${errors.join('\n - ')}`);
  }

  // The API is read-only. These checks are a second line of defense; the real one is
  // that the IBM i user in .env should only have read authority.
  if (!/^\s*SELECT\b/i.test(def.sql)) fail('sql must start with SELECT');
  if (def.sql.includes(';')) fail("sql must not contain ';'");
  const forbidden = def.sql.match(FORBIDDEN_KEYWORD);
  if (forbidden) fail(`keyword ${forbidden[0].toUpperCase()} is not allowed`);

  if (def.fetchAll !== undefined && typeof def.fetchAll !== 'boolean') fail('fetchAll must be boolean');
  if (def.fetchAll === true && def.orderBy !== undefined) fail('fetchAll cannot be combined with orderBy');
  if (def.orderBy !== undefined) {
    // orderBy is placed into the SQL text, so it must look like plain column names.
    if (typeof def.orderBy !== 'string' || !ORDER_BY_PATTERN.test(def.orderBy.trim())) {
      fail('orderBy must be column names with optional ASC/DESC');
    }
    if (/\bORDER\s+BY\b/i.test(def.sql)) fail('sql must not contain ORDER BY when orderBy is set');
  }

  const params = def.params ?? [];
  if (!Array.isArray(params)) {
    fail('params must be an array');
    throw new Error(`Invalid endpoint:\n - ${errors.join('\n - ')}`);
  }

  const declared = new Set();
  params.forEach((p) => {
    if (!p || typeof p.name !== 'string' || !NAME_PATTERN.test(p.name)) {
      fail('invalid param name');
      return;
    }
    if (declared.has(p.name)) fail(`duplicate param ${p.name}`);
    declared.add(p.name);
    if (p.required !== undefined && typeof p.required !== 'boolean') {
      fail(`param ${p.name}: required must be boolean`);
    }
    if (p.maxLength !== undefined && !(Number.isInteger(p.maxLength) && p.maxLength > 0)) {
      fail(`param ${p.name}: maxLength must be a positive integer`);
    }
  });

  const used = new Set();
  for (const [, name] of def.sql.matchAll(PLACEHOLDER)) {
    used.add(name);
    if (!declared.has(name)) fail(`:${name} is used in sql but not declared in params`);
  }
  // A declared but unused param is almost always a typo, and it would silently accept a
  // query-string key that does nothing.
  for (const name of declared) {
    if (!used.has(name)) fail(`param ${name} is declared but never used in sql`);
  }

  if (errors.length > 0) throw new Error(`Invalid endpoint:\n - ${errors.join('\n - ')}`);

  return Object.freeze({
    ...def,
    params: Object.freeze(params.map((p) => Object.freeze({
      ...p,
      maxLength: p.maxLength ?? DEFAULT_MAX_LENGTH,
    }))),
  });
}

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

// Turns the query string into { paramName: value }, or throws a 400.
function validateQuery(endpoint, query) {
  const declared = new Map(endpoint.params.map((p) => [p.name, p]));

  for (const key of Object.keys(query)) {
    if (!declared.has(key) && !(endpoint.orderBy && PAGING_KEYS.includes(key))) {
      throw new AppError(`Unknown parameter: ${key}`, 400);
    }
    // Express turns repeated keys into arrays (and a[b]=1 into objects).
    // Rejecting them avoids guessing which value was meant.
    if (typeof query[key] !== 'string') {
      throw new AppError(`Parameter ${key} must be given exactly once`, 400);
    }
  }

  const values = {};
  for (const param of endpoint.params) {
    const raw = query[param.name];
    if (raw === undefined || raw === '') {
      if (param.required) throw new AppError(`Missing required parameter: ${param.name}`, 400);
      // NULL keeps every :marker in the SQL bound, even when the client leaves it out.
      values[param.name] = null;
      continue;
    }
    if (raw.length > param.maxLength) {
      throw new AppError(`Parameter ${param.name} exceeds ${param.maxLength} characters`, 400);
    }
    values[param.name] = raw;
  }
  return values;
}

function parseInteger(raw, name, min, max, fallback) {
  if (raw === undefined || raw === '') return fallback;
  // Digits only: Number() would also accept '1e3', '0x10' and ' 5 '.
  if (!/^\d+$/.test(raw)) throw new AppError(`${name} must be an integer`, 400);
  const value = Number(raw);
  if (value < min || value > max) throw new AppError(`${name} must be between ${min} and ${max}`, 400);
  return value;
}

// Only endpoints that declare orderBy are paged; the others keep the plain row cap.
function parsePaging(endpoint, query, { pageSize, rowLimit }) {
  if (!endpoint.orderBy) return null;
  return {
    limit: parseInteger(query.limit, 'limit', 1, rowLimit, pageSize),
    offset: parseInteger(query.offset, 'offset', 0, MAX_OFFSET, 0),
  };
}

function buildBody(rows, paging) {
  const body = { P_ISFOUND: rows.length > 0 ? '1' : '0', rows };
  return paging ? { ...body, limit: paging.limit, offset: paging.offset } : body;
}

// One cache shared by all endpoints. The path is part of the key, so endpoints cannot collide.
const cache = createTtlCache({ ttlSeconds: config.cacheTtlSeconds, maxEntries: CACHE_MAX_ENTRIES });

function cacheKey(endpoint, values, paging) {
  return JSON.stringify([endpoint.path, values, paging]);
}

function createHandler(endpoint) {
  return async (req, res, next) => {
    try {
      const values = validateQuery(endpoint, req.query);
      const paging = parsePaging(endpoint, req.query, config);

      const key = cacheKey(endpoint, values, paging);
      let body = cache.get(key);
      const hit = body !== undefined;
      if (!hit) {
        const rows = await db.runSelect(endpoint, values, paging);
        body = buildBody(rows, paging);
        // Only successful results are cached; errors are thrown before this line.
        cache.set(key, body);
      }

      // A debug aid for checking that repeated requests are served from memory.
      if (cache.enabled) res.set('X-Cache', hit ? 'HIT' : 'MISS');
      res.json(body);
    } catch (err) {
      next(err);
    }
  };
}

// Validates every definition, rejects duplicate paths, and registers a GET route for each.
// Express would silently let the first of two identical paths win, so duplicates are an error.
function registerEndpoints(router, definitions) {
  const seen = new Set();
  for (const def of definitions) {
    const endpoint = normalizeDefinition(def);
    if (seen.has(endpoint.path)) throw new Error(`Invalid endpoint: duplicate path ${endpoint.path}`);
    seen.add(endpoint.path);
    router.get(endpoint.path, createHandler(endpoint));
  }
}

module.exports = {
  registerEndpoints,
  normalizeDefinition,
  validateQuery,
  parsePaging,
};
