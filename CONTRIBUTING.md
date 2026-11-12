# Contributing to NovelForge

Thanks for helping. This page covers setting up, the checks a change must pass, and the conventions the code follows.

## Setting up

1. Install [Bun](https://bun.sh) 1.4 or later.
2. `bun install`
3. `bun src/main.ts --fake --open` runs the app with a stand-in Narrator and image model, so you need no key and spend no money.

Develop with `--fake`. Its stand-ins (`src/fake-services.ts`) build each reply from the schema they are sent, and keep their own Saves and Settings under `fake/`, apart from your real ones. Test against a real model only by hand, and only when a change needs it.

## Checks

Every pull request runs these in CI, and they should pass locally first:

| Command | What it checks |
| --- | --- |
| `bun run check` | Biome lint and formatting, the TypeScript typecheck, and the unit tests in `test/` |
| `bun run e2e` | The Playwright specs in `e2e/`, against `--fake` on port 4630 |
| `bun run format` | Formats every file the way `check` expects |

Unit tests use the fakes in `test/` and never a real key. `SLOW_TESTS=1 bun test` also runs the slow idle-timeout test. In e2e specs, find elements by role and label first, and add a `data-testid` only where those can't tell things apart.

## Conventions

- **Words:** use the terms in [`GLOSSARY.md`](GLOSSARY.md), in code, comments and the UI alike. Add a term there when you add a concept.
- **Decisions:** record a decision that shapes the design as an ADR in [`docs/adr/`](docs/adr/), numbered after the last.
- **Comments** say why, not what. A known limit taken on purpose gets a comment starting `shortcut:`, which names the limit and when to lift it.
- **Server routes** live in one module per area (`*-routes.ts`), which takes the shared `ServerContext` from `src/http.ts`. Validate every request body with a Zod schema through `parseBody`, and answer with an allowlist of fields, never a whole stored object.
- **Secrets:** an API key must never reach a response or a log line. Logs carry counts and ids, never story text.
- **Lint suppressions** need a reason: `// biome-ignore lint/<group>/<rule>: why`. `useExhaustiveDependencies` is off, as many effects deliberately re-run on a trigger value or leave out functions made anew on each render.
- **Tests:** a bug fix comes with a test that fails without it. Test through the HTTP routes or a module's exported functions, as the app uses them.

## Sending a change

1. Keep it to one purpose, and say why in the description.
2. Run `bun run check` and `bun run e2e`.
3. A visible change needs a look in the browser with `--fake`, and a screenshot in the pull request helps.

By contributing, you agree that your contribution is licensed under the project's [license](LICENSE.md).
