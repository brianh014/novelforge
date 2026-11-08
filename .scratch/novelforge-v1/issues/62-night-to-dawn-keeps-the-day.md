# 62: Night to dawn keeps the same day

**What to find out:** Why didn't `set_story_time` move the day on when the story went through the night into dawn?

**Status:** needs-triage

**Found in:** the Rightous review (Save `9e6413ef-…`)

## What happened

Aldric arrives in the afternoon, climbs the ridge that night, and rides out at dawn (#130 to #140). `storyTime` at #142 is still `day 1`, "14th of Rainmoot, 612 CW", "dawn". It should be day 2, the 15th.

## Where to look

- The `storyTime` rule in `assemblePrompt` (`src/prompt-assembler.ts`). `days_passed` is described as "how many days the narration moved past, usually 0", so passing midnight into a new morning may not read as a day.
- Go through the Snapshots from #110 to #134 to find the Turn where time reached dawn, and see which `set_story_time` it sent.
