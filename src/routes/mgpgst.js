'use strict';

// Setting orderBy turns on paging: clients may send ?limit=...&offset=...
// ORDER BY is required for OFFSET to be stable between pages, so it is added by the
// framework from this field. Do not write ORDER BY inside sql.
// Use columns that are indexed (ideally unique); otherwise IBM i may sort the whole table
// for every page.
module.exports = {
  path: '/api/web/services/MGPGST',
  description: 'GET ALL GROUP PACKAGE STOCK MASTER',
  sql: 'SELECT * FROM MGPGST',
  // orderBy: 'CDPAKG',
  fetchAll: true,
};
