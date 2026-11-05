# 06: Lore and prompt assembly

**What to build:** Every Turn is a stateless prompt built from the current Snapshot. Relevant Lore Entries reach the Narrator, player text is treated as in-character data, and secrets stay on the server.

**Blocked by:** 02

**Status:** done

- [x] Each prompt is assembled only from the Snapshot, active Lore Entries, rolling summary, Director's Notes, Model Instructions and recent Messages
- [x] Player text is clearly delimited as in-character data
- [x] `world_rules` appear late in the prompt, with the instruction to fail violating actions in character
- [x] Always-on Lore Entries are always included
- [x] Keyword-activated entries are included when keywords appear in recent Messages
- [x] Activation allows one level of recursion and stays within a token budget, with always-on entries first
- [x] The rolling summary is stored in the Snapshot, so Revert restores the right summary
- [x] The Narrator can add Lore Entries and Plot Threads during play
- [x] Tests with unique markers prove no player-facing response reveals the World Bible or Plot Threads

## Comments

- Always-on Lore Entries, Plot Threads and `world_rules` are never dropped, so a large enough set can exceed the token budget. They spend it first, and keyword-activated entries fill what remains.
- Keywords match whole words, so `vault` does not activate on "vaults". Always-on content is not scanned during recursion.
- `worldRules`, always-on entries and `directorsNotes` have no production writer yet (tickets 15 and 12). Tests seed them through the Save Store until those routes exist.
- **User sign-off (2026-11-05):** every criterion was already ticked, so the status was only out of date.
