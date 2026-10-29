'use strict';

const db = require('../db/query');

// Reports whether the database answers, not just whether Node is alive.
// The error detail is logged for developers but never sent to the client.
async function health(req, res) {
  try {
    await db.ping();
    res.json({ status: 'ok', datasource: 'odbc', timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Health check failed:', err.odbcErrors || err);
    res.status(503).json({ success: false, error: 'Database unavailable' });
  }
}

module.exports = health;
