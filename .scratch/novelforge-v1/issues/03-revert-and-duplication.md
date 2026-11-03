# 03: Revert and duplication

**What to build:** A client can Revert to any Message, restoring its Snapshot instantly and permanently deleting everything after it. A client can also duplicate a Save, either whole or from a chosen Message. No API call to a model is needed.

**Blocked by:** 02

**Status:** ready-for-agent

- [ ] The API reports how many Messages and images a Revert would delete, before it happens
- [ ] Revert restores the target Message's Snapshot and makes no provider call
- [ ] Revert deletes later Messages, Snapshots and images in one transaction
- [ ] Orphaned Snapshot sections are swept, and sections still used by remaining Messages survive
- [ ] A test covers the sweep against shared sections
- [ ] Duplicating a Save creates an independent Save
- [ ] Duplicating from a Message creates a Save that ends at that Message
- [ ] Duplicates contain no API keys
