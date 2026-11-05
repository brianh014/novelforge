# 49: Fold the Story's left page on desktop

**What to build:** On a wide screen the Story's left page can fold away, so the screen reads like a phone, with the story in one column and images folded inline.

**Status:** done

- [x] An arrow on the left page folds it to a strip holding the title, the PC's name and Main Menu
- [x] The arrow is a real button with `aria-expanded`, and opens the page again
- [x] Folded, Scene Images and NPC portraits show as rows in the story, which start folded and open in place
- [x] The left page starts open, and the choice is kept per browser, out of the Save
- [x] Folding during a Turn, or after one, doesn't move the player's words
- [x] A phone is unchanged and shows no arrow
- [x] The user has tried it in the real app

## Comments

- **User request (2026-11-05):** "adding a collapse for the left side section on desktop view. Makes it similar to mobile and has the inline photos collapsed".
- Agent's defaults, not yet confirmed: open by default, one choice for all Saves, and the story held to a readable column rather than the full width. Condition, the PC's portrait, So far and Recent people go with the page, as they do on a phone.
- The picture arrow by the title stays phone only, as the rows do its job here.
- This replaces ticket 44's "Nothing shows on desktop": rows now show on a wide screen while the left page is folded.
- Checked in headless Chrome at 1366, 761, 760 and 390 wide, with a fake text server and a fake ComfyUI, in Prose and Stage. Bubbles and Script weren't looked at, nor were real images.
- The user tried it in the real app on port 4600 and approved it (2026-11-05). It showed without a restart.
