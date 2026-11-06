# 59: Backfill Scene Memories

**What to build:** A one-off script writes Scene Memories for the Messages of an existing Save that are already outside the window, so a long story gets its past back. All of those Messages are still in the Save.

**Status:** ready-for-agent

**Blocked by:** 58

## Design

- `scripts/backfill-scene-memories.ts` takes a Save id, and refuses to run while the app is using port 4600, so it can't race a Turn
- It copies the Save to a backup beside it before writing anything
- It works through the uncovered older Messages, 20 at a time, oldest first, with one Text Provider call per batch, using the Text Model and connection in Settings
- Each call gets the batch and the Scene Memory rules from ticket 58, and no Lore Entries or Plot Threads, so hidden text can't reach a memory by accident
- It writes the finished list into the latest Snapshot only when every batch has succeeded, so a failure leaves the Save exactly as it was
- It prints progress and a count, with no story text

## The limit to accept

The memories go into the latest Snapshot. A Revert to a Message before the backfill brings back a state without them, so the script would need running again. Old Snapshots aren't rewritten, because they're the record of what was true at that Message.

## Acceptance

- [ ] The script refuses to run when the app is on port 4600, or when the Save already has memories that cover those Messages
- [ ] A backup exists before any write, and its path is printed
- [ ] A failed batch stops the run, with the Save unchanged
- [ ] After a run, the Messages before the window are covered in order, with no gaps or overlaps, and the window from ticket 58 still holds
- [ ] Each memory's prompt holds only that batch and the rules, shown by a test with a fake Text Provider
- [ ] The Server Log and printed output hold no story text
- [ ] `novelforge-spec.md` mentions the script
- [ ] Tests run on a scratch Save, never a real one

## Before running it on a real Save

Ask the player first. It writes to their Save and sends every older Message to the Text Provider, even though each is cheap.

## Not in this ticket

- A Journal button. Add one only if this is needed for more than a few Saves
