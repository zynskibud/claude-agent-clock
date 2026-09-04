# claude-agent-clock

> Time-tick injection for [Claude Code](https://code.claude.com/) and the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview). Stops long-running agent sessions from going time-blind.

---

## The problem

Long-running Claude sessions are time-blind. Once a session is started, the only timestamps the model ever sees are whatever was anchored in the system prompt at session start. There is no built-in mechanism for it to learn that:

- The current turn is happening **3 hours after** the last one (the user walked away)
- The session has crossed **midnight** and the date has rolled
- A **deadline** the user mentioned ("ship by 5pm Friday") is now in the past

This is observable in any Claude Code session that crosses a day boundary — the model will confidently reason about "today" using yesterday's anchored date.

---

## Hey Anthropic — this is a bandaid

This repo exists because Claude Code (and any agent built on the Agent SDK, since they spawn the same closed binary) has no built-in re-anchoring of the wall clock across turns. After ~12+ hours of session uptime, the model is reasoning with a stale date.

The "real" fix lives **inside the Claude Code binary** — in whatever code constructs the system prompt or runs the agent loop. Both `claude-agent-sdk-typescript` and `claude-agent-sdk-python` are wrapper packages around the same closed binary (the TS SDK lists 8 platform-specific binary `optionalDependencies`; the Python SDK README states the binary is bundled), so neither wrapper repo is the right place for the fix either.

**Probably a low-hanging-fruit change for whoever owns the agent loop:** on each new turn, re-stamp the system context with the current ISO timestamp and local date. That's effectively what this hook does, externally, with the documented `UserPromptSubmit` → `additionalContext` seam.

If shipping this natively isn't the right call, shipping it as a default-on hook in Claude Code's settings would also work. Either way, until then, this repo is the workaround.

— Issue tracker: file at https://github.com/anthropics/claude-code/issues (link to be added once the upstream issue is open).

---

## Using Claude Code? Fix it in 60 seconds

Clone this repo, then add this block to `~/.claude/settings.json` (or `~/.claude/settings.local.json` if you don't want it syncing across machines yet):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "$HOME/repos/claude-agent-clock/hook/time-tick.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

That's it. The next Claude Code session you open gets time context injected as a `<system-reminder>` whenever:
- The gap since your last turn exceeds 30 minutes (configurable via `CLAUDE_AGENT_CLOCK_MIN_GAP_MINUTES`)
- The local date has rolled since the last turn
- An optional deadline (`CLAUDE_AGENT_CLOCK_DEADLINE`, ISO 8601) has been crossed

State lives at `~/.local/state/claude-agent-clock/last.json` (or `$XDG_STATE_HOME/...`). Fires and suppressions are logged to `~/.claude/logs/agent-clock.log`. Kill switch: `CLAUDE_AGENT_CLOCK=0`.

Run the local tests to verify the hook on your machine:

```bash
./hook/test.sh
```

---

## Building on the Agent SDK?

Same logic, packaged as a `HookCallback` factory you drop into your `query()` options.

```bash
npm install claude-agent-clock
```

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";
import { clockHook } from "claude-agent-clock";

for await (const message of query({
  prompt: "...",
  options: {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            clockHook({
              minGapMinutes: 30,
              deadline: new Date("2026-04-26T17:00:00-04:00"), // optional
              stashFile: "./.agent-clock-state.json",          // optional, persists across runs
            }),
          ],
        },
      ],
    },
  },
})) {
  console.log(message);
}
```

API:

```ts
clockHook(opts?: {
  minGapMinutes?: number;     // default 30
  deadline?: Date;            // optional, fires once when crossed
  stashFile?: string;         // optional, persists state across processes
  log?: (msg: string) => void;
  now?: () => Date;           // override clock for testing
}): HookCallback
```

The hook returns the standard SDK shape on fire:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "<system-reminder>\nCurrent time: 2026-04-25T13:42:08-04:00\nTime since your last turn: 240 minutes\nDate has changed: 2026-04-24 -> 2026-04-25\n</system-reminder>"
  }
}
```

…and `{}` (no injection) when the trigger thresholds aren't met.

Run the demo to see what the hook emits across a simulated session:

```bash
cd packages/ts && npm install && npm run example
```

---

## How it works

A `UserPromptSubmit` hook fires **before each user-prompt turn**. The hook inspects:

1. **Gap since last fire** — if `now - last_injected > minGapMinutes`, fire.
2. **Date rolled** — if today's local date != last fire's date, fire.
3. **Deadline crossed** — if a deadline was configured and `now >= deadline`, fire (once per deadline).

When any trigger fires, the hook emits a `<system-reminder>` block via the documented `additionalContext` field. The block lands in the model's context for that turn — same primitive Anthropic uses internally for things like context-size warnings.

**Trigger logic is event-based, not interval-based.** Tick-tocking every N minutes during active work would be context noise the model would learn to ignore. Event-driven keeps signal high: only fire when something actually happened.

---

## Why this matters as a pattern

Time-tick injection is a generalizable agent-design pattern, not a Claude-specific thing. Any agent framework that:

- Runs sessions long enough to cross meaningful time boundaries (hours, days)
- Has a turn loop the host application can inject into

…benefits from this pattern. Other adjacent "ambient context" injections worth thinking about:

- **Deadline ticker** — countdown to a known target time
- **Rate-limit / budget reminders** — "you've used 47% of the API budget for this run"
- **External event echoes** — "a webhook fired 8 minutes ago: [event]"

The principle: **the model can only reason about state it can observe in its context.** If the host knows something time-sensitive that the model needs to track across turns, the host should be the one to plumb it in — the model can't conjure it from nothing.

---

## Repo layout

```
hook/                       Claude Code bash hook (POSIX bash + python3 inline)
  time-tick.sh              The hook itself
  test.sh                   Local test runner
  settings.snippet.json     Paste-in for ~/.claude/settings.json

packages/ts/                npm package: claude-agent-clock
  src/index.ts              clockHook factory
  test/clockHook.test.ts    vitest suite
  examples/before-after.ts  Runnable demo
```

---

## License

MIT — see [LICENSE](./LICENSE).
