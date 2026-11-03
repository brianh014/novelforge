# 02: State and Snapshots

**What to build:** The Narrator can change the game through state operations, and the server validates and applies them. Every Message has a logically complete, immutable Snapshot, so the state at any Message can be retrieved.

**Blocked by:** 01

**Status:** ready-for-agent

- [ ] A finished Turn's state operations update inventory, status, NPCs and PC-known information
- [ ] Operations the server can disprove, such as removing an item the PC lacks, are refused
- [ ] A refused operation has a defined, tested outcome and never corrupts state
- [ ] The Narrator cannot replace the whole state
- [ ] Every Message has a Snapshot that can be loaded whole
- [ ] Unchanged Snapshot sections are stored once and shared, without callers seeing this
- [ ] Snapshots are never changed after being written
