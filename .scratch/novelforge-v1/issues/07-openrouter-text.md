# 07: OpenRouter text

**What to build:** A full game can be played through the REST API with a real OpenRouter text model, with narration streaming as it's written. Provider settings and API keys persist per install.

**Blocked by:** 04, 05, 06

**Status:** ready-for-agent

- [ ] The Text Provider is one OpenAI-compatible client with a configurable base URL
- [ ] Schema mode is used on models that support it, with JSON validation and retries as the fallback
- [ ] Narration streams to the client during a Turn, and nothing is committed until the Turn is valid
- [ ] A Check request produces no partial player-visible narration before the result
- [ ] Settings and API keys are stored per install and never in a Save
- [ ] Model Instructions are included in prompts
- [ ] The model can change between Turns of a Save
- [ ] A manual run with a real OpenRouter model plays several Turns, including a Check
