# 61: The summary repeats the Narrator's slips

**What to find out:** Should the summary step check what it records against the Messages, so that a mistake in one reply doesn't become memory?

**Status:** needs-triage

**Found in:** the Rightous review (Save `9e6413ef-…`, Messages 1 to 142)

## What happened

- Reply #128 says the new writ is in "the same clerk's hand as the writ Torren had shown him". Torren never showed a writ. He only heard about one from the second company's leader (#19).
- The summary at #142 now says "Torren the cooper showed him a writ", so the slip has become a record.
- The same summary says "Aldric showed them the writ". It was the other way round: Ferrow showed hers to Aldric (#128).
- A Scene Memory has "Seraine Ashvane" for Seren Ashvane.

## Options

1. Tell the summary step that it must never record something it can't find in the Messages, Scene Memories or known facts.
2. Leave it and let the check in ticket 60 catch the reply that started it.
3. Do nothing. These are small, and only cost anything if a later reply leans on them.
