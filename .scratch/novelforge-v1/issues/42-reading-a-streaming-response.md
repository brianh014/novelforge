# 42: Reading a streaming response

**What to build:** A new Turn puts the player's words at the top of the story, so the response can be read as it arrives.

**Status:** ready-for-human

- [x] The player's words snap to the top of the view, even in a short Turn
- [x] The response streams in below them without moving them
- [x] The down arrow shows once text runs past the bottom
- [x] The end of the response doesn't move the view
- [x] Scrolling by hand stops the following
- [ ] Bubbles and Script seen in a browser
- [x] Stage box is untouched

## Comments

- **Asked for by the user (2026-11-04):** first, stop following once the response fills the view. Then, after trying that, snap their own words to the top instead.
- Measured in headless Chrome with a fake streaming text server, in Prose at desktop and phone widths. Bubbles used the earlier version of this behaviour and hasn't been run since the snap. iOS Safari hasn't been run.
- A Turn that finishes while the player is away opens at the end of the response on return, like any page load, not at their words.
