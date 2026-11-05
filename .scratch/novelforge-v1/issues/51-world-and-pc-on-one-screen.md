# 51: Create the world and the PC on one screen

**What to build:** World and PC creation become one form, with sections to draw the Cover and the PC's portrait, each with a Redraw button. One press then writes the world and draws whatever the player didn't, and a review shows the result before the story begins.

**Status:** ready-for-human

- [x] One form, in this order: the world's fields, Art Style, Cover, the PC's fields, portrait
- [x] The Cover section draws from the Title, theme and World Brief, and is unavailable until those are filled
- [x] The portrait section draws from the PC's physical traits, and is unavailable until they are filled
- [x] Each drawn image has a Redraw with its editable Image Prompt, like the wizard's Cover today
- [x] Changing a field after drawing leaves that image as it is, for the player to Redraw
- [x] With images off, both sections say so and nothing else on the form changes
- [x] One button writes the world, then draws the Cover from the World Overview and the portrait from the PC, if the player didn't draw them
- [ ] The Narrator writes the world with the PC in view. The PC stays canon, and the world bends to them
- [x] The separate fit call goes, and so does the "the world changed" notice. Working out what the PC wears and their opening status stays
- [x] The review shows the Cover, portrait and World Overview, with Regenerate and Begin
- [x] Regenerate keeps the PC and every image already drawn, and offers Redraw as before
- [x] Begin creates the Save with the images, and goes straight into the story
- [x] Pick for me is one button for the whole form, filling only the empty boxes, with the Starting Hook left alone while it's off
- [x] The button on each box works on an empty box too, writing that field from scratch. This includes the PC's name
- [x] Pick for me and that button see every other field on the form, and still see only the player's own words
- [x] Undo still works on any box the button wrote
- [x] A draft in the tab survives a reload, as it does now
- [x] `novelforge-spec.md` and `GLOSSARY.md` say how this works now

## Comments

- **User request (2026-11-05):** "Combine PC and World creation in one screen, they are tied close together and it makes sense to do it at the same time. Also include sections to go ahead and draw the cover and PC, along with a redraw button. If they didn't get drawn by the user, then they are drawn on world create."
- What the code does today, and what this runs into:
  - The Cover prompt is built from the World Overview (`startCover` in `src/rest-api.ts`), which doesn't exist until the world does. A Cover drawn on the form has to come from the Title, theme and World Brief.
  - `covers` is keyed by world id, and the PC's portrait needs a Save (`drawPortrait` in `src/image-pipeline.ts`). Early drawing needs something to hold images before either exists.
  - The portrait uses what the PC is wearing, which only `fitPc`'s sheet call works out. An early portrait has only the player's words.
  - The PC currently joins an already written world through `fitPc`, which changes the world if the PC conflicts with it.
- **User answers (2026-11-05):**
  - The Overview stays as a review after generating, and Regenerate keeps the PC and anything already drawn.
  - "World is still first fields, then PC after. Auto gen still takes in context of other fields"
  - "Whole form, but enhance button on each field can now also generate that field from scratch"
- **User confirmed (2026-11-05):** "auto gen" includes writing the world, so the Narrator sees the PC while building it and the fit step goes.
- Agent's defaults, not yet confirmed:
  - The "Your story is ready" page goes, as the review now shows the same things. Begin opens the story.
  - An early portrait has only the player's words, as nothing has yet worked out what the PC wears.
  - A Cover drawn on the form isn't drawn again from the World Overview.
- Build notes:
  - Images drawn on the form need a server-side home before a world or a Save exists, in memory like `covers`. The wizard's text is safe in the tab if a restart loses them.
  - A portrait stored at Begin must survive every Revert, as one drawn with the Save does today.
  - `enhance` skips an empty box only because the wizard hides the button (`value.trim()`). Its prompt calls the text a draft to keep, so an empty box needs wording of its own. `ABOUT` has no `name` entry yet.
  - `pickForMe` and `pickPc` become one call over the empty fields.
  - Ticket 52 reuses `FitReply`'s `world_update` shape and `fitPc`'s merge of it, so move those rather than delete them.
- **Agent's notes on the build (2026-11-05):**
  - Unticked for the user: "The Narrator writes the world with the PC in view". The prompt carries the PC and the canon wording (tested), but only fake replies have run. Whether a real model bends the world, such as for a wizard in a strict modern-day world, needs a real world generated. Nothing here spent money on one.
  - Decided: images drawn early live in memory under one id per form, which becomes the world's id. `POST /worlds/draw` starts a draw, `/worlds/:id/portrait` mirrors `/worlds/:id/cover`, and `POST /worlds/:id/begin` makes the Save. `POST /saves` no longer takes a world.
  - Decided: the PC's sheet (what they wear, opening status) runs just before the world, not at Begin. It's the small call, so a failure costs no world, Begin is instant, and the portrait drawn with the world still shows what the PC wears. Regenerate doesn't run it again.
  - Decided: Regenerate tries again for an image that came to nothing (failed, or images were off), from the new World Overview. It keeps an image that is drawn or still drawing, and its edited prompt.
  - Decided: a portrait held at Begin waits in the Save's image queue. A Turn can't draw a second one and a Scene Image doesn't miss it as a reference. If it came to nothing, one is drawn then.
  - Decided: a Redraw on the form or review uses the form's current Art Style, as it can change after a first draw.
  - Decided: `/settings` gains `imagesReady`, the server's own test, so the form can say images are off.
  - Decided: the form is no longer an HTML form, as each image's Redraw is a form inside it. So `required` is gone, the button checks the boxes itself with the same messages, and Enter in a box no longer submits.
  - Added, from review: the review page says when the form has changed since the world was written. Otherwise a PC edit followed by the rail's World Overview link would be dropped at Begin without a word.
  - Moved for ticket 52: `WorldUpdate` and `mergeWorldUpdate` in `src/world-creation.ts`, with a test. Nothing else calls them yet. Its lists still replace the old ones whole.
  - The button shows "Write" on an empty box and "Enhance" on a filled one, in its tooltip and label. The icon is the same.
- **Checked (2026-11-05):** a real headless Chrome on port 4602, with a scratch app folder, no key, and fake text and ComfyUI servers. It covered both flows, a failed draw and retry, images off, a reload, phone width (390px, no sideways scroll), Begin before images landed, and no hidden text in the page, tab storage or app log. Screenshots were viewed. `test/world-and-pc.test.ts` covers the server.
- **Not checked:** real text or image models, so no real Cover from a World Brief or portrait prompt has been seen. iOS Safari. Real Saves. The fake images are solid colours, so how a real 2:3 Cover and square portrait sit side by side on the review is worth a look. A Revert after Begin was tested by a server test, not in the browser.
