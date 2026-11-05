# 16: PC creation wizard

**What to build:** A player can create whomever they want as the PC. Their choices are canon, and the world adapts if they conflict with it.

**Blocked by:** 15

**Status:** done

- [x] A player can enter name, background, physical traits, skills, starting inventory and other descriptive fields
- [x] “Pick for me” fills only empty fields
- [x] Starting inventory is sorted into wearing and carrying
- [x] A PC who conflicts with the world is accepted, with a non-blocking warning
- [x] The Narrator updates the World Bible to fit that PC
- [x] The first Turn starts from the Starting Hook, or as a sandbox if there isn't one

## Comments

- `POST /saves` with `worldId` makes two Narrator calls before it creates the Save. The first sorts the inventory and writes the opening status from the player's own words only, so its prompt holds no secrets. The second sees the World and returns `world_update`, or null. The client only ever gets `worldChanged`, so the warning is fixed wording in `play.tsx`.
- The starting inventory is one item per line. The player's list decides what exists, and the Narrator only says which items are worn, ignoring case. A worn item it rewords counts as carried.
- The warning rests on `#/play/<id>/world-changed` and shows until the first Turn. It isn't stored in the Save, so leaving the page before then loses it.
- PC fields other than the name live in the `pc_details` JSON column. `saves.read(id).pc` holds them for portraits in ticket 18. `GET /saves/:id` still sends only the name.
- The first Turn is still a player input and a Narrator response. The Starting Hook or sandbox instruction goes in the prompt until the Narrator has answered once, and the blank page shows the Starting Hook.
- Later Turns still receive the player's original World Brief, so the prompt says the PC and `world_rules` win over it.
- **User sign-off (2026-11-05):** every criterion was already ticked, so the status was only out of date.
