# 56: Log Levels and a complete Server Log

**What to build:** Every part of the app logs through one logger, at one of four Log Levels, so a problem can be traced from the Server Log alone. The Log Level defaults to Warning, or Verbose on a debug build, and the player can change it in a new Advanced section of Settings. It takes effect at once, with no restart.

**Status:** ready-for-agent

**Blocked by:** none, but commit the uncommitted work on `main` first, as it touches the same files

## Log Levels

Each level includes the ones above it in this table.

| Level | Use it for | Examples |
|---|---|---|
| Error | Something the player asked for or expected didn't happen, or a bug | A Turn or World Change failed for good, a failed Scene Image, Redraw or Requested Image, an unhandled route error, a Save that won't open or upgrade |
| Warning | Something went wrong and the app recovered, or carried on with less | A Narrator reply retried, Schema mode rejected, a replacement drawn from the old image's prompt, a content refusal, a failure to write the log file |
| Info | One line per decision or finished step | A Turn committed, a text reply, an image drawn or dropped, a repeat ignored, a Save opened or upgraded, a Revert, a Settings change by field name only, a stream lost |
| Verbose | The steps in between, and anything frequent | Each request's method, route pattern, status and time, each image job queued, started and finished, each poll fallback, prompt sizes, provider error text |

The names and order follow the browser console's own levels (Verbose, Info, Warnings, Errors), as there's no logging framework here, and each maps to a console method: `console.error`, `console.warn`, `console.info` and `console.debug`. The startup lines (the address and network addresses) always print, whatever the level, or a player on Warning couldn't find the app.

## Acceptance

### Logger

- [ ] `src/logger.ts` has `error`, `warning`, `info` and `verbose`, each taking an area, a message and optional fields, with no new dependency
- [ ] Each line has the time, level, area, message and fields as JSON, in that order
- [ ] A line below the current level costs almost nothing, as its fields are never built or serialized
- [ ] Nothing the logger does can throw into a Turn or a request, including a value that won't serialize
- [ ] A test fails on any `console.` call in `src/` outside `src/logger.ts`, so a new one can't slip in. The page's code is included, apart from anything already browser-only and deliberate

### Default level

- [ ] The default is Verbose on a debug build and Warning on a compiled one, using the `isCompiled` check already in `src/main.ts`
- [ ] A saved Log Level beats the default on either build
- [ ] A build that has no saved level keeps following its default, so a later change to the default still reaches it

### Everything at the right level

- [ ] All 18 current `console.log` and `console.error` calls move to the logger at the level in the table above
- [ ] A refused operation logs its reason as well as its type, such as `remove_item: not held` or `add_known_npc: no such NPC`, with no story text
- [ ] A repeated known fact or NPC logs at Info, with a count only
- [ ] A Turn's commit line says if it was a new Turn, Rewrite or Regenerate
- [ ] A replaced Turn logs if its Scene Image was forced, and if it fell back to the old image's prompt
- [ ] Each image logs when it's queued, started, drawn, failed, or dropped by a Rewrite, Revert or Save deletion, with its kind and Message id
- [ ] A Turn that loses its client logs when that happens, not only when the Turn ends
- [ ] Each request logs at Verbose by route pattern, such as `/saves/:id/turn`, never the real path
- [ ] Save upgrades, imports, exports, duplicates and deletions log at Info, and a failure at Error
- [ ] Settings changes log field names only, never values

### The page

- [ ] The page reports a fixed list of events to a new `POST /log` route: stream lost, polling fallback, Turn resumed after a reload, polling gave up, narration restarted and uncaught page error
- [ ] The route accepts only those event names and numeric fields, with no free text, so nothing the page holds can reach the log. Anything else gets a 400, and the body size is capped, as the app listens on the network
- [ ] A failed report never bothers the player
- [ ] These events land in the Server Log marked as coming from the page, so one Turn reads in order across both

### Log file

- [ ] Lines also go to `logs/novelforge.log` beside `Saves`, at the same level as the console, so they outlive the terminal
- [ ] It rotates at 10 MB and keeps one older file
- [ ] It's created with the same owner-only mode as `settings.json`, and `logs/` is in `.gitignore`
- [ ] If the file can't be written, the app carries on with the console, and warns once

### Settings

- [ ] Settings has a new Advanced section after Reading, on every screen Settings appears
- [ ] It has a Log Level choice: Error, Warning, Info or Verbose, plus Default, which shows what the default is on this build
- [ ] It saves with the Save button like the other sections, and applies at once, with no restart
- [ ] It says in a line or two what the levels do, and that the log never holds story text
- [ ] It works at phone width and by keyboard, like the other sections

### Secrets

- [ ] Every line about a Save gives its Save id, and its Message id or image where it has one, so the text can be found in the Save without being in the log
- [ ] A retried or failed Narrator reply gives its generation id, as it's in no Save
- [ ] At every level, including Verbose, the log holds no World Bible, Plot Thread, world rule, story text, player input, Image Prompt or API key
- [ ] A test plays a Turn, Rewrite, World Change and Requested Image at Verbose with marked secrets, including failed provider calls, and finds none of them in the log
- [ ] Error objects are logged by type, status and message only. `error.cause` and provider text are checked, as either can repeat the prompt, and provider text is logged at Verbose only, through `redacted`

### Docs

- [ ] `novelforge-spec.md` has a section on the Server Log and Log Levels
- [ ] `GLOSSARY.md` gains Server Log and Log Level, as the Full Log is the story's own record and the two must not blur
- [ ] The spec's "stays in the server log" lines still hold, or are changed to match

## Comments

- **User request (2026-11-05):** "Plan a ticket to bring the standards of logging up with full log levels, verbose, debug, warning and error. Log everything at the right level. Default is warning, but on debug builds, default is verbose. User should be able to change log level in a new advanced section in settings".
- **User correction (2026-11-05):** "I meant Info level instead of Debug, or whatever is standard for the framework". The levels are Verbose, Info, Warning and Error, from noisiest to quietest.
- **Why now:** tracing the vanishing response worked from the log, but the log couldn't say why `add_known_npc` was refused, or show anything from the page, so it couldn't fully rule out switching windows. The log also lives only in a terminal or a temporary file.
- **User answers (2026-11-05):** "debug is what we are doing now. I imagine later we will have a prod builds", and "log file and post in scope". The user asked if story text should stay out, or if the log should reference where it is in the Save.
- Decisions:
  - A debug build is running from source with `bun run`, which is how the app runs today, so it defaults to Verbose. A prod build is the compiled one, from `bun run build`, which isn't in use yet.
  - The startup lines always print, even though they're Info by nature.
  - The log file and the page's `POST /log` are in scope. Both come from what the logs couldn't do when tracing the vanishing response.
  - Story text stays out at every level, and the log points to it instead, by Save id and Message id. So the Server Log can be shared for help without sharing the story or its secrets, and a line can still lead to the exact text in the Save.
  - A Narrator reply thrown away is in no Save, so the log gives its generation id, which finds it in the provider's own logs where the provider keeps them.
- Build notes:
  - `settingsStore.update` writes the whole merged object, so a `logLevel` in `defaults` would be saved on the first unrelated change and pin that build's default. Leave it out of `defaults`, as an optional field, and work out the default in the logger. Default in the Settings form sends nothing or clears it, so `SettingsUpdate` needs a way to clear it.
  - `src/main.ts` patches `console.log` and `console.error` to add the time. That goes, as the logger writes the time.
  - The logger needs the Settings store to read the level, but lines can come before it's ready, so it starts at the build's default. It should read the level on each line or be told on change, so a Settings save applies at once.
  - Write through the four console methods named above. Tests that use `spyOn(console, "error")` to catch a line that's now a Warning need to spy on `console.warn` instead.
  - Tests run unbundled, so they'd default to Verbose and flood the output. `startServer`'s options or the test support should set a quiet level.
  - `test/rest-api.test.ts` and others may match today's wording, so expect to update those.
  - Text in the `Text reply:` line includes the generation id, which is worth keeping, as it finds a call in the provider's own logs.
  - `POST /log` must not call `turns.status`, as reading a failure takes it.
  - Reproduce nothing on port 4600. Test on a scratch port with fake servers, as the rules in the handoffs say.
