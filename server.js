'use strict';

// Everything is loaded inside try/catch because configuration and endpoint definitions are
// validated while these files load. A mistake there should print one readable message
// and exit, not a stack trace.
let config;
let app;
let connections;
let db;
try {
  config = require('./src/config');
  app = require('./src/app');
  connections = require('./src/db/pool');
  db = require('./src/db/query');
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const SHUTDOWN_TIMEOUT_MS = 10000;

async function start() {
  // Probe before listening so a bad DB setting fails at boot, not on the first request.
  await connections.init();
  await db.ping();

  const server = app.listen(config.port, () => {
    // The mode and cache are logged because they change how IBM i sees this service.
    console.log(`API listening on http://localhost:${config.port}`);
    console.log(`DB connection mode: ${config.db.connectionMode}, cache TTL: ${config.cacheTtlSeconds}s`);
  });
  server.on('error', (err) => {
    console.error('Server error:', err.message);
    process.exit(1);
  });

  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`${signal} received, shutting down`);

    // unref so this timer never keeps the process alive on its own.
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS).unref();

    // Stop accepting new requests, let running ones finish, then close the pool.
    // Closing the pool closes its connections, which is expected to release the locks held
    // by their QZDASOINIT jobs on IBM i (see "Testing lock behavior" in the README).
    server.close(async () => {
      try {
        await connections.close();
        process.exit(0);
      } catch (err) {
        console.error('Pool close failed:', err.message);
        process.exit(1);
      }
    });
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Startup failed:', err.odbcErrors || err.message);
  process.exit(1);
});
