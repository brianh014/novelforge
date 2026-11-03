# 12: Rewrite, Regenerate and Director's Notes

**What to build:** A player can correct the story by giving feedback on the latest Narrator response, replacing it, or adding a standing Director's Note.

**Blocked by:** 09

**Status:** ready-for-agent

- [ ] Rewrite regenerates the latest Narrator response using the player's feedback
- [ ] Regenerate replaces the latest Narrator response without feedback
- [ ] Both replace the response and its state changes, so no stale state remains
- [ ] Both update the summary and Journal
- [ ] Both reuse the Turn's stored roll, and neither creates a new one
- [ ] Failures leave the existing response in place
- [ ] A player can add, edit and remove Director's Notes
- [ ] Director's Notes reach the Narrator on later Turns and are restored by Revert
