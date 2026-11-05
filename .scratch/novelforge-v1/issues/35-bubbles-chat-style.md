# 35: Bubbles chat style is broken

**What to build:** In the Bubbles chat style, the PC's words were unreadable and NPC speech showed as narration.

**Blocked by:** none

**Status:** done

## Criteria

- [x] The PC's words are readable in their bubble, in both themes
- [x] NPC lines show as bubbles when the model leaves out the brackets from `[Name]:`
- [x] A colon in ordinary narration doesn't make a speaker
- [x] The bracketed form still works

## Comments

Checked in Chrome on a copy of the user's Save: 23 NPC bubbles and 6 PC bubbles, where no NPC line had one before.

The PC's text took the muted colour meant for player lines outside a bubble, on the bubble's accent background.

None of the 23 spoken lines in the Save's last 12 Narrator messages used the brackets. The fix reads existing Saves without changing them, and no prompt changed.

Bare names now also get a speaker in the Prose, Script and Stage styles. In Prose that means the name is coloured and loses its colon, the same as a bracketed line.

Limit: a bare name is capitalized words before a colon and a quote, so "Sign: “Closed”" gets a speaker and "Jan van Dijk" doesn't. Recorded as a `shortcut:` comment in `src/web/chat-style.tsx`.
