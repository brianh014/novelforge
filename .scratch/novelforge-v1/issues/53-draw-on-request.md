# 53: Draw on request from the story

**What to build:** An image button in the story takes the player's words and uses the recent story to draw what they mean. "The woman in the corner" draws the woman who was recently in the story.

**Status:** ready-for-human

**Blocked by:** none

- [x] A button by the story's input opens a short box for the player's words, and asks for at least some words
- [x] One press draws, with no step to check the prompt first
- [ ] A text call turns the words and the recent story into an Image Prompt, following the rules in ticket 50
- [x] That call gets the recent story and the people in the Scene with their looks, and never the World Bible or Plot Threads
- [x] The player's words are data to that call, never instructions
- [x] A marked person with a portrait uses it as a reference, as a Scene Image does
- [x] The image joins the latest Message and leaves its Scene Image alone, and a Message can have several
- [x] It shows in the story, the Gallery and the Full Log, and can be Redrawn
- [x] A Revert past its Message removes it
- [x] It isn't a Turn: no Message, no Snapshot, and the Narrator never hears about it
- [x] The button is unavailable with images off, and while a Turn runs
- [x] The player sees a clear failure if the text call or the draw fails
- [x] Older Saves open and gain the new table, and export, import and duplicate carry it
- [x] `novelforge-spec.md` and `GLOSSARY.md` say how this works now

## Comments

- **User request (2026-11-05):** "An image gen button in chat that takes input from the user and uses recent context of the story. Like \"the woman in the corner\" would create an image of a woman that was recently in the story."
- **User answers (2026-11-05):** it's an extra picture rather than a replacement, and it draws right away, with Redraw for changing the prompt afterwards.
- Agent's defaults, not yet confirmed:
  - The left page and Stage box keep showing the Scene Image, so a requested image shows as a row in the story. Check this in play, as the player may expect it on the left page.
  - Someone made up on the spot, like an unnamed woman, gets no portrait or NPC entry.
- Build notes:
  - This is the one image prompt written outside a Turn. Ticket 50's "no separate text call" was about Turn images and still stands for those.
  - `scene_images` keys on `message_id`, and `REDRAWABLE`, `SAVE_TABLES`, Revert's deletes and `visibleImages` all need the new table. The Save's version goes up, so an older build refuses it.
  - A Redraw needs the stored `pictured`, as Scene Images keep it. Redraw of `kind: "scene"` reads the location from the Snapshot, which a requested image can do through its Message.
  - The prompt shows in the Gallery, and the people's looks go into it, so a person the PC doesn't know yet can show there. Leave them out of the call unless they're in the Scene, as the Narrator's own prompts do.
- **Built (2026-11-05):** the term is Requested Image, now in `GLOSSARY.md`. Saves move to version 13 for the new `requested_images` table, so an older build refuses them.
- Decisions taken:
  - The press answers at once, and the text call and the draw run as one job in the Save's image queue, so the player can change screens or play on. The story is read at the press, so the picture is of the moment asked about, and it stays on that Message. It waits behind any running image and is never dropped.
  - A failure is held for the player like a missed Turn failure: told once, even after leaving and coming back, with their words back in the box. If two fail before they look, only the last is told.
  - The text call also gets the World Brief and the Scene's location, both of which the player can read, because ticket 50's rules ask for the place and its era. The ticket named only the story and the people.
  - A mark for someone outside the Scene gets the prompt's own phrase, with no stored looks and no portrait. Without this, a name in the recent story could put their looks in the Gallery.
  - A replaced response takes its Requested Images with it, as it does its Scene Image, because they were drawn from the story it replaces. The ticket didn't say.
  - The Scene Image at or before the Message is the previous-scene reference when the location matches, and Redraw does the same.
  - The player's words are the row's and the Gallery's label, up to 300 characters.
  - A latest Message can be a player Message after a Revert, so a Requested Image can join one, and import allows that. Before the story opens the button is unavailable, as there's no Message to join.
  - Rows start folded, matching the user's earlier choice of folded rows. A status line says "Drawing 1 picture…" until it lands.
  - The Revert dialog now says "images", as it counts both kinds.
- Left unticked: the text call box. The call, its rules and its data are tested, and the wording was checked against the Klein guidance, but no real text model has run it, as that may cost money. Whether a real model writes good prompts from this, and finds "the woman in the corner", needs the user in play, as ticket 50 did.
- Verified: `test/draw-on-request.test.ts`, plus six import refusals in `test/load-game.test.ts`, and a real Chrome run on port 4602 with a scratch Saves folder, a fake text server and `test/fake-comfyui.ts`, at desktop and phone sizes, in all four Chat styles. In that run no response to the page held hidden text, and the log held no story, words or prompt.
- Not checked:
  - The user's default that the left page keeps the Scene Image, which the ticket asks to check in play.
  - A real image model, iOS Safari, or a real Save opening on version 13.
  - A long label makes a tall Gallery tile. 300 characters was seen and is harmless, so it isn't clamped.
- Limits to know:
  - **Empty casts:** only the Scene's cast get their looks and portrait. Ticket 50 found the cast empty for 11 of 12 Scene Images on a real Save, so often a known NPC named in the story won't be in the call. They'd be drawn from the story's words, with no portrait. Adding known NPCs named in the recent story is a small change, and this ticket's wording ruled it out, so it's the user's call.
  - **Provider errors:** a provider's detail stays out of the log on this path, apart from the shared "Schema mode rejected" line in `src/text-provider.ts`, which a Turn logs the same way, up to 300 characters.
  - **Existing console warning:** the Journal logs a `<dialog>` inside `<p>` warning for the PC's portrait. This was there before and isn't from this ticket.
