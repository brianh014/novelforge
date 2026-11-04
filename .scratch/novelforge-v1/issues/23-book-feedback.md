# 23: Book feedback from the first real playthrough

**What to build:** The changes the user asked for after playing with a real model, on the look chosen from the options report below.

**Blocked by:** none, the user chose Direction B

**Status:** ready-for-agent

## Look

- [x] Less white space overall
- [x] Lean into the book theme: the UI looks like an old book, with an old book palette
- [x] Tabs sit at the top right of the screen, like bookmarks
- [x] Story text is upright and more legible, not italic
- [x] Duplicate from here, Rewrite and Regenerate become compact icons

## Images

- [x] Scene Images show whole, not cropped at the top and bottom
- [x] Clicking any image opens it larger in a modal
- [x] Step 2 of 3 of world creation shows a generated image of the world
- [x] The finished PC shows their generated image

## Setup

- [x] World generation shows a loading screen
- [x] Fields lock while the Narrator is generating on setup screens
- [x] The PC personality field is removed, since the player shows it by acting

## Play

- [x] The first message gives the player the world's details and brings them fully up to speed
- [x] The World Brief moves from the left side into the Journal
- [x] A "Decide for me" option has the model write the player's response

## Comments

- Raised by the user on 2026-11-04 after a real playthrough.
- Report: https://claude.ai/artifact/4CwRtaQFpzDTY1EmJ4oq8q (private Artifact). Source: `.scratch/novelforge-v1/old-book-options.html`. Directions: A Working Copy, B Open Spread, C Bound Manuscript, each in Day and Candlelight, at desktop and phone widths.
- **User decisions (2026-11-04):** Direction B, Open Spread, with both the light and dark themes and a toggle in Settings. Remove the personality field. The step 2 image is the story's cover art, like a book cover, so it matches the world's general theme, and its extra paid image is accepted.
- **Built 2026-11-04.** A real new game on `deepseek/deepseek-v4.1-flash-1017` and `google/gemini-nano-banana-2.1`: the cover, opening, Decide for me and PC portrait all worked, and no secret reached a cover or Decide prompt in the tests. A headless Chrome run covered the scene image's shape, the viewer, the wizard's lock and Cancel, both themes, and overflow at 390px on six screens.
- **World generation took 270 to 290 seconds** on that model, so the wait text says a few minutes. The opening took about 60 seconds, 15 of them before the first word.
- **The opening is a real first Turn.** Its player Message, `OPENING_INPUT`, is stored because every Narrator Message must follow one, and `readable` hides it. Rewrite, Regenerate and import work on it unchanged. It rolls no Check.
- `personality` stays in `PcDetails`, because that strict shape validates imports and older Saves hold it. Only the wizard and Pick for me dropped it.
- The cover is painted in the background, so Accept doesn't wait, and it joins the Save whenever it lands. Regenerating a world pays for a new cover.
- Pick for me now takes over the right page as the other waits do, so the Art Style list disappears for a few seconds.
- In the real opening the Narrator wrote lines for the PC, such as `[Test Mercy]:`, and mixed past and present tense. Prompt-only, and left for the player to judge.
- Not looked at: the Script, Bubbles and Stage box styles in the new palette, and bubble faces don't open the viewer. A cover that lands after the Story opens shows on the next load.
- **Dark theme, 2026-11-04.** The user found the first dark paper wrong and chose C, Charcoal laid paper, from https://claude.ai/artifact/FsrEgmyYingzWGmwKNzKLJ (private Artifact, source `.scratch/novelforge-v1/dark-paper-styles.html`). It keeps the app's shared grain rather than the report's slightly softer one. The light theme keeps its parchment and age spots.
