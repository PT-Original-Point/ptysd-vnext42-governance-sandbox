#!/bin/sh
set -eu
BASE="$HOME/.local/state/ptysd-v45-z5"
WORK="$BASE/workspace"
MODEL="opencode/muse-spark-1.3-contributor-free"
MODEL_BARE="muse-spark-1.3-contributor-free"
OPENCODE="/usr/local/bin/opencode"
PYTHON="/usr/bin/python3"
AUTH="$HOME/.local/share/opencode/auth.json"
LOG="$BASE/opencode-run.jsonl"
CATALOG="$BASE/model-catalog.txt"

fail() {
  echo "Z5_FAIL=$1" >&2
  exit "${2:-1}"
}

test "$(id -un)" = "ptysd" || fail WRONG_USER 40
test -x "$OPENCODE" || fail OPENCODE_MISSING 41
test -x "$PYTHON" || fail PYTHON_MISSING 42
VERSION="$($OPENCODE --version 2>/dev/null || true)"
test "$VERSION" = "1.18.30" || fail OPENCODE_VERSION_MISMATCH 43

AUTH_OK="$($PYTHON - "$AUTH" <<'PY'
import json, os, sys
p=sys.argv[1]
try:
    d=json.load(open(p, encoding='utf-8'))
except Exception:
    print('false'); raise SystemExit
print('true' if isinstance(d, dict) and 'opencode' in d else 'false')
PY
)"
test "$AUTH_OK" = "true" || fail OPENCODE_ZEN_AUTH_REQUIRED 44
mkdir -p "$BASE"
umask 077
OPENCODE_DISABLE_AUTOUPDATE=1 "$OPENCODE" models opencode --verbose --refresh > "$CATALOG"

COST_GUARD="$($PYTHON - "$CATALOG" "$MODEL" "$MODEL_BARE" <<'PY'
import json, sys
p, heading, model_id = sys.argv[1:]
s=open(p, encoding='utf-8', errors='replace').read()
pos=s.find(heading)
if pos < 0:
    print('MODEL_NOT_FOUND'); raise SystemExit
start=s.find('{', pos)
if start < 0:
    print('MODEL_JSON_NOT_FOUND'); raise SystemExit
try:
    obj,_=json.JSONDecoder().raw_decode(s[start:])
except Exception:
    print('MODEL_JSON_INVALID'); raise SystemExit
cost=obj.get('cost') or {}
cache=cost.get('cache') or {}
checks=[
    obj.get('id')==model_id,
    obj.get('providerID')=='opencode',
    obj.get('status')=='active',
    cost.get('input')==0,
    cost.get('output')==0,
    cache.get('read')==0,
    cache.get('write')==0,
]
print('PASS' if all(checks) else 'NONZERO_OR_UNQUALIFIED')
PY
)"
test "$COST_GUARD" = "PASS" || fail "ZERO_COST_GUARD_$COST_GUARD" 45

test ! -e "$WORK" || fail WORKSPACE_NOT_CLEAN 46
mkdir -p "$WORK/src" "$WORK/tests"
cat > "$WORK/src/message.txt" <<'EOF'
PENDING
EOF
cat > "$WORK/tests/test_message.py" <<'EOF'
from pathlib import Path
import sys
expected = b"HELLO_FROM_OPENCODE\n"
actual = Path("src/message.txt").read_bytes()
if actual != expected:
    print(f"FAIL expected={expected!r} actual={actual!r}")
    sys.exit(1)
print("PASS_Z5_SYNTHETIC_MESSAGE")
EOF
cat > "$WORK/TASK.md" <<'EOF'
# Z5 synthetic coding task

Change exactly one file: `src/message.txt`.

Required final bytes:
`HELLO_FROM_OPENCODE\n`

Do not modify any other file. Do not use shell commands, network tools, subagents, or external directories.
The trusted outer verifier will run the fixed test after OpenCode exits.
EOF
cat > "$WORK/opencode.json" <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "model": "opencode/muse-spark-1.3-contributor-free",
  "small_model": "opencode/muse-spark-1.3-contributor-free",
  "permission": {
    "*": "deny",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "edit": {"*": "deny", "src/message.txt": "allow"}
  }
}
EOF
TASK_HASH="$(sha256sum "$WORK/TASK.md" | awk '{print $1}')"
TEST_HASH="$(sha256sum "$WORK/tests/test_message.py" | awk '{print $1}')"
CFG_HASH="$(sha256sum "$WORK/opencode.json" | awk '{print $1}')"

cd "$WORK"
: > "$LOG"
OPENCODE_DISABLE_AUTOUPDATE=1 timeout 240s "$OPENCODE" run \
  --pure \
  --format json \
  --model "$MODEL" \
  "Read TASK.md and complete exactly that task. Change only src/message.txt. Do not use shell commands, network tools, subagents, or external directories." \
  > "$LOG"

"$PYTHON" tests/test_message.py || fail OUTER_TEST_FAILED 47
test "$(sha256sum TASK.md | awk '{print $1}')" = "$TASK_HASH" || fail TASK_FILE_CHANGED 48
test "$(sha256sum tests/test_message.py | awk '{print $1}')" = "$TEST_HASH" || fail TEST_FILE_CHANGED 49
test "$(sha256sum opencode.json | awk '{print $1}')" = "$CFG_HASH" || fail CONFIG_FILE_CHANGED 50

RUN_COST="$($PYTHON - "$LOG" <<'PY'
import json, sys
count=0
total=0.0
for raw in open(sys.argv[1], encoding='utf-8', errors='strict'):
    raw=raw.strip()
    if not raw:
        continue
    obj=json.loads(raw)
    if obj.get('type')!='step_finish':
        continue
    part=obj.get('part') or {}
    cost=part.get('cost')
    if not isinstance(cost,(int,float)):
        print('MISSING_COST'); raise SystemExit
    count += 1
    total += float(cost)
if count < 1:
    print('NO_STEP_FINISH'); raise SystemExit
print(f'PASS:{count}:{total:.12g}' if total == 0 else f'NONZERO:{count}:{total:.12g}')
PY
)"
case "$RUN_COST" in PASS:*) ;; *) fail "OBSERVED_COST_$RUN_COST" 51 ;; esac
CANDIDATE_SHA="$(sha256sum src/message.txt | awk '{print $1}')"
CANDIDATE_BYTES="$(wc -c < src/message.txt | tr -d ' ')"
printf 'PASS_Z5_REAL_MODEL_MINIMAL_LOOP\n'
printf 'MODEL=%s\n' "$MODEL"
printf 'MODEL_COST_GUARD=%s\n' "$COST_GUARD"
printf 'OBSERVED_RUN_COST=%s\n' "$RUN_COST"
printf 'CANDIDATE_SHA256=%s\n' "$CANDIDATE_SHA"
printf 'CANDIDATE_BYTES=%s\n' "$CANDIDATE_BYTES"
printf 'RUN_LOG=%s\n' "$LOG"
