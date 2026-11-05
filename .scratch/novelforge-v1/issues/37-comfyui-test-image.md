# 37: ComfyUI test image

**What to build:** A player can check their ComfyUI setup from Settings, by typing a prompt and seeing the image, without playing a Turn.

**Status:** done

- [x] A prompt box and Test button sit at the bottom of the ComfyUI settings
- [x] The image shows below them at full width, and a failure shows ComfyUI's reason
- [x] It uses the saved Settings, and the image reaches no Save
- [x] Checked in a browser against a real ComfyUI

## Comments

- **User decision (2026-11-04):** layout A from https://claude.ai/artifact/BmoMkCWNsHqjJYSHYvBixN, local copy `comfy-test-options.html`.
- `POST /settings/comfy-test` uses the same adapter as the game, so in Advanced Mode it also updates the last job's problem shown in Settings.
- Images are 16:9 with no art style or negative prompt. Leaving Settings cancels the job.
- **Resolution and stats, user request (2026-11-04):** stats are table A from https://claude.ai/artifact/SfDUD4jZCqV2MR78LhgnF4, and Resolution is a dropdown beside Image provider, for both providers. Checkpoint type stays and now only warns, as the user kept it earlier. The dropdown and warning were the agent's defaults, as the user only named the table.
- OpenRouter's public `/images/models` listed a `resolution` enum on 27 of 63 models on 2026-11-04, in tiers from 768 to 4K. The adapter sends it the same way as `aspect_ratio`. **No paid call has tested it**, so the field name in a request is inferred from that listing. The user's `meta/muse-image` lists no resolution, so it is unaffected.
- Klein 9B at 8 steps, one image each through `/settings/comfy-test`: 480p 16s, 720p 15s, 1080p 35s, 4K 221s and 25.5 MB. The first includes a model load, so it is slower than its size suggests.
- Checked in headless Chrome on an isolated copy with no key, against the user's ComfyUI with Klein 9B at 8 steps: the button showed Drawing, the image arrived in 18s at full width, with no sideways scroll at 1366 and 390 wide. ComfyUI's queue went from one running job to none after leaving Settings. Light theme and Advanced Mode weren't checked. The unreachable message was checked by test only, after the browser run showed Bun's raw wording.
