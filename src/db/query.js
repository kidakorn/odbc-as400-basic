'use strict';

const config = require('../config');
const { AppError } = require('../errors');
const connections = require('./pool');
const { prepareQuery, normalizeRow } = require('./sql');

const PROBE_SQL = 'SELECT 1 FROM SYSIBM.SYSDUMMY1';

// Caps how many queries run at once and how many may wait for their turn.
// It exists because odbc's Pool.query takes no per-query options, so every query checks out
// its own connection to apply a timeout. Without a cap, a burst (for example a user holding F5)
// would open as many IBM i jobs as there are requests.
function createLimiter(max, queueMax) {
  let active = 0;
  const waiting = [];

  return {
    async acquire() {
      if (active < max) {
        active += 1;
        return;
      }
      if (waiting.length >= queueMax) {
        throw new AppError('Server busy, try again later', 503);
      }
      await new Promise((resolve) => waiting.push(resolve));
    },
    release() {
      const next = waiting.shift();
      // The slot is handed straight to the next waiter without decrementing,
      // so active can never exceed max even when many requests finish at once.
      if (next) next();
      else active -= 1;
    },
  };
}

const limiter = createLimiter(config.db.poolMax, config.db.queueMax);

// A failure while closing must not hide the real error from the query,
// because an exception thrown inside finally replaces the one in flight.
async function closeQuietly(connection) {
  try {
    await connection.close();
  } catch (err) {
    console.error('Closing connection failed:', err.odbcErrors || err.message);
  }
}

async function execute(sql, values) {
  await limiter.acquire();
  try {
    const connection = await connections.getConnection();
    try {
      return await connection.query(sql, values, { timeout: config.db.queryTimeout });
    } finally {
      await closeQuietly(connection);
    }
  } finally {
    limiter.release();
  }
}

async function ping() {
  await execute(PROBE_SQL, []);
}

// endpoint: { sql, orderBy?, fetchAll? }, values: { name: value }, paging: { limit, offset } | null
async function runSelect(endpoint, values, paging) {
  const { text, values: bound } = prepareQuery(endpoint, values, paging, config.rowLimit);
  const rows = await execute(text, bound);
  return rows.map(normalizeRow);
}

module.exports = { ping, runSelect, createLimiter };
