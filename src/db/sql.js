'use strict';

// Pure helpers that build SQL text. Nothing here talks to the database, so all of it
// can be unit tested without IBM i.

const NAMED_PARAM = /:([A-Za-z_][A-Za-z0-9_]*)/g;

// Values become ? markers and are never concatenated into the text,
// so client input cannot change the SQL. This is the main SQL injection guard.
function toPositional(sql, params) {
  const values = [];
  const text = sql.replace(NAMED_PARAM, (_, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`Missing value for parameter :${name}`);
    }
    values.push(params[name]);
    return '?';
  });
  return { text, values };
}

// Interpolated, not bound: IBM i releases disagree on ? inside FETCH FIRST,
// so the integer check is the guard instead.
function withRowLimit(sql, limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new TypeError('row limit must be a positive integer');
  }
  return `${sql} FETCH FIRST ${limit} ROWS ONLY`;
}

// limit and offset are interpolated for the same reason as above.
// orderBy is not user input: it comes from the endpoint definition, which is
// checked against a strict pattern when the endpoint is registered.
function withPaging(sql, orderBy, limit, offset) {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(offset) || offset < 0) {
    throw new TypeError('limit must be a positive integer and offset a non-negative integer');
  }
  return `${sql} ORDER BY ${orderBy} OFFSET ${offset} ROWS FETCH FIRST ${limit} ROWS ONLY`;
}

// Decides how the result set is bounded, in this priority order:
//   1. paging (endpoint has orderBy): ORDER BY + OFFSET + FETCH FIRST
//   2. fetchAll: no limit at all, by explicit choice of the endpoint author
//   3. otherwise: the global ROW_LIMIT cap
function prepareQuery(endpoint, values, paging, rowLimit) {
  const { text, values: bound } = toPositional(endpoint.sql, values);
  let sql;
  if (paging) sql = withPaging(text, endpoint.orderBy, paging.limit, paging.offset);
  else if (endpoint.fetchAll) sql = text;
  else sql = withRowLimit(text, rowLimit);
  return { text: sql, values: bound };
}

// CHAR columns are space-padded on IBM i, so trailing spaces are trimmed.
// BigInt values are turned into strings because JSON.stringify throws on BigInt.
function normalizeRow(row) {
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string') out[key] = value.trimEnd();
    else if (typeof value === 'bigint') out[key] = value.toString();
    else out[key] = value;
  }
  return out;
}

module.exports = { toPositional, withRowLimit, withPaging, prepareQuery, normalizeRow };
