# 58: Scene Memories

**What to build:** Older story fades instead of vanishing. Each batch of 20 Messages gets a Scene Memory of about 100 words, written by the Narrator before those Messages leave the prompt. Every Scene Memory goes to the Narrator on every Turn, so its memory runs from full text, to Scene Memories, to the overall summary.

**Status:** ready-for-agent

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

- [ ] `sceneMemories` is in `State` and `openingState`, and survives a Revert, Rewrite, Regenerate, export and import
- [ ] An old Save upgrades, opens, and keeps its latest 100 Messages in the prompt
- [ ] A new story sends every Message until the window reaches 100, then asks for a memory of the oldest 20
- [ ] A finished memory moves the window on, so those 20 Messages leave the prompt
- [ ] A Turn that omits the memory still commits, and the next Turn asks again with the same Messages in the prompt
- [ ] A Rewrite or Regenerate of the Turn that wrote a memory replaces it, and a Revert before it removes it
- [ ] The server records the Message range, and nothing the Narrator returns can set it
- [ ] Scene Memories reach the prompt oldest first, and hidden text can't reach them except through the Narrator's own reply, which the prompt forbids
- [ ] The Journal shows them, and a player's edit is what the next prompt sends
- [ ] The Server Log gives a memory's Message range and length, with no story text
- [ ] `novelforge-spec.md` and `GLOSSARY.md` describe Scene Memories, and the window comment in the prompt code explains the rule
- [ ] Tests cover the window, a missed memory, a Rewrite, a Revert and an upgrade

## Not in this ticket

- Filling in Scene Memories for older Messages, which is ticket 59
- Merging old Scene Memories into chapter memories. Add that only if they outgrow the budget, and keep the originals underneath so a merge can be redone
- Reminders that bring back the original Messages when a rare name returns. They become useful only if memories stop fitting, or prove too thin
- Per-NPC knowledge

## After shipping

Compare a stretch of play with memories against `.scratch/novelforge-v1/narrator-review-baseline.md`. If quality drops at 100 Messages, as Summaryception's author would predict, lower the window to about 50.
