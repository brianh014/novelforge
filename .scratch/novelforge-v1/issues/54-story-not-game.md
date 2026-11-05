# 54: Say "story", and name stories by their title

**What to build:** Anywhere "game" is used becomes "story", to keep with the novel theme. A story is always referred to by its title, never by the PC's name.

**Status:** ready-for-human

**Blocked by:** 51, as it rewrites the wizard this touches

- [x] No player-facing text says "game": New Story, Load Story, "This story" in Settings, and the rest
- [x] `GLOSSARY.md`, `novelforge-spec.md`, the ADRs, code comments and code names such as `NewGame` say "story" too
- [x] Tests follow the wording, with their own fixture text changed only where it names the app
- [x] The delete confirmation names the story by its title
- [x] Every place that names a story uses its title
- [x] A Save with no title still falls back to the PC's name
- [x] `grep -riE '\bgames?\b' src test GLOSSARY.md novelforge-spec.md docs/adr` finds nothing that should change

## Comments

- **User request (2026-11-05):** "Anywhere \"game\" is used, change to \"story\" to keep with the novel theme. And always refer to a story using the title, not the PC name".
- **User answer (2026-11-05):** a Save with no title keeps the PC's name, as that's the one thing that tells such Saves apart.
- Agent's defaults, not yet confirmed:
  - Old tickets in `.scratch` stay as written, since they're a record.
  - "Save" stays the word for the file on disk, as in `GLOSSARY.md`.
  - The PC's name stays as a second line under the title on the Load screen and the Story's left page, because it names the PC there and not the story.
- Build notes:
  - Player-facing today: `src/web/menu.tsx`, `src/web/load.tsx`, `src/web/settings.tsx` (`THIS_GAME`, "Open a game") and `src/web/wizard.tsx`.
  - Delete confirmation: `src/web/load.tsx:119`. Fallbacks: `load.tsx:72-77`, `play.tsx:459` and `wizard.tsx:556`, though ticket 51 removes that last page.
  - Renaming the `novelforge-new-game` storage key drops a wizard draft in progress. Only an open tab would notice.
- Built (2026-11-05), not yet seen by the user:
  - Checked in a real browser on 4602 with a scratch Save folder and no key: 33 checks passed, screenshots viewed. A titled Save, a Save with no title and an unreadable file were seeded. Every main screen's HTML, including aria-labels, alts and titles, was scanned for "game": Main Menu, Load Story, the Story, Journal, Gallery, Inventory, Settings with and without a story open, and New Story.
  - **Decision:** `storyName` in `src/web/api.ts` is the one place that picks the title or the PC's name, used by Load Story, its delete confirmation and the Story's left page. Duplicate, Delete and Load labels, notices and Cover alts follow it, so Cover alts now read "Cover of The Salt Road", not "Cover of Mara's story".
  - **Decision:** where "game" meant the program and not a story, it became "app": `startGame` and `game` in the tests are now `startApp` and `app` (about 1,450 uses), and five code comments and the spec's Tech section say "app". `story.post("/saves")` would be wrong, as that handle is the running server.
  - **Decision:** `test/load-game.test.ts` is now `test/load-story.test.ts`. No fixture text used the word, so none changed.
  - **Decision:** the wizard's "You can change this in game" is now "You can change this during the story".
  - **Decision:** the spec's "out of the game for now" (Director's Notes) is now "out of play for now", and "break the game" is now "break the story".
  - **Decision:** the draft key is now `novelforge-new-story`, and an old draft isn't kept. Keeping it needs a fallback read and a removal, or a finished draft would come back, and it would leave the old key in the code. It's in `sessionStorage`, so only an open tab loses one.
  - Added **Story** to `GLOSSARY.md`, with the naming rule and Game to avoid, and the same rule to the spec's Main Menu section.
  - Narrator prompts: none changed, as no prompt or error string in `src` held the word. Code comments were the only hits outside the UI.
  - Nothing stored or sent needed a migration: no Save column, Snapshot key, API field or route held the word. `pc_name` stays, as it is the PC's name. The `#/new` and `#/load` routes stay.
  - Left alone: the page title is always "NovelForge", and an export is named `novelforge-save-<id>.sqlite`, so neither names a story. The PC's name stays where it names the PC: the wizard's choices so far, the Inventory, the Journal, and the prompt box.
  - The final grep finds two lines, both meant to stay: `GLOSSARY.md`'s "_Avoid_: Game" under **Story**, and the spec's "This is a story, not a D&D game", a literal game.
  - Not checked: real Saves, as they weren't opened. iOS Safari. The World Overview step and the error messages were checked by the grep only, not on screen. Gallery and Journal were scanned with near-empty Saves, so their fuller rows were covered by the grep too.
