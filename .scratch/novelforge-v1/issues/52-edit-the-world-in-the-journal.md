# 52: Edit any part of the world in the Journal

**What to build:** The player can edit what the Journal shows in place, and can change the hidden world by telling the Narrator what should be true. Hidden information stays hidden the whole way through.

**Status:** ready-for-human

**Blocked by:** 51, for the `world_update` reply it moves

- [x] The World Brief, Recent summary, each fact in What the PC knows, and each NPC's summary can be edited in the Journal
- [x] Facts can be added and removed as well as edited
- [x] A box in the Journal takes plain words for a hidden change, such as "the mayor is secretly a smuggler"
- [ ] One Narrator call applies it to the World Bible, world rules and Plot Threads, changing only what it touches
- [x] The player sees only that it was done, or that it failed. No reply, error or route gives hidden text to the SPA
- [x] The next Turn uses the edited world
- [x] A Revert to before an edit undoes it, for hidden and visible edits alike
- [x] Regenerate and Rewrite of the latest response keep an edit made since it
- [x] Editing is refused while a Turn is running
- [x] Hidden text stays out of the log
- [x] `novelforge-spec.md` and `GLOSSARY.md` say how this works now, including that this is a new out-of-character input

## Comments

- **User request (2026-11-05):** "Ability to edit any part of the world in the journal. Hidden info can be changed, but not displayed to the player".
- **User answers (2026-11-05):** hidden changes go through the Narrator ("Tell the Narrator"), and a Revert undoes an edit.
- Agent's defaults, not yet confirmed:
  - The World Brief sits on the Save, not in a Snapshot, so an edit to it survives a Revert unless it moves. Decide when building: move it, or accept that one exception.
  - NPC names can't be edited here, as portraits and Image Prompt marks find people by name.
  - Inventory and status keep their own tab. The Full Log isn't editable. The PC's details aren't in the Journal, so they're out of this ticket.
- Build notes:
  - Snapshots are immutable and `writeSnapshot` never rewrites a section. `pending_notes` is the precedent: a change held on the Save that `currentState` lays over the latest Snapshot, and the next Message stores. Check how Revert and replacement clear it before reusing the pattern.
  - The hidden change can reuse the `world_update` reply and merge from ticket 51's move. Its lists replace the old ones whole, so a Narrator that drops one loses it. The same `shortcut:` applies, and this time the player can't see the loss, so consider requiring only changed entries.
  - The player's words are data for the Narrator's call, framed like `CHOICES_ARE_DATA`, though here they are a deliberate instruction about the world.
- Built (agent, 2026-11-05). Decisions, for the user to review:
  - **World Brief and Revert: moved into the Snapshot.** The box says a Revert undoes visible edits too, so no exception. It is a new `worldBrief` section, one row shared by every Message after the upgrade. `saves.read` returns that one, so the prompt, Journal and Load Game all follow it. The `world_brief` column stays as the World Brief the Save began with, and nothing reads it now but import's check.
  - **The Save version goes to 12 in this ticket**, not only in 53: `save.pending_edits`, `messages.edits` and the new section. A real Save upgrades when a new build opens it, and an older build then refuses it. 53 now raises it to 13.
  - **An edit is stored as a change, not as the new section.** `pending_notes` holds a whole list, which a Regenerate would lay over a state from before the response, bringing back what the replaced response wrote. Replaying changes over the player Message's Snapshot avoids that.
  - **Regenerate twice:** the first replacement stores the edit only in its Narrator Snapshot, so a second would start from the player Message and lose it. The edits now ride on the Narrator Message, as its Check does, and a Revert past it takes them too.
  - **An edit to something only the replaced response wrote** stands as an addition. A removal of it does nothing, so the new response can write that fact again.
  - **The whole-list loss is gone.** `WorldUpdate` now holds only changes: Lore Entries to add or rewrite by exact title, `removed_lore`, and `{old, new}` for each rule and thread changed. What a reply leaves out stays. A misquoted `old` or a reply that changes nothing is unusable and gets the three tries, so the player is never told "done" for nothing. `WorldUpdate` and `mergeWorldUpdate` moved to `src/state-applier.ts`, as the Save store needs them, and a rewritten Lore Entry keeps its place and whether it's always on.
  - **While the Narrator changes the world**, Turns and edits are refused with their own message, and the page shows no running Turn. A Revert during one wins, and the change then fails with the 409 for a story that moved.
  - **Duplicate from the latest Message** starts from that Message, so it leaves out an edit made since, as Director's Notes did. A whole-Save Duplicate and an export keep it.
  - An edit can't be empty, so the summary or an NPC's summary can't be blanked. Remove is for facts.
  - The hidden change also sees the World Brief and the summary, so it needn't contradict the story. It never touches the Journal's text, so a known fact the change contradicts stays until the player edits it.
  - Failures of a hidden change log no cause, as a provider's error can echo the prompt. The one other line that can, `Schema mode rejected`, keeps its first 300 characters, and this prompt puts the world after those, which a test holds to.
- Checked: `test/edit-the-world.test.ts` (each box, and each failure path with a marked secret looked for in the reply and the log), and a real Chrome run on port 4602 with a scratch Saves folder and a fake text server. It drove every edit, Add, Remove, Cancel, Tell the Narrator done, malformed and refused, both refusals during a Turn, a Regenerate and a Revert through the page, and phone width with no sideways scroll. None of its 71 page responses, nor the log, held hidden text.
- Left unticked: "One Narrator call applies it... changing only what it touches". The merge is proven, but that a real model picks the right entries and quotes rules exactly has only been faked. No real model was called, as that costs money. Try "the mayor is secretly a smuggler" on a real Save and see that the next Turns reflect it. If it often fails with "no usable response", the model is misquoting.
- Not checked: a real Save upgrading to 12 (only a hand-made older Save in a test); iOS Safari; leaving the Journal during a hidden change. That still applies, but nothing says so afterwards, and the player can't see the result. The Journal shows a refusal during a Turn only after Save is pressed, as it doesn't know a Turn is running.
- shortcut noted: a change to the hidden world only reaches a Turn through a Lore Entry's keywords, as ever, so one with poor keywords may stay asleep.
