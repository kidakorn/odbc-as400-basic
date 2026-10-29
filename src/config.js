'use strict';

const path = require('path');
const { loadConfig } = require('./loadConfig');

// This is the only file that touches the real environment. The validation rules live in
// loadConfig.js so tests can exercise them without needing a complete .env.
// Variables already set in the real environment win over the .env file (dotenv default).
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Throws if the configuration is invalid. server.js catches this and prints the message,
// and every other module can rely on receiving a complete, frozen config.
module.exports = loadConfig(process.env);
