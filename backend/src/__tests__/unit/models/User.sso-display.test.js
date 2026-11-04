const mockQuery = jest.fn();
const mockSimpleQuery = jest.fn();
jest.mock('../../../database/connection', () => ({ query: mockQuery, simpleQuery: mockSimpleQuery, transaction: fn => fn(mockQuery) }));
jest.mock('../../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('bcryptjs', () => ({ hash: jest.fn(async () => 'fixture-hash') }));
jest.mock('../../../models/SystemConfig', () => ({ getSetting: jest.fn() }));
jest.mock('../../../models/AIModel', () => ({}));
jest.mock('../../../services/admin/GroupService', () => ({ checkGroupCapacity: jest.fn(async () => true) }));
jest.mock('../../../services/admin', () => ({ GroupService: {} }));
jest.mock('../../../services/auth/EmailAuthService', () => ({}));
jest.mock('../../../services/auth/TokenService', () => ({ generateTokenPair: jest.fn(async () => ({ accessToken: 'fixture-only', refreshToken: 'fixture-only' })) }));
jest.mock('../../../services/auth/SiteConfigService', () => ({ getUserSiteConfig: jest.fn(async () => ({})) }));
const crypto = require('crypto');
const User = require('../../../models/User');
const UserService = require('../../../services/admin/UserService');
const Controller = require('../../../controllers/AuthControllerRefactored');
const SystemConfig = require('../../../models/SystemConfig');
const { normalizeSSODisplayName } = require('../../../utils/ssoDisplayName');
const uuid = '11111111-aaaa-4000-8000-000000000001';
let records, beforeDisplayUpdate;
const response = () => ({ status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } });
function request(overrides = {}) {
 const b = { uuid, name: '学生一', timestamp: Math.floor(Date.now()/1000), platform_key: 'fixture-a', ...overrides };
 b.signature = crypto.createHash('md5').update(`${b.uuid || b.username}${b.timestamp}fixture-secret`).digest('hex'); return b;
}
async function login(b) { const r = response(); await Controller.ssoLogin({body:b,ip:'127.0.0.1'},r); return r; }
function seed(extra = {}) {
 const r = {id:records.length+1,uuid,uuid_source:'sso',username:'sso_11111111',email:`${uuid}@sso.local`,status:'active',role:'user',group_id:1,credits_quota:120,used_credits:0,expire_at:null,sso_display_name:null,sso_display_name_locked:0,deleted_at:null,...extra};records.push(r);return r;
}
beforeEach(() => {
 records=[];beforeDisplayUpdate=null;
 jest.spyOn(User.prototype,'getPermissions').mockResolvedValue(['chat.use']);
 SystemConfig.getSetting.mockResolvedValue({enabled:true,platforms:[{platform_key:'fixture-a',secret:'fixture-secret',target_group_id:1,default_credits:120},{platform_key:'fixture-b',secret:'fixture-secret',target_group_id:2,default_credits:250}]});
 mockQuery.mockImplementation(async (sql,p=[]) => {
  const q=sql.replace(/\s+/g,' ').trim();
  if(q.includes('FROM users u')&&q.includes('SELECT u.*')) {const f=q.match(/WHERE u\.(id|uuid|username) = \?/)[1];return {rows:records.filter(r=>!r.deleted_at&&r[f]===p[0]).map(r=>({...r}))};}
  if(q.startsWith('SELECT expire_date FROM user_groups')||q.startsWith('SELECT * FROM user_groups'))return {rows:[]};
  if(q.startsWith('INSERT INTO users')) {
   const keys=['uuid','uuid_source','email','username','password_hash','phone','role','group_id','status','remark','token_quota','credits_quota','credits_expire_at','expire_at'];
   const data=Object.fromEntries(keys.map((k,i)=>[k,p[i]]));
   if(records.some(r=>r.uuid===data.uuid||r.username===data.username))throw Object.assign(new Error('duplicate username'),{code:'ER_DUP_ENTRY'});
   return {rows:{insertId:seed(data).id}};
  }
  if(q.startsWith('UPDATE users SET sso_display_name = ?')) {
   if(beforeDisplayUpdate)beforeDisplayUpdate();
   const r=records.find(r=>r.id===p[1]&&r.uuid_source==='sso'&&r.username===p[2]&&!r.sso_display_name_locked&&!r.deleted_at);
   if(r)r.sso_display_name=p[0];return {rows:{affectedRows:r?1:0}};
  }
  if(q.startsWith('UPDATE users SET last_login_at'))return {rows:{affectedRows:1}};
  if(q.startsWith('UPDATE users SET ')) {
   const r=records.find(r=>r.id===p[p.length-1]);
   [...q.matchAll(/([a-z_]+) = \?/g)].map(m=>m[1]).filter(f=>f!=='id').forEach((f,i)=>{r[f]=p[i];});return {rows:{affectedRows:1}};
  }
  if(q.startsWith('INSERT INTO credit_transactions'))return {rows:{}};
  if(q.startsWith('SELECT COUNT(*)'))return {rows:[{total:records.length}]};
  throw new Error(`Unexpected SQL: ${q}`);
 });
 mockSimpleQuery.mockImplementation(async()=>({rows:records.map(r=>({...r}))}));
});
afterEach(()=>jest.restoreAllMocks());
test('first login displays name and preserves UUID, internal username, group and credits',async()=>{
 const r=await login(request());expect(r.statusCode).toBe(200);expect(r.body.data.user).toMatchObject({display_name:'学生一',username:'sso_11111111',uuid,group_id:1,credits_quota:120});expect(records).toHaveLength(1);expect(r.body.data.user.sso_display_name_locked).toBeUndefined();
});
test('explicit third-party username takes precedence over name',async()=>{expect((await login(request({username:'student_001'}))).body.data.user.display_name).toBe('student_001');});
test('existing auto account fills name on next SSO without new account or lost credits',async()=>{
 seed({used_credits:37});const r=await login(request({username:'student_001'}));expect(r.body.data.user).toMatchObject({id:1,display_name:'student_001',used_credits:37,credits_quota:120});expect(records).toHaveLength(1);
});
test('repeat refreshes label and preserves id',async()=>{await login(request());const r=await login(request({name:'新名字'}));expect(r.body.data.user).toMatchObject({id:1,display_name:'新名字',uuid});expect(records).toHaveLength(1);});
test('auth/me reads persisted name after callback/refresh',async()=>{await login(request());const r=response();await Controller.getCurrentUser({user:{id:1}},r);expect(r.body.data.user.display_name).toBe('学生一');});
test('existing admin-chosen username wins',async()=>{seed({username:'admin_chosen'});expect((await login(request())).body.data.user.display_name).toBe('admin_chosen');expect(records[0].sso_display_name).toBeNull();});
test('admin rename locks label even when later renamed back to auto username',async()=>{
 await login(request());const u=await User.findById(1);await u.update({username:'chosen'});await u.update({username:'sso_11111111'});
 expect((await login(request())).body.data.user.display_name).toBe('sso_11111111');expect(records[0].sso_display_name_locked).toBe(1);
});
test('admin rename plus group change locks label in transaction',async()=>{seed({sso_display_name:'old'});await UserService.updateUser(1,{username:'chosen',group_id:2});expect(records[0]).toMatchObject({username:'chosen',group_id:2,sso_display_name:null,sso_display_name_locked:1});});
test('concurrent admin rename is protected and reloaded',async()=>{seed();beforeDisplayUpdate=()=>Object.assign(records[0],{username:'race_winner',sso_display_name_locked:1});expect((await login(request())).body.data.user.display_name).toBe('race_winner');expect(records[0].sso_display_name).toBeNull();});
test('deleted during update does not login',async()=>{seed();beforeDisplayUpdate=()=>{records[0].deleted_at=new Date();};expect((await login(request())).statusCode).toBe(400);});
test('invalid username falls back to name',async()=>{expect((await login(request({username:{bad:true}}))).body.data.user.display_name).toBe('学生一');});
test.each([null,'','   ',12,{},'a\u202eb','a\u0000b'])('invalid name %p falls back without breaking login',async name=>{const r=await login(request({name}));expect(r.statusCode).toBe(200);expect(r.body.data.user.display_name).toBe('sso_11111111');});
test('Unicode name clips to 100 whole code points',async()=>{const r=await login(request({name:'😀'.repeat(110)}));expect(Array.from(r.body.data.user.display_name)).toHaveLength(100);expect(r.body.data.user.display_name.endsWith('😀')).toBe(true);});
test('two UUIDs with same name across platforms remain separate',async()=>{await login(request({username:'same_name'}));const r=await login(request({uuid:'22222222-aaaa-4000-8000-000000000002',username:'same_name',platform_key:'fixture-b'}));expect(r.statusCode).toBe(200);expect(r.body.data.user).toMatchObject({id:2,display_name:'same_name'});expect(records).toHaveLength(2);});
test('same UUID across platforms preserves account and group',async()=>{await login(request());const r=await login(request({platform_key:'fixture-b'}));expect(r.body.data.user).toMatchObject({id:1,group_id:1,credits_quota:120});expect(records).toHaveLength(1);});
test('legacy username-only still signs, matches and displays',async()=>{const r=await login(request({uuid:undefined,username:'legacy_student'}));expect(r.statusCode).toBe(200);expect(r.body.data.user).toMatchObject({uuid:'legacy_student',display_name:'legacy_student'});});
test('unsigned label is only display, cannot change identity or privileges',async()=>{const b=request();b.username='admin';expect((await login(b)).body.data.user).toMatchObject({uuid,username:'sso_11111111',role:'user',display_name:'admin'});});
test('invalid signature creates no account or name',async()=>{const b=request();b.signature='invalid';expect((await login(b)).statusCode).toBe(403);expect(records).toHaveLength(0);});
test('system account cannot acquire external label',async()=>{seed({uuid_source:'system'});expect((await login(request())).body.data.user.display_name).toBe('sso_11111111');expect(records[0].sso_display_name).toBeNull();});
test('disabled account cannot sync name',async()=>{seed({status:'inactive'});expect((await login(request())).statusCode).toBe(403);expect(records[0].sso_display_name).toBeNull();});
test('admin list serializes and searches label with bound parameters',async()=>{seed({sso_display_name:'student_001'});expect((await User.getList({search:'student_001'})).users[0].display_name).toBe('student_001');const [sql,p]=mockQuery.mock.calls.find(([q])=>q.includes('SELECT COUNT(*)'));expect(sql).toContain('u.sso_display_name LIKE ?');expect(p).toEqual(Array(4).fill('%student_001%'));});
test('markup remains plain text',()=>{expect(normalizeSSODisplayName(' <b>Student</b> ')).toBe('<b>Student</b>');});

const migration = require('../../../../migrations/20261104_001_sso_display_name');
test('additive migration can resume after either column already exists', async () => {
  const existing = new Set(['sso_display_name']);
  const column = { notNullable: () => column, defaultTo: () => column, nullable: () => column };
  const table = { string: jest.fn(() => column), boolean: jest.fn(name => { existing.add(name); return column; }) };
  const knex = { schema: { hasColumn: jest.fn(async (_,name) => existing.has(name)), alterTable: jest.fn(async (_,fn) => fn(table)) } };
  await migration.up(knex); await migration.up(knex);
  expect(table.string).not.toHaveBeenCalled(); expect(table.boolean).toHaveBeenCalledTimes(1);
  expect(knex.schema.alterTable).toHaveBeenCalledTimes(1);
});
test('rollback leaves display data intact for old application code', async () => {
  const knex = { schema: { alterTable: jest.fn() } }; await migration.down(knex); expect(knex.schema.alterTable).not.toHaveBeenCalled();
});
