'use strict';

const config = require('../config');

// How connections are handed out depends on DB_CONNECTION_MODE:
//
//   pool        : connections are kept open and reused. Fast, but each connection is a
//                 QZDASOINIT job on IBM i, and a job that ran a query can keep a *SHRRD
//                 lock on the file until the connection itself is closed.
//   per-request : a fresh connection per query, closed when the query is done. Slower
//                 (a login per request) but the job lock goes away with the connection.
//
// Everything else in the project calls getConnection() and connection.close() the same way
// in both modes. In pool mode close() hands the connection back to the pool, in
// per-request mode it really closes it. That is why only this file knows about the mode.

let pool = null;
let odbc = null;

// Loaded on first use, not at require time, so tests and tooling can import the app on a
// machine where the native odbc module is not built.
function loadOdbc() {
  if (!odbc) odbc = require('odbc');
  return odbc;
}

function buildConnectionString({ driver, host, user, password, library }) {
  // Inside braces a literal '}' must be doubled, or it ends the PWD value early.
  const escapedPassword = password.replace(/}/g, '}}');
  return `DRIVER={${driver}};SYSTEM=${host};UID=${user};PWD={${escapedPassword}};DBQ=${library};DefaultLibraries=${library};NAM=0`;
}

async function init() {
  // Per-request mode has nothing to prepare. The startup ping still proves the settings work.
  if (config.db.connectionMode !== 'pool' || pool) return;
  pool = await loadOdbc().pool({
    connectionString: buildConnectionString(config.db),
    loginTimeout: config.db.loginTimeout,
    initialSize: config.db.poolInitial,
    maxSize: config.db.poolMax,
  });
}

async function getConnection() {
  if (config.db.connectionMode === 'pool') {
    if (!pool) throw new Error('Database pool is not initialized');
    return pool.connect();
  }
  return loadOdbc().connect({
    connectionString: buildConnectionString(config.db),
    loginTimeout: config.db.loginTimeout,
  });
}

async function close() {
  if (!pool) return;
  const current = pool;
  // Cleared first so a second shutdown signal cannot close the same pool twice.
  pool = null;
  await current.close();
}

module.exports = { init, getConnection, close, buildConnectionString };
