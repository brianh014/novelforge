# 15: World creation wizard

**What to build:** A player can create a world through the wizard, and the Narrator generates its World Bible, Plot Threads and World Overview. The player reviews only the World Overview.

**Blocked by:** 09

**Status:** ready-for-agent

- [x] The wizard offers every theme in the spec, plus a custom theme
- [x] A player can write a World Brief or use “Pick for me”
- [x] A player can turn the Starting Hook on or off, write one, or use “Pick for me”
- [x] A player can choose any Art Style in the spec or describe their own
- [x] Generation produces Lore Entries with several keywords each, `world_rules` and Plot Threads
- [x] A spoiler-free World Overview is shown, with accept or regenerate
- [x] Marker tests prove the player-facing wizard never reveals the World Bible or Plot Threads
- [x] A generation failure can be retried without losing the player's input

## Comments

- A generated World is held in memory on the server, in a map in `startServer`, because a Save needs a PC. The client holds only its id and World Overview. An abandoned World stays until the app restarts, and a restart loses it, so the wizard says to generate it again.
- Accepting a World makes no call. The final `POST /saves` with `worldId` writes the World into the opening Snapshot and uses the World up. `POST /saves` without `worldId` still works as before.
- The World Overview is Narrator free text and only its prompt keeps it spoiler-free, even against a World Brief that asks for secrets. It isn't screened, as noted in `src/world-creation.ts`.
- Marker tests cover the REST routes, including failures, a Turn's stream and the snapshot route. That the rendered wizard and browser storage hold no secrets was checked in headless Chrome, not by the test suite.
- Generated Lore Entries are never always-on, because always-on entries bypass the token budget. Theme isn't stored. The prompt puts it in `world_rules`, which reach every Turn.
- `jsonSchemaOf` now also drops `minItems` from what's sent to models, for Turns too, so that a strict schema mode can't reject a World and turn off schema mode for that model. Replies are still validated.
- The Starting Hook is a `starting_hook` column on `save`, added by `toVersion3`, read with `saves.read(id).startingHook`. World generation uses it, but no Turn prompt does yet. That is ticket 16's, and dropping it here would lose what the player chose.
- “Pick for me” works only on an empty box, so it can't replace what the player wrote. The result is shown and can be edited.
- The wizard's choices are kept in `sessionStorage`, so a reload or a trip to Settings keeps them. Leaving the wizard during a generation cancels it.
- The ticket and spec say “regenerate” the world, but `GLOSSARY.md` defines Regenerate only for a Narrator response. The glossary is unchanged, so that entry needs widening or a new term.
