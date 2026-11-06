# Narrator review baseline

Measured from Messages 1 to 295 of the Stark Reality story, before the memory and style changes. Tickets 58 and 60 compare against this.

## Baseline: Messages 1 to 295, 140 replies

**Repetition**
| Measure | Baseline |
|---|---|
| Median reply | 290 words |
| Radiator in a reply | about 20% |
| Brick wall | 15-20% |
| Keys on the hook | about 15% |
| Last paragraph names a room prop | about 1 in 6 |
| Dialogue contractions vs spelled-out forms | 65 to 221 |
| "does not" / "do not" | about 4.2 per 1,000 words |
| Player's quoted line repeated back | 6 of 51, 4 of them in the last third |

Stock AI phrases were already rare ("not X but Y" 0, "a beat" about once), so don't credit the changes for those. Compare rates, as the new sample will be small.

**Memory at Message 295**
- 54 known facts, with about 4 versions of the cloth, 3 of the jacket, and 2 each of the keys, the notebook woman, Lena and "nine times"
- 15 NPCs, with "Nadia" and "Woman with notebook" as one person with the same looks
- 8 Plot Threads, 20 Lore Entries, 3 near-identical sore-neck status lines
- Lore sent vs matched: The Ones Who Came Through 0 of 18, Wellness Program 19 of 132, Ellis Crane 29 of 133, Nadia Bell 23 of 53, Meridian Freight 24 of 139
- Summary 273 words at Message 83, 144 at 126, 280 at 295. By the end it had lost Renata, the Summer Social, Marisol, Tyler and the collector

**Stale records to watch**
- The Ellis Crane Plot Thread says he's alive and has a shoebox. The story says he died and there's a banker's box. The Lore Entry has the same stale details
- Nadia's Lore says mid-twenties, cropped hair, sociology, the bench. The story made her early thirties, a low knot, anthropology
- Dana Reyes is HR in Lore but "my manager" in the story. Gerald Pike is the supervisor in Lore
- Two Meridian Freight Lore Entries disagree on floors, and Halden Mutual shares floor eleven
- Lore says 4B's window faces the street. The story says a brick wall, but a fact has a photo of the street taken from that window
- 2C is two floors below 4B, but it's "one flight" in one reply and "on my floor" in a fact
- Yuki Sanada has a Plot Thread and Lore, but she's never been named in the story, despite about three nudges. "The man who wants your jeans" appeared instead
- Nadia planned to scan pages that Lena still has, and told Brian to bring the jacket. The Narrator had him leave it, a choice the player never made

## What to check after more play

1. **New ops:** are they used at all, and correctly? In Messages 297 and 299 the only op was `set_scene`.
2. **Records:** did any stale record above get fixed? Did `merge_npc` merge Nadia? Did the fact count fall or grow more slowly?
3. **Summary:** does it now keep open questions? At Message 299 it still left out Renata, so the "every open question" rule may be too weak.
4. **Lore:** does the Wellness Program entry reach the Narrator on the assessment? Do the plot entries stop being crowded out? At 6,000 tokens the whole World Bible should fit.
5. **Prose:** compare the rates above. Are new props simply replacing the old ones?
6. **Corrections:** when the player assumes something untrue, does the reply correct it? Is it overcorrecting a true claim because its records are stale?
7. **PC agency:** does it still make choices for the PC?
8. **Failed Turns:** look for `Unusable Narrator reply` lines. The new ops shouldn't cost a Turn, and the larger schema shouldn't either. Also look for NPCs coming back after a merge, as nothing enforces the kept name.

