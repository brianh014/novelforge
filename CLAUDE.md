## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Uses the five default triage labels, recorded on a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project rules

Create an HTML report of UI options only when the user asks for one, for a large visual change. Otherwise build UI changes directly.

### Testing the app

- To try the app in a browser, start `novelforge-dev` from `.claude/launch.json` (port 4610). It runs with `--fake`: a stand-in Narrator and image model (`src/fake-services.ts`), no key or network, and its own Saves, Settings and logs under `fake/`.
- Agents always test with `--fake`. Never send a request to a real text model, image model or ComfyUI: they cost real money, so only a human tests real connections, with `novelforge-dev-real` (port 4620). When a change needs that, finish it with fakes and tell the user what to try for real.
- Never test against port 4600, which is the user's own server.
- Automated tests use the fakes in `test/` and never a real key.
- `bun test` runs the unit tests in `test/` (about 40s). The 14s idle-timeout test runs only with `SLOW_TESTS=1`. Under `bun test`, Saves skip SQLite's flush to disk and ComfyUI polls fast; a Save that many tests seed the same way goes through `cachedSave` in `test/support.ts`.
- `bun run e2e` runs the Playwright specs in `e2e/` against `--fake` on port 4630, in a fresh `e2e/.data` folder each run (`e2e/serve.ts`). Find UI by role and label first; add a `data-testid` only where those can't tell things apart (story messages are `message-player` and `message-narrator`).
- The fake Narrator builds each reply from the schema it is sent, with three of every list. It never asks for a Check, so Checks can't be clicked through. A rule the schema doesn't carry (a word limit, say) can still fail, and then the app retries and falls back as it would with a real model; teach `src/fake-services.ts` the rule if that blocks a screen.
- Fake pictures are plain plates in the book's colours, for checking layout, not art.
- `--watch` restarts the server on every code change, and an unfinished world in the New Story wizard lives only in server memory, so it is lost then: generate it again.
