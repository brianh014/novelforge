# 06: Lore and prompt assembly

**What to build:** Every Turn is a stateless prompt built from the current Snapshot. Relevant Lore Entries reach the Narrator, player text is treated as in-character data, and secrets stay on the server.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] Each prompt is assembled only from the Snapshot, active Lore Entries, rolling summary, Director's Notes, Model Instructions and recent Messages
- [ ] Player text is clearly delimited as in-character data
- [ ] `world_rules` appear late in the prompt, with the instruction to fail violating actions in character
- [ ] Always-on Lore Entries are always included
- [ ] Keyword-activated entries are included when keywords appear in recent Messages
- [ ] Activation allows one level of recursion and stays within a token budget, with always-on entries first
- [ ] The rolling summary is stored in the Snapshot, so Revert restores the right summary
- [ ] The Narrator can add Lore Entries and Plot Threads during play
- [ ] Tests with unique markers prove no player-facing response reveals the World Bible or Plot Threads
