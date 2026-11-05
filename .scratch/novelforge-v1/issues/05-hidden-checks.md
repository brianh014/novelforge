# 05: Hidden Checks

**What to build:** Risky actions are decided by a hidden Check. The Narrator requests a Check with a difficulty, the server rolls a d20, and a second call narrates the result. The player never sees any part of it.

**Blocked by:** 02

**Status:** done

- [x] The Narrator's response can be either a finished Turn or a Check request
- [x] Safe actions use one call, and Checks use two
- [x] Difficulty must be Easy (5), Moderate (10), Hard (15) or Very Hard (20), and anything else is rejected
- [x] The d20 comes from a Dice port that tests can script
- [x] The second call receives the outcome and degree
- [x] Natural 20 is a strong success, natural 1 is a bad failure, and a near miss is mixed
- [x] The near-miss margin is one configurable value
- [x] The roll is stored with the Turn
- [x] Player text claiming a roll has no effect on the result
- [x] Tests with unique markers prove no player-facing response reveals a Check, roll or difficulty

## Comments
- **User sign-off (2026-11-05):** every criterion was already ticked, so the status was only out of date.
