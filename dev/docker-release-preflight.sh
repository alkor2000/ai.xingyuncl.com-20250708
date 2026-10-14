#!/usr/bin/env bash
# Read-only Docker release checks. Also streamed over SSH before any code transfer.
set -euo pipefail

normalize_arch() { case "$1" in x86_64|amd64) echo amd64;; aarch64|arm64) echo arm64;; *) echo "$1";; esac; }

case "${1:-}" in
  runtime)
    short="${2:?target short SHA required}"
    [[ "$short" =~ ^[0-9a-f]{7,40}$ ]] || { echo "invalid target SHA" >&2; exit 2; }
    for service in backend frontend; do
      name="ai-platform-$service"
      tag=$(docker inspect "$name" --format '{{.Config.Image}}' 2>/dev/null || true)
      running_id=$(docker inspect "$name" --format '{{.Image}}' 2>/dev/null || true)
      health=$(docker inspect "$name" --format '{{.State.Health.Status}}' 2>/dev/null || true)
      running=$(docker inspect "$name" --format '{{.State.Running}}' 2>/dev/null || true)
      paused=$(docker inspect "$name" --format '{{.State.Paused}}' 2>/dev/null || true)
      restarting=$(docker inspect "$name" --format '{{.State.Restarting}}' 2>/dev/null || true)
      case "$tag" in
        "ai-platform-$service:v-$short-"*) ;;
        *) echo "STALE $service image=$tag"; exit 0 ;;
      esac
      tagged_id=$(docker image inspect "$tag" --format '{{.Id}}' 2>/dev/null || true)
      if [ -z "$running_id" ] || [ "$running_id" != "$tagged_id" ] || [ "$health" != healthy ] ||
         [ "$running" != true ] || [ "$paused" != false ] || [ "$restarting" != false ]; then
        echo "STALE $service image=$tag health=$health running=$running paused=$paused restarting=$restarting"
        exit 0
      fi
    done
    echo CURRENT
    ;;
  resources)
    min_gib="${2:?minimum free GiB required}"
    min_mib="${3:?minimum available MiB required}"
    min_inodes="${4:?minimum free inodes required}"
    # 可选第 5 参数只改提示语（build / prebuilt / image-build），阈值由调用方按各自依据算好传入。
    label="${5:-build}"
    for value in "$min_gib" "$min_mib" "$min_inodes"; do
      [[ "$value" =~ ^[0-9]+$ ]] || { echo "invalid resource threshold" >&2; exit 2; }
    done
    disk=$(df -B1 --output=avail / | awk 'NR==2 {print $1}') || { echo "disk availability unreadable" >&2; exit 1; }
    # `--output=iavail` 本身就是 inode 余量，再带 -i 会被 coreutils 判为互斥选项而整条预检失败。
    inodes=$(df --output=iavail / | awk 'NR==2 {print $1}') || { echo "inode availability unreadable" >&2; exit 1; }
    memory=$(free -b | awk '$1=="Mem:" {print $7}') || { echo "memory availability unreadable" >&2; exit 1; }
    for value in "$disk" "$inodes" "$memory"; do
      [[ "$value" =~ ^[0-9]+$ ]] || { echo "resource availability unknown" >&2; exit 1; }
    done
    if (( disk < min_gib * 1073741824 || memory < min_mib * 1048576 || inodes < min_inodes )); then
      echo "insufficient $label resources: disk=$disk bytes memory=$memory bytes inodes=$inodes; need ${min_gib}GiB ${min_mib}MiB $min_inodes inodes" >&2
      exit 1
    fi
    echo "resources ready: disk=$disk bytes memory=$memory bytes inodes=$inodes"
    ;;
  arch)
    # 本机 Docker 守护进程的平台（Go 命名，如 linux/amd64）；读不到就失败，不猜。
    os=$(docker version --format '{{.Server.Os}}' 2>/dev/null || true)
    arch=$(docker version --format '{{.Server.Arch}}' 2>/dev/null || true)
    [ -n "$os" ] && [ -n "$arch" ] || { echo "docker platform unknown" >&2; exit 1; }
    echo "$os/$(normalize_arch "$arch")"
    ;;
  image-identity)
    # 一行说明一个本地镜像：ID、平台、字节数、构建进镜像的 CUSTOMER_DOMAIN 默认值（没有则 -）。
    tag="${2:?image tag required}"
    [[ "$tag" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]*:[A-Za-z0-9._-]+$ ]] || { echo "invalid image tag" >&2; exit 2; }
    id=$(docker image inspect "$tag" --format '{{.Id}}' 2>/dev/null) || { echo "image missing: $tag" >&2; exit 1; }
    os=$(docker image inspect "$tag" --format '{{.Os}}')
    arch=$(docker image inspect "$tag" --format '{{.Architecture}}')
    size=$(docker image inspect "$tag" --format '{{.Size}}')
    domain=$(docker image inspect "$tag" --format '{{range .Config.Env}}{{println .}}{{end}}' | awk -F= '$1=="CUSTOMER_DOMAIN" {print $2; exit}')
    echo "id=$id platform=$os/$(normalize_arch "$arch") size=$size customer_domain=${domain:--}"
    ;;
  untracked-context)
    # 服务器检出里、会被 Dockerfile COPY 进镜像的未跟踪文件（如门户页 frontend/public/www/）：现场构建会把它们带进镜像，
    # 预构建镜像里没有。列出来并以 exit 1 表示存在；.dockerignore 明确排除的那几类不算（近似，宁多勿漏）。
    dir="${2:?checkout dir required}"
    [ -d "$dir" ] || { echo "checkout dir missing" >&2; exit 2; }
    list=$(git -C "$dir" status --porcelain --untracked-files=all -- backend frontend docker database tools 2>/dev/null \
      | awk '$1=="??" {print $2}' \
      | grep -vE '(^|/)(node_modules|dist|build|logs|coverage|tmp|temp|__tests__)/|(^|/)\.env(\.|$)|\.(log|bak|backup|sh|test\.js|spec\.js|key|pem|crt)$|storage/(uploads|private)/' || true)
    if [ -n "$list" ]; then echo "$list"; exit 1; fi
    echo "no untracked build-context files"
    ;;
  *) echo "usage: $0 runtime SHORT_SHA | resources MIN_GIB MIN_MIB MIN_INODES [LABEL] | arch | image-identity TAG | untracked-context DIR" >&2; exit 2 ;;
esac
