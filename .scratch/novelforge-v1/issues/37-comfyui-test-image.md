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
- Checked in headless Chrome on an isolated copy with no key, against the user's ComfyUI with Klein 9B at 8 steps: the button showed Drawing, the image arrived in 18s at full width, with no sideways scroll at 1366 and 390 wide. ComfyUI's queue went from one running job to none after leaving Settings. Light theme and Advanced Mode weren't checked. The unreachable message was checked by test only, after the browser run showed Bun's raw wording.
