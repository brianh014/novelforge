## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels, recorded on a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project rules

Create an HTML report of UI options only when the user asks for one, for a large visual change. Otherwise build UI changes directly.

Follow the conventions in `CONTRIBUTING.md`: Glossary terms, `shortcut:` comments, Zod at every route, allowlisted responses, and no key or story text in a log.

### Recommended setup

`README.md` → Recommended settings is the player-facing version. When advising on providers or changing defaults and Settings hints, keep to it:

- Text: a hosted API is recommended. A long story's prompt runs past 30,000 tokens, which a 10 GB GPU can't hold. Local text (Local / OpenAI server) is supported for short stories, privacy and trying things out, not the main path.
- Images: local ComfyUI is preferred, as NovelForge draws many pictures and each costs money on a paid API. OpenRouter is for players with no GPU for ComfyUI.

### Code layout

- The server's routes are split by area, one module each: `settings-routes`, `world-routes`, `save-routes`, `turn-routes` and `gallery-routes` (ADR 0004). A new route goes in its area's module. State only one area uses stays private to that module. `src/http.ts` holds what they share, and `rest-api.ts` only puts them together.
- `Play` (`src/web/play.tsx`) keeps the Turn and the state its parts share. The parts are in their own files: `story-pictures.tsx` (the `useStoryPictures` hook and the pictures inline in the story), `story-recap.tsx` (the left page), `message-controls.tsx` (the tools under a Message) and `play-asks.tsx` (the forms over the compose box). A new piece of the story screen goes in the file for its job.
- `NewStory` (`src/web/wizard.tsx`) keeps the form's state, the Narrator calls and the Art and Your World steps. The parts are in their own files: `wizard-draft.ts` (the draft, its themes and keeping it in the tab), `wizard-form.tsx` (the first step's boxes), `wizard-pictures.tsx` (a picture with its Draw, Redo, Nudge and Upload) and `wizard-frame.tsx` (the heading, the Working screen and the dialogs). A new piece of the New Story screen goes in the file for its job.

### CI and releases

- `.github/workflows/ci.yml` runs `bun run check` and `bun run e2e` on pushes and pull requests. The repo is on Gitea for now and will move to GitHub later. Gitea runs this same file, so keep steps that only work on GitHub behind `github.server_url == 'https://github.com'`.
- Releases are manual: `bun run release` builds the 10 downloads into `dist/release`, and the user uploads them. The user has put automated releases on hold, so don't add a release workflow unless they ask.

### Testing the app

- To try the app in a browser, start `novelforge-dev` from `.claude/launch.json` (port 4610). It runs with `--fake`: a stand-in Narrator and image model (`src/fake-services.ts`), no key or network, and its own Saves, Settings and logs under `fake/`.
- Agents always test with `--fake`. Never send a request to a real text model, image model or ComfyUI: they cost real money, so only a human tests real connections, with `novelforge-dev-real` (port 4620). When a change needs that, finish it with fakes and tell the user what to try for real.
- Never test against port 4600, which is the user's own server.
- Automated tests use the fakes in `test/` and never a real key.
- `bun run check` runs what CI runs: Biome lint and format check, the typecheck and the unit tests. `bun run format` fixes formatting. A lint suppression needs a reason (see `CONTRIBUTING.md`).
- `bun test` runs the unit tests in `test/` (about 40s). The 14s idle-timeout test runs only with `SLOW_TESTS=1`. Under `bun test`, Saves skip SQLite's flush to disk and ComfyUI polls fast; a Save that many tests seed the same way goes through `cachedSave` in `test/support.ts`.
- `bun run e2e` runs the Playwright specs in `e2e/` against `--fake` on port 4630, in a fresh `e2e/.data` folder each run (`e2e/serve.ts`). Find UI by role and label first; add a `data-testid` only where those can't tell things apart (story messages are `message-player` and `message-narrator`).
- `bun run perf` times a 1,200-Message story (opening it, typing, a Turn coming in) against `--fake` on port 4640 on React's production build, as players get, and prints the numbers. It is not in CI, as timings vary by machine; run it by hand after changes to the story screen.
- The fake Narrator builds each reply from the schema it is sent, with three of every list. Each Turn meets new people, and first any Important Character of the last world built that the PC hasn't met. It never asks for a Check, so Checks can't be clicked through. A rule the schema doesn't carry (a word limit, say) can still fail, and then the app retries and falls back as it would with a real model; teach `src/fake-services.ts` the rule if that blocks a screen.
- Fake pictures are plain plates in the book's colours, for checking layout, not art.
- `--watch` restarts the server on every code change, and an unfinished world in the New Story wizard lives only in server memory, so it is lost then: generate it again.
