// Path containment and object correspondence for the frozen-asset resolver, against real MySQL.
//
// Every file here is created by this script inside its own temporary tree: nothing reads another
// person's data and nothing touches a host file. "Outside the upload root" means a sibling temp
// directory, not /etc.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const ROOT = path.resolve(__dirname, '../..');
const mysql = require(path.join(ROOT, 'backend/node_modules/mysql2/promise'));
const { createAssetResolver } = require(path.join(ROOT, 'backend/src/services/websiteArtifact/assets'));

const OWNER = 201;
const OTHER = 202;
const APP_HOST = 'practice-containment.localhost';
const read = () => new Promise(resolve => {
  let raw = '';
  process.stdin.on('data', chunk => { raw += chunk; }).on('end', () => resolve(JSON.parse(raw)));
});
const digest = buffer => crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16);

// A temp tree: an upload root, and a sibling directory that is deliberately NOT inside it.
function buildTree() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'p09-containment-'));
  const uploads = path.join(base, 'storage', 'uploads');
  const outside = path.join(base, 'outside');
  const deeper = path.join(base, 'outside-deeper', 'b');
  fs.mkdirSync(path.join(uploads, 'chat-images', '2026-09'), { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(deeper, { recursive: true });
  const bytes = name => Buffer.from(`p09-${name}-bytes`);
  fs.writeFileSync(path.join(uploads, 'chat-images/2026-09/mine.png'), bytes('mine'));
  fs.writeFileSync(path.join(uploads, 'chat-images/2026-09/axb.png'), bytes('axb'));
  fs.writeFileSync(path.join(uploads, 'chat-images/2026-09/theirs.png'), bytes('theirs'));
  fs.writeFileSync(path.join(outside, 'owned.png'), bytes('outside-owned'));
  fs.writeFileSync(path.join(outside, 'final.png'), bytes('outside-final'));
  fs.writeFileSync(path.join(deeper, 'c.png'), bytes('outside-deeper'));
  fs.symlinkSync(outside, path.join(uploads, 'nested'));                       // a PARENT directory link
  fs.symlinkSync(path.join(base, 'outside-deeper'), path.join(uploads, 'deep'));  // one more level down
  fs.symlinkSync(path.join(outside, 'final.png'), path.join(uploads, 'final.png')); // final component
  return { base, uploads, outside };
}

async function main() {
  const input = await read();
  const tree = buildTree();
  const db = await mysql.createConnection({ ...input.connection, multipleStatements: true });
  const rows = [
    // Everything the owner really owns, written the way each real model writes it.
    ['files', `${tree.uploads}/chat-images/2026-09/mine.png`, OWNER],
    ['files', `${tree.uploads}/chat-images/2026-09/axb.png`, OWNER],
    ['files', `${tree.uploads}/nested/owned.png`, OWNER],          // a row for a path behind the link
    ['files', `${tree.uploads}/deep/b/c.png`, OWNER],
    ['files', `${tree.uploads}/final.png`, OWNER],
    ['files', `${tree.uploads}/chat-images/2026-09/theirs.png`, OTHER]
  ];
  await db.query('SET FOREIGN_KEY_CHECKS=0');
  for (const [table, filePath, user] of rows) {
    await db.query(`INSERT INTO ${table}(id,user_id,original_name,stored_name,file_path,file_size,mime_type,status)
      VALUES(?,?,?,?,?,?,?,'ready')`,
    [crypto.randomUUID(), user, path.basename(filePath), path.basename(filePath), filePath, 16, 'image/png']);
  }
  // The AI image module keeps a full URL on this deployment.
  await db.query(`INSERT INTO image_generations(user_id,prompt,size,status,local_path,file_size,credits_consumed)
    VALUES(?,?,?,?,?,?,0)`, [OWNER, 'a pond', '1024x1024', 'success',
    `http://${APP_HOST}/uploads/chat-images/2026-09/mine.png`, 16]);

  const resolver = createAssetResolver({
    models: { query: async (sql, params) => (await db.query(sql, params))[0] },
    uploadRoot: tree.uploads, ownHosts: [APP_HOST]
  });
  const ask = async reference => {
    const info = resolver.classify(reference);
    if (info.kind !== 'upload') return { reference, classified: info.kind };
    const out = await resolver.resolve({ ownerUserId: OWNER, projectId: 3, reference: info });
    return { reference, ...(out.refused ? { refused: out.refused }
      : { returned_bytes: digest(out.content), owned_by: out.owned_by, byte_length: out.byte_length }) };
  };
  const cases = {
    own_regular_file: await ask('/uploads/chat-images/2026-09/mine.png'),
    own_absolute_url: await ask(`http://${APP_HOST}/uploads/chat-images/2026-09/mine.png`),
    another_students_file: await ask('/uploads/chat-images/2026-09/theirs.png'),
    final_component_symlink: await ask('/uploads/final.png'),
    parent_directory_symlink: await ask('/uploads/nested/owned.png'),
    multi_level_symlink: await ask('/uploads/deep/b/c.png'),
    like_wildcard_key: await ask('/uploads/chat-images/2026-09/a_b.png'),
    offsite_url: await ask('https://cdn.example.com/x.png')
  };
  // What "outside" actually means here, so the verdict can be read without guessing.
  const outsideBytes = {
    owned: digest(fs.readFileSync(path.join(tree.outside, 'owned.png'))),
    final: digest(fs.readFileSync(path.join(tree.outside, 'final.png'))),
    deeper: digest(fs.readFileSync(path.join(tree.base, 'outside-deeper/b/c.png'))),
    axb: digest(fs.readFileSync(path.join(tree.uploads, 'chat-images/2026-09/axb.png')))
  };
  await db.end();
  fs.rmSync(tree.base, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ cases, outside_bytes: outsideBytes }, null, 2));
}
main().catch(error => { process.stderr.write(String(error && error.stack).slice(0, 2000)); process.exitCode = 1; });
