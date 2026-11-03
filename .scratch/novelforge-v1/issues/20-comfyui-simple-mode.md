# 20: ComfyUI Simple Mode

**What to build:** A player can generate images through their own ComfyUI by choosing a family, model and LoRAs, without ever seeing a workflow.

**Blocked by:** 17

**Status:** ready-for-agent

- [ ] A player can enter the ComfyUI address and choose a family: SD 1.5/SDXL or FLUX.2
- [ ] SD 1.5/SDXL offers a checkpoint dropdown from what's installed
- [ ] FLUX.2 offers diffusion model, text encoder and VAE dropdowns
- [ ] A refresh button updates the lists
- [ ] A player can add multiple LoRAs, each with a strength and optional trigger words
- [ ] Trigger words are added to prompts automatically
- [ ] The Graph Builder is tested from choices to graph output, without a running ComfyUI
- [ ] SD 1.5/SDXL uses the previous Scene through img2img, and FLUX.2 uses native multi-reference
- [ ] Images still generate when NPC references aren't available, and Settings shows what's supported
- [ ] A manual run against a real ComfyUI works for each family
