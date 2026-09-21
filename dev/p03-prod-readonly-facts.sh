#!/usr/bin/env bash
# P03 双站生产只读事实核对 —— 由用户本人在本机运行（会话内的生产读取会被审核拦截）。
# 只打印：部署 HEAD 与脏文件计数、Identity/P03 配置中白名单内的非密变量、数据库授权与 schema 的布尔/计数事实。
# 不打印密钥、口令、连接地址、用户记录或任何正文；不修改任何服务器上的东西。
# 用法：bash dev/p03-prod-readonly-facts.sh            （两站）
#       bash dev/p03-prod-readonly-facts.sh practice   （只查星云站 PM2）
#       bash dev/p03-prod-readonly-facts.sh pku        （只查北大站 Docker）
set -uo pipefail
PRACTICE_HOST="${PRACTICE_SSH_HOST:-practice}"
PKU_HOST="${DOCKER_SSH_HOST:-pkuailab}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/ai-platform}"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=20"
# 允许打印的变量名（公开标识/开关；CLIENT_SECRET、CREDENTIALS_FILE、RUNTIME_DIR、DB_* 一律不打印）
ALLOW='^(IDENTITY_ENABLED|IDENTITY_ISSUER|IDENTITY_PUBLIC_ORIGIN|IDENTITY_CLIENT_ID|IDENTITY_DEPLOYMENT_INSTANCE_KEY|IDENTITY_TOKEN_AUTH_METHOD|IDENTITY_BACKCHANNEL_URL|P03_HANDOFF_[A-Z_]+)='
# 应用自己的数据库连接内只读查询：授权类别、users/user_groups 是否已有 P03 资格链所需列、影子账号计数、P03 表是否存在
read -r -d '' NODE_FACTS <<'JS'
const m=require('mysql2/promise');(async()=>{const e=process.env;
const c=await m.createConnection({host:e.DB_HOST||'localhost',port:+(e.DB_PORT||3306),user:e.DB_USER,password:e.DB_PASSWORD,database:e.DB_NAME});
const [g]=await c.query('SHOW GRANTS FOR CURRENT_USER()');const t=g.map(r=>Object.values(r)[0]).join('\n');
const [[v]]=await c.query('SELECT VERSION() AS v');
const [u]=await c.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users' AND column_name IN ('uuid_source','role','status','expire_at','deleted_at') ORDER BY 1");
const [gm]=await c.query("SELECT column_name AS c FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='user_groups' AND column_name IN ('edu_school_id','cohort') ORDER BY 1");
const [[s]]=await c.query("SELECT COUNT(*) AS n FROM users WHERE uuid_source='sso' AND deleted_at IS NULL");
const [[p]]=await c.query("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name LIKE 'p03_handoff_%'");
console.log(JSON.stringify({mysql:v.v,grant_count:g.length,all_privileges:/ALL PRIVILEGES/i.test(t),global_grant:/ON \*\.\*/.test(t.replace(/GRANT USAGE ON \*\.\*/g,'')),
 users_columns:u.map(r=>r.c),user_groups_mapping_columns:gm.map(r=>r.c),sso_shadow_accounts:s.n,p03_handoff_tables:p.n}));await c.end();
})().catch(e=>{console.log(JSON.stringify({db_error:e.code||'failed'}));process.exit(1)});
JS
NODE_FACTS="${NODE_FACTS//$'\n'/ }"   # one line, so printf %q stays plain backslash quoting for any remote shell
ARGS="$(printf '%q ' "$REMOTE_DIR" "$ALLOW" "$NODE_FACTS")"

practice() {
  echo "== ai.xingyuncl.com ($PRACTICE_HOST, PM2) =="
  $SSH "$PRACTICE_HOST" "bash -s $ARGS" <<'REMOTE'
DIR="$1"; ALLOW="$2"; NODE_FACTS="$3"
cd "$DIR" || { echo "remote_dir_missing"; exit 1; }
echo "head=$(git rev-parse HEAD)  dirty_tracked=$(git status --porcelain | grep -vc '^??')"
echo "-- backend/.env (allow-listed names only)"
grep -E "$ALLOW" backend/.env 2>/dev/null | sort || echo "(none set)"
echo "-- pm2 process env (allow-listed names only)"
if command -v pm2 >/dev/null 2>&1; then
  ID=$(pm2 id ai-platform-auth 2>/dev/null | tr -d '[] ' | head -1)
  [ -n "$ID" ] && pm2 env "$ID" 2>/dev/null | grep -E '^(IDENTITY_(ENABLED|ISSUER|PUBLIC_ORIGIN|CLIENT_ID|DEPLOYMENT_INSTANCE_KEY|TOKEN_AUTH_METHOD)|P03_HANDOFF_[A-Z_]+):' | sort || echo "(pm2 process not found)"
else echo "(pm2 not on PATH for this shell)"; fi
echo "-- database facts (application connection, read-only)"
cd backend && node -r dotenv/config -e "$NODE_FACTS"
REMOTE
}

pku() {
  echo "== ai.pkuailab.com ($PKU_HOST, Docker) =="
  $SSH "$PKU_HOST" "bash -s $ARGS" <<'REMOTE'
DIR="$1"; ALLOW="$2"; NODE_FACTS="$3"
cd "$DIR" || { echo "remote_dir_missing"; exit 1; }
echo "head=$(git rev-parse HEAD)  dirty_tracked=$(git status --porcelain | grep -vc '^??')"
echo "-- running backend container env (allow-listed names only)"
docker compose exec -T backend sh -c "env | grep -E '$ALLOW' | sort" || echo "(container env unavailable)"
echo "-- database facts (application connection inside the container, read-only)"
docker compose exec -T -e NODE_FACTS="$NODE_FACTS" backend sh -c 'cd /app && node -e "$NODE_FACTS"'
REMOTE
}

case "${1:-all}" in
  practice) practice ;;
  pku) pku ;;
  all) practice; echo; pku ;;
  *) echo "usage: $0 [all|practice|pku]"; exit 2 ;;
esac
