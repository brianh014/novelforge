# 43: Turns survive leaving the Story

**What to build:** Changing screens during a Turn no longer cancels it.

**Status:** done

- [x] A running Turn lives outside the Story screen
- [x] A failure while away is shown on return, with the player's text back in the box
- [x] Returning mid-Turn shows the text so far and carries on
- [x] Returning after it finished shows the response
- [x] An item used during a Turn waits in the box

## Comments

- **Reported by the user (2026-11-04):** the request was cancelled on changing screens. That was by design: leaving aborted the request, and the server stopped the Turn.
- Reloading or closing the page still ends the Turn, as the server stops when the connection drops. A phone that drops the connection in the background would do the same.
- Checked in headless Chrome with a fake streaming text server.
