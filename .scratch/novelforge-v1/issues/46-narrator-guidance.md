# 46: Keeping the Narrator on track

**What to build:** The Narrator leaves the PC's choices to the player, keeps the summary current, and brings idle Plot Threads into play.

**Status:** done

- [x] The prompt's last instruction keeps the PC's choices and speech to the player, and thoughts private
- [x] Each finished Turn's `summary` replaces the story's
- [x] A blank, malformed or missing summary changes nothing and costs no Turn
- [x] Every eighth response names the next Plot Thread in turn
- [x] A story with no Plot Threads gets no nudge
- [ ] Seen with the real model on the real Save

## Comments

- **Asked for by the user (2026-11-05):** after a review of the Narrator on their Save, which found "I think" read as speech, choices made for the PC, a summary last updated at Message 43, and four Plot Threads with no page time.
- `summary` is a required reply field, like `people` in ticket 45, as `set_summary` was an optional operation the model skipped. `set_summary` still works, so an older habit can't fail a Turn.
- The whole summary is written each Turn, which adds up to about 300 words of output to every Turn.
- Older replies in the prompt leave `summary` out, to save tokens, so a late instruction asks for every field.
- Threads get a turn by the clock, as which have shown isn't tracked, so one already in play can be nudged too, and a nudge can be ignored.
- **User sign-off (2026-11-05):** closed on the user's word. Any unticked box stays unticked, as that check wasn't recorded as run.
