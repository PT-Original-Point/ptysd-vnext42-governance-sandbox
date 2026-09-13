#!/bin/sh
set -eu
BASE="/home/ptysd/.local/state/ptysd-v45-z4"
WORK="$BASE/workspace"
PAYLOAD="$WORK/payload.txt"
PIDFILE="$BASE/worker.pid"
RECOVERY="$BASE/recovery"
RECOVERY_PAYLOAD="$RECOVERY/payload.txt"
CMD="${SSH_ORIGINAL_COMMAND:-}"

ensure_base() {
  mkdir -p "$BASE"
  chmod 700 "$BASE"
}

emit_hash_file() {
  file="$1"
  test -f "$file" || { echo "PAYLOAD_ABSENT" >&2; exit 21; }
  printf 'SHA256='; sha256sum "$file" | awk '{print $1}'
  printf 'BYTES='; wc -c < "$file" | tr -d ' '
}

is_alive() {
  test -f "$PIDFILE" || return 1
  pid="$(cat "$PIDFILE")"
  case "$pid" in (*[!0-9]*|'') return 1;; esac
  kill -0 "$pid" 2>/dev/null
}

case "$CMD" in
  probe)
    echo 'PTYSD_RESTRICTED_BRIDGE_OK'
    printf 'USER='; id -un
    printf 'HOSTNAME='; hostname
    ;;
  z4-prestate)
    if test -d "$BASE"; then echo 'BASE_EXISTS=true'; else echo 'BASE_EXISTS=false'; fi
    if test -f "$PAYLOAD"; then echo 'PAYLOAD_EXISTS=true'; else echo 'PAYLOAD_EXISTS=false'; fi
    if is_alive; then echo 'WORKER_ALIVE=true'; else echo 'WORKER_ALIVE=false'; fi
    ;;
  z4-start)
    ensure_base
    if test -e "$PAYLOAD" || test -e "$PIDFILE"; then
      echo 'PRESTATE_NOT_CLEAN' >&2
      exit 22
    fi
    mkdir -p "$WORK"
    chmod 700 "$WORK"
    printf 'PTYSD-V45-Z4-SYNTHETIC-PAYLOAD-v1\n0123456789abcdef\n' > "$PAYLOAD"
    chmod 600 "$PAYLOAD"
    nohup sh -c 'trap "exit 0" TERM INT; while :; do sleep 300; done' >/dev/null 2>&1 &
    pid=$!
    printf '%s\n' "$pid" > "$PIDFILE"
    chmod 600 "$PIDFILE"
    printf 'PID=%s\n' "$pid"
    emit_hash_file "$PAYLOAD"
    ;;
  z4-manifest)
    emit_hash_file "$PAYLOAD"
    if test -f "$PIDFILE"; then printf 'PID='; cat "$PIDFILE"; else echo 'PID=ABSENT'; fi
    if is_alive; then echo 'WORKER_ALIVE=true'; else echo 'WORKER_ALIVE=false'; fi
    ;;
  z4-clean)
    if is_alive; then echo 'WORKER_STILL_ALIVE' >&2; exit 25; fi
    rm -rf "$WORK"
    rm -f "$PIDFILE"
    echo 'CLEAN=true'
    ;;
  z4-recovery-prestate)
    if test -e "$RECOVERY"; then echo 'RECOVERY_EXISTS=true'; else echo 'RECOVERY_EXISTS=false'; fi
    if test -f "$RECOVERY_PAYLOAD"; then echo 'RECOVERY_PAYLOAD_EXISTS=true'; else echo 'RECOVERY_PAYLOAD_EXISTS=false'; fi
    if is_alive; then echo 'WORKER_ALIVE=true'; else echo 'WORKER_ALIVE=false'; fi
    ;;
  z4-recovery-hash)
    emit_hash_file "$RECOVERY_PAYLOAD"
    ;;
  z4-restore-recovery\ *)
    if is_alive; then echo 'WORKER_STILL_ALIVE' >&2; exit 26; fi
    if test -e "$RECOVERY"; then echo 'RECOVERY_NOT_CLEAN' >&2; exit 27; fi
    b64="${CMD#z4-restore-recovery }"
    case "$b64" in (*[!A-Za-z0-9+/=]*|'') echo 'INVALID_BASE64' >&2; exit 28;; esac
    ensure_base
    mkdir -p "$RECOVERY"
    chmod 700 "$RECOVERY"
    umask 077
    printf '%s' "$b64" | base64 -d > "$RECOVERY_PAYLOAD"
    emit_hash_file "$RECOVERY_PAYLOAD"
    ;;
  *)
    echo 'COMMAND_NOT_ALLOWED' >&2
    exit 64
    ;;
esac
