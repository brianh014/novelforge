# 28: One Pick for me on step 1, and Enhance

**What to build:** Step 1 has one Pick for me that fills every empty box, like the PC step. Boxes get an Enhance button that improves what the player wrote, for a player with a general idea.

**Blocked by:** none

**Status:** done

## Criteria

- [x] Step 1 has one Pick for me, worded and placed as on the PC step. It fills only the empty boxes in one call, and is off once they're all filled
- [x] Pick for me leaves out a Starting Hook that's turned off, and retries a Title over 80 characters
- [x] World Brief, Title, Starting Hook and each PC box except the name have Enhance, shown once the box has words in it
- [x] Enhance keeps the player's facts and uses their other choices. On a Title it keeps the 80 character limit
- [x] Undo brings back the player's words, and goes away once they edit the box
- [x] Checked in a real browser at 1366x800 and 390px, with the model calls faked. Server validation checked separately, against a copy with no model set

## Comments

- Raised by the user on 2026-11-04.
- No options report: it reuses the PC step's Pick for me row and the same quiet link, so it isn't a new visual direction.
- Enhance sits on the box's label line, as a control under a box read as belonging to the next one in ticket 27.
- Undo wasn't asked for. Enhance replaces the box's value, so the browser's own undo can't bring the player's words back. It's one step, and a reload clears it.
- The box label "Starting inventory, one item per line" became "Inventory, one item per line", as Undo overlapped it at 390px.
- This replaces the per-box Pick for me and the hint from ticket 27. The Pick for me Title now reads the World Brief and the World Brief reads the Title, which closes the open offer.
- Your theme, Your Art Style and the PC name have no Enhance. No real model has run Pick for me or Enhance yet.
