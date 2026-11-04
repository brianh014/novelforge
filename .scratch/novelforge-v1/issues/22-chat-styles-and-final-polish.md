# 22: Chat styles and final polish

**What to build:** The finished game has working Chat styles and a consistent, story-focused look at every screen size, matching the chosen UI direction.

**Blocked by:** 10, 11, 12, 13, 18

**Status:** ready-for-agent

- [x] The Chat style options from the UI report work and persist
- [x] Every screen matches the recorded UI direction
- [x] Every screen works at phone and desktop widths
- [x] Interactive elements are keyboard accessible and have readable contrast
- [x] A full game can be played from New Game onward in the final executable

## Comments

- **No real model has played this game.** The full game below ran against a fake server. The user hasn't yet done the real OpenRouter, image, local server or ComfyUI runs, so how a real model follows the `[Name]:` prompt is unknown.
- **The full game run.** A byte-identical copy of `dist/novelforge.exe` in a throwaway folder, so no real Saves or settings were touched, driven by headless Chrome through the Local text path, against a fake OpenAI-compatible server and the fake ComfyUI. No OpenRouter call was made. 42 steps passed: world wizard, PC wizard, Turns with a Check, Journal, inventory and an item action, Rewrite, Regenerate, Duplicate from here on the latest Message, Revert with its Snapshot restored, duplicate, export, delete, restart and reload. Import sent the same request as the button, as a headless run can't drive the file picker.
- **All four Chat styles ship, Prose is the default.** This settles what ticket 08 left open. They apply to the live stream and committed Messages. The Full Log isn't styled, as the spec calls it "exactly the story", so it shows the `[Name]:` lines as written.
- Anything that isn't a whole `[Name]:` tag at the start of a line is narration, including a tag still streaming, so `[Ash` shows as typed until `]:` arrives. The spec's example also has `[Ashley] “...` with no colon, which stays narration. Player Messages are never parsed.
- A speaker's name has to match the state exactly to get a portrait, otherwise Bubbles shows an initial. The PC's name goes on the PC's side.
- **Stage box walks the whole story.** The report says reading back means opening the Full Log, but Revert and Duplicate from here have to be reachable on any Message, and a screen reader needs every beat, so Back goes to any Message and the controls sit under the beat. Hidden beats stay in the DOM. It shows the Scene Image of that moment, and works over a plain page with images off. Next doesn't announce the new beat, as the whole text is there to read. "A tap moves on" is the Next button, not the whole box.
- A response of only whitespace now retries like any unusable reply, as it would leave a Message with no beats, and no controls in a Stage box. Stored narration is trimmed.
- **Fixed from the known gaps:** Duplicate from here on every Message, the Journal polling for portraits (which supersedes the note in ticket 18), the favicon, and the dark-mode review.
- **Not fixed:** the world-changed warning still lives in the URL, so it shows until the first Turn and is gone if the player leaves first. Keeping it means storing it in the Save, which is a schema change for a one-time notice.
- The Revert dialog quotes a Message with its `[Name]:` tags, as written, in every Chat style.
- After a failed Turn a Stage box returns to the first beat of the previous response, not the beat the player was on.
- **Contrast:** measured in the DOM in 252 states, all screens at 320, 390 and 1280, Medium and Large, light and dark, including dialogs, all four Chat styles and the Rewrite box. The tokens needed no change. Browser default placeholders failed at 4.06 and 3.51, so `::placeholder` now uses `--muted`. Disabled controls are exempt under WCAG. The thinking text faded below AA, so it now moves between two passing colours. `--line` is decoration, at 1.5:1, and every control has an `--ink` edge.
- **Widths:** no sideways scroll or clipped controls in those 252 states. Two fixes came from this: the Rewrite box on a phone replaces the Scene Image and Send box while open, or the response had no room at 320 wide, and it no longer sits 44px up in the Story. The only target under 24px is the 20px checkbox, whose label is the target.
- **Keyboard:** every screen walked by Tab at 1280 and 390, in all four Chat styles, with zero issues: every stop reached, ring shown, in view and unclipped. The Notes, Revert and Delete dialogs start and stay focused inside, Escape closes them, and focus returns to the opener. `.waiting` is the only animation, and it is off under reduced motion.
- **No-Check rule:** a case-insensitive grep of `src/web` and the error strings, and a DOM check of text, labels, alt text, placeholders and values at each step and in all 252 states. "Check" as a plain verb is gone from Settings and from Text Provider and ComfyUI errors. "Checkpoint" stays in Settings, as it is ComfyUI's term for a model.
- Spot-checked by eye in screenshots, not all 252. The images in those runs were flat colours from the fake ComfyUI, so Stage box over a busy real image is unseen, though its box is opaque.
