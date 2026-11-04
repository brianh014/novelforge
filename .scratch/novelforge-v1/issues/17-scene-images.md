# 17: Scene Images

**What to build:** A Scene Image appears above the chat when the scene changes, generated in the background by OpenRouter, using as few images as possible.

**Blocked by:** 14

**Status:** ready-for-agent

- [x] A Scene Image is requested when `scene_changed` is true, or when the location or visible cast changes
- [x] Descriptions aren't compared as text
- [x] Generation runs in the background, and a Turn never waits for it
- [x] An image failure doesn't affect the Turn
- [x] Images use the Save's current Art Style, and existing images don't change
- [x] The previous Scene Image is passed as a reference where the model supports it
- [x] The payload holds a list of role-tagged references, trimmed to the model, and unsupported fields are dropped
- [x] The player can see how many images were generated this session
- [x] Turning images off stops new images, and existing ones stay visible
- [x] Images are stored in the Save, counted by the Revert preview and deleted by Revert
- [ ] A manual run with a real OpenRouter image model works

## Comments

- "A manual run with a real OpenRouter image model works" stays unticked. This work had to run without the real key and without calling OpenRouter, so the real adapter was only tested against a local fake server, and the request and response shapes come from OpenRouter's docs and `openapi.json`. To run it, in PowerShell, with `dist\settings.json` holding a working text model:

  ```powershell
  cd C:\Users\brian\Projects\novelforge
  bun run build
  Start-Process .\dist\novelforge.exe
  $key = (Get-Content .novelforge-openrouter-key.txt -Raw).Trim()
  Invoke-RestMethod -Method Patch -Uri http://127.0.0.1:4600/settings -ContentType application/json -Body (@{ imageProvider = 'openrouter'; imageModel = 'google/gemini-2.5-flash-image'; imageApiKey = $key; imagesEnabled = $true } | ConvertTo-Json)
  ```

  Then open http://127.0.0.1:4600, play a Turn that goes somewhere new, and a Scene Image should appear above the chat. Play another that changes the scene to exercise the reference. Failures appear in the app's console as `Image API error`. The Save's list is at `http://127.0.0.1:4600/saves/<id>/images`. An image costs money on this model, and each scene change makes one.
- OpenRouter facts, from the docs (2026-11-04): `POST /api/v1/images` takes `model`, `prompt`, `aspect_ratio` and `input_references` (`{ type: "image_url", image_url: { url } }`, a data URL here, at most 16) and answers with `data[].b64_json`. `GET /api/v1/images/models` gives `architecture.input_modalities`, where `image` means the model takes references, and `supported_parameters`, where an absent key means unsupported. No per-model reference limit is documented, and OpenRouter's own example of an image-input model has no `input_references` key, so that key isn't required: its descriptor's `max` is used if it has one, and otherwise 16. There are no fields for a negative prompt or a style, so both go in the prompt. The docs say cancelled and failed generations aren't billed, and that a model can return SVG, which the game refuses.
- The scene is a new Snapshot section, `{ location, visibleCast }`, set by a new `set_scene` operation, so Revert and replacement restore it with everything else. A cast name the state lacks is left out, as the cast only steers images and must not fail a Turn. A blank `visual_description` falls back to the location. A Save from before gets an empty scene, so its next `set_scene` counts as a change.
- An image is keyed by its Message, whose id is never reused. Revert and replacement delete it through `deleteAfter`. A generation in flight is cancelled when its Message goes or its Save is deleted, and one that finishes anyway stores nothing, because the insert selects from `messages`. A cancelled image is simply gone: replacing a response draws again only if the new response calls for it.
- One image draws per Save, and only the newest waiting scene is kept, so a run of quick Turns pays for two images, and the second builds on the first. A failure isn't retried, and stopping the server loses the image in flight, as retrying would spend money the player didn't choose to.
- The image prompt never reaches the client. Alt text and the caption come from `location`, Narrator free text kept clean only by its prompt, like the Journal and inventory.
- The session count is every image the player paid for, including one whose Message has gone or whose bytes were refused. It covers all Saves and resets with the server.
- Import checks each image's signature and size, not that it decodes, because the bytes are only ever served with a type read from them and `nosniff`.
- `MAX_IMPORT_BYTES` is 512 MiB, about 250 images at 2 MiB each. A longer game can export but not import, as the `shortcut:` there says. `maxRequestBodySize` is set to match.
- Ticket 18: `state.scene.visibleCast` holds the NPCs in view, by name, for portraits and references. Add roles to `ImagePayload["reference_images"]`, where the first references survive trimming, so the order is the priority. Portraits need their own Revert count and delete in `countAfter` and `deleteAfter`, and `session++` in the pipeline is the count they share.
- Ticket 20: the `imageProvider !== "openrouter"` check in `draw` is what keeps Local silent. Replace it with choosing an adapter, and pick the key check per provider. `style_preset` and `negative_prompt` are in the payload for ComfyUI to use properly.
- **User decision (2026-11-04):** keep coalescing, so scenes passed over while an image is drawing get no image.
