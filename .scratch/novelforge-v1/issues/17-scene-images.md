# 17: Scene Images

**What to build:** A Scene Image appears above the chat when the scene changes, generated in the background by OpenRouter, using as few images as possible.

**Blocked by:** 14

**Status:** ready-for-agent

- [ ] A Scene Image is requested when `scene_changed` is true, or when the location or visible cast changes
- [ ] Descriptions aren't compared as text
- [ ] Generation runs in the background, and a Turn never waits for it
- [ ] An image failure doesn't affect the Turn
- [ ] Images use the Save's current Art Style, and existing images don't change
- [ ] The previous Scene Image is passed as a reference where the model supports it
- [ ] The payload holds a list of role-tagged references, trimmed to the model, and unsupported fields are dropped
- [ ] The player can see how many images were generated this session
- [ ] Turning images off stops new images, and existing ones stay visible
- [ ] Images are stored in the Save, counted by the Revert preview and deleted by Revert
- [ ] A manual run with a real OpenRouter image model works
