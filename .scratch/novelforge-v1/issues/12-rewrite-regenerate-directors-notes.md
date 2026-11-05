# 12: Rewrite, Regenerate and Director's Notes

**What to build:** A player can correct the story by giving feedback on the latest Narrator response, replacing it, or adding a standing Director's Note.

**Blocked by:** 09

**Status:** done

- [x] Rewrite regenerates the latest Narrator response using the player's feedback
- [x] Regenerate replaces the latest Narrator response without feedback
- [x] Both replace the response and its state changes, so no stale state remains
- [x] Both update the summary and Journal
- [x] Both reuse the Turn's stored roll, and neither creates a new one
- [x] Failures leave the existing response in place
- [x] A player can add, edit and remove Director's Notes
- [x] Director's Notes reach the Narrator on later Turns and are restored by Revert

## Comments

- **Check decision.** A replacement takes no Dice, so it cannot roll. A Turn with a stored Check goes straight to the result call, and the new row keeps the Check. A Turn with no Check stays without one: the prompt says not to request one, and a Check request anyway counts as an invalid reply, which spends the normal retries and then fails with the existing response in place. The spec says "Only a new Turn rolls again", and rolling here would let Regenerate buy a Check the Turn never had.
- **Notes and Snapshots.** Snapshots stay immutable, so a Note change writes no Snapshot. It waits in `save.pending_notes`, which every read of the current state applies, and the next Message's Snapshot takes it up, which is a Turn's player Message or a replacement's Narrator Message. A Revert clears it. So a Revert to a Message restores the Notes that Message was written with: a Note deleted while Message N was the latest comes back on a Revert to N, and a Note added while N was the latest is gone. A first version relinked the latest Snapshot instead, and review rejected that for losing the deleted Note.
- A replacement commits as a new Narrator Message with a new id, built from the player Message's Snapshot plus the current Director's Notes. The new id is what makes `StaleTurn` catch a Turn or replacement in flight from the old response, and what lets a dropped stream find the result. So the two Messages of a Turn are not always consecutive ids.
- A response can only be replaced while it is the latest Message. After a Revert to a player Message there is nothing to replace, and the route returns 409.
- Rewrite's feedback reaches the Narrator as JSON with the rejected response, ahead of any Check result, so the result has the last word. Regenerate leaves the old response out of the prompt entirely.
- The replacement does not have to call `set_summary`. Without one, the summary falls back to the one from before the Turn, which is what an ordinary Turn with no `set_summary` would leave.
- Leaving the page mid-Rewrite drops the feedback. Unlike a Turn's text it is not kept for the player's return, as it is only a correction and the response stays in place.
- Routes: `POST /saves/:id/messages/:messageId/rewrite` (`{ feedback }`) and `/regenerate` (`{}`), both following the Turn's JSON or stream contract with `messages` holding only the new Narrator Message. `GET`/`POST /saves/:id/notes` and `PATCH`/`DELETE /saves/:id/notes/:index`, which return `{ notes }`.
- `replaceTurn` deletes through `deleteAfter`, so ticket 17's image deletion there will cover a replaced response too.
- Checked in headless Chrome against the compiled executable and a local fake OpenAI-compatible server, at 1280, 390 and 320 wide in light and dark: Regenerate and Rewrite by keyboard, streaming, failures leaving the response, and adding, editing and removing Notes, then a Revert restoring them. No horizontal scroll, no requests off localhost, and the only console error was the existing missing favicon.
- **User sign-off (2026-11-05):** every criterion was already ticked, so the status was only out of date.
