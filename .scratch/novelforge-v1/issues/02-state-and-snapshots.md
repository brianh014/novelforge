# 02: State and Snapshots

**What to build:** The Narrator can change the game through state operations, and the server validates and applies them. Every Message has a logically complete, immutable Snapshot, so the state at any Message can be retrieved.

**Blocked by:** 01

**Status:** done

- [x] A finished Turn's state operations update inventory, status, NPCs and PC-known information
- [x] Operations the server can disprove, such as removing an item the PC lacks, are refused
- [x] A refused operation has a defined, tested outcome and never corrupts state
- [x] The Narrator cannot replace the whole state
- [x] Every Message has a Snapshot that can be loaded whole
- [x] Unchanged Snapshot sections are stored once and shared, without callers seeing this
- [x] Snapshots are never changed after being written

## Comments
- **User sign-off (2026-11-05):** every criterion was already ticked, so the status was only out of date.
