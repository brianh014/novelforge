# 55: Gallery sections, and deleting scene images

**What to build:** The Gallery is split into sections, newest first, and the player can delete images from its Scenes section, now that they can easily add them. The Cover and all portraits can't be deleted.

**Status:** ready-for-human

**Blocked by:** 53, so requested images are covered

- [x] The Gallery has three sections: Cover, Characters and Scenes
- [x] Characters shows the PC first, then NPCs
- [x] Scenes holds Scene Images and requested images together
- [x] NPCs and Scenes sort newest to oldest, by the Message an image belongs to
- [x] A Redraw doesn't move an image
- [x] A section with nothing in it doesn't show
- [x] Each image in Scenes has a delete button, and Cover and Characters have none
- [x] The server refuses to delete the Cover or a portrait, whatever the client sends
- [x] Delete asks for confirmation first, as deleting a Save does
- [x] A deleted image leaves the Gallery, the story and the Full Log, and only the image goes: its Message and Snapshot stay
- [x] An image being Redrawn can't be deleted
- [ ] The left page and Stage box fall back to the Scene Image before the deleted one, and show none if there isn't one
- [x] The next Scene Image in that location uses an earlier one as its reference, or none
- [x] `novelforge-spec.md` and `GLOSSARY.md` say how this works now

## Comments

- **User request (2026-11-05):** "Oh and now since the player can easily add new images, we need a delete button in the gallery. Don't allow deleting cover art or PC photo".
- **User request (2026-11-05):** "Don't allow deleting npc portraits too. And break up the gallery into sections. Cover and PC, NPCs, Scenes (which includes the players one off images). Sort newest to oldest".
- **User request (2026-11-05):** "Actually just do characters section with PC always being first image".
- Agent's defaults, not yet confirmed:
  - A Revert doesn't bring a deleted image back.
  - The Cover keeps a section of its own at the top, as Characters has no place for it.
- Build notes:
  - `REDRAWABLE` and `visibleImages` already name each kind of image and what the player may see, so the route can follow `/saves/:id/gallery/redraw`.
  - The Gallery's `kind` is enough to section it on the client. The PC's portrait is the one with `npc === null`, which the Gallery response doesn't include yet, so it needs adding. Its `label` is the PC's name, which an NPC could share.
  - `isRedrawing` answers the Redraw check.
  - `DeleteDialog` in `src/web/load.tsx` is written for Saves, so it needs generalising or moving.
- **Built (2026-11-05):** `POST /saves/:id/gallery/delete` takes `kind` and `ref`, and `saves.gallery` now returns Gallery order. No Save version change.
- Decisions taken:
  - The Gallery's order is set on the server, with the PC first, so the client only splits it by `kind`. The build note's `npc` field wasn't needed, so the response didn't grow.
  - On one Message, Requested Images come newest first and its Scene Image last, as it's drawn first. The sort uses only the Message, `kind` and the id, so a Redraw moves nothing. Portraits of one Message sort the same way, newest id first.
  - The Cover's and portraits' refusal is an allowlist on the route, `scene` and `requested`, so any other kind gets a 400 before anything is looked up.
  - Deleting isn't refused during a Turn, and images being off doesn't stop it, as neither touches a stored image.
  - A Scene Image or Requested Image reads its previous-scene reference when it starts to draw. One still queued uses an earlier image. One already drawing was sent the deleted image, and it finishes and stays, as stopping it would lose a paid image.
  - A Requested Image still in the queue has no row to delete, so it isn't listed, and it lands normally if its Message's Scene Image goes.
  - The reference rule didn't change: the latest Scene Image left before the new one counts if it's in the same location. So in a run of tavern, street, deleted tavern, the next tavern image has no reference and doesn't reach back past the street. Reaching back would change how images are drawn with no delete involved.
  - No path draws a Scene again by looking for a Message with no image, and a Redraw of a deleted image gets a 404, so a deleted image never comes back.
  - The confirmation names "this image", not its label, as a label can run to 300 characters. Its wording says a Revert won't bring it back.
  - `DeleteDialog` moved to `src/web/menu.tsx` and takes the warning and the action as props.
- Left unticked: the left page and Stage box. It falls back as asked, and the Stage box shows none, but with no Scene Image left the left page shows the Cover where the Save has one, as it does before a story's first Scene Image. A Save keeps no record of a deletion, so nothing can tell those two apart. Without a Cover it shows none. The user should say whether the Cover is what they want there.
- Verified: `test/gallery-delete.test.ts`, 14 tests, and a real Chrome run on port 4602 with a scratch Saves folder, no key, a fake text server and `test/fake-comfyui.ts`, at desktop and phone sizes. That run covered the three sections, a Save with no Cover, an empty Gallery, Cancel and confirm, the disabled button during a Redraw, a Redraw starting while the dialog is open, Escape while a delete is on its way, and a delete of the reference during a real running Turn. Every image link answered 200 when checked after deletes: on the Gallery and story most times, on the Stage box twice and on the Journal once. No response to the page held hidden text, and the log held no story. Deleting a Save still works through the moved dialog.
- A review found one bug, now fixed: Escape during a delete reloaded the Gallery before the delete finished, which left a broken tile.
- Not checked:
  - iOS Safari, a real image model, or a real Save.
  - **Two devices at once:** a story page already open on another device keeps a deleted image until its next image check, usually the next Turn, and a folded row not yet opened there would show a broken picture until then. Changing screens refreshes it.
  - The Stage box going back through older beats after a delete. The code picks the latest image at or before that beat, and only the latest beat was seen.
- `failures` in `src/image-pipeline.ts` keeps a failed Redraw's text after its image is deleted, until a restart. Nothing reads it, as ids aren't reused.
