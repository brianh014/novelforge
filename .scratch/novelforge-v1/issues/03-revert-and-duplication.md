# 03: Revert and duplication

**What to build:** A client can Revert to any Message, restoring its Snapshot instantly and permanently deleting everything after it. A client can also duplicate a Save, either whole or from a chosen Message. No API call to a model is needed.

**Blocked by:** 02

**Status:** ready-for-agent

- [x] The API reports how many Messages and images a Revert would delete, before it happens (images are always 0 until ticket 17)
- [x] Revert restores the target Message's Snapshot and makes no provider call
- [x] Revert deletes later Messages, Snapshots and images in one transaction (image deletion arrives with ticket 17)
- [x] Orphaned Snapshot sections are swept, and sections still used by remaining Messages survive
- [x] A test covers the sweep against shared sections
- [x] Duplicating a Save creates an independent Save
- [x] Duplicating from a Message creates a Save that ends at that Message
- [x] Duplicates contain no API keys (Saves hold no keys, ticket 14 adds the test)
