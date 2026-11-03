Status: ready-for-agent

# NovelForge v1

The full design reference, including the theme and art style lists, is `novelforge-spec.md` at the repo root. Terms are defined in `GLOSSARY.md`. Decisions recorded in `docs/adr/` apply throughout.

## Problem Statement

A player wants a choose-your-own visual novel that responds to anything they type, without the story being fixed in advance. General AI chat tools can tell a story, but they don't track what the PC carries, what state they are in, or what the world secretly holds. They agree with whatever the player says, forget things, can be talked out of the fiction, and don't present the story visually. They also tie a game to one long session, which makes it hard to rewind or switch models.

The player wants to run this on their own machine, using whichever models they choose, with an easy download and no hosted service.

## Solution

NovelForge is a single-player app downloaded as one executable. The player creates a world and a PC through a wizard, then plays by speaking and acting only as the PC. The Narrator runs the story, voices NPCs, and draws on a secret World Bible and Plot Threads. The server owns the game state, validates every change, and uses hidden Checks to give risky actions uncertain outcomes.

Scene Images appear above the chat, visual novel style. The Journal, inventory and status show only what the PC knows. Every Turn saves automatically, and the player can Revert to any Message, correct the story, or duplicate a Save to branch it. Text and images can each use OpenRouter or a local server.

## User Stories

### Game creation

1. As a player, I want to choose a theme from a list, so that I can start quickly in a genre I like.
2. As a player, I want to describe my own theme, so that I'm not limited to the list.
3. As a player, I want to write a World Brief, so that the world reflects my idea.
4. As a player, I want “Pick for me” to generate a World Brief from my theme, so that I can start without writing one.
5. As a player, I want to choose a Starting Hook, so that the game opens with a situation I want.
6. As a player, I want “Pick for me” to generate a Starting Hook, so that I can be surprised.
7. As a player, I want to turn off the Starting Hook, so that I can begin in a sandbox-style world.
8. As a player, I want to pick an Art Style from a list, so that all images in my game share a look.
9. As a player, I want to describe my own Art Style, so that I can use a look that isn't listed.
10. As a player, I want the Narrator to generate a detailed World Bible and Plot Threads, so that the world has depth I can discover.
11. As a player, I want the World Bible and Plot Threads kept secret, so that the story can still surprise me.
12. As a player, I want a spoiler-free World Overview, so that I can judge the world without seeing its secrets.
13. As a player, I want to accept or regenerate the world, so that I don't discover a poor world only during play.
14. As a player, I want to enter my PC's name, background, physical traits, skills and starting inventory, so that I can play whomever I want.
15. As a player, I want “Pick for me” to fill only the empty PC fields, so that I can keep what I've written.
16. As a player, I want a PC portrait generated from my description, so that I can see who I'm playing.
17. As a player, I want my PC to be canon even when they conflict with the world, so that I can truly play whomever I want.
18. As a player, I want a non-blocking warning when my PC changes the world, so that I understand the effect.
19. As a Narrator, I want the World Bible updated to fit a conflicting PC, so that the PC's abilities are consistent with the world.

### Playing Turns

20. As a player, I want to type what my PC says and does, so that I control my own story.
21. As a player, I want narration to stream as it's written, so that the game feels responsive.
22. As a player, I want NPCs to speak with consistent voices, so that they feel like real characters.
23. As a player, I want the Narrator to present interesting opportunities, so that I always have something to pursue.
24. As a player, I want the Narrator to remember earlier events, so that the story stays coherent over long games.
25. As a player, I want relevant lore to reach the Narrator when it matters, so that a large world stays consistent.
26. As a player, I want the world to expand when I go somewhere unmapped, so that I'm never at the edge of the story.
27. As a player, I want new Plot Threads created when the current ones are exhausted, so that the game keeps going.
28. As a player, I want actions that break `world_rules` to fail in character, so that the world stays believable.
29. As a game owner, I want instructions typed in the chat treated as in-character text, so that the player can't inject prompts.
30. As a player, I want risky actions to have uncertain outcomes, so that the story isn't simply whatever I ask for.
31. As a player, I want difficulty to reflect my PC's skills, condition and situation, so that a master locksmith succeeds where a novice wouldn't.
32. As a player, I want strong successes, bad failures and mixed results, so that outcomes feel varied.
33. As a player, I never want to see dice, numbers or difficulty, so that the game feels like a story and not a tabletop game.
34. As a game owner, I want the player unable to set or claim a roll, so that “I roll a natural 20” has no effect.
35. As a game owner, I want the difficulty fixed before the roll exists, so that the Narrator can't choose it to fit an outcome.
36. As a player, I want safe actions resolved with one call, so that ordinary Turns are quick and cheap.

### State, inventory and status

37. As a player, I want to see what my PC is wearing and carrying, so that I know what I have.
38. As a player, I want to click an item and describe what I do with it, so that using items is easy.
39. As a player, I want that item action to appear in the chat, so that the world reacts to it.
40. As a player, I want my inventory to match the world's realism, so that I can't carry impossible amounts.
41. As a player, I want a status view of my health, injuries and conditions, so that I know how my PC is doing.
42. As a player, I want status described in words, not numbers, so that it feels like part of the story.
43. As a game owner, I want the server to validate state operations, so that the Narrator can't silently lose or invent state.
44. As a game owner, I want the server to refuse operations it can disprove, such as removing an item the PC lacks, so that state stays valid.

### Journal

45. As a player, I want a recent summary, so that I can catch up after a break.
46. As a player, I want a Full Log of the story with images, so that I can reread it.
47. As a player, I want a list of known NPCs with portraits, so that I can remember who people are.
48. As a player, I want the Journal to contain only what the PC knows, so that it never spoils secrets.

### Correcting the story

49. As a player, I want to Rewrite the latest Narrator response with feedback, so that I can fix something that went wrong.
50. As a player, I want Rewrite to update summaries and the Journal, so that nothing stale remains.
51. As a player, I want to Regenerate the latest Narrator response, so that I can get a different take without explaining why.
52. As a game owner, I want Rewrite and Regenerate to reuse the stored roll, so that they can't be used as free rerolls.
53. As a player, I want to add a Director's Note, so that I can correct a fact without Reverting.
54. As a player, I want Director's Notes restored by Revert, so that they match that point in the story.
55. As a player, I want to Revert to any Message, so that I can take the story another way.
56. As a player, I want Revert to restore all game state instantly, so that it needs no API call.
57. As a player, I want a confirmation showing how much a Revert deletes, so that I don't lose work by accident.
58. As a player, I want to choose “Duplicate from here” instead of Reverting, so that I can keep that future.

### Errors

59. As a player, I want a failed Turn to change nothing, so that errors never corrupt my game.
60. As a player, I want my text kept in the input box after a failure, so that I don't have to retype it.
61. As a player, I want invalid responses retried automatically, so that I don't see routine failures.
62. As a player, I want to be told when content is refused and be able to edit my message, so that I can continue.
63. As a player, I want a retry option on network or API errors, so that a temporary problem doesn't end my session.

### Images

64. As a player, I want a Scene Image above the chat, so that I can see where I am.
65. As a player, I want a new Scene Image when the scene changes, so that the picture stays current.
66. As a paying API user, I want images generated only when needed, so that I don't waste money.
67. As a player, I want the previous Scene Image used as a reference, so that backgrounds stay consistent when the cast changes.
68. As a player, I want NPC portraits used as references where the model supports them, so that NPCs look consistent.
69. As a paying API user, I want an NPC portrait generated only on first appearance in a Scene, so that mentions don't cost anything.
70. As a player, I want images generated in the background, so that a Turn never waits.
71. As a paying API user, I want a running count of images generated this session, so that I can track my use.
72. As a player, I want to turn images off at any time, so that existing images stay visible and no new ones are created.
73. As a player, I want to change Art Style mid-game, so that new images use it while old ones stay unchanged.

### Models and settings

74. As a player, I want to choose text and image models separately, so that I can balance cost and quality.
75. As a player, I want OpenRouter or Local for each of text and images, so that I can mix them.
76. As a local model user, I want to use any OpenAI-compatible URL for text, so that I can use the server I already run.
77. As a local image user, I want to pick my model and family from a dropdown, so that I never have to touch a workflow.
78. As a local image user, I want to add multiple LoRAs with strengths and trigger words, so that I can shape the look easily.
79. As a local image user, I want a refresh button, so that models I've just added appear.
80. As a local image user, I want to see what references my setup supports, so that I understand any limits.
81. As an advanced user, I want to provide my own ComfyUI workflow, so that I can use IPAdapter or per-NPC LoRAs.
82. As a player, I want Model Instructions, so that I can guide the Narrator across all my games.
83. As a player, I want to change models mid-game, so that I'm not locked in.
84. As a player, I want font size and Chat style settings, so that reading is comfortable.

### Saves and menu

85. As a player, I want every Turn saved automatically, so that I never lose progress.
86. As a player, I want a main menu with New Game, Load Game and Settings, so that the app is easy to navigate.
87. As a player, I want to load, duplicate and delete Saves, so that I can manage my games.
88. As a player, I want delete to ask for confirmation, so that I don't lose a game by accident.
89. As a player, I want to import and export a Save file, so that I can move or share a game.
90. As a player, I want API keys left out of Saves, so that sharing a Save never leaks them.
91. As a player, I want old Saves upgraded when opened, so that updates don't break my games.

### UI

92. As the product owner, I want an HTML report of UI options before any UI code, so that I choose the direction before it's built.
93. As the product owner, I want 3 distinct directions covering the game screen, a wizard step, the Journal and inventory at desktop and phone widths, so that I can compare them properly.
94. As a player, I want a clean, story-focused interface that works at any screen size, so that the game feels like a visual novel.

### Development

95. As a coding agent, I want to drive the whole game through the REST API, so that I can verify work without a UI.
96. As a coding agent, I want scripted LLM responses and dice, so that Turns are deterministic in tests.

## Implementation Decisions

### Product boundary

- NovelForge is single player and localhost only, with no accounts, hosting or cloud.
- TypeScript on both ends, compiled with Bun into one executable with the SPA embedded.
- Local inference is connected to, never bundled (ADR 0001).
- Which content is allowed is decided by the provider and model. NovelForge has no filter or rating of its own.

### Modules

- **Save Store:** owns the SQLite file for one Save. It offers atomic Turn commit, load Snapshot, Revert, duplicate (whole or from a Message), import, export and migration. Callers never see section sharing.
- **Turn Engine:** runs a Turn from player input to committed Messages and Snapshot, including Checks, retries and failure handling. Rewrite and Regenerate reuse it.
- **Prompt Assembler:** builds each stateless prompt from a Snapshot and returns it as data. Delimits player text as in-character input and places `world_rules` late.
- **Lore Activation:** given Lore Entries and recent Messages, selects always-on and keyword-activated entries within a token budget, with one level of recursion.
- **State Applier:** validates Narrator state operations against a Snapshot and produces the next Snapshot.
- **Check Resolver:** validates the difficulty, takes a d20 from the Dice port, and determines the degree.
- **World Creation:** generates the World Bible, Plot Threads, World Overview, Starting Hook and “Pick for me” content, and reconciles a conflicting PC.
- **Text Provider:** one OpenAI-compatible HTTP client with a configurable base URL. No agent framework.
- **Image Pipeline:** decides when images are needed, builds the payload, runs jobs in the background, stores results and counts them.
- **Image Adapters:** format the shared payload for OpenRouter and ComfyUI, trimming references and dropping unsupported fields to suit the model.
- **ComfyUI Graph Builder:** turns family, model and LoRA choices into a workflow graph. It's pure and needs no running server.
- **Settings Store:** per-install settings, including API keys, kept separate from every Save.
- **REST API:** the only interface the SPA uses. It never exposes the World Bible, Plot Threads or Checks.

### Turn flow

- Every Turn is a fresh, stateless call (ADR 0002).
- The Narrator's structured response is either a finished Turn or a Check request.
- A finished Turn contains narration, state operations, PC-known updates, `scene_changed` and `visual_description`.
- A Check request contains the action and its difficulty. The server validates the difficulty, rolls, and makes a second call to narrate the result.
- Actions violating `world_rules` get no Check and fail in character.
- Models without schema mode fall back to JSON validation and retries.
- Invalid JSON retries up to twice. Failed Turns write nothing.
- Narration streams to the SPA. Nothing is committed until the Turn is complete and valid.

### Checks

- Difficulties are Easy 5, Moderate 10, Hard 15 and Very Hard 20. The Narrator's one difficulty already accounts for skills, condition and situation.
- The action succeeds if the d20 meets or beats the difficulty.
- A natural 20 is always a strong success, a natural 1 is always a bad failure, and a near miss is a mixed result. The near-miss margin is one configurable value, tuned in playtesting.
- The roll is stored with the Turn but never returned to the SPA. Rewrite and Regenerate reuse it.

### Storage

- One SQLite file per Save, in a known folder next to the app (ADR 0003).
- Rollback journal with full sync, not WAL.
- A Turn or Revert is one transaction.
- Snapshots are logically complete and immutable. Sections are stored only when changed and shared between Messages.
- A Snapshot contains inventory, status, the World Bible, Plot Threads, NPCs, PC-known information, summary and Director's Notes.
- Revert sweeps orphaned sections and deletes Messages and images after the target.
- Saves are migrated when opened.
- Art Style is per Save. Everything else in Settings is per install.

### Images

- A Scene Image is requested when `scene_changed` is true, or when the server sees the location or visible cast change. Descriptions aren't compared as text.
- NPC portraits are generated on first appearance in a Scene, from the NPC's stored appearance text.
- The payload contains `prompt`, optional `negative_prompt`, `aspect_ratio`, `reference_images` and `style_preset`. Each reference has a role, such as previous scene or NPC.
- In Simple Mode, SD 1.5/SDXL uses one checkpoint and img2img from the previous Scene. FLUX.2 uses separate diffusion model, text encoder and VAE selections with native multi-reference.
- The LoRA list is global, each with a strength and optional trigger words. If references can't be used, images still generate and Settings shows what's supported.
- Advanced mode accepts user workflow JSON.

### REST API

- Resources cover Saves, Turns, Messages, Revert, duplication, Rewrite, Regenerate, Director's Notes, Journal, inventory, status, images, game creation and Settings.
- Narration is delivered as a stream. The transport is the implementer's choice.
- Responses are built only from player-facing data.

## Testing Decisions

- Good tests check external behaviour through the REST API, not internal modules or Save file structure. A test should survive a rewrite of the internals.
- The primary seam is the REST API. Tests start the real server and use real SQLite Saves in a temp folder.
- Only three things are replaced, at the outer edges: the Text Provider (scripted responses, including refusals, invalid JSON and network failures, and recording every prompt), image providers (recording requests, references and failures), and the Dice port (scripted d20 results).
- Checks are tested at the REST seam: script the d20, send a Turn, and assert that the second call received that result.
- Secrecy gets its own tests. Scripted World Bible, Plot Thread and Check data contain unique markers, and no player-facing response may contain them.
- The ComfyUI Graph Builder is a small second seam, tested from inputs to graph output.
- The Revert orphan sweep must be tested against shared sections, because a bug could delete data other Messages need.
- Failure tests cover a provider error partway through a Turn, confirming nothing was written.
- There's no existing test code to follow, so the first tests set the pattern.
- Real OpenRouter and ComfyUI runs are manual and outside the automated suite.
- SPA testing is decided after the UI direction is chosen.

## Out of Scope

- Hosting, accounts and multi-user play
- Bundled inference runtimes
- Importing SillyTavern character cards or lorebooks
- A message tree or branch UI
- Embedding or vector retrieval
- Per-NPC LoRAs in Simple Mode
- IPAdapter in Simple Mode
- Swipeable alternate responses
- An app-level content rating or filter
- Any player-visible dice, difficulty or Check UI

## Further Notes

- **Build order:** 1) fake provider, minimal game creation, Turns, Snapshots, Checks, Revert and OpenRouter text, with no UI; 2) UI options report, then the user chooses; 3) Journal, inventory, status, and Rewrite, Regenerate and Director's Notes; 4) full wizard and World Bible generation; 5) OpenRouter images; 6) ComfyUI and local text; 7) UI polish.
- **UI gate:** no UI code may be written until the user has chosen from the UI options report. Slice 1 is deliberately REST-only.
- **Playtesting risks:** the Narrator may rarely request Checks or set everything to Easy, which the server can't judge. Keyword activation can miss paraphrases, so Lore Entries need several keywords.
- **Unverified:** ComfyUI reference workflows and FLUX.2 limits haven't been tested against a live server. Bun packaging hasn't been tried. Storage figures came from a simulation using Node's SQLite and synthetic data.
- **Repo setup:** add a `.gitattributes` before code is written, because Git warns about LF and CRLF conversion.
