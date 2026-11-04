# 25: Titled covers

**What to build:** A world gets a spoiler-free title, and the Cover has that title lettered into the picture, so that it looks like a real book.

**Blocked by:** none

**Status:** ready-for-agent

## Criteria

- [x] `generateWorld` returns a title of at most 80 characters, and a reply without one is retried
- [x] The title changes on Regenerate, as it comes from the same reply as the world
- [x] The cover prompt carries the title as data and asks for no other lettering
- [x] The cover has its own negative prompt, and Scene Images and portraits keep `AVOID`
- [ ] A real cover shows the title spelled correctly and placed well
- [x] Load Game shows the title beside the cover, with the PC under it (L1). Checked in a real browser at desktop and 360px, including a Save with no title

## Comments

Prompt work done with fakes only: 587 tests pass and typecheck is clean. No real cover has been drawn with a title yet, so how well the image model spells is still unknown.

Ticket 26 moved the title to a player choice, so `generateWorld` no longer returns one and Regenerate keeps it. The cover prompt is unchanged, and the real-cover criterion above stays open.
