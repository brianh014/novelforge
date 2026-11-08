# 63: Krea 2 as a Simple Mode family (optional)

**What to build:** A `krea2` choice in Simple Mode's Model family, next to `sd` and `flux2`, drawing from words alone.

**Status:** needs-triage

**Optional:** parked on 2026-11-08. Without references Krea 2 can't keep faces the same, the way SD can't either, so it's worth building only for its look.

## What was found (2026-11-08)

- **Base Krea 2 is text-to-image only.** Krea's model card ([krea/Krea-2-Turbo](https://huggingface.co/krea/Krea-2-Turbo)) and ComfyUI's docs ([docs.comfy.org](https://docs.comfy.org/tutorials/image/krea/krea-2)) list no editing or references. Its model has no reference-latent path, so ComfyUI's core reference nodes are silently dropped, and reference tokens without an edit LoRA turn the image into a mosaic ([EricRollei/Krea2_ComfyUI_Advanced](https://github.com/EricRollei/Krea2_ComfyUI_Advanced)).
- **No reliable multi-face option exists.** Every reference route needs custom nodes plus a LoRA:
  - [krea2-identity-edit](https://huggingface.co/conradlocke/krea2-identity-edit) needs `comfyui-krea2edit` ≥ 2.0 and keeps one person (scene + person at most).
  - [ComfyUI-Krea2-Reference](https://github.com/KonokoAz/ComfyUI-Krea2-Reference) takes up to 4 images, but its author says two references "work only partially".
  - The official style reference LoRA copies style, not faces.
- **Graph, from ComfyUI's own `image_krea2_turbo_t2i` template (core nodes only):** `UNETLoader` → `KSampler` (euler, simple), `CLIPLoader` type `krea2` with Qwen3-VL-4B, `CLIPTextEncode`, negative = `ConditioningZeroOut` of the positive, `EmptyLatentImage`, `VAELoader` with `qwen_image_vae`, `VAEDecode`.
- **Defaults** (Krea's repo, via [comfyui-wiki](https://comfyui-wiki.com/en/news/2026-06-22-krea-2-open-source-text-to-image)): Turbo 8 steps, cfg 1 in ComfyUI (Krea says 0, i.e. no guidance); Raw about 52 steps, cfg 3.5.
- **Prompts:** long natural-language prose works best ([ComfyUI blog](https://blog.comfy.org/p/krea-2-open-source-models-are-now)).
- This ComfyUI (0.31.0) lists `krea2` among `CLIPLoader` types, and has `Pornmaster_krea2_Turbo_int4_convrot_v4.safetensors` to test with.

## Decided

- Words only: `usesPortraits` false, no previous-Scene img2img, and Settings shows the same "faces change" note as SD.
- Shares the Diffusion model, Text encoder and VAE pickers with FLUX.2.
- Prose, with the prompt before the style, as FLUX.2 does.
- Uses the Steps and CFG settings from 2026-11-08. Blank means: `turbo` in the filename gets 8 steps and cfg 1, anything else 52 and 3.5. The CFG box shows for Krea 2.
- A notice when `CLIPLoader` doesn't list `krea2`, like the FLUX.2 one (`hasFlux2` in `src/comfyui.ts`).

## Where to change

- `src/settings-store.ts`: `comfyFamily` enum.
- `src/graph-builder.ts`: a `krea2Image` graph, `buildGraph`, `drawSteps`, `chosenModels`, `promptStyle`, the prompt order.
- `src/comfyui.ts`: a `hasKrea2` check.
- `src/web/settings.tsx`: family option, pickers, CFG box and placeholder, notes.
- Tests: `test/graph-builder.test.ts`, `test/comfyui.test.ts`, `test/settings.test.ts`.

## Done when

- A Test image draws with Krea 2 Turbo on local ComfyUI, then Settings goes back to Klein.
