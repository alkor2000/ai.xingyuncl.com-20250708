#!/usr/bin/env bash
# 按用户组（学校）导出学生与 AI 的完整对话记录 —— 由用户本人在本机运行（会话内的生产读取会被审核拦截）。
#
# 用法：
#   dev/export-group-chats.sh pku "某某中学"                           # ai.pkuailab.com（Docker，ssh 别名 pkuailab）
#   dev/export-group-chats.sh practice "某学校"                          # ai.xingyuncl.com（PM2，ssh 别名 practice）
#   dev/export-group-chats.sh local "某学校"                             # 本地容器库（make db-pull 之后，用来验证脚本）
#   dev/export-group-chats.sh pku --list-groups [关键词]                 # 只列出组名与人数/会话/消息数，不导出
# 选项：
#   --out DIR            输出目录（默认 ~/ai-platform-exports/<站点>-<组名>-<时间戳>，刻意放在仓库之外）
#   --exact              组名精确匹配（默认模糊匹配，把学校导入生成的 “_2/_3” 同名后缀组一起带出）
#   --roles all          包含组内非 user 角色账号（组管理员/老师）；默认只导 role=user 的学生
#   --include-deleted    包含已软删除的账号（用户名已被改成 deleted_… 前缀）
#
# 输出：raw.jsonl（原始逐行记录）、messages.csv（每条消息一行，Excel 可直接打开）、conversations.csv、users.csv、
#       markdown/<用户名>_<ID>.md（每个学生一份可读的完整对话）、summary.json。
# 服务器侧只做 SELECT（只读事务），用应用容器/进程自己的数据库连接，脚本经 stdin 送达，不在服务器落任何文件。
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CJS="$ROOT/dev/export-group-chats.cjs"
PKU_HOST="${DOCKER_SSH_HOST:-pkuailab}"
PRACTICE_HOST="${PRACTICE_SSH_HOST:-practice}"
REMOTE_DIR="${REMOTE_DIR:-/var/www/ai-platform}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-ai-platform-backend}"

SITE="${1:-}"; shift || true
case "$SITE" in pku|practice|local) ;; *) sed -n '2,22p' "$0"; exit 2 ;; esac

GROUP=""; OUT=""; EXACT=0; ROLES=user; INCLUDE_DELETED=0; LIST=0
while [ $# -gt 0 ]; do
  case "$1" in
    --out) OUT="$2"; shift 2 ;;
    --exact) EXACT=1; shift ;;
    --roles) ROLES="$2"; shift 2 ;;
    --include-deleted) INCLUDE_DELETED=1; shift ;;
    --list-groups) LIST=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    --*) echo "未知选项: $1" >&2; exit 2 ;;
    *) GROUP="$1"; shift ;;
  esac
done
if [ "$LIST" != 1 ] && [ -z "$GROUP" ]; then echo "缺少组名（学校名）" >&2; exit 2; fi
case "$ROLES" in user|all) ;; *) echo "--roles 只能是 user 或 all" >&2; exit 2 ;; esac

# 参数打包成 base64 的 JSON：中文组名不经过 ssh/容器的多层 shell 转义
ARGS_JSON=$(node -e '
  const [site, group, exact, roles, del, list] = process.argv.slice(1);
  process.stdout.write(JSON.stringify({ site, group: group || null, exact: exact === "1", roles, includeDeleted: del === "1", listGroups: list === "1" }));
' "$SITE" "$GROUP" "$EXACT" "$ROLES" "$INCLUDE_DELETED" "$LIST")
B64=$(printf '%s' "$ARGS_JSON" | base64 -w0)
NODE_ARGS="--mode remote --args-b64 $B64"

run_remote() {
  case "$SITE" in
    pku)
      # 容器内 WORKDIR 是 /app，mysql2 在 /app/node_modules；node - 从 stdin 读脚本
      ssh -o BatchMode=yes -o ConnectTimeout=20 "$PKU_HOST" \
        "docker exec -i -w /app $BACKEND_CONTAINER node - $NODE_ARGS" < "$CJS" ;;
    practice)
      # 非交互 ssh 不加载 nvm，按部署用户的 nvm 找同一个 node；dotenv 读 backend/.env
      ssh -o BatchMode=yes -o ConnectTimeout=20 "$PRACTICE_HOST" \
        "cd $REMOTE_DIR/backend && { [ -s \"\$HOME/.nvm/nvm.sh\" ] && . \"\$HOME/.nvm/nvm.sh\" >/dev/null 2>&1; NODE=\$(command -v node 2>/dev/null || ls -d \"\$HOME\"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -V | tail -1); \"\$NODE\" -r dotenv/config - $NODE_ARGS; }" < "$CJS" ;;
    local)
      # 与 practice 路径一致：脚本走 stdin，mysql2 从 backend/node_modules 解析
      (cd "$ROOT/backend" && node -r dotenv/config - $NODE_ARGS < "$CJS") ;;
  esac
}

if [ "$LIST" = 1 ]; then
  run_remote > /dev/null   # 表格打在 stderr 上；stdout 的 JSON 这里不需要
  exit 0
fi

SAFE_GROUP=$(node -e 'process.stdout.write(process.argv[1].replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40))' "$GROUP")
OUT="${OUT:-$HOME/ai-platform-exports/${SITE}-${SAFE_GROUP}-$(date +%Y%m%d_%H%M%S)}"
mkdir -p "$OUT"
RAW="$OUT/raw.jsonl"

echo "[1/2] 从 $SITE 导出到 $RAW ..." >&2
set +e
run_remote > "$RAW"
RC=$?
set -e
if [ "$RC" -ne 0 ]; then
  [ "$RC" -eq 3 ] && echo "提示：先用  $0 $SITE --list-groups  看一下线上实际的组名。" >&2
  rm -f "$RAW"; rmdir "$OUT" 2>/dev/null || true
  exit "$RC"
fi
if ! tail -n1 "$RAW" | grep -q '"type":"end"'; then
  echo "❌ 导出流没有正常结束标记（传输可能中断），保留 $RAW 供检查，不做转换" >&2; exit 1
fi

echo "[2/2] 转成 CSV / Markdown ..." >&2
node "$CJS" --mode convert --in "$RAW" --out "$OUT"
echo "完成：$OUT" >&2
ls -la "$OUT" >&2
