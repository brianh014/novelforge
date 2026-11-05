# 42: Reading a streaming response

**What to build:** A new Turn puts the player's words at the top of the story, so the response can be read as it arrives.

**Status:** done

- [x] The player's words snap to the top of the view, even in a short Turn
- [x] The response streams in below them without moving them
- [x] The down arrow shows once text runs past the bottom
- [x] The end of the response doesn't move the view
- [x] Scrolling by hand stops the following
- [x] Bubbles and Script seen in a browser
- [x] Stage box is untouched

## Comments

- **Asked for by the user (2026-11-04):** first, stop following once the response fills the view. Then, after trying that, snap their own words to the top instead.
- Measured in headless Chrome with a fake streaming text server, in Prose at desktop and phone widths. Bubbles used the earlier version of this behaviour and hasn't been run since the snap. iOS Safari hasn't been run.
- A Turn that finishes while the player is away opens at the end of the response on return, like any page load, not at their words.
- **Reported by the user (2026-11-04):** the view still snapped to the bottom as a response ended. A tap or wheel in the story during a Turn stopped the following, and the end of that Turn then removed the blank room, so the text dropped to the bottom. Now only a real scroll stops the following, and the room stays either way.
- **Reported by the user (2026-11-04):** the view still snapped to the bottom at the end, but only after they had started scrolling. Reproduced in headless Chrome: a real scroll down during the stream jumped 46 to 292px at the end, while scrolling up or not at all stayed put. Chrome's scroll anchor had settled in the streamed text, and rode it down when that text was replaced by the finished Message. `overflow-anchor: none` stopped the snap, but the text then slid under the reader while streaming, so the anchor stays and the end of a Turn puts the player's words back where they were. Measured with no jump after a scroll in Prose (both widths, short and long), Bubbles, Script and a Rewrite, and with a failed Turn left alone. Bubbles and Script were measured, not looked at. Phone width used `scrollBy`, as touch input didn't reach the page headlessly. No test opens a browser, so nothing automated guards this. iOS Safari has no scroll anchoring, so it may not have had this snap, but the text may slide while streaming after a scroll there.
- **User sign-off (2026-11-05):** closed on the user's word. Any unticked box stays unticked, as that check wasn't recorded as run.
