# 59: Backfill Scene Memories

**What to build:** A one-off script writes Scene Memories for the Messages of an existing Save that are already outside the window, so a long story gets its past back. All of those Messages are still in the Save.

**Status:** ready-for-human

**Blocked by:** 58

## Design

- `scripts/backfill-scene-memories.ts` takes the path of a Save copy and the path of a settings file: `bun run scripts/backfill-scene-memories.ts <Save copy> <settings.json>`
- It only ever writes to that copy, never to the Save it was copied from. It refuses any path inside the main checkout's Saves folder, however the path is spelled
- The copy is the backup, so the script makes no second one, and a copy can't race a Turn, so there's no port check
- Opening the copy with the branch's code upgrades it, so it works on a Save at any older version
- It reads the settings file without copying it, and never prints or logs the key
- It works through the uncovered older Messages, 20 at a time, oldest first, with one Text Provider call per batch, using the Text Model and connection in that settings file
- The memories end just before the first existing memory, or the window if there is none, so they stay contiguous
- A final batch shorter than 20 becomes a shorter memory. Its Messages can't wait in the window, as that would leave a gap before an existing memory, and folding them into the batch before would make a memory of up to 39 Messages in the same 100 words
- A batch holds what the player read. The Opening's stored player Message is left out, as the page hides it. Message text is never edited in place, as a Rewrite or Regenerate stores a new Message, and `hidden_check` and `edits` stay out
- Each call gets the batch and the Scene Memory rules from ticket 58, and no Lore Entries or Plot Threads, so hidden text can't reach a memory by accident
- It writes the finished list into the latest Snapshot, and the one before it, only when every batch has succeeded, so a failure leaves the copy without any of them
- It prints progress and a count, with no story text

## The limit to accept

The memories go into the latest Snapshot. A Revert to a Message before the latest Turn brings back a state without them, so the script would need running again. Older Snapshots aren't rewritten, because they're the record of what was true at that Message.

## Acceptance

- [x] The script refuses any path inside the main checkout's Saves folder, in any spelling, before opening the file
- [x] It works on a Save at an older version, upgrading it on opening
- [x] It makes no call and writes nothing when memories already cover those Messages
- [x] A failed batch stops the run, with the copy unchanged
- [x] After a run, the Messages before the window are covered in order, with no gaps or overlaps, and the window from ticket 58 still holds
- [x] Each memory's prompt holds only that batch and the rules, shown by a test with a fake Text Provider
- [x] The Server Log and printed output hold no story text and no key
- [x] `novelforge-spec.md` mentions the script
- [x] Tests run on a scratch Save, never a real one

## Before running it on a real Save

Ask the player first. It sends every older Message to the Text Provider, even though each is cheap. It writes only to the copy, and overwriting the real Save with it is the player's step.

## Not in this ticket

- A Journal button. Add one only if this is needed for more than a few Saves

## Comments

- **Two Snapshots, not one:** the design said the latest Snapshot only, but a Regenerate or Rewrite of the latest Turn starts from the Snapshot before it, so that alone would silently drop every backfilled memory. So the list goes into both Snapshots of the latest Turn. Every older Snapshot is left alone, and these two get new section rows, as sections are shared.
- **A failure and the upgrade:** a failed run writes no memories, and a Save already at this version stays identical byte for byte. A Save at an older version stays upgraded, as opening it does that first.
- **Where the memories end:** just before the first existing memory, otherwise just before the window. That's `memory_start`, except after a Revert has moved the window back past it, where stopping at `memory_start` would take Messages out of the window.
- **The Opening's Message:** it's left out of the batches altogether, so on a Save with an Opening the first memory starts at Message 2.
- **Retries:** a reply with no usable memory gets the Turn's three tries. A Text Provider failure or refusal stops the run at once, and the memories from earlier batches are lost, so a rerun pays for them again.
- **The refusal:** it compares the files themselves, not the text of the path, so case, slashes, `..`, `\\?\` and `\\localhost` spellings and junctions are all caught. Hard links are refused too, as writing to one would write through to the real Save. The folder comes from `git rev-parse --git-common-dir`, so a worktree finds its main checkout, and the script stops if git can't say.
- **A prose refusal:** a model that writes a refusal into `scene_memory` passes as a memory, as nothing can tell them apart. Read the Journal on the copy before keeping it.
- **Not run on a real Save or a real model:** tests use scratch Saves and a fake Text Provider, so memory quality is unjudged.
