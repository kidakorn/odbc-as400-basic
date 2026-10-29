'use strict';

// Shared by the tests that load the app. It is not a test itself.
// node --test runs every file under test/, which is harmless here because this file only exports.

const TEST_ENV = {
  DB_HOST: 'test-host',
  DB_USER: 'test-user',
  DB_PASSWORD: 'test-password',
  DB_LIBRARY: 'TESTLIB',
  NODE_ENV: 'test',
  RATE_LIMIT_MAX: '1000',
};

// Call this before requiring anything from src/, because config reads the environment
// the first time it is loaded. Each test file runs in its own process, so settings cannot leak.
function useTestEnv(extra = {}) {
  Object.assign(process.env, TEST_ENV, extra);
}

// Starts the app on a random free port and returns its base URL and a close function.
function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      resolve({
        base: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => {
          server.close(done);
          // fetch keeps connections alive, which would make close() wait for them to time out.
          server.closeAllConnections();
        }),
      });
    });
  });
}

module.exports = { useTestEnv, listen };
