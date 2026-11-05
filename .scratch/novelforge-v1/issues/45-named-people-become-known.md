# 45: Everyone a response names becomes a known NPC

**What to build:** Someone named in the story gets a Journal entry and a portrait, whether or not the Narrator remembered the operations for it.

**Status:** ready-for-human

- [x] A person named in `people` but never added joins the state, is known and gets a portrait
- [x] A person already drawn but never made known appears, with no second drawing
- [x] The Narrator sending the same operations as well costs nothing
- [x] A summary and `set_scene` in the same reply can use the new name
- [x] The PC, a repeat, and someone with no looks add no NPC
- [x] A malformed list doesn't cost the Turn
- [x] Older responses in the prompt show who they named, for the Narrator to copy
- [ ] Seen with the real model on the real Save

## Comments

- **Reported by the user (2026-11-04):** Priya and Marcus had no NPC profiles. On a copy of the Save, Marcus was in `npcs` and `visible_cast` with a portrait from Message 47, but not in `pcKnown.npcs`, so the allowlist hid him. Priya was named in 7 responses and appeared nowhere in the state. The prompt already asked for `add_npc` and `add_known_npc`, so this was the model skipping optional operations. Every older reply in the prompt also shows `state_operations: []`, which may teach it to skip them, though the raw operations aren't stored, so that's unproven.
- The fix is a required `people` field in the reply, applied before `state_operations`. The Save heals with no migration, but only for someone named again.
- **Agent's default, not yet confirmed:** anyone named counts, even someone only mentioned, so each new name costs one image. This also makes known anyone named before the PC could know them, as the player has read the name anyway.
- Not run against the real model, which may charge.
