'use strict';

// Operational errors carry a message that is safe to return to clients.
// Anything that is not an AppError is treated as unexpected and hidden by the error handler.
class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.isOperational = true;
  }
}

module.exports = { AppError };
