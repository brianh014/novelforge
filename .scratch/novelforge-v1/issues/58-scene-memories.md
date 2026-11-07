# 58: Scene Memories

**What to build:** Older story fades instead of vanishing. Each batch of 20 Messages gets a Scene Memory of about 100 words, written by the Narrator before those Messages leave the prompt. Every Scene Memory goes to the Narrator on every Turn, so its memory runs from full text, to Scene Memories, to the overall summary.

**Status:** ready-for-human

**Blocked by:** none, but commit the `RECENT_MESSAGES = 100` change on `main` first, as it touches the same code

**Research:** `.scratch/novelforge-v1/story-consistency-research.md`, findings 3 and 4, Similar projects, and Recommended design

## Why

Anything that leaves the prompt now survives only if the summary, known facts or Lore happen to hold it. Coderain's folded scenes, Summaryception and Talemate's layered history all show this is a working pattern. Qvink's reasoning shapes one rule here: a model never rewrites a stored memory, because repeated rewriting is where memories degrade.

## Design

### Storage

- `State` gains `sceneMemories: { firstMessage: number; lastMessage: number; text: string }[]`, stored as a state section, so a Snapshot holds it and a Revert or Rewrite undoes it
- Message ids record where each memory came from, so a wrong memory can be traced to its source and redone

### Writing

- The window is every Message after the last one a Scene Memory covers, so a Message can't leave the prompt before it's covered
- Once that window reaches 100 Messages, the Turn's prompt asks for a memory of its oldest 20 Messages, the same way the Plot Thread nudge adds its line
- The response schema gains a nullable `scene_memory` field, and the server, not the Narrator, records the Message range
- A missing or empty memory costs nothing. It's simply asked for again next Turn, and the window keeps those Messages until then
- A Turn answered with a Check writes no memory, so only a finished Turn does

### Content

- About 100 words, covering what happened, who was there, and what changed
- Only what the PC experienced, with no Lore Entry or Plot Thread secrets, as the player reads these
- Written as past events, not as prose to imitate, so old habits of style don't return with them

### Prompt

- Every Scene Memory goes in the first system message, oldest first, next to the summary
- They're always sent, with no keyword activation and no retrieval. At 5,000 Messages that's about 245 memories, or 33,000 tokens by estimate, well inside the model's 1,050,000

### Journal

- A Scene Memories section lists them, newest first, and the player can correct each with the pencil, as with the summary
- No operation lets the Narrator change a stored memory

### Existing Saves

A Save with no Scene Memories starts with its window at its latest 100 Messages. Everything older stays with the summary until ticket 59 fills it in.

## Acceptance

- [x] `sceneMemories` is in `State` and `openingState`, and survives a Revert, Rewrite, Regenerate, export and import
- [x] An old Save upgrades, opens, and keeps its latest 100 Messages in the prompt
- [x] A new story sends every Message until the window reaches 100, then asks for a memory of the oldest 20
- [x] A finished memory moves the window on, so those 20 Messages leave the prompt
- [x] A Turn that omits the memory still commits, and the next Turn asks again with the same Messages in the prompt
- [x] A Rewrite or Regenerate of the Turn that wrote a memory replaces it, and a Revert before it removes it
- [x] The server records the Message range, and nothing the Narrator returns can set it
- [x] Scene Memories reach the prompt oldest first, and hidden text can't reach them except through the Narrator's own reply, which the prompt forbids
- [ ] The Journal shows them, and a player's edit is what the next prompt sends
- [x] The Server Log gives a memory's Message range and length, with no story text
- [x] `novelforge-spec.md` and `GLOSSARY.md` describe Scene Memories, and the window comment in the prompt code explains the rule
- [x] Tests cover the window, a missed memory, a Rewrite, a Revert and an upgrade

## Not in this ticket

- Filling in Scene Memories for older Messages, which is ticket 59
- Merging old Scene Memories into chapter memories. Add that only if they outgrow the budget, and keep the originals underneath so a merge can be redone
- Reminders that bring back the original Messages when a rare name returns. They become useful only if memories stop fitting, or prove too thin
- Per-NPC knowledge

## Comments

- **Journal box left unticked:** the route, the edit and the next prompt are tested, and the page typechecks and bundles, but nobody has seen the new section in a browser.
- **Prompt text not judged:** tests show the words reach the prompt. Whether models write good memories needs real play.
- **Upgrade start point:** the window on an old Save must stop rolling, or a missed memory would drop a Message uncovered. So the upgrade stores the oldest of the latest 100 Messages in a `memory_start` column. It's on the Save, not in the state, because old Snapshots hold no such value, and a Regenerate right after the upgrade would otherwise lose it.
- **Revert on an old Save:** going back before `memory_start` shows the latest 100 Messages, and these can still roll until the first memory is written. Those Messages were already left to the summary at the upgrade, so nothing the rule protects is lost.
- **Edits and replaced Turns:** a player's correction of a memory is lost if the Turn that wrote it is then Rewritten or Regenerated, as the replacement writes a new memory.
- **World Change:** it neither reads nor writes Scene Memories, so a memory can go on saying something a World Change made untrue. The player can correct it in the Journal. Letting the reply change memories would break the rule that no model rewrites one.
- **Batches:** always 20 Messages, so a batch can end between a player Message and its reply after a Revert leaves two player Messages in a row.

## After shipping

Compare a stretch of play with memories against `.scratch/novelforge-v1/narrator-review-baseline.md`. If quality drops at 100 Messages, as Summaryception's author would predict, lower the window to about 50.

- **The window is now 80, set on 2026-11-06 after 50 lost too much of the story:** a memory falls due at 80 and takes the oldest 20, so the window runs between 60 and 80 Messages. Each memory now has its own call beside the Turn, as memories written inside a reply came out as whole-story recaps. A missed one costs nothing and is tried again next Turn.
