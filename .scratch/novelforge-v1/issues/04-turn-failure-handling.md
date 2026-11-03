# 04: Turn failure handling

**What to build:** Any failed Turn leaves the Save unchanged and tells the client what happened, so the player can continue.

**Blocked by:** 01

**Status:** ready-for-agent

- [x] A failed Turn writes nothing to the Save, including a failure partway through a Turn
- [x] Invalid JSON retries automatically up to twice, then fails cleanly
- [x] A Narrator response with a refused state operation retries the same way
- [x] A content refusal is reported as a refusal, with the player's text available to edit
- [x] Network and API errors are reported as retryable
- [x] Retrying after a failure works and creates exactly one Turn
