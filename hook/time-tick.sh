#!/usr/bin/env bash
# claude-agent-clock — UserPromptSubmit hook for Claude Code.
# Injects a <system-reminder> with wall-clock time when:
#   gap since last fire > MIN_GAP_MINUTES (default 30), OR
#   local date has rolled since last fire, OR
#   optional deadline (CLAUDE_AGENT_CLOCK_DEADLINE, ISO 8601) has been crossed.
# Always exits 0 (never blocks the prompt).
#
# Env vars:
#   CLAUDE_AGENT_CLOCK            "0" disables the hook entirely (kill switch).
#   CLAUDE_AGENT_CLOCK_MIN_GAP_MINUTES   override default gap threshold (30).
#   CLAUDE_AGENT_CLOCK_DEADLINE   ISO-8601 deadline; fires once when crossed.
#   CLAUDE_AGENT_CLOCK_STATE_DIR  override stash dir (default XDG / ~/.claude).
#   CLAUDE_AGENT_CLOCK_LOG        override log file path.

set -u

if [ "${CLAUDE_AGENT_CLOCK:-1}" = "0" ]; then
    exit 0
fi

MIN_GAP_MINUTES="${CLAUDE_AGENT_CLOCK_MIN_GAP_MINUTES:-30}"
DEADLINE_ISO="${CLAUDE_AGENT_CLOCK_DEADLINE:-}"
STATE_DIR="${CLAUDE_AGENT_CLOCK_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/claude-agent-clock}"
STASH_FILE="$STATE_DIR/last.json"
LOG_FILE="${CLAUDE_AGENT_CLOCK_LOG:-$HOME/.claude/logs/agent-clock.log}"

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"

# Drain stdin (we don't need any of the prompt fields for v0.1 trigger logic).
if [ ! -t 0 ]; then
    cat >/dev/null
fi

python3 - "$STASH_FILE" "$LOG_FILE" "$MIN_GAP_MINUTES" "$DEADLINE_ISO" <<'PY'
import json
import sys
from datetime import datetime

stash_path, log_path, min_gap_str, deadline_iso = sys.argv[1:5]
min_gap_minutes = int(min_gap_str)

now = datetime.now().astimezone()
now_epoch = int(now.timestamp())
now_iso = now.isoformat(timespec="seconds")
now_date = now.strftime("%Y-%m-%d")

try:
    with open(stash_path) as fh:
        stash = json.load(fh)
except (FileNotFoundError, json.JSONDecodeError):
    stash = {}

last_epoch = int(stash.get("last_epoch", 0))
last_date = stash.get("last_date", "")
last_deadline_fired = stash.get("last_deadline_fired", "")

gap_seconds = now_epoch - last_epoch
gap_minutes = gap_seconds // 60

triggers = []
if last_epoch == 0 or gap_seconds > min_gap_minutes * 60:
    triggers.append("gap")
if last_date and last_date != now_date:
    triggers.append("date-rolled")
if deadline_iso and last_deadline_fired != deadline_iso:
    try:
        deadline_dt = datetime.fromisoformat(deadline_iso)
        if deadline_dt.tzinfo is None:
            deadline_dt = deadline_dt.astimezone()
        if now >= deadline_dt:
            triggers.append("deadline")
    except ValueError:
        pass

def log(msg):
    try:
        with open(log_path, "a") as fh:
            fh.write(f"{now_iso} {msg}\n")
    except OSError:
        pass

if not triggers:
    log(f"suppressed gap={gap_minutes}m")
    sys.exit(0)

lines = [f"Current time: {now_iso}"]
if last_epoch != 0:
    lines.append(f"Time since your last turn: {gap_minutes} minutes")
if "date-rolled" in triggers:
    lines.append(f"Date has changed: {last_date} -> {now_date}")
if "deadline" in triggers:
    lines.append(f"Deadline crossed: {deadline_iso}")
lines.append("Clock-hook verification marker: BLUEBIRD-7842")

reminder = "<system-reminder>\n" + "\n".join(lines) + "\n</system-reminder>"

print(json.dumps({
    "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit",
        "additionalContext": reminder,
    }
}))

new_stash = {
    "last_epoch": now_epoch,
    "last_date": now_date,
    "last_iso": now_iso,
}
if "deadline" in triggers:
    new_stash["last_deadline_fired"] = deadline_iso
elif last_deadline_fired:
    new_stash["last_deadline_fired"] = last_deadline_fired

with open(stash_path, "w") as fh:
    json.dump(new_stash, fh)

log(f"fired triggers={','.join(triggers)} gap={gap_minutes}m")
PY

exit 0
