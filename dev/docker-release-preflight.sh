#!/usr/bin/env bash
# Read-only Docker release checks. Also streamed over SSH before any code transfer.
set -euo pipefail

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
      echo "insufficient build resources: disk=$disk bytes memory=$memory bytes inodes=$inodes; need ${min_gib}GiB ${min_mib}MiB $min_inodes inodes" >&2
      exit 1
    fi
    echo "resources ready: disk=$disk bytes memory=$memory bytes inodes=$inodes"
    ;;
  *) echo "usage: $0 runtime SHORT_SHA | resources MIN_GIB MIN_MIB MIN_INODES" >&2; exit 2 ;;
esac
