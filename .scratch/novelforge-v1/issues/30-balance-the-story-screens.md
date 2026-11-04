# 30: Title on the Story screen, and balance the story screens

**What to build:** The Story screen leads with the story's title, with the PC's name as its subtitle. The Story and Inventory screens are balanced, on the look chosen from the options report.

**Blocked by:** none, the user chose B, Character Card

**Status:** ready-for-agent

## Criteria

- [x] The Story screen shows the title, with the PC's name under it. A Save from before titles shows only its PC. Checked in a real browser on a copy of the user's Save
- [x] The left page is narrower, and holds the Character Card, then a short summary, then up to three recent NPCs with their photos. Checked at 1366x800 in both themes and at 390px, with NPC summaries faked in the page
- [x] Director's Notes are gone from the Story screen and the Narrator's prompt. Ticket 31 rethinks them
- [x] NPCs have a short summary of who they are, written by the Narrator as the PC understands them, on the Story screen and in the Journal
- [ ] A real model writes NPC summaries
- [x] Inventory uses the Index Sheet, like Settings and world creation, with the PC's portrait, name and Condition in the index and both lists in the column. The item box sits in the pinned bar

## Comments

- Raised by the user on 2026-11-04: the left side is still mostly blank.
- Measured at 1366x800 on a copy of the user's Save: the Story's left page is used to about 72% of its height, and on Inventory the pages are about 60% and 29% used. The Journal is already balanced.
- Scene Images must stay whole, not cropped (ticket 23), so a bigger picture needs a wider page.
- Options report: `.scratch/novelforge-v1/story-balance-options.html`. Directions: A Wider Plate, B Character Card, C Open Notebook. Recommended B. Inventory moves both lists to the right page, with a large portrait on the left, in all three. The Journal stays as it is.
- The left page can run past the fold on a laptop, by about 130px on a copy of the user's Save, so it scrolls with the same down arrow as the sheet. Phones show none of the new parts, as the Journal holds them.
- A Save from before NPC summaries has none until the Narrator's next Turn, which the prompt tells it to fill in.
