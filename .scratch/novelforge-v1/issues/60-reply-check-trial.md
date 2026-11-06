# 60: Try a check on finished replies

**What to find out:** Can a second model call reliably catch a bad Narrator reply before the player sees it? This ticket is a trial on a copy of a Save, and it changes nothing in the app. Its answer decides whether a real check gets built.

**Status:** needs-triage

**Script:** `scripts/check-replies.ts` is built and not run. See Comments

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

## Comments

- **Built, not run:** `scripts/check-replies.ts` is built and tested on scratch Saves with a fake Text Provider. It has never run on a real Save or a real model, so this ticket's questions have no answers yet, and no prompt wording is proven. It stays `needs-triage`, blocked on two things only the player can give: permission to read their story for this, and how to handle the stale records.
- **How to run it:** take a copy of the Save outside the main checkout's Saves folder, write the labels file, then run `bun run scripts/check-replies.ts <Save copy> <settings.json> <labels.json>`. Each sampled reply costs a Text Provider call about the size of a Turn's prompt. Afterwards, delete the copy and `<Save copy>.check-replies.json` together, as the results can quote the story.
- **Labels file format:** JSON, keyed by the reply's Message id, with all four marks true or false for each. `true` means the reply has that fault. Any other key, such as `note`, is ignored. An empty `{}` runs the sample with nothing to compare. An id that isn't a reply in the Save stops the run before any call, and a Rewrite gives a reply a new id, so take ids from the same copy:

  ```json
  {
    "712": { "contradicts": false, "decides_for_pc": true, "repeats_player": false, "background_ending": false, "note": "left the jacket behind" }
  }
  ```

- **What it reads:** the copy is read once into memory, with no SQLite connection to the file, so an older Save upgrades in memory and the file can't change. It refuses the main Saves folder and hard links through the backfill's own check. A Save mid-write, with a leftover `-journal` beside it, is read without that journal, so copy it with no Turn running.
- **What each reply is judged on:** the Turn's prompt rebuilt with `assemblePrompt` from the Snapshot of the player Message before the reply, plus its stored Check result and any edits a replacement kept. The whole prompt goes as JSON data, with the four questions in a short system message. The Opening is left out, as it answers no player input.
- **The rebuilt prompt isn't the original:** it uses today's rules, today's Model Instructions from the settings file and today's `memory_start`, as none of those are stored per Turn. Rewrite feedback isn't stored, so a reply from a Rewrite is judged without it. Snapshots from before tickets 57 and 58 have empty Loose Ends and Scene Memories, and the backfill writes only to the latest two Snapshots, so older replies are judged on the summary and facts alone.
- **Sample:** 50 replies evenly spaced, so a run is repeatable, plus every id in the labels file.
- **Output:** the console gets counts only: caught, missed, false alarms and clean per question and overall, good replies rejected, unmarked replies with a yes, replies with no answer, and seconds and cost per reply. A good reply is one marked false on all four. Reasons go only in `<Save copy>.check-replies.json`, written after every reply, so a stopped run keeps what it paid for. The script won't overwrite that file, so move it away to run again.
- **Spoilers:** the check sees Lore Entries and Plot Threads, as a stale one is exactly what can cause a false rejection, and it's told to keep them out of its reasons. That rests on the model obeying, so treat the results file as holding secrets as well as story text.
- **Refusals:** a reply the model refuses, or a failed call, is counted under "No answer" and the run goes on, as an adult story may be refused reply by reply. A high count is itself a finding about the Text Model.
- **Cost is an estimate:** it's estimated tokens, the same four-characters rule Lore uses, at the prices the server's model list gives, and it's "unknown" where there are none, as on a local server. `TextProvider` doesn't pass on the provider's own usage, and this ticket changes nothing in the app.
- **App code:** `readReplies` in `src/save-store.ts` is new and only this script calls it. `Refused` and `assertIsACopy` are now exported from the backfill. Nothing the app runs has changed.
