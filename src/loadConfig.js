'use strict';

// DB_LIBRARY is interpolated into the ODBC connection string, so it must match IBM i naming rules.
const LIBRARY_PATTERN = /^[A-Za-z0-9_#@$]{1,10}$/;
const REQUIRED = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_LIBRARY'];
const CONNECTION_MODES = ['pool', 'per-request'];

function deepFreeze(obj) {
  Object.values(obj).forEach((value) => {
    if (value && typeof value === 'object') deepFreeze(value);
  });
  return Object.freeze(obj);
}

// Pure function of its input: it throws instead of calling process.exit,
// so tests can check every validation rule without killing the test runner.
// All problems are collected first so the developer fixes .env in one pass.
function loadConfig(env) {
  const errors = [];

  const missing = REQUIRED.filter((name) => !env[name]);
  if (missing.length > 0) {
    errors.push(`Missing required environment variables: ${missing.join(', ')}`);
  }
  if (env.DB_LIBRARY && !LIBRARY_PATTERN.test(env.DB_LIBRARY)) {
    errors.push('DB_LIBRARY must be 1-10 characters: letters, digits, _ # @ $');
  }

  function readInt(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const raw = env[name];
    if (raw === undefined || raw === '') return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      errors.push(`${name} must be an integer between ${min} and ${max}`);
      return fallback;
    }
    return value;
  }

  const rowLimit = readInt('ROW_LIMIT', 500, 1, 1000);
  // A page can never be larger than the row cap, so the cap is the upper bound here.
  const pageSize = readInt('PAGE_SIZE', 100, 1, rowLimit);
  const poolInitial = readInt('DB_POOL_INITIAL', 1);
  const poolMax = readInt('DB_POOL_MAX', 3);
  if (poolInitial > poolMax) errors.push('DB_POOL_INITIAL must not exceed DB_POOL_MAX');

  const connectionMode = env.DB_CONNECTION_MODE || 'pool';
  if (!CONNECTION_MODES.includes(connectionMode)) {
    errors.push(`DB_CONNECTION_MODE must be one of: ${CONNECTION_MODES.join(', ')}`);
  }

  const config = {
    env: env.NODE_ENV || 'production',
    port: readInt('PORT', 3099, 1, 65535),
    corsOrigin: env.CORS_ORIGIN
      ? env.CORS_ORIGIN.split(',').map((o) => o.trim()).filter(Boolean)
      : false,
    rowLimit,
    pageSize,
    cacheTtlSeconds: readInt('CACHE_TTL_SECONDS', 0, 0, 3600),
    rateLimit: {
      windowMs: readInt('RATE_LIMIT_WINDOW_MS', 60000),
      max: readInt('RATE_LIMIT_MAX', 120),
    },
    db: {
      driver: env.DB_DRIVER || 'IBM i Access ODBC Driver',
      host: env.DB_HOST,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      library: env.DB_LIBRARY,
      connectionMode,
      poolInitial,
      poolMax,
      queueMax: readInt('DB_QUEUE_MAX', 50, 0, 1000),
      loginTimeout: readInt('DB_LOGIN_TIMEOUT', 10),
      queryTimeout: readInt('DB_QUERY_TIMEOUT', 15),
    },
  };

  if (errors.length > 0) {
    throw new Error(`Invalid configuration:\n - ${errors.join('\n - ')}`);
  }
  return deepFreeze(config);
}

module.exports = { loadConfig };
