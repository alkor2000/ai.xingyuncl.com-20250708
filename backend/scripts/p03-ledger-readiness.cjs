#!/usr/bin/env node
// Read-only readiness check for the P03 formal handoff ledger role. Connects with the restricted
// credentials the formal runtime would use (P03_HANDOFF_DB_USER / P03_HANDOFF_DB_PASSWORD, database from
// DB_NAME) and prints facts only: database, MySQL version, grant count, table presence and the fixed error
// code when a gate fails. It never prints credentials, grant text or connection addresses, writes nothing,
// and does not enable anything. Exit 0 = ready, 1 = a named gate failed, 2 = configuration missing.
//
//   cd backend && node scripts/p03-ledger-readiness.cjs            # reads backend/.env like the server does
//   P03_HANDOFF_DB_USER=... P03_HANDOFF_DB_PASSWORD=... node scripts/p03-ledger-readiness.cjs
require('dotenv').config();
const { probeLedger } = require('../src/services/artifactHandoff/formalRuntime');

async function main() {
  const env = process.env;
  const user = env.P03_HANDOFF_DB_USER, password = env.P03_HANDOFF_DB_PASSWORD, database = env.DB_NAME;
  if (!user || !password || !database) {
    console.log(JSON.stringify({ ready: false, code: 'handoff_ledger_role_missing', detail: 'P03_HANDOFF_DB_USER / P03_HANDOFF_DB_PASSWORD / DB_NAME required' }));
    process.exit(2);
  }
  if (user === env.DB_USER) {
    console.log(JSON.stringify({ ready: false, code: 'handoff_ledger_role_missing', detail: 'the application account is not the ledger role' }));
    process.exit(1);
  }
  const pool = require('mysql2/promise').createPool({ host: env.DB_HOST || 'localhost', port: Number(env.DB_PORT || 3306), user, password, database,
    connectionLimit: 2, connectTimeout: 5000 });
  try {
    const facts = await probeLedger(pool, database);
    console.log(JSON.stringify({ ready: true, ...facts }));
  } catch (error) {
    console.log(JSON.stringify({ ready: false, code: error.code || 'handoff_ledger_unavailable' }));
    process.exitCode = 1;
  } finally {
    await pool.end().catch(() => {});
  }
}
main();
