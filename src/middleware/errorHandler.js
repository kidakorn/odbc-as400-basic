'use strict';

const config = require('../config');
const { AppError } = require('../errors');

function notFound(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.path}`, 404));
}

// Express recognizes an error handler by its four parameters, so `next` must stay in the
// signature even though it is only used in one branch.
function errorHandler(err, req, res, next) {
  // If the response has already started, the default Express handler must close it.
  if (res.headersSent) return next(err);

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ success: false, error: err.message });
  }

  // Unexpected errors may carry driver internals (SQL text, host names),
  // so they are logged and never returned as-is outside development.
  console.error(err.odbcErrors || err);
  const message = config.env === 'development' ? err.message : 'Internal server error';
  return res.status(500).json({ success: false, error: message });
}

module.exports = { notFound, errorHandler };
