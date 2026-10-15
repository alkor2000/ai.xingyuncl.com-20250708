#!/usr/bin/env bash
# Docker 站点的唯一发布互斥：在发布根目录下 mkdir 一个锁目录（原子），owner 文件记谁、何时。
# 像 preflight 一样整段经 SSH 的 bash -s 送到服务器执行；deploy-docker 在传码前 acquire，远端脚本退出时 release。
#   acquire DIR TOKEN   拿到锁 exit 0；已被占用 exit 3 并打印持有者（不抢、不清）
#   release DIR TOKEN   只释放 TOKEN 自己拿的锁；别人的锁 exit 3 不动；没有锁视为已释放
#   status  DIR         打印 free 或 held: <owner>
# 残留锁（发布中途断线）要由人核实没有发布在跑之后手工 rmdir，脚本不自动破锁。
set -euo pipefail
cmd="${1:-}"; dir="${2:-}"; token="${3:-}"
[ -n "$dir" ] || { echo "usage: $0 acquire|release DIR TOKEN | status DIR" >&2; exit 2; }
case "$cmd" in
  acquire)
    [[ "$token" =~ ^[A-Za-z0-9._-]{8,80}$ ]] || { echo "invalid lock token" >&2; exit 2; }
    mkdir -p "$(dirname "$dir")"
    if mkdir "$dir" 2>/dev/null; then
      printf 'token=%s\nsince=%s\nhost=%s\n' "$token" "$(date -u +%FT%TZ)" "$(hostname)" > "$dir/owner"
      echo "lock acquired $token"; exit 0
    fi
    echo "release lock held: $(tr '\n' ' ' < "$dir/owner" 2>/dev/null || echo 'owner unknown')" >&2; exit 3 ;;
  release)
    [[ "$token" =~ ^[A-Za-z0-9._-]{8,80}$ ]] || { echo "invalid lock token" >&2; exit 2; }
    [ -d "$dir" ] || { echo "lock not held"; exit 0; }
    grep -qx "token=$token" "$dir/owner" 2>/dev/null || { echo "lock owned by another release; not released: $(tr '\n' ' ' < "$dir/owner" 2>/dev/null)" >&2; exit 3; }
    rm -f "$dir/owner"; rmdir "$dir"; echo "lock released $token" ;;
  status)
    if [ -d "$dir" ]; then echo "held: $(tr '\n' ' ' < "$dir/owner" 2>/dev/null || echo 'owner unknown')"; else echo free; fi ;;
  *) echo "usage: $0 acquire|release DIR TOKEN | status DIR" >&2; exit 2 ;;
esac
