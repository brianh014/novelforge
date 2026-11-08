# 64: A typed 8 Steps changes Qwen Turbo's schedule

**What to build:** Qwen Image 2.1 draws on Turbo's own eight-step sigmas only while Steps is blank. Any typed number, the default 8 included, switches to ComfyUI's generic "simple" scheduler, so typing the default quietly changes the picture.

**Status:** resolved

**Found:** 2026-11-08, while drawing the Art Style examples with Steps set to 8.

## What was seen

- `qwen21Image` in `src/graph-builder.ts` picks `ManualSigmas` only when `comfySteps === null`, otherwise `BasicScheduler`.
- Side by side on the official Turbo, typed 8 and blank looked close, so the harm is small, but nothing in Settings says the two differ.

## Likely fix

- Use the Turbo sigmas whenever Qwen draws at 8 steps, blank or typed, and the scheduler for any other number. One line and a test in `test/graph-builder.test.ts`.

## Comments

2026-11-08: Fixed by the "Use model defaults" toggle. Qwen draws on the Turbo sigmas whenever its own scheduler meets 8 steps, typed or default, and on simple for any other count.
