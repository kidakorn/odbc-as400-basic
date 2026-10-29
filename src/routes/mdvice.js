'use strict';

// Lookup of one row by key. Returns 200 with P_ISFOUND "0" when nothing matches.
// The table name has no library prefix: DB_LIBRARY from .env is the default library.
module.exports = {
  path: '/api/web/services/MDVICE',
  description: 'GET DEVICE NAME MASTER BY DEVICE CODE',
  sql: 'SELECT * FROM MDVICE WHERE CDDEVC = :cddevc',
  params: [
    { name: 'cddevc', required: true, maxLength: 10 },
  ],
};
