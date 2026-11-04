# 29: World creation and Settings off the two-page spread

**What to build:** The two-page book layout doesn't work well for world creation or the Settings menu. Move them to the layout the user chooses from the options report.

**Blocked by:** none, the user chose B, Index Sheet

**Status:** done

## Criteria

- [x] Index Sheet is built for all three world creation steps and Settings, in both themes and at phone width
- [x] When a page runs past the fold, a down arrow shows and scrolls down. It goes away at the bottom, and shows again if the page grows
- [x] Errors and the Saved notice stay in the pinned bar, so they can't be missed below the fold
- [x] Settings shows one section at a time. Unsaved edits survive a switch, and Save goes to a required box in a hidden section

## Comments

- Raised by the user on 2026-11-04.
- Options report: https://claude.ai/artifact/7b1ig6wAXcDbaz8bu2tCLB, saved as `.scratch/novelforge-v1/layout-options.html`. Directions: A Single Sheet, B Index Sheet, C Chapters. Recommended C. A mix is allowed.
- Story, Journal, Inventory, Load Game and the Main Menu stay a two-page book in all three.
- Checked in a real browser at 1366x800 and 390px, with the model calls faked and an isolated Save for Settings in a game. That run found a crash no test covers: Chrome's scrollTo can return a promise, and a one-line effect handed it to React as a cleanup. There's no browser test suite, so a repeat would only show up in a run like that.
- The back links are gone: the index's steps do that job. Reveal stays a two-page screen, as it's the moment the book opens.
- Scroll at 1366x800, as mocked with sample text. World choices and Art Style: A 1134px, B 655px, C none. Of the PC: A 284px, B 280px, C none. Settings on OpenRouter: A 659px, B and C none, showing the Text section. Local servers and ComfyUI add fields, so they can still scroll.
