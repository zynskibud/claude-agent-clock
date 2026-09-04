import { clockHook } from "../src/index.js";

async function main() {
  const noCtx = { signal: new AbortController().signal };
  let now = new Date("2026-04-25T08:00:00-04:00");

  const hook = clockHook({ minGapMinutes: 30, now: () => now });

  console.log("=== Demo: clockHook output across a simulated session ===\n");

  console.log("[08:00] First prompt of the day. Hook fires (initial fire):");
  console.log(JSON.stringify(await hook(undefined, undefined, noCtx), null, 2));
  console.log();

  console.log("[08:01] Immediate follow-up. Suppressed (within 30min gap):");
  now = new Date("2026-04-25T08:01:00-04:00");
  console.log(JSON.stringify(await hook(undefined, undefined, noCtx), null, 2));
  console.log();

  console.log("[12:00] User comes back from lunch (4h gap). Fires:");
  now = new Date("2026-04-25T12:00:00-04:00");
  console.log(JSON.stringify(await hook(undefined, undefined, noCtx), null, 2));
  console.log();

  console.log("[Next morning 09:00] Date has rolled. Fires (gap + date-rolled):");
  now = new Date("2026-04-26T09:00:00-04:00");
  console.log(JSON.stringify(await hook(undefined, undefined, noCtx), null, 2));
}

main();
