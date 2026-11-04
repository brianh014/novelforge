# 18: Portraits and NPC references

**What to build:** The PC and NPCs get portraits, which appear in the Journal and help keep them consistent in Scene Images.

**Blocked by:** 10, 16, 17

**Status:** ready-for-agent

- [x] A PC portrait is generated from the character description
- [x] An NPC portrait is generated the first time they appear in a Scene, not when merely mentioned
- [x] Each NPC stores appearance text used in image prompts
- [x] Portraits appear beside NPCs in the Journal
- [x] Portraits of visible NPCs are passed as references where the model supports it
- [x] Portraits count toward the session image count and respect the images toggle

## Comments

- Images off at first appearance: the person is drawn the next time the Scene moves (a change of location or visible cast), once images are on. The same goes for a failed generation, a Save from before portraits, and a PC whose Save was made with images off. They aren't retried on every Turn, as images can cost money, and a companion who never leaves the cast isn't missed for good.
- A portrait belongs to the Message of the NPC's first appearance, even if it was drawn later, so a Revert only takes it when that appearance goes.
- A portrait isn't redrawn when `update_npc` changes an NPC's looks. Later Scene Images use the new appearance text, with the old portrait as a reference.
- A PC with no description at all gets no portrait, as there is nothing to draw from.
- The Journal doesn't poll. A portrait that finishes while it is open shows the next time it opens.
- Portraits went through the real adapter against a local fake image server, like ticket 17. The real-model run is still left for the user.
