'use strict';

// fetchAll removes the ROW_LIMIT cap on purpose, to match the old project (clients expect
// every row from this table). On a large table this uses a lot of memory and time.
// If WGPGBL grows, switch this endpoint to paging by replacing fetchAll with orderBy
// (see mgpgst.js), which is a breaking change for clients.
module.exports = {
  path: '/api/web/services/WGPGBL',
  description: 'GET ALL DOWNLOAD GROUP PACKAGE BALANCE REPORT',
  sql: 'SELECT * FROM WGPGBL',
  fetchAll: true,
};
