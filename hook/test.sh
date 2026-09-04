#!/usr/bin/env bash
# Tests for hook/time-tick.sh.
# Uses temp dirs via env-var overrides so it never touches real state.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOOK="$SCRIPT_DIR/time-tick.sh"

if [ ! -x "$HOOK" ]; then
    echo "FATAL: $HOOK is not executable"
    exit 1
fi

TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

export CLAUDE_AGENT_CLOCK_STATE_DIR="$TEST_DIR/state"
export CLAUDE_AGENT_CLOCK_LOG="$TEST_DIR/log"

PASS=0
FAIL=0

assert_contains() {
    local out="$1" needle="$2" name="$3"
    if echo "$out" | grep -q "$needle"; then
        echo "PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $name"
        echo "  expected to find: $needle"
        echo "  in output: $out"
        FAIL=$((FAIL + 1))
    fi
}

assert_empty() {
    local out="$1" name="$2"
    if [ -z "$out" ]; then
        echo "PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "FAIL: $name"
        echo "  expected empty output, got: $out"
        FAIL=$((FAIL + 1))
    fi
}

reset_state() {
    rm -rf "$TEST_DIR/state" "$TEST_DIR/log"
    mkdir -p "$TEST_DIR/state"
}

yesterday_date() {
    date -v-1d +%Y-%m-%d 2>/dev/null || date -d "yesterday" +%Y-%m-%d
}

# --- Test 1: First run (no stash) fires
reset_state
OUT=$(echo '{"prompt":"hi"}' | "$HOOK")
assert_contains "$OUT" "system-reminder" "first run fires"
assert_contains "$OUT" "Current time:" "first run includes current time"

# --- Test 2: 4h gap fires
reset_state
NOW=$(date +%s)
FOUR_HOURS_AGO=$((NOW - 4 * 3600))
TODAY=$(date +%Y-%m-%d)
echo "{\"last_epoch\":$FOUR_HOURS_AGO,\"last_date\":\"$TODAY\",\"last_iso\":\"x\"}" > "$TEST_DIR/state/last.json"
OUT=$(echo '{"prompt":"hi"}' | "$HOOK")
assert_contains "$OUT" "system-reminder" "4h gap fires"
assert_contains "$OUT" "Time since your last turn" "4h gap includes elapsed line"

# --- Test 3: 5min gap suppressed (under threshold, same date)
reset_state
NOW=$(date +%s)
FIVE_MIN_AGO=$((NOW - 5 * 60))
TODAY=$(date +%Y-%m-%d)
echo "{\"last_epoch\":$FIVE_MIN_AGO,\"last_date\":\"$TODAY\",\"last_iso\":\"x\"}" > "$TEST_DIR/state/last.json"
OUT=$(echo '{"prompt":"hi"}' | "$HOOK")
assert_empty "$OUT" "5min gap suppressed"

# --- Test 4: Date roll fires even with small gap
reset_state
NOW=$(date +%s)
TEN_MIN_AGO=$((NOW - 10 * 60))
YESTERDAY=$(yesterday_date)
echo "{\"last_epoch\":$TEN_MIN_AGO,\"last_date\":\"$YESTERDAY\",\"last_iso\":\"x\"}" > "$TEST_DIR/state/last.json"
OUT=$(echo '{"prompt":"hi"}' | "$HOOK")
assert_contains "$OUT" "system-reminder" "date roll fires with small gap"
assert_contains "$OUT" "Date has changed" "date roll includes date-changed line"

# --- Test 5: Kill switch suppresses
reset_state
OUT=$(echo '{"prompt":"hi"}' | CLAUDE_AGENT_CLOCK=0 "$HOOK")
assert_empty "$OUT" "kill switch suppresses"

# --- Test 6: Stash gets written after a fire
reset_state
echo '{"prompt":"hi"}' | "$HOOK" >/dev/null
if [ -f "$TEST_DIR/state/last.json" ]; then
    echo "PASS: stash file is written after fire"
    PASS=$((PASS + 1))
else
    echo "FAIL: stash file missing after fire"
    FAIL=$((FAIL + 1))
fi

# --- Test 7: Log line written on fire
reset_state
echo '{"prompt":"hi"}' | "$HOOK" >/dev/null
if grep -q "fired" "$TEST_DIR/log" 2>/dev/null; then
    echo "PASS: log line written on fire"
    PASS=$((PASS + 1))
else
    echo "FAIL: no log line found after fire"
    FAIL=$((FAIL + 1))
fi

# --- Test 8: Log line written on suppression too
reset_state
NOW=$(date +%s)
FIVE_MIN_AGO=$((NOW - 5 * 60))
TODAY=$(date +%Y-%m-%d)
echo "{\"last_epoch\":$FIVE_MIN_AGO,\"last_date\":\"$TODAY\",\"last_iso\":\"x\"}" > "$TEST_DIR/state/last.json"
echo '{"prompt":"hi"}' | "$HOOK" >/dev/null
if grep -q "suppressed" "$TEST_DIR/log" 2>/dev/null; then
    echo "PASS: log line written on suppression"
    PASS=$((PASS + 1))
else
    echo "FAIL: no suppression log line found"
    FAIL=$((FAIL + 1))
fi

echo
echo "Results: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
