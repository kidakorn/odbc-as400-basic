'use strict';

const express = require('express');
const health = require('./health');
const { registerEndpoints } = require('./endpoint');

const router = express.Router();

router.get('/api/health', health);

// To add an endpoint: create a file next to these (copy mdvice.js) and add it to this list.
registerEndpoints(router, [
  require('./mdvice'),
  require('./wgpgbl'),
  require('./mgpgst'),
]);

module.exports = router;
