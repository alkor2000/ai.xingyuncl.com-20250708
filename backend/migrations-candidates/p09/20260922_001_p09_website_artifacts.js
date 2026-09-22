'use strict';

// Candidate migration for the P09 website-artifact ledger. It lives OUTSIDE backend/migrations on
// purpose: knex only scans that directory and `make deploy-docker` runs `knex migrate:latest` before
// swapping containers, so moving this file is the same act as creating the tables on the next release.
// It is promoted only when the wire is frozen and a migration/release is authorized.
//
// `up` replays backend/src/services/websiteArtifact/store.js SCHEMA verbatim (one source of truth for
// the DDL bytes); `down` drops the tables in foreign-key order. Additive and re-runnable.
const { SCHEMA, TABLES } = require('../../src/services/websiteArtifact/store');

exports.up = async function up(knex) {
  for (const statement of SCHEMA) await knex.raw(statement);
};

exports.down = async function down(knex) {
  for (const table of [TABLES.files, TABLES.revisions, TABLES.sessions, TABLES.events, TABLES.idempotency,
    TABLES.links, TABLES.refs, TABLES.sequence]) {
    await knex.raw(`DROP TABLE IF EXISTS \`${table}\``);
  }
};

exports.tables = Object.values(TABLES);
