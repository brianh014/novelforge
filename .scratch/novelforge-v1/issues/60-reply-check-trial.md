# 60: Try a check on finished replies

**What to find out:** Can a second model call reliably catch a bad Narrator reply before the player sees it? This ticket is a trial on a copy of a Save, and it changes nothing in the app. Its answer decides whether a real check gets built.

**Status:** needs-triage

**Blocked by:** 57, 58, and fixing or retiring the stale records in `.scratch/novelforge-v1/narrator-review-baseline.md`. A check against stale records would reject correct replies

**Research:** `.scratch/novelforge-v1/story-consistency-research.md`, finding 7

## Questions for each reply

1. Does it contradict the known facts, Loose Ends, Scene Memories or the state?
2. Does it decide, say or choose something for the PC that the player didn't give?
3. Does it repeat the player's words?
4. Does it end on a background sound or passing detail?

## Method

- Work from a scratchpad copy of a Save, opened read-only, and delete the copy afterwards. Only do this with the player's go-ahead
- Rebuild each sampled Turn's prompt from its Snapshot, and ask the questions with the current Text Model, with a yes or no and a short reason for each
- Sample about 50 replies, including replies known to break a rule, such as the one where the Narrator left the jacket behind
- Compare the answers with a hand-marked list, and with the player's own view of any that disagree
- Print counts and short non-adult reasons only, and never quote adult text

## The answer should give

- How often it catches a real fault, and how often it rejects a good reply
- How many seconds and how much money it would add to a Turn
- Whether it flattens surprises, by reading any good replies it rejects
- A recommendation: build it, drop it, or try a decision model such as Jev

## When a real check is worth building

Only if false rejections are rare, as each one would rewrite a good reply, and if a rewrite can be limited to one attempt, so a check can never cost the player a Turn.

## Decision models

Jev isn't part of this trial. Its content policy, access and accuracy would need confirming first, as the story is adult, and the current Text Model needs no new provider.
