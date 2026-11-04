# 24: Art Style examples

**What to build:** Step 1 of world creation shows an example image of each Art Style, using the same subject in all 16, so the player can see what they are choosing.

**Blocked by:** none

**Status:** done

## Criteria

- [x] The user chose layout A and static examples. After Muse Image tests with a hilltop traveller, they chose the Settings model (google/gemini-nano-banana-2.1) and a hooded traveller in a wide landscape, run with `scripts/draw-style-examples.ts`
- [x] 3 test images approved before the other images are paid for
- [x] All 16 examples inspected for stray lettering, dice and numbers
- [x] Images shrunk and bundled in the compiled executable, with no new dependency
- [x] "Describe your own art style" still works and shows no example
- [x] Checked in a real browser at desktop and phone widths, on both papers

## Comments

Muse Image tests came back in mixed shapes, so the user moved to google/gemini-nano-banana-2.1. All 16 came back at 1376x768. Inspected them all, with the Cybertech sign and the Blueprint scale bar at full size: no lettering, numbers or dice. Shrunk to 320x180 WebP, 230 KB in total, with headless Chrome, so no new dependency.

Driven in real headless Chrome against an isolated copy: all 16 images load, selecting a style updates its description, the own style box and Generate still work, no sideways scroll at 360px, and both papers look right. 589 tests pass, typecheck is clean and the build compiles.
