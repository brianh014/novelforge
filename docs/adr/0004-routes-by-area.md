# Routes by area

The HTTP routes live in one module per area: `settings-routes`, `world-routes`, `save-routes`, `turn-routes` and `gallery-routes`. `rest-api.ts` only builds the shared parts, puts the tables together and starts the server. Before this, every route sat in one ~1000-line `startServer` closure, so any route could reach any state, and reading one area meant reading them all.

Each area is a function that takes a `ServerContext` (the options, the Saves, the live Turns and the image pipeline) and returns its routes. State that only one area uses stays private to it: the held worlds and form pictures live in `world-routes`, and the ComfyUI workflow problem is passed only to `settings-routes`. `http.ts` holds what every area needs: request parsing, error answers, the upload check, the logged wrapper and its Host check, and a `routes` helper that keeps each handler's path params typed outside `Bun.serve`.

Tests still start the whole server through `startServer`, so the split changes no behaviour a test can see.

## Considered Options

Splitting by HTTP method or path prefix alone would have cut across areas, such as the Journal reading portraits. A router library would add a dependency for something Bun's route tables already do.
