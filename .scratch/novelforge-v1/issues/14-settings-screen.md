# 14: Settings screen

**What to build:** A player can configure the app from Settings, with per-install settings kept apart from the per-Save Art Style.

**Blocked by:** 09

**Status:** ready-for-agent

- [x] A player can set text and image models and providers, including splitting them
- [x] A player can enter API keys, and the API never returns them in full
- [x] API keys never enter a Save, so duplicates contain none, and a test proves it
- [x] A player can edit Model Instructions, blank by default
- [x] A player can toggle images and set font size
- [x] A Chat style setting exists, with its options completed in ticket 22
- [x] While a game is open, Art Style edits the current Save
- [x] Settings persist across restarts

## Comments

- Art Style is an `art_style` column on `save`, added by `toVersion2`, not a Snapshot section. The spec's Snapshot list leaves it out, and a Revert must not undo a choice about future images. New Saves start blank until the wizard in ticket 15 sets one.
- The text provider isn't stored. Settings shows OpenRouter when `textBaseUrl` is the OpenRouter address, and Local otherwise.
- The image provider and model are stored only. Nothing reads them, `imageApiKey` or `imagesEnabled` until ticket 17. Local means ComfyUI, whose setup is ticket 20.
- The image key is separate from the text key, because a text server change clears the text key and text can be Local while images use OpenRouter. A player using OpenRouter for both enters the key twice.
- A stored key can be replaced but not removed from Settings. Nobody asked for that, so it's left out.
- Art Style and the per-install settings have separate Save buttons, because they are stored apart.
