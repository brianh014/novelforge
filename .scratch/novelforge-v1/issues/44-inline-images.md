# 44: Images folded into the story on phones

**What to build:** On a phone, where pictures are out of sight, each one sits folded in the story where it happened, so a new one can be noticed and opened.

**Status:** done

- [x] A Scene Image shows as a one-line row under the response it came with
- [x] An NPC's portrait does too, under their first appearance
- [x] Rows start folded, and open in place
- [x] A row landing after a response doesn't move the player's words
- [x] Nothing shows on desktop, unless the left page is folded (ticket 49)

## Comments

- **User decision (2026-11-04):** with images out of sight on a phone there was no way to know a new one had been drawn. Dots on the picture toggle and the Gallery tab were tried first, and the user preferred images folded inline.
- The PC's portrait gets no row, as it belongs to no Message.
- Checked in headless Chrome at phone and desktop width, on a copy of a real Save, with a fake text model and real images from local `flux-2-klein-9b`. Rows on older responses, further up the story, were listed but not opened.
