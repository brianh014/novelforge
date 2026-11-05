# 48: A Turn goes on without the page

**What to build:** The player can switch to another app while a slow Turn runs. The Turn finishes and saves, and the page shows it on their return.

**Status:** done

- [x] A client that leaves doesn't stop the Turn, which is saved
- [x] The server holds a running Turn's text so far, and its input, and what it replaces
- [x] A dropped stream follows the Turn on the server until it ends
- [x] A page that opens on a running Turn picks it up
- [x] A page coming back replaces a stream that went quiet without failing
- [x] A Turn that fails with nobody there is told once on return, and isn't tried again by itself
- [x] A failed Rewrite gives its feedback back to the Rewrite box, even after a reload
- [x] A stream the client cancels doesn't fail the Turn
- [x] A failure the stream delivered isn't told twice
- [x] A second Turn on the same Save is refused before it reaches the model
- [x] Seen in a real browser: reload mid-Turn and pick it up
- [ ] Seen on a real phone, with the app in the background mid-Turn

## Comments

Reverses the rule from ticket 47's time that a client leaving ends the Turn. A Turn the player never returns to still costs its model call. There's no Stop button, and a stuck reply ends at the Text Provider's 10-minute silence limit.

A server restart ends a running Turn unsaved, and the page then says the connection dropped, with the player's text handed back if the page still held it.
- **User sign-off (2026-11-05):** closed on the user's word. Any unticked box stays unticked, as that check wasn't recorded as run.
