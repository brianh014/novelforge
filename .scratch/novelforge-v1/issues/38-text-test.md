# 38: Text test

**What to build:** A player can check their text setup from Settings, by typing a prompt and seeing the reply, without playing a Turn.

**Status:** ready-for-human

- [x] A prompt box and Test button sit at the bottom of the Text settings
- [x] The reply shows below them with its time, time to the first word, approximate length and speed, and the model
- [x] It uses the saved Settings, sends the Model Instructions as the system prompt, and sends no schema
- [x] A failure or refusal says what went wrong in the player's words
- [ ] Checked against a real text model

## Comments

- The Text and ComfyUI tests share `TestBox` in `src/web/settings.tsx`, so both cancel when leaving Settings.
- `POST /settings/text-test` makes `schema` optional on `TextProvider`, as a plain prompt mustn't ask for narrator JSON.
- Lengths are the app's own estimate of four characters to a token, so token counts and speed are approximate.
- **User decision (2026-11-04):** the Settings label for Model Instructions is now "Pre-History / System Prompt / Main Prompt". The code, the prompts and `GLOSSARY.md` keep the name Model Instructions.
- A real OpenRouter test costs money, so the agent used a fake local server.
