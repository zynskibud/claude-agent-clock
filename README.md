# claude-agent-clock

> Time-tick injection for the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk/overview). Give long-running agents wall-clock awareness across turns.

**Status:** WIP. Reference implementation of an agent-design pattern.

---

## The problem

Long-running agent sessions are time-blind. Once the model is invoked with a prompt, the only timestamps it ever sees are whatever was in the system prompt at the start. There is no built-in mechanism for it to know that:

- The current turn is happening **3 hours after** the last one (because the user walked away)
- The session has crossed **midnight** and the date has rolled
- A **deadline** the user mentioned ("ship by 5pm Friday") is now in the past
- A long-running task it kicked off is **N minutes overdue**

This is observable in any Claude Code session that crosses a day boundary. The model will confidently reason about "today" using the date it was anchored on — yesterday.

## What this does

A thin wrapper around the official Claude Agent SDK that, on each turn:

1. Reads the wall clock
2. If `now - lastInjected > interval`, prepends a `<system-reminder>` message to the next turn:
   ```
   <system-reminder>
   Current time: 2026-04-25T13:42:08-04:00
   Session elapsed: 4h 17m
   </system-reminder>
   ```
3. Optionally injects a known deadline ("ship-by: 2026-04-26T17:00 EDT — 1d 3h remaining")

Default interval: 10 minutes. Configurable.

That's it. ~100 lines.

## Install

> Pre-publish placeholder.

```bash
# Node / TypeScript
npm install claude-agent-clock

# Python
pip install claude-agent-clock
```

## Usage

```ts
import { ClaudeSDKClient } from "@anthropic-ai/claude-agent-sdk";
import { withClock } from "claude-agent-clock";

const agent = withClock(
  new ClaudeSDKClient({ /* normal options */ }),
  {
    intervalMinutes: 10,
    deadline: new Date("2026-04-26T17:00:00-04:00"), // optional
  }
);

await agent.query("..."); // every turn now has time context
```

## How it works

The Agent SDK exposes hooks at the turn boundary. `withClock` wraps the client so that:

1. **Before each model turn**, a check runs: how long since we last injected a time tick?
2. **If past the threshold**, a `<system-reminder>` message is prepended to the model's input for that turn.
3. **State is per-session**: `lastInjected` resets on a new client instance, persists across turns within one.

No fork of the SDK. No reverse-engineering of internals. Just public hooks composed into a wrapper.

## Why this matters as a pattern

Time-tick injection is a generalizable agent-design pattern, not a Claude-specific thing. Any agent framework that:

- Runs sessions long enough to cross meaningful time boundaries (hours, days)
- Has a turn loop the host application can inject into

...benefits from this pattern. Other examples of similar "ambient context" injections worth considering:

- **Deadline ticker** — countdown to a known target time
- **Rate-limit / budget reminders** — "you've used 47% of the API budget for this run"
- **External event echoes** — "a webhook fired 8 minutes ago: [event]"

The principle: **the model can only reason about state it can observe in its context.** If the host knows something time-sensitive that the model needs to track across turns, the host should be the one to plumb it in — the model can't conjure it from nothing.

## Inspiration

This came out of noticing that Claude Code sessions, after running for ~12+ hours, will still happily reason as if the date hadn't changed. The fix is mechanical and belongs in the framework — but you can demonstrate it cleanly in the public Agent SDK.

## License

MIT — see [LICENSE](./LICENSE).

---

## TODO before publish

- [ ] Pick language (TS or Python — probably TS for first pass, Python second)
- [ ] Implement `withClock` against current Agent SDK turn hooks
- [ ] Add a runnable example that shows before/after with a real long session
- [ ] Tests
- [ ] `npm publish` / `pip publish`
- [ ] Tweet thread + Show HN
- [ ] File issue at `anthropics/claude-code` linking this as the reference implementation
