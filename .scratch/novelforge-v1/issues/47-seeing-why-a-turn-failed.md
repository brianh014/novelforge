# 47: Seeing why a Turn failed

**What to build:** When a Turn goes wrong, the player can clear the error and the server log shows what happened, without repeating the story. A garbled reply retries by itself.

**Status:** ready-for-human

- [x] A line in the reply's stream that isn't JSON retries, like any invalid reply
- [x] A stream that stays broken fails as retryable after three tries
- [x] Each reply logs its model, generation, provider, finish reason, usage, size and time
- [x] Each committed Turn logs attempts, summary length, people and operations
- [x] Each unusable reply logs why, by field name
- [x] A client that leaves is logged as that, not as a failed Turn
- [x] No log line holds narration or the player's text
- [x] Each new Message stores when it was written, and older Messages stay null
- [x] Every line of the server log has a time
- [x] The error above the input box can be dismissed, seen in a real browser at phone width
- [ ] Seen with the real model on the real Save

## Comments

The failed Turn that started this logged one error and no `A Turn failed:` line, which only happens when the client has already left. So it was a dropped connection, such as a phone locking or a page reload, and not a bad reply. The retry here doesn't cover that case: the server still stops a Turn when its client goes. Keeping a Turn running without its client is a separate change.
