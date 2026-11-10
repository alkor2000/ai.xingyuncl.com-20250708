/* Run only after approval of the named production read. Does not load the app,
 * call asset/import routes, take write locks or change visibility/OSS ACLs.
 * stdout contains public prompts/media addresses: save to a private local file.
 */
async function exportSnapshot(connection, limit = 1000) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10000) throw Error('Invalid export limit');
  await connection.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
  try {
    const result = {schemaVersion:1,exportedAt:new Date().toISOString(),works:[]};
    for (const media of ['image','video']) {
      const table = `${media}_generations`;
      const [columns] = await connection.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?',[table]);
      const available = new Set(columns.map(c=>c.COLUMN_NAME));
      const names = ['id','status','is_public','prompt','negative_prompt','local_path',`${media}_url`,'oss_video_url','updated_at','created_at'].filter(k=>available.has(k));
      if (!['id','status','is_public','prompt'].every(k=>available.has(k))) throw Error('Unrecognized gallery schema');
      const [[count]] = await connection.query(`SELECT COUNT(*) total FROM ${table} WHERE is_public=1`);
      if (Number(count.total) + result.works.length > limit) throw Error('Export exceeds approved batch limit; no partial snapshot emitted');
      const [rows] = await connection.query(`SELECT ${names.join(',')} FROM ${table} WHERE is_public=1 ORDER BY id`);
      if (rows.length !== Number(count.total)) throw Error('Snapshot count mismatch');
      for (const row of rows) result.works.push({media,...row});
    }
    return result;
  } finally { await connection.rollback(); }
}
module.exports = {exportSnapshot};
if (require.main === module) {
  (async()=>{
    const connection = await require('mysql2/promise').createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
    try { process.stdout.write(JSON.stringify(await exportSnapshot(connection),null,2)); }
    finally { await connection.end(); }
  })().catch(()=>{ console.error('Readonly gallery export failed; no snapshot accepted.');process.exitCode=1; });
}
