<p align="center"><img src="src/web/logo.svg" alt="NovelForge" width="200"></p>

<h1 align="center">NovelForge</h1>

<p align="center">A choose-your-own visual novel, written as you play.</p>

NovelForge is a single-player story game. You build a world and a character, then act and speak only as that character, while a text model plays the Narrator: it runs the story, voices everyone else, keeps track of the world, and rolls the dice when what you try could fail. An image model draws the Cover, portraits and scenes as the story goes.

It runs on your own computer and talks to models you choose. Bring an OpenAI-compatible text API (OpenRouter, DeepInfra, a local server) and, for pictures, OpenRouter or your own ComfyUI.

## Features

- **New Story wizard:** choose a Theme, write or generate the world and your character, and draw the Cover and portraits before you start.
- **Play:** each Turn is your move and the Narrator's reply, streamed as it's written. Ask the Narrator a question, have it decide for you, or tell it to change the world.
- **Memory:** a Journal of what your character knows, Loose Ends, the people met and Chapters, kept by the Narrator and editable by you.
- **Undo anything:** edit, rewrite or regenerate a reply, or revert to any earlier Message. Every Save is one SQLite file you can duplicate, export and import.
- **Pictures:** Scene Images when the scene changes, pictures on request, and a Gallery to redraw, nudge or replace any of them with your own.

## Running it

You need [Bun](https://bun.sh) 1.4 or later.

```bash
bun install
bun start
```

`bun start` serves NovelForge on port 4600 and opens it in your browser. Open **Settings** to enter your text model's address, model and key, and optionally an image model. Your Saves, Settings and logs stay in the project folder, which git ignores.

To try it with no model and no key, run it with stand-ins:

```bash
bun src/main.ts --fake --open
```

| Option | What it does |
| --- | --- |
| `--fake` | Uses a stand-in Narrator and image model, with their own Saves and Settings under `fake/`. |
| `--open` | Opens the browser once the server is up. |
| `--app` | Runs as the desktop app: this computer only, with Quit in the Menu. |
| `--server` | Runs as a server for the network, even from a built download. |
| `PORT` | The port to listen on (default `4600`). |
| `HOST` | The address to listen on (default `0.0.0.0` for a server, `127.0.0.1` for the app). |

`bun run install-launcher` adds a NovelForge shortcut to your desktop or app menu. `bun run release` builds the one-file downloads into `dist/release`.

> **A server on the network has no accounts.** Anyone who can reach it can play, change Settings and spend your saved keys. Keep it on a network you trust, or set `HOST=127.0.0.1`.

## Development

```bash
bun run check   # lint and format check, typecheck, unit tests
bun run e2e     # Playwright end-to-end tests, against the stand-ins
bun run format  # format every file
```

The code is TypeScript on Bun, with a React page bundled by Bun itself. Start with:

- [`GLOSSARY.md`](GLOSSARY.md): the words the code and the UI use, such as Turn, Snapshot and Scene Image.
- [`docs/adr/`](docs/adr/): the decisions behind the design, and why.
- [`docs/spec.md`](docs/spec.md): the original specification.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how to set up, test and send a change.

## License

Copyright © 2026 BrianH. NovelForge is free software under the [GNU Affero General Public License 3.0](LICENSE). You may use, change, share and sell it. If you share a changed version, or run one as a server that other people use, you must offer them its source under the same license.
