# 40: Portraits for known NPCs

**What to build:** Every NPC the PC comes to know gets a portrait, even if they were never in view.

**Status:** done

- [x] An NPC who becomes known gets one portrait without entering the visible cast
- [x] An NPC who is only in the state gets none
- [x] A Revert past the Turn they became known takes the portrait
- [x] Someone already known with no portrait is drawn when the Scene next moves, and a failure isn't retried every Turn
- [ ] Seen on a real Save

## Comments

- **Reported by the user (2026-11-04):** NPC images weren't being generated. On a copy of the Save with an NPC, she was known and had an appearance but had never been in `visible_cast`, as the PC only saw her in a photo. The code followed the spec's rule of no portrait for someone merely mentioned.
- **Agent's default, not yet confirmed:** that spec rule is reversed, so a known NPC gets a portrait. Each costs one image.
- Not changed: `set_scene` drops a name the state doesn't hold yet, so a Narrator that sends it before `add_npc` loses that person from the cast. The raw operations aren't stored, so nothing shows this has happened.
