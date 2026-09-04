import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clockHook } from "../src/index.js";

const baseTime = new Date("2026-04-25T14:00:00Z");
const noCtx = { signal: new AbortController().signal };

describe("clockHook", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "clock-test-"));
    delete process.env.CLAUDE_AGENT_CLOCK;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("fires on first call", async () => {
    const hook = clockHook({ now: () => baseTime });
    const result = await hook(undefined, undefined, noCtx);
    expect(result.hookSpecificOutput?.hookEventName).toBe("UserPromptSubmit");
    expect(result.hookSpecificOutput?.additionalContext).toContain("<system-reminder>");
    expect(result.hookSpecificOutput?.additionalContext).toContain("Current time:");
  });

  it("suppresses when within gap threshold", async () => {
    let now = baseTime;
    const hook = clockHook({ minGapMinutes: 30, now: () => now });

    const r1 = await hook(undefined, undefined, noCtx);
    expect(r1.hookSpecificOutput).toBeDefined();

    now = new Date(baseTime.getTime() + 5 * 60 * 1000);
    const r2 = await hook(undefined, undefined, noCtx);
    expect(r2).toEqual({});
  });

  it("fires when gap exceeds threshold", async () => {
    let now = baseTime;
    const hook = clockHook({ minGapMinutes: 30, now: () => now });

    await hook(undefined, undefined, noCtx);

    now = new Date(baseTime.getTime() + 4 * 60 * 60 * 1000);
    const r2 = await hook(undefined, undefined, noCtx);
    expect(r2.hookSpecificOutput?.additionalContext).toContain("Time since your last turn: 240");
  });

  it("fires on date roll even with small gap", async () => {
    let now = new Date("2026-04-25T23:55:00-04:00");
    const hook = clockHook({ minGapMinutes: 30, now: () => now });

    await hook(undefined, undefined, noCtx);

    now = new Date("2026-04-26T00:10:00-04:00");
    const r2 = await hook(undefined, undefined, noCtx);
    expect(r2.hookSpecificOutput?.additionalContext).toContain("Date has changed");
    expect(r2.hookSpecificOutput?.additionalContext).toContain("2026-04-25");
    expect(r2.hookSpecificOutput?.additionalContext).toContain("2026-04-26");
  });

  it("fires once when deadline crossed and suppresses subsequent crossings", async () => {
    const deadline = new Date("2026-04-25T17:00:00Z");
    let now = new Date("2026-04-25T14:00:00Z");
    const hook = clockHook({ minGapMinutes: 30, deadline, now: () => now });

    const before = await hook(undefined, undefined, noCtx);
    expect(before.hookSpecificOutput?.additionalContext).not.toContain("Deadline crossed");

    // Cross the deadline (also > 30min gap, so will fire on gap too)
    now = new Date("2026-04-25T17:05:00Z");
    const crossed = await hook(undefined, undefined, noCtx);
    expect(crossed.hookSpecificOutput?.additionalContext).toContain("Deadline crossed");

    // 5 min after crossing — within gap, deadline already fired — should suppress
    now = new Date("2026-04-25T17:10:00Z");
    const after = await hook(undefined, undefined, noCtx);
    expect(after).toEqual({});
  });

  it("kill switch via CLAUDE_AGENT_CLOCK=0 suppresses output", async () => {
    process.env.CLAUDE_AGENT_CLOCK = "0";
    const hook = clockHook({ now: () => baseTime });
    const result = await hook(undefined, undefined, noCtx);
    expect(result).toEqual({});
  });

  it("persists state across instances via stashFile", async () => {
    const stashFile = join(tmpDir, "stash.json");

    const h1 = clockHook({ minGapMinutes: 30, stashFile, now: () => baseTime });
    const r1 = await h1(undefined, undefined, noCtx);
    expect(r1.hookSpecificOutput).toBeDefined();

    // New instance, only 5 min later — should suppress because stash was loaded
    const h2 = clockHook({
      minGapMinutes: 30,
      stashFile,
      now: () => new Date(baseTime.getTime() + 5 * 60 * 1000),
    });
    const r2 = await h2(undefined, undefined, noCtx);
    expect(r2).toEqual({});
  });

  it("logs both fires and suppressions when log is provided", async () => {
    const lines: string[] = [];
    let now = baseTime;
    const hook = clockHook({ minGapMinutes: 30, now: () => now, log: (m) => lines.push(m) });

    await hook(undefined, undefined, noCtx);
    expect(lines.some((l) => l.includes("fired"))).toBe(true);

    now = new Date(baseTime.getTime() + 5 * 60 * 1000);
    await hook(undefined, undefined, noCtx);
    expect(lines.some((l) => l.includes("suppressed"))).toBe(true);
  });
});
