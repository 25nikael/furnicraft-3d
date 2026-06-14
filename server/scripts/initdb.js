'use strict';

// Manually initialise the database schema, then exit.
// Useful as a one-off after provisioning a fresh Postgres instance:
//   npm run initdb

require('dotenv').config();
const db = require('../db');

(async function () {
  const ok = await db.init();
  if (ok) {
    console.log('Schema initialised successfully.');
    process.exit(0);
  } else {
    console.error('Schema initialisation failed — check DATABASE_URL.');
    process.exit(1);
  }
})();
