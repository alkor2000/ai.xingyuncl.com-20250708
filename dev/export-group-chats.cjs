#!/usr/bin/env node
'use strict';
/**
 * 按用户组（学校）导出学生与 AI 的完整对话记录。由 dev/export-group-chats.sh 驱动，一般不用直接运行。
 *
 * 两种模式：
 *   --mode remote   在服务器上（Docker 站在 backend 容器内、PM2 站在 backend/ 目录用 dotenv）运行，
 *                   用应用自己的 DB_* 连接只读查询，把结果按 JSON Lines 写到 stdout（进度写 stderr）。
 *                   参数经 --args-b64 传入（base64 的 JSON），避免中文组名经 ssh 多层转义出错。
 *   --mode convert  在本机运行，把 JSONL 转成 messages.csv / conversations.csv / 每人一份 Markdown / summary.json。
 *
 * 只 SELECT，不写任何表；不打印口令与连接地址。导出文件含学生真实对话，默认落在仓库之外，不得提交。
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { once } = require('events');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-') continue; // `node -` 的占位
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[key] = true;
      else { out[key] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

const argv = parseArgs(process.argv.slice(2));
const mode = argv.mode;
if (mode === 'remote') remote().catch(fail);
else if (mode === 'convert') convert().catch(fail);
else { console.error('用法: --mode remote --args-b64 <b64json> | --mode convert --in raw.jsonl --out DIR'); process.exit(2); }

function fail(err) {
  // 不把连接地址、口令带进错误输出
  const msg = (err && (err.code || err.message)) || String(err);
  console.error(`[export] 失败: ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- remote ----
async function remote() {
  const opts = JSON.parse(Buffer.from(String(argv['args-b64'] || ''), 'base64').toString('utf8') || '{}');
  const mysql = require('mysql2'); // 服务器上的 backend 依赖里已有
  const e = process.env;
  const conn = mysql.createConnection({
    host: e.DB_HOST || 'localhost', port: +(e.DB_PORT || 3306),
    user: e.DB_USER, password: e.DB_PASSWORD, database: e.DB_NAME,
    charset: 'utf8mb4', dateStrings: true, // 时间按字符串返回，避免时区被 JS Date 二次换算
  });
  await new Promise((res, rej) => conn.connect(err => (err ? rej(err) : res())));
  const q = (sql, params) => new Promise((res, rej) => conn.query(sql, params, (err, rows) => (err ? rej(err) : res(rows))));
  await q("SET SESSION time_zone = '+08:00'"); // 所有时间统一按北京时间输出
  await q('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
  await q('START TRANSACTION READ ONLY'); // 整个导出在一个只读一致性快照里

  try {
    if (opts.listGroups) { await listGroups(q, opts); return; }

    // 1. 找组：默认模糊匹配（学校导入遇同名会生成 _2/_3 后缀的组，一起带出来），--exact 则精确匹配
    const groups = await q(
      opts.exact
        ? 'SELECT id, name, is_active, expire_date, created_at FROM user_groups WHERE name = ? ORDER BY id'
        : "SELECT id, name, is_active, expire_date, created_at FROM user_groups WHERE name LIKE CONCAT('%', ?, '%') ORDER BY id",
      [opts.group]
    );
    if (!groups.length) {
      console.error(`[export] 没有名字包含「${opts.group}」的用户组。用 --list-groups 查看所有组名。`);
      process.exit(3);
    }
    const groupIds = groups.map(g => g.id);
    console.error(`[export] 匹配到 ${groups.length} 个组: ${groups.map(g => `#${g.id} ${g.name}`).join(' | ')}`);

    // 2. 用户范围：默认只导 role=user（学生）；组管理员(role=admin，一般是老师)用 --roles all 才包含；软删除用户默认不含
    const roleCond = opts.roles === 'all' ? '' : "AND u.role = 'user'";
    const delCond = opts.includeDeleted ? '' : 'AND u.deleted_at IS NULL';
    const userWhere = `u.group_id IN (?) ${roleCond} ${delCond}`;

    const [{ n_users }] = await q(`SELECT COUNT(*) AS n_users FROM users u WHERE ${userWhere}`, [groupIds]);
    const [{ n_skipped_admin }] = await q(
      `SELECT COUNT(*) AS n_skipped_admin FROM users u WHERE u.group_id IN (?) AND u.role <> 'user' ${delCond}`, [groupIds]);
    const [{ n_conv, n_msg }] = await q(
      `SELECT COUNT(DISTINCT c.id) AS n_conv, COUNT(m.id) AS n_msg
         FROM users u JOIN conversations c ON c.user_id = u.id LEFT JOIN messages m ON m.conversation_id = c.id
        WHERE ${userWhere}`, [groupIds]);
    console.error(`[export] 用户 ${n_users} 人（另有 ${n_skipped_admin} 个非 user 角色账号${opts.roles === 'all' ? '已包含' : '未包含'}），会话 ${n_conv} 个（含无消息的空会话），消息 ${n_msg} 条`);

    // 3. 用户标签（学校导入生成的年级/班级等），按用户聚合成一列
    const tagRows = await q(
      `SELECT r.user_id, GROUP_CONCAT(t.name ORDER BY t.sort_order, t.id SEPARATOR ';') AS tags
         FROM user_tag_relations r JOIN user_tags t ON t.id = r.tag_id JOIN users u ON u.id = r.user_id
        WHERE ${userWhere} GROUP BY r.user_id`, [groupIds]);
    const tagsByUser = new Map(tagRows.map(r => [r.user_id, r.tags]));

    // 4. 可选列：messages.file_ids 不在 knex 基线 DDL 里，线上库可能有也可能没有，按 information_schema 决定
    const optCols = await q(
      "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'messages' AND column_name IN ('file_ids','generated_images')");
    const has = new Set(optCols.map(r => r.c));
    const fileIdsCol = has.has('file_ids') ? 'm.file_ids' : 'NULL';
    const genImgCol = has.has('generated_images') ? 'm.generated_images' : 'NULL';

    const meta = {
      type: 'meta', exported_at: new Date().toISOString(), site: opts.site || null, group_pattern: opts.group, exact: !!opts.exact,
      roles: opts.roles === 'all' ? 'all' : 'user', include_deleted: !!opts.includeDeleted,
      groups, counts: { users: n_users, skipped_non_user_accounts: n_skipped_admin, conversations: n_conv, messages: n_msg },
      timezone: '+08:00',
    };
    await writeLine(JSON.stringify(meta));

    // 5. 用户清单（含没有任何会话的学生，方便核对名单）
    const users = await q(
      `SELECT u.id, u.username, u.email, u.role, u.status, u.group_id, u.created_at, u.last_login_at, u.deleted_at
         FROM users u WHERE ${userWhere} ORDER BY u.id`, [groupIds]);
    for (const u of users) await writeLine(JSON.stringify({ type: 'user', ...u, tags: tagsByUser.get(u.id) || '' }));

    // 6. 消息主体：流式逐行输出，不把整个学校的消息攒在内存里
    const sql = `
      SELECT u.id AS user_id, u.username, u.email, u.role AS user_role, u.status AS user_status, u.deleted_at AS user_deleted_at,
             g.id AS group_id, g.name AS group_name,
             c.id AS conversation_id, c.title AS conversation_title, c.model_name AS conversation_model,
             c.smart_app_id, sa.name AS smart_app_name, c.system_prompt_id, c.module_combination_id,
             c.created_at AS conversation_created_at, c.cleared_at,
             m.id AS message_id, m.sequence_number, m.role, m.content, m.tokens, m.model_name, m.status,
             m.file_id, f.original_name AS attachment_name, f.mime_type AS attachment_mime, ${fileIdsCol} AS file_ids,
             ${genImgCol} AS generated_images, m.created_at
        FROM users u
        JOIN user_groups g ON g.id = u.group_id
        JOIN conversations c ON c.user_id = u.id
        JOIN messages m ON m.conversation_id = c.id
        LEFT JOIN smart_apps sa ON sa.id = c.smart_app_id
        LEFT JOIN files f ON f.id = m.file_id
       WHERE ${userWhere}
       ORDER BY u.id, c.created_at, c.id, m.sequence_number, m.created_at`;
    const stream = conn.query(sql, [groupIds]).stream({ highWaterMark: 200 });
    let n = 0;
    for await (const row of stream) {
      row.type = 'message';
      row.tags = tagsByUser.get(row.user_id) || '';
      // “清空对话”只是把 cleared_at 之前的消息在界面上藏起来，数据还在；标出来供筛选
      row.hidden_by_clear = row.cleared_at && row.created_at <= row.cleared_at ? 1 : 0;
      for (const k of ['file_ids', 'generated_images']) if (row[k] != null && typeof row[k] === 'object') row[k] = JSON.stringify(row[k]);
      await writeLine(JSON.stringify(row));
      if (++n % 2000 === 0) console.error(`[export] 已输出 ${n}/${n_msg} 条`);
    }
    await writeLine(JSON.stringify({ type: 'end', messages: n }));
    console.error(`[export] 完成，共输出 ${n} 条消息`);
  } finally {
    await q('ROLLBACK').catch(() => {});
    conn.end();
  }
}

async function listGroups(q, opts) {
  const rows = await q(`
    SELECT g.id, g.name, g.is_active, g.expire_date,
           (SELECT COUNT(*) FROM users u WHERE u.group_id = g.id AND u.deleted_at IS NULL) AS users,
           (SELECT COUNT(*) FROM users u JOIN conversations c ON c.user_id = u.id WHERE u.group_id = g.id) AS conversations,
           (SELECT COUNT(*) FROM users u JOIN conversations c ON c.user_id = u.id JOIN messages m ON m.conversation_id = c.id WHERE u.group_id = g.id) AS messages
      FROM user_groups g ${opts.group ? "WHERE g.name LIKE CONCAT('%', ?, '%')" : ''} ORDER BY g.id`, opts.group ? [opts.group] : []);
  await writeLine(JSON.stringify({ type: 'groups', groups: rows }));
  const pad = (s, n) => String(s).padEnd(n);
  console.error(`${pad('ID', 5)} ${pad('用户', 6)} ${pad('会话', 6)} ${pad('消息', 8)} 组名`);
  for (const r of rows) console.error(`${pad(r.id, 5)} ${pad(r.users, 6)} ${pad(r.conversations, 6)} ${pad(r.messages, 8)} ${r.name}${r.is_active ? '' : ' (停用)'}`);
}

async function writeLine(s) {
  if (!process.stdout.write(s + '\n')) await once(process.stdout, 'drain');
}

// --------------------------------------------------------------- convert ----
async function convert() {
  const inFile = argv.in, outDir = argv.out;
  if (!inFile || !outDir) { console.error('convert 需要 --in raw.jsonl --out DIR'); process.exit(2); }
  fs.mkdirSync(path.join(outDir, 'markdown'), { recursive: true });

  const msgCols = ['group_id', 'group_name', 'user_id', 'username', 'email', 'user_role', 'user_status', 'tags',
    'conversation_id', 'conversation_title', 'conversation_model', 'smart_app_id', 'smart_app_name', 'system_prompt_id',
    'module_combination_id', 'conversation_created_at', 'cleared_at', 'hidden_by_clear',
    'message_id', 'sequence_number', 'role', 'content', 'tokens', 'model_name', 'status',
    'attachment_name', 'attachment_mime', 'file_ids', 'generated_images', 'created_at'];
  const convCols = ['group_name', 'user_id', 'username', 'tags', 'conversation_id', 'conversation_title', 'conversation_model',
    'smart_app_name', 'conversation_created_at', 'cleared_at', 'first_message_at', 'last_message_at',
    'messages', 'user_messages', 'assistant_messages', 'total_tokens'];

  const msgCsv = fs.createWriteStream(path.join(outDir, 'messages.csv'));
  msgCsv.write('\uFEFF' + msgCols.join(',') + '\n'); // BOM 让 Excel 直接识别 UTF-8
  const usersOut = [];
  const convs = new Map(); // conversation_id -> 汇总行
  const perUser = new Map(); // user_id -> {username, conversations:Set, messages, first, last}
  let meta = null, total = 0, longCells = 0;

  // Markdown：按用户顺序流式写，用户变化时换文件
  let mdUser = null, mdStream = null, mdConv = null;
  const closeMd = async () => { if (mdStream) { mdStream.end(); await once(mdStream, 'finish'); mdStream = null; mdUser = null; mdConv = null; } };

  const rl = readline.createInterface({ input: fs.createReadStream(inFile), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.type === 'meta') { meta = r; continue; }
    if (r.type === 'user') { usersOut.push(r); continue; }
    if (r.type === 'end' || r.type === 'groups') continue;
    if (r.type !== 'message') continue;
    total++;
    if (r.content && r.content.length > 32767) longCells++;

    if (!msgCsv.write(msgCols.map(c => csvCell(r[c])).join(',') + '\n')) await once(msgCsv, 'drain');

    let cv = convs.get(r.conversation_id);
    if (!cv) {
      cv = { group_name: r.group_name, user_id: r.user_id, username: r.username, tags: r.tags, conversation_id: r.conversation_id,
        conversation_title: r.conversation_title, conversation_model: r.conversation_model, smart_app_name: r.smart_app_name,
        conversation_created_at: r.conversation_created_at, cleared_at: r.cleared_at, first_message_at: r.created_at, last_message_at: r.created_at,
        messages: 0, user_messages: 0, assistant_messages: 0, total_tokens: 0 };
      convs.set(r.conversation_id, cv);
    }
    cv.messages++; cv.total_tokens += Number(r.tokens) || 0;
    if (r.role === 'user') cv.user_messages++; else if (r.role === 'assistant') cv.assistant_messages++;
    if (r.created_at < cv.first_message_at) cv.first_message_at = r.created_at;
    if (r.created_at > cv.last_message_at) cv.last_message_at = r.created_at;

    let pu = perUser.get(r.user_id);
    if (!pu) { pu = { username: r.username, tags: r.tags, conversations: new Set(), messages: 0, first: r.created_at, last: r.created_at }; perUser.set(r.user_id, pu); }
    pu.conversations.add(r.conversation_id); pu.messages++;
    if (r.created_at < pu.first) pu.first = r.created_at;
    if (r.created_at > pu.last) pu.last = r.created_at;

    if (mdUser !== r.user_id) {
      await closeMd();
      mdUser = r.user_id;
      mdStream = fs.createWriteStream(path.join(outDir, 'markdown', `${safeName(r.username)}_${r.user_id}.md`));
      mdStream.write(`# ${r.username}（用户ID ${r.user_id}）\n\n- 组：${r.group_name}\n- 标签：${r.tags || '-'}\n- 角色：${r.user_role}\n\n`);
    }
    if (mdConv !== r.conversation_id) {
      mdConv = r.conversation_id;
      const app = r.smart_app_name ? `，智能应用：${r.smart_app_name}` : '';
      const cleared = r.cleared_at ? `，用户曾于 ${r.cleared_at} 清空过此会话` : '';
      mdStream.write(`\n## ${r.conversation_title || '未命名会话'}\n\n- 会话ID：${r.conversation_id}\n- 模型：${r.conversation_model}${app}\n- 创建：${r.conversation_created_at}${cleared}\n\n`);
    }
    const who = r.role === 'user' ? '学生' : r.role === 'assistant' ? `AI${r.model_name ? `（${r.model_name}）` : ''}` : '系统';
    const flags = [r.status && r.status !== 'completed' ? `状态:${r.status}` : '', r.hidden_by_clear ? '已被清空' : '', r.attachment_name ? `附件:${r.attachment_name}` : ''].filter(Boolean);
    const w = `### ${who} · ${r.created_at}${flags.length ? `（${flags.join('，')}）` : ''}\n\n${(r.content || '').replace(/^(#{1,6} )/gm, '\\$1')}\n\n`;
    if (!mdStream.write(w)) await once(mdStream, 'drain');
  }
  await closeMd();
  msgCsv.end(); await once(msgCsv, 'finish');

  // conversations.csv
  const convRows = [...convs.values()];
  fs.writeFileSync(path.join(outDir, 'conversations.csv'),
    '\uFEFF' + convCols.join(',') + '\n' + convRows.map(cv => convCols.map(c => csvCell(cv[c])).join(',')).join('\n') + '\n');

  // users.csv（含没有会话的学生）
  const userCols = ['id', 'username', 'email', 'role', 'status', 'group_id', 'tags', 'created_at', 'last_login_at', 'deleted_at', 'conversations', 'messages', 'first_message_at', 'last_message_at'];
  fs.writeFileSync(path.join(outDir, 'users.csv'),
    '\uFEFF' + userCols.join(',') + '\n' + usersOut.map(u => {
      const pu = perUser.get(u.id);
      const row = { ...u, conversations: pu ? pu.conversations.size : 0, messages: pu ? pu.messages : 0, first_message_at: pu ? pu.first : '', last_message_at: pu ? pu.last : '' };
      return userCols.map(c => csvCell(row[c])).join(',');
    }).join('\n') + '\n');

  const activeUsers = perUser.size;
  const summary = {
    meta, users_in_scope: usersOut.length, users_with_messages: activeUsers, conversations: convs.size, messages: total,
    date_range: total ? { from: convRows.reduce((a, c) => (c.first_message_at < a ? c.first_message_at : a), convRows[0].first_message_at), to: convRows.reduce((a, c) => (c.last_message_at > a ? c.last_message_at : a), convRows[0].last_message_at) } : null,
    cells_over_excel_limit: longCells,
    files: ['messages.csv', 'conversations.csv', 'users.csv', 'markdown/<用户名>_<用户ID>.md', 'raw.jsonl', 'summary.json'],
  };
  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`用户 ${summary.users_in_scope} 人（有对话 ${activeUsers} 人），会话 ${summary.conversations} 个，消息 ${total} 条` +
    (summary.date_range ? `，时间 ${summary.date_range.from} ~ ${summary.date_range.to}` : ''));
  if (longCells) console.log(`注意：${longCells} 条消息正文超过 Excel 单格 32767 字符上限，Excel 打开 messages.csv 会截断，完整内容看 Markdown 或 raw.jsonl`);
}

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function safeName(s) {
  return String(s || 'user').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'user';
}
