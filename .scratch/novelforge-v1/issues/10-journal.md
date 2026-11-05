# 10: Journal

**What to build:** A player can open the Journal to read the recent summary, the Full Log and known NPCs, seeing only what the PC knows.

**Blocked by:** 09

**Status:** done

- [x] The Journal shows the recent summary
- [x] The Full Log shows the story exactly as written, with images once they exist
- [x] The NPC section lists only NPCs the PC knows about
- [x] All Journal content comes from PC-known data
- [x] Marker tests prove the Journal never reveals secrets or Checks
- [x] After a Revert, the Journal matches the restored Snapshot

## Comments

- No images exist yet, so the Full Log shows text only. Ticket 17 adds Scene Images to it, and ticket 18 adds portraits to the NPC section.
- The route allowlists what it sends, but the summary is not in the PC-known section: it is Narrator free text, as are the known facts. Only the prompt keeps secrets and Checks out of them, so a model that disobeys could still show one. The marker test proves the route, not the model.
- **User decision (2026-11-04):** keep the summary and known facts in the Journal, with the prompt as their only guard. Check this on the real-model run.
- **User sign-off (2026-11-05):** every criterion was already ticked, so the status was only out of date.
