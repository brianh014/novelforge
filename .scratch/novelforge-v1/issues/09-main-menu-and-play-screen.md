# 09: Main menu and play screen

**What to build:** A player can open the app in a browser, start a minimal game from the main menu, and play streamed Turns, using the UI direction chosen in ticket 08. This establishes the SPA embedded in the executable.

**Blocked by:** 08

**Status:** ready-for-agent

- [ ] The SPA is served from the single executable, and the UI follows the recorded direction
- [ ] The SPA uses React with TypeScript, built by Bun and styled with plain CSS design tokens, with no Tailwind, component library, state library or client-side router library
- [ ] The main menu offers New Game, Load Game and Settings
- [ ] A player can play Turns and watch narration stream
- [ ] Refusals and errors are shown, and the player's text stays in the input box
- [ ] The player can Revert to a Message, with a confirmation showing what will be deleted
- [ ] The Revert confirmation offers “Duplicate from here”
- [ ] The layout works at phone and desktop widths
