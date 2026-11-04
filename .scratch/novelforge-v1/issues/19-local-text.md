# 19: Local text

**What to build:** A player can use any OpenAI-compatible local server for text, alone or alongside OpenRouter images.

**Blocked by:** 14

**Status:** ready-for-agent

- [x] A player can enter a local base URL and choose a model
- [x] Text can be Local while images use OpenRouter
- [x] Models without schema mode work through the JSON validation and retry fallback
- [x] An unreachable server shows a clear, retryable error
- [ ] A manual run with a real local server plays several Turns

## Comments

- **The manual run is not done, so its box stays unticked.** Nothing answered at `http://127.0.0.1:1234/v1/models` or `http://127.0.0.1:11434/v1/models`, and no server was installed or started (ADR 0001). Every test and the browser check used a fake server, which is not evidence about any real model, its first-load time or how well it follows the prompt's schema.
- To run it by hand, start LM Studio's server (port 1234) or Ollama (port 11434) with a model loaded, then:

  1. Run `dist/novelforge.exe` and open `http://127.0.0.1:4600`.
  2. In Settings, set Text provider to Local, and Local server address to `http://localhost:1234/v1`, or `http://localhost:11434/v1` for Ollama. Leave the key empty and save.
  3. Choose the model from Text model, which is now a list, and save.
  4. Start a game and play at least four Turns, including a risky action such as leaping a wide gap, which should get a Check.
  5. Stop the server and send a Turn. The error should say the Text Provider can't be reached, and your text should stay in the box. Start the server again and send it.

  Pass if the Turns commit and the state changes stick. Tick the box and record the model. Narration that only appears at the end of a Turn is expected from a model that writes `check` after `narration`, wraps its reply in prose, or ignores the key order.
- The model list comes from the saved address, so a player saves a new address before choosing a model. That way a key can never reach an address that is still being typed. The Settings screen lists models only for Local, and a server without a list gets the text box as before. A saved model the server doesn't list stays selected until the player changes it.
- Once a server lists models, only those can be chosen, and the list refreshes on Save or reload. If a late list arrives while the player is typing a name, the box becomes the list. That needs a slow `/models`, so it was left.
- A new `GET /settings/text-models` answers `{ models }`, which is empty when the server is off, has no list or sends another shape. It fetches only the saved address.
- `parseReply` now takes the text from the first `{` to the last `}`, after dropping `<think>` text, including an opening tag supplied by the chat template and a block cut off before it closes. That covers fences and prose for Turns and wizard calls. Braces in the prose around the JSON fail validation and retry, as a `shortcut:` comment notes. `<thinking>` and other tags aren't handled.
- Narration streams only when the reply starts with `{"check":null,"narration":"`, with or without a code fence or thinking first. In any other key order it stays hidden until `done`, because it could still turn into a Check request. This was kept on purpose, and a test covers it.
- Failures now say what to check: the server can't be reached (refused, unknown host or dropped), it stopped responding (10 minutes of silence), or it returned an error. The status and body stay in the server log. The client joins a retry hint on with a full stop, so these messages don't end in one.
- The 10-minute limit is on silence, not on the whole reply, so response headers, any chunk or a keep-alive reset it. `/models` gets 15 seconds, and a Turn carries on in plain JSON without it. A failed `/models` isn't remembered, so a server that hangs on it adds up to 15 seconds to every call, including retries. A crash mid-stream reads as "can't be reached". `fetch` has `timeout: false` because Bun documents a 5-minute default idle limit. A 320-second silent first response was not cut off either way on Bun 1.4.4, so that default wasn't actually seen firing.
- Bun already drops `Authorization` on a cross-origin redirect. No code was needed, and a test pins it, so a Bun upgrade that changes this fails loudly.
- `setupProblem` needed no change: a local address with no key is not a setup problem. A test already covered that, and the new tests check no `Authorization` header is sent.
- The Settings and play screens were checked in headless Chrome against the compiled executable and a fake server, at 390 and 1280 wide in light and dark: no horizontal scroll, and the model list works by keyboard. The wizard shares the server message and error styling but was checked through the API only.
- "Text Provider" appears in player-facing messages but not in `GLOSSARY.md`, so it needs an entry or another word.
