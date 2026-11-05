# 39: Gallery and Redraw

**What to build:** A player can see every image in a Gallery, read the Image Prompt behind each one, and Redraw it from the same or an edited prompt. The same dialog works on the Cover and the PC's portrait during world creation.

**Status:** done

- [x] New images keep their Image Prompt, and older ones show that theirs wasn't kept
- [x] A Gallery tab shows the Cover, the PC, known NPCs and Scene Images, in that order
- [x] Clicking a Gallery image opens it larger with its prompt, Redraw and Close
- [x] Redraw uses the Save's Art Style, the current model and Resolution, and the original shape, negative prompt and kinds of reference images
- [x] A finished Redraw replaces the image everywhere and changes nothing else in the story
- [x] A failed Redraw keeps the old image, says why in the dialog, and marks the thumbnail
- [x] Redraws wait in the Save's queue, are never dropped for a newer Scene Image, and stop if a Revert or replaced Turn removes their image
- [x] Redraw is disabled while drawing, with an empty prompt, or with images off
- [x] The Cover on the World Overview, and the Cover and PC portrait on the Ready page, open the same dialog
- [x] A Cover that failed to draw shows its prompt on the World Overview so it can be retried
- [x] Accept during a Cover Redraw carries the result into the Save, or the old Cover if it fails
- [x] Checked in a real browser with a real local model

## Comments

- Decisions came from a grilling session on 2026-11-04. `GLOSSARY.md` holds Image Prompt, Redraw and Gallery.
- **User decision:** the old rule that what the image model was told never reaches the player is dropped. The Narrator's `visual_description` is kept clean only by its prompt, and a `shortcut:` comment records this.
- **User decision:** a finished Redraw replaces the image at once, with no undo or history.
- **User decision:** Regenerate on the World Overview still rebuilds the whole world, and discards an edited Cover prompt.
- **User decision:** replacing a Turn draws a fresh Scene Image and loses any Redraw of the old one. Duplicates and exports include Image Prompts.
- Checked in headless Chrome on 2026-11-04 with an isolated app, a fake text server and real images from local `flux-2-klein-9b` at 480p: Cover Redraw, Accept during a Redraw, a failed first Cover and its retry, PC portrait and Scene Image Redraws, a failure with the dialog shut, images off, and phone width. An older real Save, on an isolated copy, opened with 8 images and blank prompts, and no image was drawn for it.
- Not run for real: a Redraw through OpenRouter, as it costs money. NPC portrait Redraws and a Revert during a Redraw are covered by tests only.
- After Accept during a Cover Redraw, the Save holds no Cover until the Redraw ends, so the Ready page shows none until a reload. The grilling session said it would show the old Cover.
- **User decision (2026-11-04):** the Gallery moved out of the Journal into its own tab, as the Journal had too much going on.
