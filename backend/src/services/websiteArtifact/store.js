'use strict';

// Default-off MySQL 8 ledger candidate for P09 (website artifact association, fixed review revisions,
// append-only source events, short-lived review sessions). Unmounted by default: no pool, no automatic
// DDL, not in backend/migrations. Two rules carry the design:
//   * event_seq is handed out by a counter row locked inside the writing transaction, so the sequence
//     equals commit order with no gaps and no late-visible holes — a reader that consumed seq N can
//     never miss an event that commits afterwards (C06 supplement §3, 服务端提交顺序水位).
//   * object refs are opaque and minted per (source_instance, kind, local_id), so the same numeric
//     project id on two practice instances can never collide and no internal id leaves the platform.
const { randomUUID, createHash } = require('node:crypto');
const { fail } = require('./errors');

const TABLES = Object.freeze({
  refs: 'p09_object_refs', links: 'p09_links', revisions: 'p09_revisions', files: 'p09_revision_files',
  events: 'p09_events', sequence: 'p09_event_sequence', sessions: 'p09_review_sessions', idempotency: 'p09_idempotency'
});
const ASCII = 'CHARACTER SET ascii COLLATE ascii_bin';
// Candidate DDL: additive, idempotent, reviewed as bytes. Kept out of backend/migrations until the wire
// is frozen and a release is authorized (knex only scans that directory and deploy runs it).
const SCHEMA = Object.freeze([
  `CREATE TABLE IF NOT EXISTS ${TABLES.refs}(kind VARCHAR(16) ${ASCII} NOT NULL, source_instance VARCHAR(64) ${ASCII} NOT NULL,
    local_id VARCHAR(64) ${ASCII} NOT NULL, ref CHAR(36) ${ASCII} NOT NULL, created_at BIGINT NOT NULL,
    PRIMARY KEY(kind,source_instance,local_id), UNIQUE KEY ref(ref)) ENGINE=InnoDB`,
  // Two generated keys carry the "one current work" rules. They are NULL for anything that is not
  // active, and MySQL lets NULLs repeat in a UNIQUE index — so history stays, while at any moment a
  // student has one work per assignment AND a project belongs to one assignment (candidate v2: the
  // first version keyed the project by assignment, which let one project answer two assignments).
  `CREATE TABLE IF NOT EXISTS ${TABLES.links}(id CHAR(36) ${ASCII} NOT NULL, source_instance VARCHAR(64) ${ASCII} NOT NULL,
    artifact_ref CHAR(36) ${ASCII} NOT NULL, project_ref CHAR(36) ${ASCII} NOT NULL, entry_ref CHAR(36) ${ASCII} NOT NULL,
    owner_user_id BIGINT NOT NULL, student_uuid VARCHAR(100) ${ASCII} NOT NULL, project_id BIGINT NOT NULL,
    entry_page_id BIGINT NOT NULL, assignment_ref VARCHAR(128) ${ASCII} NOT NULL, lesson_ref VARCHAR(128) ${ASCII} NULL,
    school_ref VARCHAR(64) ${ASCII} NOT NULL,
    issuer_key VARCHAR(64) ${ASCII} NOT NULL, grant_id CHAR(36) ${ASCII} NOT NULL, state VARCHAR(16) ${ASCII} NOT NULL,
    work_state VARCHAR(16) ${ASCII} NOT NULL, has_effective_save TINYINT NOT NULL DEFAULT 0,
    preview_available TINYINT NOT NULL DEFAULT 0, saved_at BIGINT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL,
    revoked_at BIGINT NULL, revoked_reason VARCHAR(32) ${ASCII} NULL,
    content_digest CHAR(64) ${ASCII} NULL, change_no INT NOT NULL DEFAULT 0,
    save_evidence VARCHAR(16) ${ASCII} NOT NULL DEFAULT 'none', save_reason VARCHAR(32) ${ASCII} NULL,
    real_save_count INT NOT NULL DEFAULT 0, page_count INT NOT NULL DEFAULT 0,
    write_seq BIGINT NOT NULL DEFAULT 0, applied_write_seq BIGINT NOT NULL DEFAULT 0,
    last_real_save_at BIGINT NULL, sync_pending_at BIGINT NULL, sync_attempts INT NOT NULL DEFAULT 0,
    reconciled_at BIGINT NULL, reconcile_error VARCHAR(32) ${ASCII} NULL,
    active_work_key VARCHAR(224) ${ASCII} AS (IF(state='active', CONCAT(source_instance,'|',assignment_ref,'|',owner_user_id), NULL)) STORED,
    active_project_key VARCHAR(160) ${ASCII} AS (IF(state='active', CONCAT(source_instance,'|',project_id), NULL)) STORED,
    PRIMARY KEY(id), UNIQUE KEY artifact(artifact_ref), UNIQUE KEY one_active_work(active_work_key),
    UNIQUE KEY one_active_project(active_project_key), KEY owner(owner_user_id,state),
    KEY project(source_instance,project_id,state), KEY scope(source_instance,school_ref,created_at),
    KEY pending(sync_pending_at)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.revisions}(id CHAR(36) ${ASCII} NOT NULL, link_id CHAR(36) ${ASCII} NOT NULL,
    revision_no INT NOT NULL, content_sha256 CHAR(64) ${ASCII} NOT NULL, byte_length BIGINT NOT NULL,
    manifest JSON NOT NULL, request_key CHAR(64) ${ASCII} NOT NULL, created_at BIGINT NOT NULL,
    PRIMARY KEY(id), UNIQUE KEY seq(link_id,revision_no), UNIQUE KEY request(link_id,request_key),
    CONSTRAINT fk_p09_revisions_link FOREIGN KEY(link_id) REFERENCES ${TABLES.links}(id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.files}(revision_id CHAR(36) ${ASCII} NOT NULL, path VARCHAR(255) NOT NULL,
    media_type VARCHAR(64) ${ASCII} NOT NULL, byte_length INT NOT NULL, sha256 CHAR(64) ${ASCII} NOT NULL,
    content LONGBLOB NOT NULL, PRIMARY KEY(revision_id,path),
    CONSTRAINT fk_p09_files_revision FOREIGN KEY(revision_id) REFERENCES ${TABLES.revisions}(id) ON DELETE CASCADE) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.sequence}(name VARCHAR(32) ${ASCII} NOT NULL, value BIGINT NOT NULL,
    PRIMARY KEY(name)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.events}(event_seq BIGINT NOT NULL, fact_id VARCHAR(80) ${ASCII} NOT NULL,
    type VARCHAR(32) ${ASCII} NOT NULL, link_id CHAR(36) ${ASCII} NOT NULL, source_instance VARCHAR(64) ${ASCII} NOT NULL,
    student_uuid VARCHAR(100) ${ASCII} NOT NULL, school_ref VARCHAR(64) ${ASCII} NOT NULL, occurred_at BIGINT NOT NULL,
    recorded_at BIGINT NOT NULL, payload JSON NOT NULL,
    PRIMARY KEY(event_seq), UNIQUE KEY fact(fact_id), KEY scope(source_instance,school_ref,event_seq),
    CONSTRAINT fk_p09_events_link FOREIGN KEY(link_id) REFERENCES ${TABLES.links}(id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.sessions}(id CHAR(36) ${ASCII} NOT NULL, link_id CHAR(36) ${ASCII} NOT NULL,
    revision_id CHAR(36) ${ASCII} NULL, audience VARCHAR(80) ${ASCII} NOT NULL, audience_kind VARCHAR(16) ${ASCII} NOT NULL,
    grant_id CHAR(36) ${ASCII} NOT NULL, issuer_key VARCHAR(64) ${ASCII} NOT NULL,
    handoff_sha256 CHAR(64) ${ASCII} NULL, secret_sha256 CHAR(64) ${ASCII} NULL,
    client_sha256 CHAR(64) ${ASCII} NULL, issued_at BIGINT NOT NULL, handoff_expires_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL, consumed_at BIGINT NULL, consumed_client_sha256 CHAR(64) ${ASCII} NULL,
    revoked_at BIGINT NULL, revoked_reason VARCHAR(32) ${ASCII} NULL, last_access_at BIGINT NULL, access_count INT NOT NULL DEFAULT 0,
    PRIMARY KEY(id), UNIQUE KEY handoff(handoff_sha256), KEY prune(expires_at), KEY by_link(link_id,revoked_at),
    CONSTRAINT fk_p09_sessions_link FOREIGN KEY(link_id) REFERENCES ${TABLES.links}(id)) ENGINE=InnoDB`,
  `CREATE TABLE IF NOT EXISTS ${TABLES.idempotency}(scope VARCHAR(32) ${ASCII} NOT NULL, key_sha256 CHAR(64) ${ASCII} NOT NULL,
    request_sha256 CHAR(64) ${ASCII} NOT NULL, response JSON NOT NULL, created_at BIGINT NOT NULL,
    PRIMARY KEY(scope,key_sha256), KEY prune(created_at)) ENGINE=InnoDB`
]);
const identifier = (value, max) => typeof value === 'string' && value.length >= 1 && value.length <= max && /^[A-Za-z0-9_]+$/.test(value);
// Restricted application-role candidate: DML on the P09 ledger and SELECT on the named read-only source
// tables (projects/pages/users), nothing else. CREATE USER and the password stay with the operator.
function restrictedRoleGrants({ database, user, host = '127.0.0.1', sourceTables = [] }) {
  if (!identifier(database, 64) || !identifier(user, 32) || typeof host !== 'string' || !/^[A-Za-z0-9_.%-]{1,60}$/.test(host) ||
      !Array.isArray(sourceTables) || sourceTables.some(t => !identifier(t, 64) || Object.values(TABLES).includes(t))) fail('invalid_request');
  const account = `'${user}'@'${host}'`;
  return [...Object.values(TABLES).map(t => `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${database}\`.\`${t}\` TO ${account}`),
    ...sourceTables.map(t => `GRANT SELECT ON \`${database}\`.\`${t}\` TO ${account}`)];
}
const sha256 = value => createHash('sha256').update(value).digest('hex');
const decode = value => (typeof value === 'string' ? JSON.parse(value) : value);

class WebsiteArtifactStore {
  constructor({ pool, now = Date.now }) {
    if (!pool || typeof pool.getConnection !== 'function' || typeof now !== 'function') fail('invalid_request');
    Object.assign(this, { pool, now });
  }
  async install() { for (const statement of SCHEMA) await this.pool.query(statement); }
  // Every write path runs here: one connection, one transaction, rollback on any throw.
  async transaction(fn) {
    let connection;
    try { connection = await this.pool.getConnection(); } catch { fail('storage_unavailable', 503, true); }
    try {
      await connection.beginTransaction();
      const result = await fn(new Tx(connection, this.now));
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally { connection.release(); }
  }
  async read(fn) {
    let connection;
    try { connection = await this.pool.getConnection(); } catch { fail('storage_unavailable', 503, true); }
    try { return await fn(new Tx(connection, this.now)); } finally { connection.release(); }
  }
}

class Tx {
  constructor(connection, now) { Object.assign(this, { connection, now }); }
  async query(sql, params = []) {
    try { const [rows] = await this.connection.execute(sql, params); return rows; }
    catch (error) {
      if (error && (error.code === 'ER_DUP_ENTRY' || error.errno === 1062)) { const e = new Error('duplicate'); e.duplicate = true; e.raw = error; throw e; }
      fail('storage_unavailable', 503, true); // never surface the driver message
    }
  }
  async one(sql, params) { const rows = await this.query(sql, params); return rows[0] || null; }

  // Opaque, instance-scoped object reference. Minted once and reused, so a ref is stable across
  // renames and re-associations, and two instances never hand out the same ref for the same local id.
  async ref(kind, sourceInstance, localId) {
    const key = [kind, sourceInstance, String(localId)];
    const existing = await this.one(`SELECT ref FROM ${TABLES.refs} WHERE kind=? AND source_instance=? AND local_id=?`, key);
    if (existing) return existing.ref;
    const ref = randomUUID();
    try {
      await this.query(`INSERT INTO ${TABLES.refs}(kind,source_instance,local_id,ref,created_at) VALUES(?,?,?,?,?)`, [...key, ref, this.now()]);
      return ref;
    } catch (error) {
      if (!error.duplicate) throw error;
      const row = await this.one(`SELECT ref FROM ${TABLES.refs} WHERE kind=? AND source_instance=? AND local_id=?`, key);
      return row.ref;
    }
  }
  // Commit-ordered sequence: the counter row is locked for the rest of the transaction, so a reader
  // that has seen seq N is guaranteed to have seen every event that committed before it.
  async nextSeq() {
    await this.query(`INSERT INTO ${TABLES.sequence}(name,value) VALUES('events',0) ON DUPLICATE KEY UPDATE name=name`);
    const row = await this.one(`SELECT value FROM ${TABLES.sequence} WHERE name='events' FOR UPDATE`);
    const next = Number(row.value) + 1;
    await this.query(`UPDATE ${TABLES.sequence} SET value=? WHERE name='events'`, [next]);
    return next;
  }
  async appendEvent(event) {
    const seq = await this.nextSeq();
    const row = { ...event, event_seq: seq, recorded_at: this.now() };
    try {
      await this.query(`INSERT INTO ${TABLES.events}(event_seq,fact_id,type,link_id,source_instance,student_uuid,school_ref,occurred_at,recorded_at,payload)
        VALUES(?,?,?,?,?,?,?,?,?,?)`, [seq, row.fact_id, row.type, row.link_id, row.source_instance, row.student_uuid,
        row.school_ref, row.occurred_at, row.recorded_at, JSON.stringify(row.payload)]);
    } catch (error) {
      // A fact is immutable: the same observed change re-recorded keeps the original event and seq.
      if (!error.duplicate) throw error;
      return this.one(`SELECT * FROM ${TABLES.events} WHERE fact_id=?`, [row.fact_id]);
    }
    return row;
  }
  async events(scope, afterSeq, limit) {
    return this.query(`SELECT event_seq,fact_id,type,link_id,source_instance,student_uuid,school_ref,occurred_at,recorded_at,payload
      FROM ${TABLES.events} WHERE source_instance=? AND school_ref=? AND event_seq>? ORDER BY event_seq ASC LIMIT ${Number(limit)}`,
    [scope.sourceInstance, scope.schoolRef, afterSeq]);
  }
  async watermark() {
    const row = await this.one(`SELECT value FROM ${TABLES.sequence} WHERE name='events'`);
    return row ? Number(row.value) : 0;
  }
  async linkById(id, { forUpdate = false } = {}) {
    return this.one(`SELECT * FROM ${TABLES.links} WHERE id=?${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  }
  async linkByArtifact(sourceInstance, artifactRef) {
    return this.one(`SELECT * FROM ${TABLES.links} WHERE source_instance=? AND artifact_ref=?`, [sourceInstance, artifactRef]);
  }
  // The current row for this student on this assignment: an active one if there is one, otherwise the
  // most recent history row (a student may re-link after revoking, and both rows stay).
  async activeLinkForAssignment(sourceInstance, assignmentRef, ownerUserId) {
    return this.one(`SELECT * FROM ${TABLES.links} WHERE source_instance=? AND assignment_ref=? AND owner_user_id=?
      ORDER BY state='active' DESC, created_at DESC LIMIT 1 FOR UPDATE`, [sourceInstance, assignmentRef, ownerUserId]);
  }
  async linksForProject(sourceInstance, projectId) {
    return this.query(`SELECT * FROM ${TABLES.links} WHERE source_instance=? AND project_id=? AND state='active'`, [sourceInstance, projectId]);
  }
  // Durable "this work changed" marker. It is written by the editor's own request path before any
  // reconciliation is attempted, so a crash between the source write and the projection leaves the row
  // pending instead of silently stale.
  async markPending(sourceInstance, projectId, at) {
    const rows = await this.query(`UPDATE ${TABLES.links} SET write_seq=write_seq+1,
      sync_pending_at=COALESCE(sync_pending_at,?), updated_at=?
      WHERE source_instance=? AND project_id=? AND state='active'`, [at, at, sourceInstance, projectId]);
    return rows?.affectedRows ?? 0;
  }
  // One observed source write. `write_seq` is the durable order of those writes for this work: a
  // reconciliation samples it before it reads the source and may only apply its result while it is
  // still the same number, so a slow reader can never write an older projection over a newer one.
  async markLinkPending(id, at) {
    await this.query(`UPDATE ${TABLES.links} SET write_seq=write_seq+1, sync_pending_at=COALESCE(sync_pending_at,?),
      updated_at=? WHERE id=? AND state='active'`, [at, at, id]);
  }
  // Oldest pending work first; a scope restricts a read-time sweep to what the caller is asking about.
  async pendingLinks({ sourceInstance = null, schoolRef = null, limit = 50 } = {}) {
    const params = [];
    let sql = `SELECT * FROM ${TABLES.links}
      WHERE state='active' AND (sync_pending_at IS NOT NULL OR applied_write_seq<write_seq)`;
    if (sourceInstance) { sql += ' AND source_instance=?'; params.push(sourceInstance); }
    if (schoolRef) { sql += ' AND school_ref=?'; params.push(schoolRef); }
    sql += ` ORDER BY sync_pending_at ASC LIMIT ${Number(limit)}`;
    return this.query(sql, params);
  }
  async clearPending(id, at, { error = null, attempts = null } = {}) {
    if (error) {
      await this.query(`UPDATE ${TABLES.links} SET sync_attempts=sync_attempts+1, reconcile_error=?, reconciled_at=? WHERE id=?`,
        [String(error).slice(0, 32), at, id]);
      return;
    }
    await this.query(`UPDATE ${TABLES.links} SET sync_pending_at=NULL, sync_attempts=?, reconcile_error=NULL, reconciled_at=? WHERE id=?`,
      [attempts ?? 0, at, id]);
  }
  // The durable fact behind 制作事实: the editor's authenticated save path wrote content for this work.
  // Written in the same request that saved, so it survives a crash of the reconciliation that follows.
  async recordRealSave(id, at) {
    await this.query(`UPDATE ${TABLES.links} SET real_save_count=real_save_count+1, last_real_save_at=?,
      save_evidence='observed', save_reason='observed_save', sync_pending_at=COALESCE(sync_pending_at,?), updated_at=?
      WHERE id=? AND state='active'`, [at, at, at, id]);
  }
  // Self-healing pass: active works whose projection has not been verified recently. It is what closes
  // the window where a pending marker itself was lost (crash between the source write and the marker).
  async staleLinks({ sourceInstance = null, schoolRef = null, olderThan, limit = 20 } = {}) {
    const params = [olderThan];
    let sql = `SELECT * FROM ${TABLES.links} WHERE state='active' AND sync_pending_at IS NULL
      AND applied_write_seq>=write_seq AND (reconciled_at IS NULL OR reconciled_at<?)`;
    if (sourceInstance) { sql += ' AND source_instance=?'; params.push(sourceInstance); }
    if (schoolRef) { sql += ' AND school_ref=?'; params.push(schoolRef); }
    sql += ` ORDER BY reconciled_at IS NOT NULL, reconciled_at ASC LIMIT ${Number(limit)}`;
    return this.query(sql, params);
  }
  async pendingCount({ sourceInstance, schoolRef = null }) {
    // No school named means "the whole instance": a NULL comparison would silently count nothing.
    // Outstanding means either a marker is still set OR the projection has not caught up with the
    // observed writes — a cleared marker alone never makes a stale projection look finished.
    const row = await this.one(`SELECT COUNT(*) AS n FROM ${TABLES.links}
      WHERE state='active' AND (sync_pending_at IS NOT NULL OR applied_write_seq<write_seq)
      AND source_instance=?${schoolRef ? ' AND school_ref=?' : ''}`,
    schoolRef ? [sourceInstance, schoolRef] : [sourceInstance]);
    return Number(row?.n || 0);
  }
  // An active link for this project, whatever assignment it belongs to: the "one project, one current
  // assignment" rule is checked against this, not against the assignment the caller happens to name.
  async activeLinkForProject(sourceInstance, projectId) {
    return this.one(`SELECT * FROM ${TABLES.links} WHERE source_instance=? AND project_id=? AND state='active' FOR UPDATE`,
      [sourceInstance, projectId]);
  }
  async linksForOwner(ownerUserId) {
    return this.query(`SELECT * FROM ${TABLES.links} WHERE owner_user_id=? ORDER BY created_at DESC LIMIT 200`, [ownerUserId]);
  }
  // Scope is always (instance, school): edu filters further by its own assignment roster.
  async linksInScope(scope, { assignmentRefs = null, studentUuids = null } = {}) {
    const params = [scope.sourceInstance, scope.schoolRef];
    let sql = `SELECT * FROM ${TABLES.links} WHERE source_instance=? AND school_ref=?`;
    if (Array.isArray(assignmentRefs) && assignmentRefs.length) {
      sql += ` AND assignment_ref IN (${assignmentRefs.map(() => '?').join(',')})`;
      params.push(...assignmentRefs);
    }
    if (Array.isArray(studentUuids) && studentUuids.length) {
      sql += ` AND student_uuid IN (${studentUuids.map(() => '?').join(',')})`;
      params.push(...studentUuids);
    }
    sql += ' ORDER BY created_at ASC LIMIT 1000';
    return this.query(sql, params);
  }
  async insertLink(row) {
    const columns = ['id', 'source_instance', 'artifact_ref', 'project_ref', 'entry_ref', 'owner_user_id', 'student_uuid', 'project_id',
      'entry_page_id', 'assignment_ref', 'lesson_ref', 'school_ref', 'issuer_key', 'grant_id', 'state', 'work_state',
      'has_effective_save', 'preview_available', 'saved_at', 'created_at', 'updated_at', 'content_digest', 'change_no',
      'save_evidence', 'save_reason', 'real_save_count', 'page_count', 'write_seq', 'applied_write_seq',
      'last_real_save_at', 'reconciled_at'];
    await this.query(`INSERT INTO ${TABLES.links}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`,
      columns.map(c => row[c]));
    return row;
  }
  async updateLink(id, patch) {
    const keys = Object.keys(patch);
    if (!keys.length) return;
    await this.query(`UPDATE ${TABLES.links} SET ${keys.map(k => `${k}=?`).join(',')}, updated_at=? WHERE id=?`,
      [...keys.map(k => patch[k]), this.now(), id]);
  }
  async revisions(linkId) {
    return this.query(`SELECT id,link_id,revision_no,content_sha256,byte_length,manifest,created_at FROM ${TABLES.revisions}
      WHERE link_id=? ORDER BY revision_no ASC`, [linkId]);
  }
  async revisionById(id) {
    return this.one(`SELECT id,link_id,revision_no,content_sha256,byte_length,manifest,created_at FROM ${TABLES.revisions} WHERE id=?`, [id]);
  }
  async revisionByRequest(linkId, requestKey) {
    return this.one(`SELECT id,link_id,revision_no,content_sha256,byte_length,manifest,created_at FROM ${TABLES.revisions}
      WHERE link_id=? AND request_key=?`, [linkId, requestKey]);
  }
  async insertRevision(row, files) {
    await this.query(`INSERT INTO ${TABLES.revisions}(id,link_id,revision_no,content_sha256,byte_length,manifest,request_key,created_at)
      VALUES(?,?,?,?,?,?,?,?)`, [row.id, row.link_id, row.revision_no, row.content_sha256, row.byte_length,
      JSON.stringify(row.manifest), row.request_key, row.created_at]);
    for (const file of files) {
      await this.query(`INSERT INTO ${TABLES.files}(revision_id,path,media_type,byte_length,sha256,content) VALUES(?,?,?,?,?,?)`,
        [row.id, file.path, file.media_type, file.byte_length, file.sha256, file.content]);
    }
    return row;
  }
  async revisionFile(revisionId, path) {
    return this.one(`SELECT path,media_type,byte_length,sha256,content FROM ${TABLES.files} WHERE revision_id=? AND path=?`, [revisionId, path]);
  }
  async insertSession(row) {
    await this.query(`INSERT INTO ${TABLES.sessions}(id,link_id,revision_id,audience,audience_kind,grant_id,issuer_key,
      handoff_sha256,issued_at,handoff_expires_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    [row.id, row.link_id, row.revision_id, row.audience, row.audience_kind, row.grant_id, row.issuer_key,
      row.handoff_sha256, row.issued_at, row.handoff_expires_at, row.expires_at]);
    return row;
  }
  async touchSession(id, at) {
    await this.query(`UPDATE ${TABLES.sessions} SET last_access_at=?, access_count=access_count+1 WHERE id=?`, [at, id]);
  }
  async revokeSessionsForOwner(ownerUserId, at, reason) {
    await this.query(`UPDATE ${TABLES.sessions} s JOIN ${TABLES.links} l ON s.link_id=l.id
      SET s.revoked_at=?, s.revoked_reason=? WHERE l.owner_user_id=? AND s.revoked_at IS NULL`,
    [at, String(reason).slice(0, 32), ownerUserId]);
  }
  async revokeSessionsForIssuer(issuerKey, at, reason) {
    await this.query(`UPDATE ${TABLES.sessions} SET revoked_at=?, revoked_reason=? WHERE issuer_key=? AND revoked_at IS NULL`,
      [at, String(reason).slice(0, 32), issuerKey]);
  }
  async sessionByHandoff(hash, { forUpdate = false } = {}) {
    return this.one(`SELECT * FROM ${TABLES.sessions} WHERE handoff_sha256=?${forUpdate ? ' FOR UPDATE' : ''}`, [hash]);
  }
  async sessionById(id) { return this.one(`SELECT * FROM ${TABLES.sessions} WHERE id=?`, [id]); }
  // Consumption is a single conditional update: the first redeemer wins and the handoff stops existing,
  // so a stolen copy of the token cannot be redeemed a second time even under a race.
  async consumeSession(id, secretHash, clientHash) {
    const result = await this.query(`UPDATE ${TABLES.sessions} SET consumed_at=?, secret_sha256=?, client_sha256=?,
      consumed_client_sha256=?, handoff_sha256=NULL WHERE id=? AND consumed_at IS NULL AND handoff_sha256 IS NOT NULL`,
    [this.now(), secretHash, clientHash, clientHash, id]);
    return (result?.affectedRows ?? 0) === 1;
  }
  async revokeSessions(linkId, reason = 'link_revoked') {
    await this.query(`UPDATE ${TABLES.sessions} SET revoked_at=?, revoked_reason=? WHERE link_id=? AND revoked_at IS NULL`,
      [this.now(), String(reason).slice(0, 32), linkId]);
  }
  async idempotent(scope, keyHash) { return this.one(`SELECT * FROM ${TABLES.idempotency} WHERE scope=? AND key_sha256=?`, [scope, keyHash]); }
  async rememberIdempotent(scope, keyHash, requestHash, response) {
    await this.query(`INSERT INTO ${TABLES.idempotency}(scope,key_sha256,request_sha256,response,created_at) VALUES(?,?,?,?,?)`,
      [scope, keyHash, requestHash, JSON.stringify(response), this.now()]);
  }
  async prune(before) {
    await this.query(`DELETE FROM ${TABLES.sessions} WHERE expires_at<?`, [before]);
    await this.query(`DELETE FROM ${TABLES.idempotency} WHERE created_at<?`, [before]);
  }
}
module.exports = { WebsiteArtifactStore, Tx, TABLES, SCHEMA, restrictedRoleGrants, sha256, decode };
