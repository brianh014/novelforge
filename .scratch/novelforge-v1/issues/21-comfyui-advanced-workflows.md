# 21: ComfyUI Advanced workflows

**What to build:** An advanced player can supply their own ComfyUI workflow, which is how IPAdapter and per-NPC LoRAs are used.

**Blocked by:** 20

**Status:** ready-for-agent

- [x] A player can provide workflow JSON in Settings
- [x] Documented placeholders let the workflow receive the prompt, references and other payload fields
- [x] An invalid workflow shows a clear error and doesn't affect the Turn
- [ ] A manual run with a real custom workflow works

## Comments

- **The manual run is not done, so its box stays unticked.** Nothing answered at `http://127.0.0.1:8188/system_stats`, and ComfyUI was not installed or started (ADR 0001). Every test and the browser check used the fake server, so neither shows a real ComfyUI accepting a workflow, or that the blank image and `has_` switches behave well with real IPAdapter nodes.
- To run it by hand, start ComfyUI on port 8188 with a checkpoint installed. IPAdapter is optional, for steps 6 and 7. Then:

  1. Run `dist/novelforge.exe` and open `http://127.0.0.1:4600`.
  2. In Settings, set Image provider to Local (ComfyUI), ComfyUI address to `http://127.0.0.1:8188` and ComfyUI mode to Advanced workflow.
  3. Open Placeholders and an example, copy the example into Workflow JSON, change `your_model.safetensors` to your checkpoint's filename and press Save settings. It should say Saved.
  4. Start a game and play a Turn that moves to a new place. A Scene Image should appear without blocking the Turn, and ComfyUI's console should show the job.
  5. Change `ckpt_name` to a file you don't have and save, which is allowed, as only ComfyUI knows its models. Play another Turn that moves. The Turn should stand, and reopening Settings should show the node that failed. Put the name back.
  6. In ComfyUI, build a workflow with IPAdapter, turn on Dev Mode if your version needs it and use Export (API). In it, set a `LoadImage` node's `image` to `{{npc_1}}`, the IPAdapter `weight` to `{{has_npc_1}}`, and the text to `{{art_style}}, {{prompt}}`. Paste it in and save.
  7. Play with an NPC in view after their portrait has drawn. The Scene Image should follow the portrait, and a new portrait, which has no references, should draw with no grey in it.
  8. Paste a workflow saved with plain Save or Export (not API), and save. Settings should say it's the UI format.

  Pass if the workflow draws into the Save. Tick the box and record the workflow and models.
- **Placeholders are filled in the parsed JSON, in `inputs` only, in one pass.** Story text is inserted as a string value and never scanned again, so quotes, braces and text like `{{seed}}` stay plain text. `class_type` and `_meta` are left alone. A placeholder that is a whole value keeps its type, so `{{seed}}` is a number. One inside longer text joins it.
- `{{prompt}}` is required, which goes beyond the handover's checks, because a workflow without it would ignore the story. Every other placeholder is optional, and one left out is simply not sent. It's the bare prompt: Simple Mode joins trigger words, Art Style and prompt, but here the workflow does that with `{{art_style}}, {{prompt}}`.
- Double braces are reserved in a workflow's inputs. Anything in them that isn't a placeholder is refused, so a typo can't reach ComfyUI, which also means a custom node's own `{{...}}` syntax can't be used. Spaces and capitals count as typos.
- **References beyond the workflow's slots aren't uploaded**, like an adapter trimming to what a model takes.
- **An empty slot gets a blank grey 64 pixel PNG.** Portraits never have references and a first Scene has no previous one, so one workflow has to run with and without them, and a `LoadImage` node with no file fails ComfyUI's validation. Removing the node instead would need each node's types to rewire what follows it. The grey would still pull IPAdapter towards grey, so `{{has_...}}` gives 1 or 0 for use as a weight. That switch can only be 0 or 1 unless the workflow does its own maths, and an img2img workflow on `{{previous_scene}}` can't turn off the same way, so its portraits and first Scenes start from grey. The player can avoid this by using `{{previous_scene}}` for IPAdapter rather than img2img.
- **Per-NPC use is by position, not by person.** `{{npc_1}}` is the first visible NPC with a portrait, in the Scene's order, and only the payload reaches a workflow, so it never gets a name. A per-NPC LoRA is a LoRA node with `{{has_npc_1}}` as its strength, which turns on whenever slot 1 is filled, by whoever. That suits one recurring companion, not a LoRA kept for a named NPC among several. Doing that needs NPC names in the payload, which is a decision for the user.
- **The image kept** is the last `SaveImage` output in node order, otherwise the last preview. Integer ids iterate numerically, so node 10 follows node 9, and ids such as `12:3` from a subgraph come after all of those. A batch gives its last image. This covers the case that matters, a preview of an intermediate step beside a final save. `SaveImage` also leaves a copy in ComfyUI's output folder, which is the player's choice.
- **A job ComfyUI reports as an error keeps no image**, in either mode, even if an earlier node finished one, as ComfyUI's history lists those outputs. A job stopped from ComfyUI's own UI is reported as stopped. Both rest on ComfyUI's `status_str`, which the fake imitates from memory of `execution.py`, so the manual run should confirm it.
- `{{width}}` and `{{height}}` are always about a megapixel, 1360x768 at 16:9 and 1024 square. Advanced has no base model to go on, so an SD 1.5 workflow types its own size. It can't then follow the aspect ratio.
- The Simple Mode choices, LoRA list and trigger words stay stored but aren't used, and are hidden while the mode is Advanced. Switching back restores them.
- **Validation runs when saving with Local and Advanced selected**, on what would be stored, so switching to them checks a workflow saved earlier. A workflow that isn't in use isn't checked, as Settings hides the box and the player couldn't see what to fix. Node names and model names aren't checked, as only ComfyUI knows those: they show at generation time. The failed save returns 422 and changes nothing.
- `comfyWorkflow` is a plain string in the settings schema, kept as the player typed it. If validation were in the schema, a bad file would throw on every `settings.read()`, including during Turns. A stored workflow that stops parsing fails as a job does.
- **Settings shows the last Advanced failure.** It's in memory, so a restart clears it, and a good image or a changed workflow also clears it. It appears when Settings opens, so it doesn't update while the screen is open. It holds the node and error type and never ComfyUI's text, which can repeat the prompt, and the image prompt is kept from the player (`/saves/:id/images`). The text stays in the log through the error's `cause`. It has to be an `Error`, as Bun doesn't print a string `cause`.
- The placeholder docs are in Settings, in a closed section under the box, with the example from `WORKFLOW_EXAMPLE`, which a test checks parses. `novelforge-spec.md` has the same contract under Advanced. There's no README to put it in.
- The Settings screen was checked in headless Chrome against the compiled executable and the fake ComfyUI, at 390 and 1280 wide in light and dark, with a 300 node workflow of over 400 KB and the guide open: no horizontal scroll, and nothing past the viewport. Broken JSON, the UI format, an unknown placeholder and an empty box each showed their own error and stored nothing. A valid workflow saved, a PC portrait reached the Save through it, a failed job showed in Settings, and the guide opens by keyboard. That run found a real bug the tests couldn't: a `Buffer` at module load blanked the whole app, as the browser loads `comfy-workflow.ts` for the example.
- "Advanced workflow" isn't in `GLOSSARY.md`, like the ComfyUI terms noted in ticket 20.
