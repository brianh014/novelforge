# Stateless Turns built from Snapshots

Every Turn is a fresh LLM call assembled from the current Snapshot, a rolling summary and recent Messages, not a long session with auto-compaction. Revert must restore any Message instantly with no API calls, and state must stay independent of the model, neither of which a compacted session can provide. This also allows switching models mid-story.
