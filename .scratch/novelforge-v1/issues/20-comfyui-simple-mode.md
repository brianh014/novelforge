# 20: ComfyUI Simple Mode

**What to build:** A player can generate images through their own ComfyUI by choosing a family, model and LoRAs, without ever seeing a workflow.

**Blocked by:** 17

**Status:** ready-for-agent

- [x] A player can enter the ComfyUI address and choose a family: SD 1.5/SDXL or FLUX.2
- [x] SD 1.5/SDXL offers a checkpoint dropdown from what's installed
- [x] FLUX.2 offers diffusion model, text encoder and VAE dropdowns
- [x] A refresh button updates the lists
- [x] A player can add multiple LoRAs, each with a strength and optional trigger words
- [x] Trigger words are added to prompts automatically
- [x] The Graph Builder is tested from choices to graph output, without a running ComfyUI
- [x] SD 1.5/SDXL uses the previous Scene through img2img, and FLUX.2 uses native multi-reference
- [x] Images still generate when NPC references aren't available, and Settings shows what's supported
- [ ] A manual run against a real ComfyUI works for each family

## Comments

- **The manual run is not done, so its box stays unticked.** Nothing answered at `http://127.0.0.1:8188`, and ComfyUI was not installed or started (ADR 0001). The graphs were checked against ComfyUI's own `nodes.py`, `server.py` and FLUX.2 templates from GitHub, and every test and the browser check used a fake server. That is not evidence that a real model draws a good picture, or that the steps, sampler, CFG or img2img denoise suit one.
- To run it by hand, start ComfyUI on port 8188 with an SD 1.5 or SDXL checkpoint installed, plus FLUX.2 Dev's three files (`flux2_dev_fp8mixed.safetensors` in `models/diffusion_models`, `mistral_3_small_flux2_bf16.safetensors` in `models/text_encoders`, `flux2-vae.safetensors` in `models/vae`). Then:

  1. Run `dist/novelforge.exe` and open `http://127.0.0.1:4600`.
  2. In Settings, set Image provider to Local (ComfyUI) and ComfyUI address to `http://127.0.0.1:8188`, and save.
  3. Choose SD 1.5/SDXL, the checkpoint and its Checkpoint type. Add a LoRA with a strength and trigger words if you have one, and save.
  4. Start a game and play a Turn that moves to a new place. A Scene Image should appear without blocking the Turn. Move again: the new image should keep the look of the last one, and ComfyUI's console should show a `LoadImage` for a file in `temp/novelforge`.
  5. Revert while an image is drawing. ComfyUI should stop that job, and no image should appear.
  6. Rename a chosen file in ComfyUI's models folder and press Refresh lists. Settings should name it as not installed. Put it back.
  7. Choose FLUX.2 and its three files, save, and play Turns with an NPC in view after their portrait has drawn. ComfyUI's console should show one `ReferenceLatent` per reference.

  Pass if both families draw into the Save. Tick the box and record the models.
- **`comfySdBase` and the Checkpoint type list weren't asked for.** The spec has one SD 1.5/SDXL family, but a checkpoint file doesn't say which it is, and each needs its own size: SD 1.5 at 1024 pixels doubles faces, and SDXL at 512 looks poor. A filename guess would fail silently, so the player chooses, and the default is SDXL. It only sets the size.
- **FLUX.2 is ComfyUI's FLUX.2 Dev template.** Klein models also appear in the list and use the same loaders, but their templates use `CFGGuider` (cfg 5 with a negative prompt on base, cfg 1 and 4 steps on distilled), so a Klein model would run without its CFG or with more steps than it needs. Settings says so. The negative prompt is dropped for FLUX.2, because its guider has none.
- Turning images off stops the next job from starting, as with OpenRouter. It doesn't stop one already submitted, even one waiting in ComfyUI's queue, so that image is still stored and counted.
- `GET /settings/comfy-models` asks `/object_info/{node}` for five nodes, because the whole `/object_info` can take many seconds. It reads both combo forms, `[[...options], {}]` and `["COMBO", { options }]`. It fetches only the saved address, with a 30 second limit, and any redirect is an error, on image calls too. FLUX.2 support is judged by `CLIPLoader` listing the `flux2` type.
- The limit is 10 minutes of silence from the server. While `/queue` and `/history` answer, a job can take any length of time. A job in neither has been lost, for example by a restart, and fails at once. A job that hangs while ComfyUI keeps answering waits until someone stops it in ComfyUI, and holds up that Save's later images until then.
- Cancelling asks ComfyUI to delete the job from its queue, then interrupts it only if `/queue` shows it running, by `prompt_id`. Older servers ignore `prompt_id` and interrupt whatever runs, so the check protects the player's own job, apart from a very small gap between the two calls. `POST /prompt` is deliberately not aborted, so a job can't be queued after its cancel.
- Images use `PreviewImage`, and references upload to ComfyUI's temp folder under `novelforge/`, named by hash. ComfyUI clears that folder when it starts, so neither story images nor references pile up in its input or output folders. `LoadImage` reads them as `novelforge/<hash>.png [temp]`, which `folder_paths.annotated_filepath` supports.
- FLUX.2 takes up to 10 references, the figure on ComfyUI's FLUX.2 page, each scaled to 1 megapixel as its template does. That is a lot of memory at the limit, and no real GPU has tried it.
- Sizes keep the area of the base's square in multiples of 16: 688x384 for SD 1.5, 1360x768 for SDXL and FLUX.2 at 16:9, and 512 or 1024 square. SD uses dpmpp_2m with karras, 25 steps, cfg 7 and 0.65 denoise for img2img. These are starting values, not tuned ones.
- The `/view` body is read whole before its size is checked. The address is the player's own server, so this was left.
- The `comfyui-skill-public` skill holds only its `SKILL.md`, as its reference files are missing, so FLUX.2 and API facts came straight from ComfyUI's source, its templates and docs.comfy.org.
- The Settings screen was checked in headless Chrome against the compiled executable and a fake ComfyUI, at 390 and 1280 wide in light and dark, for both families, with very long model names: no horizontal scroll. Adding a LoRA works by keyboard, removing one keeps focus, Refresh shows a new model, a missing model is named, and an image reached the Save and showed in play.
- "Graph Builder", "Simple Mode", "LoRA" and "Image Adapter" aren't in `GLOSSARY.md`, so they need entries. The Settings text mentions an Advanced workflow, as the spec's example does, ahead of ticket 21.
- **First real run (2026-11-04), box still unticked.** `comfyModels` and `comfyImages` ran from a script against the user's ComfyUI, which SwarmUI starts on `http://127.0.0.1:7821`, on an RTX 3080 with 10 GB. No Save, game or Settings screen was involved. At 16:9 with no LoRA: SDXL (`sd_xl_base_1.0`) drew in 14s, and img2img from that image in 11s kept the scene. FLUX.2 with Klein 9B (`flux-2-klein-9b`, `qwen_3_8b`, `flux2-vae`) drew in 51s, and with one reference in 66s it kept the scene closely. Those images looked right by eye. A cancel 6 seconds into a FLUX.2 job threw AbortError and left ComfyUI's queue empty. FLUX.2 Dev isn't installed, so that template only ran with Klein, at Dev's 20 steps. Steps 4, 6 and 7 of the manual run above, in a real game, are still to do, as are LoRAs. Klein 9B then moved to 8 steps at the user's word, which took a new image from 51s to 19s. The reference and cancel runs were at 20 steps.
- **User decision (2026-11-04):** keep the Checkpoint type setting (SDXL or SD 1.5), though the spec doesn't list it.
