#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_log="$(mktemp)"
trap 'rm -f "$build_log"' EXIT

# 复用已下载的依赖，减少共享出口的请求；只对临时网络错误退避一次。
for attempt in 1 2; do
  set +e
  bash "$project_dir/android/gradlew" -p "$project_dir/android" --no-daemon --max-workers=2 "$@" 2>&1 | tee "$build_log"
  build_status="${PIPESTATUS[0]}"
  set -e

  if [ "$build_status" -eq 0 ]; then
    exit 0
  fi
  if [ "$attempt" -eq 2 ] || ! grep -Eq 'Received status code (429|502|503|504)|SocketTimeoutException|ConnectTimeoutException' "$build_log"; then
    exit "$build_status"
  fi

  echo "::warning::Android 依赖源暂时不可用；保留缓存，等待 60 秒后重试一次。"
  sleep 60
done
