# NovelForge

## AI driven choose your own visual novel

# Brief

A game/app that lets the user go through a choose your own adventure style visual novel that’s driven by an LLM. The user controls their own actions and speaks for themselves, while the LLM drives the story, controls NPCs, tracks the state of the world, and presents interesting hooks for the player to take.  
It can create images. Images created based on the current scene in the game, and a new one is generated once the scene has changed enough to justify creating a new one.

# Features

## Game creation, wizard style workflow

### Create the world

The first step in a new game is creating the world, the player selects from lists or provides a free form answer

* Theme: each has a short description, shown to the player once chosen and sent to the Narrator with its name  
  * High Fantasy  
  * Dark Fantasy  
  * Cyberpunk  
  * Sci Fi Fantasy (ie Star Wars, Sci Fi with magic)  
  * Sci Fi (ie The Expanse, Star Trek)  
  * Modern Day  
  * Steampunk  
  * Realistic medieval  
  * Western  
  * Create your own  
* World Brief \- free form field to describe the world  
* Title - free form field for the story's title, lettered into the Cover  
* Toggle for Starting Hook  
  * Yes \- the player specifies a Starting Hook at the beginning of the game  
  * No \- The PC just starts in the world with no immediate hook, more sandbox style start  
* One “Pick for me” button that will use the theme and any provided info to generate the empty fields above  
* An “Enhance” button on each of those fields, which rewrites what the player wrote into something richer, for a player with a general idea. Undo brings back their words  
* Art style \- the style to be used for all image generation in this Save (can be changed in game, affects new images only)  
  * **Cinematic Photorealism**  
    * Ultra-detailed photorealistic style capturing hyper-accurate physics, micro-surface textures, natural volumetric light dispersion, realistic lens depth of field, and true-to-life subsurface scattering, indistinguishable from high-resolution digital cinema footage.  
  * **Modern Digital Painting & Concept Art**  
    * Clean, high-definition digital realism combining smooth blended gradients, rich volumetric atmosphere, dynamic lighting, and expressive digital brushwork—balancing sharp edge control with polished character and environment art rendering.  
  * **Graphic Novel & Comic Illustration**  
    * Bold graphic aesthetic defined by clean ink linework, stylized cell-shading, dynamic speed lines, sharp silhouettes, and saturated flat tones with optional Ben-Day halftone dot patterns.  
  * **Cybertech & Retro-Futuristic Neon**  
    * High-contrast, rain-slicked sci-fi aesthetic blending 1980s low-life street aesthetics with glowing neon-cyan and magenta palettes, hard-edged cyberware detail, dark atmospheric chiaroscuro, and wireframe perspective grids.  
  * **Traditional Impasto Oil Painting**  
    * Richly textured painterly realism featuring visible expressive brushstrokes, dynamic palette knife work, deep glazes, physical impasto texture, and dramatic chiaroscuro lighting across vibrant, wet-on-wet blended pigments.  
  * **Luminous Fluid Watercolor**  
    * Soft semi-translucent aesthetic characterized by delicate watery washes, soft-edge color bleeding, visible paper grain texture, expressive paint splatters, and vibrant pigment pooling along fine hand-drawn ink contours.  
  * **Impressionism, Post-Impressionism & Expressionism**  
    * Vibrant, light-focused style featuring rapid broken brushstrokes, unblended pure pigments, raw jagged linework, and non-naturalistic, emotionally intense color choices with visible motion.  
  * **Medieval Romanesque & Gothic Manuscript**  
    * Flat two-dimensional composition with bold ink outlines, stylized expressive figures, luminous gilded leafing, geometric drapery folds, and hierarchical scaling set against saturated primary pigments and intricate architectural border ornamentation.  
  * **Japanese Ukiyo-e Woodblock**  
    * Traditional Edo-period aesthetic defined by flat graphic compositions, strong black ink outlines, rhythmic wave and cloud motifs, subtle paper grain, and layered block-printed pigment washes.  
  * **Art Nouveau Decorative Illustration**  
    * Ornate turn-of-the-century aesthetic featuring sweeping organic curves, flowing stylized hair and drapery, flat-toned figures, and intricate floral frame borders inspired by Alphonse Mucha.  
  * **Retro Sci-Fi Pulp Illustration**  
    * High-contrast 1970s and 80s book-cover art featuring bold gouache and airbrush gradients, vivid speculative color palettes, dramatic heroic staging, painterly space hardware, and atmospheric cosmic dust.  
  * **Architectural Blueprint & Technical Drafting**  
    * Precision monochrome drafting style featuring crisp white or cyan vector linework on a dark background, grid overlays, detailed cross-sections, schematic callouts, and clean geometric typography.  
  * **Surrealism & Dream Logic**  
    * Mind-bending realism blending precise, dreamlike detail with impossible juxtaposition, melting forms, hyper-smooth gradients, and unsettling atmospheric lighting inspired by Salvador Dalí and René Magritte.  
  * **Cubism & Geometric Abstraction**  
    * Deconstructed perspective breaking subjects into sharp faceted geometric planes, overlapping angular shapes, and muted monochromatic tone palettes.  
  * **Art Deco & Streamline Moderne**  
    * Symmetrical luxury aesthetic featuring sharp geometric line work, metallic gold/bronze accents, sleek aerodynamic curves, high-contrast black-and-gold tones, and sunburst motifs.  
  * **Modern Anime & Manga Illustration**  
    * Polished Japanese graphic art style featuring sharp ink contour lines, vibrant cell-shading, expressive eye dynamics, clean hair clumps, and dramatic action-line perspective.  
  * Describe your own art style

    

### Generate the world

Once details are entered, the Narrator generates a detailed World Bible that is used for the rest of the game, along with the Plot Threads, which are kept secret from the player. The Narrator can expand the World Bible and create new Plot Threads during play, such as when the player has exhausted the current ones or ventured into an unmapped area.

The World Bible is a set of Lore Entries. Each has a title, keywords and self-contained content. The Narrator should give each entry several keywords so that paraphrases still activate it.

Generation also produces a World Overview covering what the PC would plausibly know. The player can accept it or regenerate the world before creating the PC.

### Create a character

The player can play whomever they want. Whatever the player writes during character creation is canon. If it conflicts with the world, the game shows a non-blocking warning and the Narrator updates the World Bible to fit. World rules apply strictly from the first Turn. For example, a player can create a wizard who throws fireballs in a strict modern-day world, and the world changes to allow it.

* Name
* Background
* Physical traits
* Skills/experiences (what they are good at/can do, as free text with no numbers)
* Current inventory (inventory explained more further down)
* Any other fields needed to fully describe the PC

An image of the PC will be generated based on the descriptions.
“Pick for me” button that will use any provided info to generate empty fields. Each field except the name also has “Enhance”, as in world creation

## The game loop

The game plays like a typical AI chat session, but the game is a harness to help guide a choose your own visual novel story.

### The “chat”

Interacting with the story will be similar to an AI chat session.

Example

```
[Ashley]: “Hey PC, how is it going? Do you have those spanners I was asking for?”

Ashley looks up at you from her workbench

PC: “Hey Ash, yeah I got ten for you here”

Ashley takes the spanners from you

[Ashley] “Oh thank you so much! I really needed these.”
```

The Narrator must not take instructions from the player in the main chat, ie no prompt/instruction injection. Player text is always passed as clearly delimited in-character data. The player can only say what the PC is saying or doing, and they cannot “break the game”/do something that doesn't fit the world. For example, in a modern day theme strictly based on the current 2026 world, a PC would not be able to cast magic if it hasn't somehow been introduced into the story.

Rewrite and Model Instructions are the only out-of-character inputs. Director's Notes are out of the game for now: Rewrite covers correcting the Narrator. Their code stays, as they may come back (ticket 31).

### Turns

Every Turn is a fresh, stateless LLM call (see [ADR 0002](docs/adr/0002-stateless-turns-from-snapshots.md)). The prompt is assembled from the current Snapshot, active Lore Entries, the rolling summary, Director's Notes, Model Instructions and the most recent Messages. `world_rules` go late in the prompt, where they have the most impact.

Lore Entry activation:

* Always-on entries include `world_rules` and active Plot Threads
* Other entries activate when their keywords appear in recent Messages, within a token budget
* Activation allows one level of recursion
* There are no probability rolls, timers or embeddings

**Structured Output Protocol:** Force function calling / JSON Schema output mode on supporting models, falling back to validating the JSON and retrying on models without it. Narration streams as it arrives. The Narrator's response is one of:

* **A finished Turn:** narration, state operations, PC-known updates, `scene_changed` and `visual_description`
* **A Check request:** the action being attempted and its difficulty

System prompt must explicitly instruct the Narrator: *"Evaluate player action against `world_rules`. If an action violates world constraints, describe the failure in-character rather than fulfilling it."*

**State authority:** The Narrator proposes discrete state operations, such as add item, remove item and set condition. The server validates and applies them, and refuses operations it can disprove, such as removing an item the PC doesn't have. The Narrator judges plausibility. It must not rewrite the whole state.

### Checks

Checks add randomness to risky actions and stop the Narrator from simply agreeing with the player. They are completely hidden. The player never sees rolls, difficulties or Check results, and they don't appear in the chat, Journal, Full Log or SPA API responses. The Narrator must never mention dice, numbers or Checks. This is a story, not a D&D game.

1. The Narrator requests a Check for a risky action, setting the difficulty before any roll exists
2. The server validates the difficulty and rolls a d20
3. A second call narrates the result

Safe actions need only one call. Actions that violate `world_rules` get no Check and fail in-character. The player cannot set or claim a roll.

The Narrator chooses one difficulty that already accounts for the PC's skills, condition and the situation. The action succeeds if the d20 meets or beats it.

| Difficulty | DC |
|---|---|
| Easy | 5 |
| Moderate | 10 |
| Hard | 15 |
| Very Hard | 20 |

Results also carry a degree:

* Natural 20 is always a strong success
* Natural 1 is always a bad failure
* A near miss is a mixed result, where the PC succeeds at a cost. The exact margin is tuned in playtesting

The roll is stored with the Turn, so Rewrite and Regenerate reuse it. Only a new Turn rolls again.

### Correcting the story

LLMs sometimes are wrong, or don't remember correctly. The player has three controls:

* **Rewrite** \- give feedback on the latest Narrator response and it regenerates with that feedback. For example, “No Ashley is actually mad it took so long for me to get those spanners” repeats her response, but angry this time, and any summaries or Journal entries reflect the change
* **Regenerate** \- replace the latest Narrator response without feedback
* **Director's Note** \- a standing out-of-character instruction for this Save, such as “Ashley has green eyes, not blue”. Older text stays in the Full Log as written. Notes are stored in the Snapshot, so Revert restores them too

### Revert

The player can Revert to any previous Message, which restores that Message's Snapshot. History is linear, so everything after that Message is permanently deleted, including its images. A confirmation shows how much will be deleted and offers “Duplicate from here” to keep it instead.

### Errors

A failed Turn writes nothing and keeps the player's text in the input box.

* Invalid JSON retries automatically up to twice
* A content refusal tells the player it was refused and lets them edit the message
* Network or API errors offer a retry

### State Snapshots

Game state (Inventory, Status, World Bible, Plot Threads, NPC lists, PC-known information, summary, Director's Notes) is stored as a logically complete, immutable Snapshot linked to every Message `ID`. Reverting to Message `N` restores Snapshot `N` instantly without re-summarization or API calls.

### Journal

The journal has multiple sections

* Recent summary \- summary of recent events
* Full log \- a full history of exactly the story along with images
* NPCs \- a list of NPCs the PC knows about. Images next to their name

The Journal is built only from the PC-known section of the Snapshot, which the Narrator updates through state operations. The server never sends the World Bible or Plot Threads to the SPA.

### Images

A Scene Image is displayed whole on the left page of the book, beside the story, and any image opens larger when clicked. In the Stage box Chat style it sits behind the story instead. Previous Scene Images can be used as a reference for the new image, like maybe a character in the image changed, but we want the background to be the same.

The user may be using a paid API, so need to respect the volume of images created. Settings has a toggle to disable generating images at any time, and the game shows a running count of images generated this session. There is no hard limit.

Images generate in the background, so a Turn never waits for one.

An NPC portrait is generated the first time that NPC appears in a Scene, not when they are merely mentioned. Each NPC stores appearance text for image prompts. Portraits are displayed in the Journal and used as reference images for Scene Images where the model supports it.

**Explicit Image Triggering:** The Narrator's structured output includes a boolean `scene_changed` flag and a `visual_description` string. A Scene Image is generated only when `scene_changed` is true or the server sees the location or visible cast change. There is no text comparison of descriptions.

**Unified Image Adapter Interface:** Define a standard internal payload (`prompt`, optional `negative_prompt`, `aspect_ratio`, `reference_images`, `style_preset`) and a lightweight backend adapter pattern to format requests for OpenRouter and ComfyUI. `reference_images` is a list where each item has a role, such as previous scene or NPC. Each adapter trims the list to what the model supports and drops unsupported fields.

### Inventory

The player has an RPG-like inventory UI they can open that shows what they are carrying and wearing. They can click on an item and a chat window will appear to ask what they are doing with that item. For example, the player is wearing a hat, clicks on it and says “I take my hat off and give it to Ashley", the chat would then have this action in it and the world would react.
The inventory should match the world. A real current world theme wouldn't let the player carry 5000 pounds of stuff in their backpack.
The inventory at first can just be a list, broken into two sections; wearing and carrying.

### Status

Similar to RPGs, the player will also have a UI for their status like health, injuries and conditions
Unlike a RPG, these are not hard numbers but general conditions for the story. Like there is not health points.

# Settings

Menu to change various settings. While a game is open, Art Style edits the current Save.

Per Save:

* Art style \- affects new images only

Per install:

* AI settings
  * Text model
  * Image model
  * OpenRouter or Local
  * Can split, so OpenRouter for one, local for the other
  * ComfyUI setup and LoRAs
  * API keys
  * Toggle images on and off, current images are kept and displayed, just no new images created
  * Model Instructions \- allows the user to add an [agents.md](http://agents.md) style instruction. Blank by default
* UI Settings
  * Chat style \- Script, Prose (the default), Bubbles or Stage box, from the UI options report. It changes how the Story shows Messages, not the Full Log, which stays exactly as written
  * Theme - Match this device (the default), Light or Dark
  * Font size

API keys live in the install's settings file and are never written to a Save, because Saves are made to be shared.

Model switching is allowed mid-game, and a LoRA list carries across Saves, so it may need changing when switching to a Save with a different Art Style.

# Main Menu

* New Game
* Load Game \- load, duplicate, delete with confirmation, and import or export a Save file
* Settings

Every Turn saves automatically, so there is no manual save. Players branch a story by duplicating a Save, either from this menu or with “Duplicate from here” on any Message.

# Tech

NovelForge is a single-player app that runs on one person's machine. The server binds to localhost, with no accounts, hosting or cloud.

The game is a web based SPA with a local RESTful API server. Being API based, the coding agent building the game can easily test on its own and build its own testing harness.

The app is TypeScript on both ends, compiled with Bun into a single executable with the SPA embedded, so it has low system requirements and needs nothing else installed. Local model servers are the exception (see [ADR 0001](docs/adr/0001-connect-to-local-models-not-bundle.md)).

The server uses `Bun.serve` with no web framework, and Zod validates Narrator JSON and API requests. Hono is the fallback if routing gets messy. The SPA uses React with TypeScript, built by Bun and styled with plain CSS design tokens. It uses no Tailwind, component library or state library, and no client-side router library is planned.

## Storage

Each Save is one SQLite file holding its Messages, Snapshots and images (see [ADR 0003](docs/adr/0003-one-sqlite-file-per-save.md)). Saves are stored in a known folder next to the app and are independent of the LLM model being used.

* Uses a rollback journal with full sync, not WAL
* A Turn or Revert is one transaction
* Snapshot sections are stored only when they change and are shared between Messages
* Revert sweeps orphaned sections, and this sweep must have a test because a bug could delete shared data
* Old Saves are migrated when opened

## Models

NovelForge uses its own thin harness: one HTTP client with a configurable base URL and no agent framework. OpenRouter and local text servers are reached through the same OpenAI-compatible API. Local text works with any OpenAI-compatible URL the user provides.

OpenRouter also provides image models, using its reference image support. Which content is allowed is decided by the provider and model the user picks. NovelForge has no content rating or filter of its own.

### Local images

ComfyUI is the only Local image backend in v1, and the user runs it themselves.

**Simple Mode** is the default, and the user never sees a workflow. They enter the ComfyUI address, choose a model family, and pick their model from a dropdown listing what ComfyUI has installed. They can add as many LoRAs as they like, each with a strength and optional trigger words that are added to prompts automatically. NovelForge builds the graph. Model files must be in ComfyUI's model folders, and a refresh button updates the lists.

The LoRA list applies to every image. Character LoRAs aren't in v1, and could be supported later through Advanced workflows.

| Family | Model selection | Reference images in Simple Mode |
|---|---|---|
| SD 1.5 / SDXL | One checkpoint file | Previous Scene through img2img. NPCs rely on appearance text |
| FLUX.2 | Separate diffusion model, text encoder and VAE | Native multi-reference |

If a setup can't use NPC references, the image still generates and Settings shows what's supported, for example “NPC references need FLUX.2 or an Advanced workflow”.

**Advanced** lets the user provide their own workflow JSON, which is also how IPAdapter is used.

The player pastes a workflow from ComfyUI's Export (API) into Settings. It's per-install, so no Save carries it, and it goes only to the player's own ComfyUI. Settings refuses one that isn't valid JSON, is in ComfyUI's UI format, uses an unknown placeholder or lacks `{{prompt}}`, and lists every placeholder with a working example.

| Placeholder | Value |
|---|---|
| `{{prompt}}` (required), `{{negative_prompt}}`, `{{art_style}}`, `{{aspect_ratio}}` | The image payload's text. `{{prompt}}` doesn't include the Art Style |
| `{{width}}`, `{{height}}` | About one megapixel at the aspect ratio, in multiples of 16 |
| `{{seed}}` | A new random number per image |
| `{{npc_1}}`, `{{npc_2}}`, ... | Portraits of visible NPCs who have one, in Scene order, so a number is a position and not a set person |
| `{{previous_scene}}`, `{{pc}}` | The previous Scene Image and the PC's portrait |
| `{{reference_1}}`, `{{reference_2}}`, ... | Every reference in priority order: NPCs, previous Scene, PC |
| `{{has_npc_1}}`, `{{has_previous_scene}}`, `{{has_reference_1}}`, ... | 1 if that reference exists for this image, otherwise 0 |

* A placeholder that is a whole input value keeps its type, and one inside longer text joins it. Values are filled into the parsed JSON, in `inputs` only, so story text can't alter the graph.
* Only the image payload reaches a workflow, never the World Bible, Plot Threads or Checks.
* References beyond the workflow's slots aren't sent. Portraits and first Scenes have no references, so a slot with no image gets a blank grey one and the job still runs. A `{{has_...}}` switch used as a weight or strength turns that slot off. An img2img workflow can't turn off that way, so it starts those images from grey.
* The image kept is the highest numbered node's `SaveImage`, or `PreviewImage` if there's none. An id like `12:3` from a subgraph counts as higher than any plain number. Saved copies also stay in ComfyUI's output folder. A job that fails keeps no image, even if an earlier node finished one.
* The Simple Mode model choices, LoRA list and trigger words are ignored. A workflow brings its own.
* A failed job leaves the Turn alone, and Settings shows the node and error type of the last failure. ComfyUI's full text stays in the server log, as it can repeat the prompt.

## Testing

A fake LLM provider and a controllable dice roller let Turns be tested deterministically. Checks are tested through the REST API by scripting the dice and asserting what the Narrator receives, and tests confirm no player-facing response reveals them.

## UI/UX

An old book, open on a desk: aged paper, ink browns and bottle green, the story on the right page, and bookmarks hanging from the top right. It is responsive to screen size. The dark theme is the same book on charcoal laid paper.

World creation, Settings, Load Game and Inventory use the Index Sheet layout from the layout options report: one sheet with a side index, a column that fills the rest of the sheet, and a pinned bottom bar, plus a down arrow whenever a page runs past the fold. Settings shows one section at a time. Everything else stays a two-page book.

**Before any UI code is written, the agent must create an HTML report of UI options.** It shows 3 distinct visual directions, each mocking up the main game screen, a wizard step, the Journal and the inventory at desktop and phone widths using a sample story. It also shows the Chat style options. The player-facing UI contains no Check elements. The mockups are throwaway, and the user can pick one direction or mix parts.

# Build order

Everything in this spec is in v1.

1. Fake provider, minimal game creation, Turns, Snapshots, Checks, Revert, and OpenRouter text, with no UI
2. UI options report, then the user chooses
3. Journal, inventory, status, and Rewrite/Regenerate/Director's Notes
4. Full game-creation wizard and World Bible generation
5. OpenRouter images
6. ComfyUI and local text
7. UI polish

# Not in v1

* Importing SillyTavern character cards or lorebooks
* Bundled inference runtimes
* A message tree or branch UI
* Embedding or vector retrieval
* Per-NPC LoRAs
* IPAdapter in Simple Mode
* Swipeable alternate responses
