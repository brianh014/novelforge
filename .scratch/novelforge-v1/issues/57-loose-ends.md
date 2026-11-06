# 57: Loose Ends

**What to build:** The state gains a list of Loose Ends: what the PC knows is still unresolved, such as unanswered questions, promises, plans, invitations and people still missing. Every finished Turn can add to it, and an item leaves only when play resolves it. The Narrator gets the whole list on every Turn, so these can no longer fall out of the 500-word summary.

**Status:** ready-for-agent

**Blocked by:** none

**Research:** `.scratch/novelforge-v1/story-consistency-research.md`, findings 1 and 2

## Why

The summary has to hold the whole story and every open question in one piece of prose. By Message 295 it had lost Renata, the Summer Social, Marisol, Tyler and the collector, even though the prompt asks it to keep open questions. The rule is too weak because the list has no place of its own. NarraWorld and Coderain both keep open developments as their own record.

## Name

"Loose End", not "open thread", so it can't be confused with a Plot Thread. A Plot Thread is secret and describes where the story could go. A Loose End is known to the PC and describes what is still unresolved.

## Design

- `State` gains `looseEnds: string[]`, stored as a state section like the other lists, so a Snapshot holds it and a Revert restores it
- New operations are `add_loose_end` and `resolve_loose_end`. The second copies the item exactly, as `remove_known_fact` does
- The Current state in the prompt carries the list
- A new prompt rule says to add a Loose End when something is left open, resolve one only when play has settled it, and never resolve one to make room. Loose Ends are written as the PC would write them, with no Lore Entry or Plot Thread secrets
- The summary rule stops asking for every open question, as this list now holds them
- The Journal shows a Loose Ends section, which the player can add to, edit and remove from, as with known facts

## Existing Saves

- A Save from before this ticket upgrades with an empty list, and no Turn fails because of it
- While the list is empty and the story has begun, a prompt rule asks the Narrator to fill it from the summary, known facts and recent Messages, in the same way it's already asked to give known NPCs their missing summaries
- This can't recover what every record has already lost. Renata may need adding by hand in the Journal

## Acceptance

- [ ] `looseEnds` is in `State` and `openingState`, and survives a Revert, Rewrite, Regenerate, export and import
- [ ] An old Save upgrades and opens with an empty list
- [ ] `add_loose_end` ignores an exact repeat, with a count at Info and no story text
- [ ] `resolve_loose_end` on an item not in the list is refused without costing a Turn, and logs its reason at the usual level
- [ ] The operations are in the response schema, and a Check request can't change the list
- [ ] The prompt carries the list and the new rules, and an empty list on a started story asks for it to be filled
- [ ] The summary rule no longer asks for every open question
- [ ] The Journal section can add, edit and remove items, and is empty-safe
- [ ] Hidden text can't reach the list through any route other than the Narrator's own operations, and the prompt forbids that
- [ ] `novelforge-spec.md` and `GLOSSARY.md` describe Loose Ends
- [ ] Tests cover each operation, an upgrade, a Revert and the prompt text

## Not in this ticket

- Hiding Loose Ends from the player
- Reminding the Narrator of a Loose End by the clock, as the Plot Thread nudge does. Add that only if play shows they sit unused
