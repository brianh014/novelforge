# 09: Main menu and play screen

**What to build:** A player can open the app in a browser, start a minimal game from the main menu, and play streamed Turns, using the UI direction chosen in ticket 08. This establishes the SPA embedded in the executable.

**Blocked by:** 08

**Status:** ready-for-agent

- [x] The SPA is served from the single executable, and the UI follows the recorded direction
- [x] The SPA uses React with TypeScript, built by Bun and styled with plain CSS design tokens, with no Tailwind, component library, state library or client-side router library
- [x] The main menu offers New Game, Load Game and Settings
- [x] A player can play Turns and watch narration stream
- [x] Refusals and errors are shown, and the player's text stays in the input box
- [x] The player can Revert to a Message, with a confirmation showing what will be deleted
- [x] The Revert confirmation offers “Duplicate from here”
- [x] The layout works at phone and desktop widths

## Comments

- Every Turn in the checks used a local fake OpenAI-compatible server. No real model has been run through the UI, so real narration formatting is unseen. `\n` in narration shows as written. Prose shows no `[Name]:` speaker styling, because the Narrator prompt doesn't ask for it.
- Checked in headless Chrome against the compiled executable at 1280, 390 and 320 wide: no horizontal scroll, no console errors, no requests off localhost. Not checked in Firefox, Safari or with a real screen reader.
- Fonts are bundled from Fontsource: EB Garamond (regular, italic), IM Fell English and IM Fell English SC, Latin subset only, about 170 KB, under the OFL with the licences in `src/web/fonts/`. Other scripts use the fallback serif stack.
- `GET /saves/:id` is new, returning the World Brief and PC name for the play screen. `bun run build` now passes `--production`, because otherwise the SPA shipped React's development build at about 1 MB.
- Until ticket 13 the only way back to a Save is its URL, `#/play/<id>`. Until ticket 14 the Settings stub points the player at `settings.json`.
- The Journal and Inventory bookmark tabs are inert until tickets 10 and 11. The left page holds only the PC name and World Brief, so status and notes go there.
- Leaving mid-Turn aborts it. Its text comes back in the box on return, but not after a page reload.
- “Duplicate from here” is only offered in the Revert confirmation, as this ticket asks, so it can't be reached from the latest Message. The spec says “on any Message”, and ticket 13 or a later one can add that.
