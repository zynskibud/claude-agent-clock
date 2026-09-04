import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ClockHookOptions {
  minGapMinutes?: number;
  deadline?: Date;
  stashFile?: string;
  log?: (message: string) => void;
  now?: () => Date;
}

interface ClockState {
  lastEpoch: number;
  lastDate: string;
  lastDeadlineFired?: string;
}

interface UserPromptSubmitOutput {
  hookSpecificOutput?: {
    hookEventName: "UserPromptSubmit";
    additionalContext: string;
  };
}

export type ClockHookCallback = (
  input: unknown,
  toolUseId: string | undefined,
  context: { signal: AbortSignal },
) => Promise<UserPromptSubmitOutput>;

function loadStash(path: string | undefined): ClockState | null {
  if (!path || !existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    return {
      lastEpoch: typeof raw.last_epoch === "number" ? raw.last_epoch : 0,
      lastDate: typeof raw.last_date === "string" ? raw.last_date : "",
      lastDeadlineFired:
        typeof raw.last_deadline_fired === "string" ? raw.last_deadline_fired : undefined,
    };
  } catch {
    return null;
  }
}

function saveStash(path: string | undefined, state: ClockState): void {
  if (!path) return;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const payload: Record<string, unknown> = {
      last_epoch: state.lastEpoch,
      last_date: state.lastDate,
      last_iso: new Date(state.lastEpoch * 1000).toISOString(),
    };
    if (state.lastDeadlineFired) payload.last_deadline_fired = state.lastDeadlineFired;
    writeFileSync(path, JSON.stringify(payload));
  } catch {
    // best-effort persistence
  }
}

function localDateString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function clockHook(opts: ClockHookOptions = {}): ClockHookCallback {
  const minGapMinutes = opts.minGapMinutes ?? 30;
  const deadline = opts.deadline;
  const deadlineIso = deadline?.toISOString();
  const stashFile = opts.stashFile;
  const log = opts.log ?? (() => {});
  const nowFn = opts.now ?? (() => new Date());

  let state: ClockState = loadStash(stashFile) ?? { lastEpoch: 0, lastDate: "" };

  return async () => {
    if (process.env.CLAUDE_AGENT_CLOCK === "0") return {};

    const now = nowFn();
    const nowEpoch = Math.floor(now.getTime() / 1000);
    const nowIso = now.toISOString();
    const nowDate = localDateString(now);

    const gapSeconds = nowEpoch - state.lastEpoch;
    const gapMinutes = Math.floor(gapSeconds / 60);

    const triggers: string[] = [];
    if (state.lastEpoch === 0 || gapSeconds > minGapMinutes * 60) triggers.push("gap");
    if (state.lastDate && state.lastDate !== nowDate) triggers.push("date-rolled");
    if (
      deadline &&
      deadlineIso &&
      state.lastDeadlineFired !== deadlineIso &&
      now.getTime() >= deadline.getTime()
    ) {
      triggers.push("deadline");
    }

    if (triggers.length === 0) {
      log(`${nowIso} suppressed gap=${gapMinutes}m`);
      return {};
    }

    const lines: string[] = [`Current time: ${nowIso}`];
    if (state.lastEpoch !== 0) lines.push(`Time since your last turn: ${gapMinutes} minutes`);
    if (triggers.includes("date-rolled"))
      lines.push(`Date has changed: ${state.lastDate} -> ${nowDate}`);
    if (triggers.includes("deadline")) lines.push(`Deadline crossed: ${deadlineIso}`);

    const reminder = `<system-reminder>\n${lines.join("\n")}\n</system-reminder>`;

    state = {
      lastEpoch: nowEpoch,
      lastDate: nowDate,
      lastDeadlineFired: triggers.includes("deadline") ? deadlineIso : state.lastDeadlineFired,
    };
    saveStash(stashFile, state);
    log(`${nowIso} fired triggers=${triggers.join(",")} gap=${gapMinutes}m`);

    return {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: reminder,
      },
    };
  };
}
