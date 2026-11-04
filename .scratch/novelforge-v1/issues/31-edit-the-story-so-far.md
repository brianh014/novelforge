# 31: Edit the story so far

**What to build:** A way for the player to correct the story when the model does something off. It replaces Director's Notes, which were standing instructions rather than edits.

**Blocked by:** the user's answer on how an edit should work

**Status:** needs-info

## Criteria

- [ ] Decided with the user, then filled in

## Comments

- Raised by the user on 2026-11-04.
- Director's Notes left the Story screen and the Narrator's prompt in ticket 30, so any left in a Save can't steer the story unseen.
- Their REST routes, `changeNotes`, `pending_notes`, the `directorsNotes` state and about 25 tests remain, as they also cover Revert and replacement. Reuse or delete them here. The routes carry a `shortcut:` comment.
