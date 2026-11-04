# 07: OpenRouter text

**What to build:** A full game can be played through the REST API with a real OpenRouter text model, with narration streaming as it's written. Provider settings and API keys persist per install.

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [x] The Text Provider is one OpenAI-compatible client with a configurable base URL
- [x] A content refusal from the model is raised as `ContentRefused`, which ticket 04 reports to the player
- [x] Schema mode is used on models that support it, with JSON validation and retries as the fallback
- [x] Narration streams to the client during a Turn, and nothing is committed until the Turn is valid
- [x] A Check request produces no partial player-visible narration before the result
- [x] Settings and API keys are stored per install and never in a Save
- [x] Model Instructions are included in prompts
- [x] The model can change between Turns of a Save
- [x] A manual run with a real OpenRouter model plays several Turns, including a Check

## Comments

- **Manual run passed (2026-11-04), see the last comment.** Before that, every test used a local fake server, and the only real OpenRouter call was one `GET /models`, which confirmed the shape: 401 models, 334 listing `structured_outputs`, and `openai/gpt-4o-mini` among them. No chat request has reached OpenRouter, so strict schema acceptance, streaming and Check narration are unproven against a real model.
- To run it by hand from the repo root, in Git Bash. It uses `openai/gpt-4o-mini`, and `settings.json` is gitignored:

  ```bash
  bun run src/main.ts
  ```

  In a second shell:

  ```bash
  URL=http://127.0.0.1:4600
  JSON='Content-Type: application/json'
  bun -e 'const key = (await Bun.file("../.novelforge-openrouter-key.txt").text()).trim(); console.log(await fetch("http://127.0.0.1:4600/settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ textApiKey: key, textModel: "openai/gpt-4o-mini" }) }).then((r) => r.text()))'
  ID=$(curl -s $URL/saves -H "$JSON" -d '{"worldBrief":"A drowned city of canals and rotting bridges","pc":{"name":"Ash"}}' | bun -e 'console.log((await Bun.stdin.json()).id)')
  turn() { curl -sN $URL/saves/$ID/turns -H "$JSON" -H 'Accept: text/event-stream' -d "{\"input\":\"$1\"}"; echo; }
  turn "I look around the flooded plaza."
  turn "I ask the nearest boatman what happened to the bridges."
  turn "I sprint along the crumbling parapet and leap the wide gap in the broken bridge, high above the floodwater, with no rope."
  turn "I catch my breath and look ahead."
  bun -e "const {Database}=require('bun:sqlite');console.log(new Database('Saves/$ID.sqlite').query('SELECT id, hidden_check FROM messages WHERE hidden_check IS NOT NULL').all())"
  ```

  Pass if each `turn` ends in `event: done` with several `event: narration` lines first, and the last command prints a Check. If the server logs `Schema mode rejected`, the Turn still played but through the fallback, so report that. Keep `settings.json` afterwards only if you want the key to stay in it.
- **REST streaming contract.** `POST /saves/:id/turns` with `Accept: text/event-stream` answers 200 with server-sent events. Each has one JSON `data` line:
  - `narration` `{ text }`: more text, to append.
  - `restart` `{}`: discard all narration shown so far for this Turn. An attempt failed and another is starting.
  - `done` `{ messages }`: the Turn is committed. `messages` has the same shape as the JSON route and is the final text.
  - `error` `{ status, error, failure?, input? }`: nothing was committed, so discard the narration shown. `status` is what the JSON route would use, for example 422 refused, 502 retryable, 409 stale, 404 unknown Save. Validation of the body still answers 400 before any stream.
  - Without that Accept header the route answers plain JSON as before.
- A stream ending without `done` or `error` means the connection dropped. Leaving aborts the Turn, but it may have committed just before, so read the Messages before sending again.
- A Check gives no event until the result call streams, and a reply that does not open with `check: null` shows nothing until `done`. Show a waiting state, and render `done` whether or not narration events came.
- `GET /settings` and `PATCH /settings` take and return `textBaseUrl`, `textModel` and `modelInstructions`. `textApiKey` is accepted on PATCH and never returned, only `hasTextApiKey`. Ticket 14 builds the screen on these. Settings live in `settings.json` beside the Saves folder, not in it. Changing the base URL without sending a key clears the stored key, so it can never reach a different server. Kept by user decision (2026-11-03).
- Bun's idle timeout was real: a silent streamed response dropped at about 12 seconds while the handler ran on. A POST that had read its body survived. `idleTimeout: 0` fixes it, and a test goes red without it.
- A model with no structured outputs may refuse in prose. That reads as an invalid reply, so it ends as retryable after three paid calls, not as refused. Without schema mode there is no reliable signal to tell them apart.
- Result narration streams before commit, and a client that leaves commits nothing, so a player could read a bad result, disconnect and send again for a new roll. Decided by the user (2026-11-03): leave it, cheating this way doesn't matter.
- A Text Provider call has no timeout of its own, so a hung provider waits on Bun's fetch defaults, which were not measured. With no model set, a Turn fails as retryable and only the server log says why.
- OpenRouter may reposition mid-array system entries for some providers. The array is sent in order, and how each upstream treats it was not checked.
- **Manual run, 2026-11-04.** The user entered the key in Settings and played one Turn in the app. A REST run on a test Save then played seven more on `deepseek/deepseek-v4.1-flash-1017` and one on `openai/gpt-4o-mini`. Every Turn ended in `event: done`. The third forced a Check (Very Hard, roll 4, failure, plain) and its narration matched the failure. No server log held `Schema mode rejected`, so strict schema mode worked on both models. The model wrote spoken lines as `[Name]:`, and status, facts, plot threads, a new NPC and a World Bible entry all updated.
- **Narration does stream.** With a Bun client, one Turn's first event came at 4.2s and the last at 8.0s, and client times matched the server's. Upstream reads were spread across 1.0s to 7.5s. A Node client run through the context-mode sandbox showed every event at the same instant, which is that client's buffering and not the app. Setting `Accept-Encoding: identity` changed nothing, so no code changed. Browser delivery was not timed.
