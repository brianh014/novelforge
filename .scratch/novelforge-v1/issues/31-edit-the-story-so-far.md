# 31: Edit the story so far

**What to build:** A way for the player to correct the story when the model does something off. It replaces Director's Notes, which were standing instructions rather than edits.

**Blocked by:** none

**Status:** wontfix

## Criteria

- [x] Decided with the user: nothing new is needed

## Comments

- Raised by the user on 2026-11-04.
- Director's Notes left the Story screen and the Narrator's prompt in ticket 30, so any left in a Save can't steer the story unseen.
- Their REST routes, `changeNotes`, `pending_notes`, the `directorsNotes` state and about 25 tests remain, as they also cover Revert and replacement. The routes carry a `shortcut:` comment.
- Decided by the user on 2026-11-04: Rewrite covers correcting the Narrator. Director's Notes stay off the screen and out of the prompt, and their code stays, as they may come back. To bring them back, restore the Story screen's dialog and the prompt line from before ticket 30.
