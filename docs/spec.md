# NovelForge

## AI driven choose your own visual novel

# Brief

An app that lets the user go through a choose your own adventure style visual novel that’s driven by an LLM. The user controls their own actions and speaks for themselves, while the LLM drives the story, controls NPCs, tracks the state of the world, and presents interesting hooks for the player to take.  
It can create images. Images created based on the current scene in the story, and a new one is generated once the scene has changed enough to justify creating a new one.

# Features

## Story creation, wizard style workflow

### Create the world

A new story is one form, in this order: the world's fields, Art Style, Cover, the PC's fields, portrait. The player selects from lists or provides a free form answer

* Theme: each has a short description, shown to the player once chosen and sent to the Narrator with its name  
  * High Fantasy  
  * Dark Fantasy  
  * Urban Fantasy  
  * Cyberpunk  
  * Space Opera (ie Star Wars, Sci Fi with magic)  
  * Sci Fi (ie The Expanse, Star Trek)  
  * Modern Day  
  * Steampunk  
  * Realistic medieval  
  * Western  
  * Post-Apocalyptic  
  * Horror  
  * Noir  
  * Create your own  
* World Brief \- free form field to describe the world  
* Title - free form field for the story's title, lettered into the Cover  
* Toggle for Starting Hook  
  * Yes \- the player specifies a Starting Hook at the beginning of the story  
  * No \- The PC just starts in the world with no immediate hook, more sandbox style start  
* One “Pick for me” button for the whole form, world and PC together. One Narrator call fills only the empty boxes, seeing every other box and only the player's own words, and leaves the Starting Hook alone while it's off  
* A button on each box, including the PC's name. On a box with words it's “Enhance”, which rewrites what the player wrote into something richer, for a player with a general idea. On an empty box it writes that field from scratch. It sees every other box and only the player's own words, and Undo brings back what the box held  
* Art style \- the style to be used for all image generation in this Save (can be changed during the story, affects new images only)  
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
* Cover \- a section to draw the Cover before the world exists, from the Title, theme and World Brief. It's unavailable until those are filled  

    

### Generate the world

One button writes the world with the PC in view. The PC stays canon and the world bends to them, so there is no separate step to fit them in and no notice that the world changed. The Narrator also works out what the PC wears and their opening status, before the world, so a failure there costs no world. The Narrator generates a detailed World Bible that is used for the rest of the story, along with the Plot Threads, which are kept secret from the player. The Narrator can expand the World Bible and create new Plot Threads during play, such as when the player has exhausted the current ones or ventured into an unmapped area.

The World Bible is a set of Lore Entries. Each has a title, keywords and self-contained content. The Narrator should give each entry several keywords so that paraphrases still activate it.

Generation also produces a World Overview covering what the PC would plausibly know. It then draws the Cover from the World Overview and the portrait from the PC, in what they wear, for whichever the player didn't draw on the form. An image drawn on the form isn't drawn again.

A review shows the Cover, portrait and World Overview, with Regenerate and Begin. Clicking an image, here or on the form, opens it larger, with a Redraw button that shows its Image Prompt, to Redraw only that image, and an image that failed to draw shows its prompt so it can be tried again. Regenerate writes a new world around the same PC and keeps every image already drawn with its edited prompt, trying again only for one that came to nothing. If the form has changed since the world was written, the review says so, as Begin and Regenerate use what the world was written from.

Begin creates the Save with the images and goes straight into the story. An image still drawing lands in the Save when it's done. A portrait stored this way survives every Revert, like any other portrait of the PC.

Images drawn before Begin are held in memory, as neither a world nor a Save exists yet. A restart loses them and any world not yet begun, while the form's text stays in the tab, surviving a reload.

### Create a character

The player can play whomever they want. Whatever the player writes during character creation is canon. If it conflicts with the theme or World Brief, the Narrator builds the world to fit them. World rules apply strictly from the first Turn. For example, a player can create a wizard who throws fireballs in a strict modern-day world, and the world changes to allow it.

* Name
* Background
* Physical traits
* Skills/experiences (what they are good at/can do, as free text with no numbers)
* Current inventory (inventory explained more further down)
* Any other fields needed to fully describe the PC

A portrait section draws the PC from their physical traits, and is unavailable until those are filled. Drawn here, it has only the player's words, as nothing has yet worked out what the PC wears.

Changing a field after drawing leaves that image as it is, for the player to Redraw. With images off or not set up, the Cover and portrait sections say so, and nothing else on the form changes.

“Pick for me” and the button on each box work here as in the world's fields

## The story loop

The app plays like a typical AI chat session, but the app is a harness to help guide a choose your own visual novel story.

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

The Narrator must not take instructions from the player in the main chat, ie no prompt/instruction injection. Player text is always passed as clearly delimited in-character data. The player can only say what the PC is saying or doing, and they cannot “break the story”/do something that doesn't fit the world. For example, in a modern day theme strictly based on the current 2026 world, a PC would not be able to cast magic if it hasn't somehow been introduced into the story.

Rewrite, Model Instructions and Tell the Narrator in the Journal are the only out-of-character inputs. A World Change is a deliberate instruction about the world, so it reaches the Narrator as JSON data in a call of its own, never in the main chat, and the Narrator treats it only as what should be true of the world, never as instructions about anything else. Director's Notes are out of play for now: Rewrite covers correcting the Narrator. Their code stays, as they may come back (ticket 31).

### Turns

Every Turn is a fresh, stateless LLM call (see [ADR 0002](docs/adr/0002-stateless-turns-from-snapshots.md)). The prompt is assembled from the current Snapshot, active Lore Entries, Scene Memories, the rolling summary, Director's Notes, Model Instructions and every Message no Scene Memory covers yet. `world_rules` go late in the prompt, where they have the most impact.

Lore Entry activation:

* Always-on entries include `world_rules` and active Plot Threads
* Each finished Turn replaces the rolling summary with its `summary`, and a blank one leaves it as it was
* The current state carries every Loose End on every Turn, so they don't depend on the summary. If the list is empty once the story has begun, the prompt asks the Narrator to fill it from the summary, known facts and recent Messages, which is how a Save from before Loose Ends gets them
* Scene Memories fade older story without losing it, so the Narrator's memory runs from full Messages, to Scene Memories, to the summary. Every Scene Memory goes in the first system message on every Turn, oldest first, with no keywords or retrieval
* The Message window is every Message after the last one a Scene Memory covers, so a Message can't leave the prompt uncovered. Once it reaches 100 Messages, the Turn asks for a Scene Memory of its oldest 20 in about 100 words, in the nullable `scene_memory` field. The server records the Message range, and a reply can't choose it. A missed memory costs nothing: the Turn commits, the window keeps those Messages, and the next Turn asks again. Only a finished Turn writes one. A Save from before Scene Memories starts its window at its latest 100 Messages, and older ones stay with the summary. After a Revert to before that point, the latest 100 Messages stand in until a memory is written. `scripts/backfill-scene-memories.ts` is a one-off that writes the memories such a Save lacks, on a copy of it, from each batch and the memory rules alone
* Every eighth response, the prompt names the next Plot Thread in turn and asks the Narrator to bring it into play
* The last instruction before the player's action keeps the PC's choices and speech to the player, and treats anything the PC is said to think as private
* Other entries activate when their keywords appear in recent Messages, within a token budget, the latest mentioned first
* Activation allows one level of recursion
* There are no probability rolls, timers or embeddings

**Structured Output Protocol:** Force function calling / JSON Schema output mode on supporting models, falling back to validating the JSON and retrying on models without it. Narration streams as it arrives. The Narrator's response is one of:

* **A finished Turn:** narration, state operations, PC-known updates, `people`, `summary`, `scene_changed` and `visual_description`
* **A Check request:** the action being attempted and its difficulty

System prompt must explicitly instruct the Narrator: *"Evaluate player action against `world_rules`. If an action violates world constraints, describe the failure in-character rather than fulfilling it."*

**State authority:** The Narrator proposes discrete state operations, such as add item, remove item and set condition. The server validates and applies them, and refuses operations it can disprove, such as removing an item the PC doesn't have. A repeated known fact, NPC or Loose End is simply ignored, as it is already true. The Narrator adds a Loose End when play leaves something open and resolves one, copying it exactly, only when play has settled it, never to make room. Resolving an item not on the list changes nothing and doesn't cost the Turn, as the item just stays open, and the Server Log gives the reason at Warning. The Narrator keeps its own records true to play by rewriting or removing known facts, Lore Entries and Plot Threads, and by merging two NPCs who turn out to be one person. These never refuse a Turn, as a long text is easily miscopied: a rewrite of something it can't find adds the new text, and a removal or merge of someone or something not there does nothing. A merge keeps the kept NPC's looks and summary, and each portrait stays in the Save, so a Revert brings the other NPC back with theirs. It can't change an always-on Lore Entry, as those bypass the token budget. The Narrator judges plausibility. It must not rewrite the whole state.

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

* Invalid JSON retries automatically up to twice, and so does a broken line in the reply's stream
* A content refusal tells the player it was refused and lets them edit the message
* Network or API errors offer a retry
* The error stays above the input box until the player dismisses it or starts another Turn
* A Turn goes on without its client, so the player can switch apps, lock the phone or reload. The page picks it up on return, text so far included, and a failure waits to be told once. A Turn still costs its model call if the player never comes back, and a server restart ends it unsaved.
* Only one Turn runs per Save, and a second is refused before it reaches the model

### State Snapshots

Story state (Inventory, Status, World Bible, world rules, Plot Threads, NPC lists, PC-known information, Loose Ends, Scene Memories, summary, World Brief, Director's Notes) is stored as a logically complete, immutable Snapshot linked to every Message `ID`. Reverting to Message `N` restores Snapshot `N` instantly without re-summarization or API calls.

Snapshots never change, so an edit made in the Journal waits on the Save, is laid over the latest Snapshot for everything that reads the state, and goes into the Snapshot of the next Message. A Revert to any Message from before an edit undoes it, for hidden and visible edits alike, and so does Duplicate from a Message from before it. A Rewrite or Regenerate of the latest response keeps every edit made since that response's player Message, however many times it runs, by replaying them over that Message's Snapshot. An edit to something only the replaced response wrote stands as an addition. The World Brief the Save began with stays on the Save, and the Snapshots hold the one in use.

### Journal

The Journal has multiple sections

* World Brief \- the player's own description of the world
* Recent summary \- summary of recent events
* Scene Memories \- what happened in older Messages, newest first
* What the PC knows \- facts the PC has learned
* Loose Ends \- what the PC knows is still unresolved
* Full log \- a full history of exactly the story along with images
* NPCs \- a list of NPCs the PC knows about. Images next to their name

The Journal is built only from the PC-known, Loose Ends and Scene Memories sections of the Snapshot and the summary and World Brief, which the Narrator's state operations and the player's edits update. The server never sends the World Bible, world rules or Plot Threads to the SPA.

**Editing:** The World Brief, Recent summary, each Scene Memory, each fact, each Loose End and each known NPC's summary have a pencil button that changes the text in place, facts and Loose Ends can also be added and removed, and each edit reaches the next Turn. NPC names can't be edited, as portraits and Image Prompt marks find people by name. Inventory and status keep their own tab, and the Full Log can't be edited. A Scene Memory's Message range can't be edited, and no state operation or World Change lets the Narrator change a stored memory. An edit can only name a fact, Loose End, Scene Memory or NPC the Journal shows, and an NPC the PC doesn't know gets the same answer as someone who doesn't exist.

**Tell the Narrator:** The “Tell Narrator what to change” button at the top right of the Journal's left page opens a box for plain words about the world as a whole, a World Change, such as “the mayor is secretly a smuggler”. It is how the player nudges the story where they want it or corrects a mistake. One Narrator call, not streamed, gets the whole World Bible, the world rules, the Plot Threads and the Journal's text, and replies with only what changes: Lore Entries to add or to rewrite by exact title, Lore Entries to remove, changes to single world rules, Plot Threads and facts, each quoting the old text exactly, and a new World Brief, Recent summary or NPC summary where the old one no longer holds. What a reply leaves out stays, so it can't lose an entry. A World Change neither sees nor changes Loose Ends, which only a Turn's state operations and the player's own edits can touch. A reply that misquotes, names an NPC the Journal doesn't show, or changes nothing, is unusable and gets the same retries as a Turn. The Journal's text stays free of secrets, by the Narrator's instructions alone: a secret goes in the hidden parts even when the player names it. The player sees that it was done or that it failed, and whatever changed in the Journal: the reply is never sent to the SPA, the Server Log holds only how many entries changed, and a failure's line leaves out the provider's detail, which can echo the prompt.

Edits and World Changes are refused while a Turn runs. A Turn or edit is refused during a World Change, and a Revert during one wins, failing the change.

### Images

A Scene Image is displayed whole on the left page of the book, beside the story, and any image opens larger when clicked. In the Stage box Chat style it sits behind the story instead. The previous Scene Image is used as a reference for the new image only in the same location, as when a character changed but the background should stay the same. A new location, or a return to an earlier one, has no such reference.

The user may be using a paid API, so need to respect the volume of images created. Settings has a toggle to disable generating images at any time. There is no hard limit.

Images generate in the background, so a Turn never waits for one.

**Gallery and Redraw:** The book's Gallery tab, between Journal and Inventory, has up to three sections, and a section with nothing in it doesn't show. Cover holds the Cover. Characters holds the PC's portrait first, then the portraits of NPCs the PC knows. Scenes holds the Scene Images and Requested Images together. NPCs and Scenes run newest to oldest by the Message an image belongs to, so a Redraw moves nothing, and on one Message the Requested Images come newest first and its Scene Image last. Clicking one opens it larger, and a Redraw button there shows its Image Prompt, which is the main text it was drawn from. Images from before this feature show that their prompt wasn't kept, and the player can write one.

Redraw draws that image again from the same or an edited prompt, using the Save's current Art Style, the current model and Resolution, and the image's original shape, negative prompt and kinds of reference images. It takes one click, and the dialog notes that it may cost money. A finished Redraw replaces the image at once, with no undo or history, and changes nothing else: a redrawn portrait is used for future Scene Images, but the NPC's stored appearance stays, and the Narrator never sees the edit. A failed Redraw keeps the old image and prompt, says why in the dialog, and marks the thumbnail until the next Redraw of that image or an app restart.

**Deleting an image:** Each image in Scenes has a Delete button, which asks for confirmation first, as deleting a Save does. The Cover and portraits have none, and the server refuses to delete them whatever the client sends. An image being Redrawn can't be deleted until that finishes. Only the image goes, for good: its Message and Snapshot stay, a Revert doesn't bring it back, and it's gone from the Gallery, the story, the Full Log, the Save's file, exports and duplicates. The Narrator is never told, and nothing draws it again.

The left page and Stage box then show the Scene Image before it. With none left, the Stage box shows no image and the left page shows what it shows before any Scene Image: the Cover, or nothing without one. The next Scene Image follows the usual rule, so the latest Scene Image left before it is its reference if that's in the same location, and otherwise it has none. A Scene Image or Requested Image reads its reference when it starts to draw, so one still waiting never uses a deleted image, and one already drawing finishes with what it was sent.

Redraws wait in the Save's image queue and are never dropped for a newer Scene Image. Each image has one Redraw at a time, and the button is disabled with an empty prompt or while images are off. A Revert or replaced Turn that removes an image stops its Redraw. A replaced Turn whose response had a Scene Image, drawn or still drawing, always draws a fresh one, which loses any Redraw of the old one. The Narrator is told to write its prompt, and one that doesn't gets the old image's prompt. Duplicates and exports include Image Prompts.

An NPC portrait is generated once, the first time that NPC appears in a Scene or the PC comes to know them, even if they aren't in view, such as someone seen in a photo. An NPC who is only in the state gets none. The PC's portrait is drawn from their physical traits and what they wear, so a PC with no physical traits gets none. Each finished Turn lists everyone its narration names, with their looks, and anyone listed but missing joins the state and becomes known to the PC, even if the Narrator left out the operations for it. A list that is malformed is ignored rather than costing the Turn. Anyone missed is drawn when the Scene next moves. Each NPC stores appearance text for image prompts. Portraits are displayed in the Journal and used as reference images where the model supports it, only for people marked in that Scene Image, the PC included.

**Explicit Image Triggering:** The Narrator's structured output includes a boolean `scene_changed` flag and a `visual_description` string, which it writes only for a Turn that will draw, and not at all while images are off. A Scene Image is generated only when `scene_changed` is true, the server sees the location or visible cast change, or a Rewrite or Regenerate replaces a response that had one, and only if there is a prompt to draw. There is no text comparison of descriptions.

**Image Prompts:** A Scene Image's prompt must stand alone: someone who has never read the story could draw the moment correctly from it, so anything invented for the story is described physically and nothing is left for the model to make up. Its wording follows the Prompt Style. Simple Mode's SD 1.5/SDXL family gets keywords, about 40 words with up to two people as short phrases. FLUX.2, OpenRouter and Advanced workflows get prose, at most 150 words plus up to four people, ordered people, place, light, with every exclusion worded as what is there instead, as FLUX.2 has no negative prompt. The Narrator never names a medium, camera or lens, as those are the Art Style's. In prose the Narrator marks each person in the picture as `[Name: phrase]`, the PC included, with a phrase of at most 15 words for their build, hair and current clothing, so names never reach the model. Part of a name counts when it can only mean one person. Someone whose portrait is sure to reach the model, which means Simple Mode's FLUX.2, keeps the phrase, as the image carries their face and repeating it in words only costs length. Anyone else gets their stored looks, unless those run past 60 words. A later mark of the same person becomes "the same person", and an unknown name becomes its phrase, or "a person". An NPC's stored looks are one phrase of 40 to 60 words, and clothing changes through `update_npc`. The PC's are their physical traits and what the inventory has them wearing. FLUX.2 and OpenRouter put the Art Style after the prompt, and SD puts it first. Existing images and prompts are never rewritten, even if the model changes.

**Requested Images:** A button by the story's input opens a short box for the player's own words, such as “the woman in the corner”, and one press draws with no step to check the prompt first. Redraw is how to change it afterwards. It's an extra picture: it joins the latest Message and leaves that Message's Scene Image alone, and a Message can have several. The button is unavailable with images off, while a Turn runs, and before the story opens. The story says how many are drawing, and the player can play on meanwhile, with the picture staying on the Message they asked from.

One text call turns the words into an Image Prompt, the only one written outside a Turn, by the same rules and Prompt Style as a Scene Image's. It isn't streamed, and it gets what the player can read and the people in view: the words, the World Brief, the Scene's location, the last 12 Messages, the PC's looks, and the name and looks of each person in the Scene. It never gets the World Bible, world rules, Plot Threads or Checks, and a person outside the Scene isn't in it, so someone named in a mark who isn't in the Scene gets only the prompt's phrase, with no stored looks or portrait. The player's words are JSON data to that call and never instructions. Someone made up on the spot, like an unnamed woman, gets no portrait or NPC entry. A marked person with a portrait uses it as a reference, as a Scene Image does, and the Scene Image at or before the Message is the previous-scene reference when its location matches.

A Requested Image shows as a folded row under its Message in every Chat style, whatever the left page shows, and the left page and Stage box keep showing the Scene Image. It also shows in the Full Log and the Gallery, labelled with the player's words, and can be Redrawn. A Requested Image isn't a Turn: it makes no Message or Snapshot, and the Narrator never hears about it. A Revert past its Message or a replaced response removes it, and stops one on the way, and duplicates, exports and imports carry it. A failed text call or draw says so once, even if the player was away, and puts their words back in the box. The Server Log records only which step failed and the error's type, never the words, the story or the prompt.

**Unified Image Adapter Interface:** Define a standard internal payload (`prompt`, optional `negative_prompt`, `aspect_ratio`, `reference_images`, `style_preset`) and a lightweight backend adapter pattern to format requests for OpenRouter and ComfyUI. `reference_images` is a list where each item has a role, such as previous scene or NPC. Each adapter trims the list to what the model supports and drops unsupported fields.

### Inventory

The player has an RPG-like inventory UI they can open that shows what they are carrying and wearing. They can click on an item and a chat window will appear to ask what they are doing with that item. For example, the player is wearing a hat, clicks on it and says “I take my hat off and give it to Ashley", the chat would then have this action in it and the world would react.
The inventory should match the world. A real current world theme wouldn't let the player carry 5000 pounds of stuff in their backpack.
The inventory at first can just be a list, broken into two sections; wearing and carrying.

### Status

Similar to RPGs, the player will also have a UI for their status like health, injuries and conditions
Unlike a RPG, these are not hard numbers but general conditions for the story. Like there is not health points.

# Settings

Menu to change various settings. While a story is open, Art Style edits the current Save.

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
  * Model Instructions, labelled Pre-History / System Prompt / Main Prompt \- allows the user to add an [agents.md](http://agents.md) style instruction. Blank by default
  * Test text \- a prompt box and Test button at the bottom of the Text settings send that prompt to the saved model, with the Model Instructions as the system prompt and no schema. The reply shows there with its time, time to the first word, approximate length and speed, and the model
* Advanced
  * Log Level \- Default, Error, Warning, Info or Verbose. Default shows what it is on this build, and a change applies as soon as it's saved
* UI Settings
  * Chat style \- Script, Prose (the default), Bubbles or Stage box, from the UI options report. It changes how the Story shows Messages, not the Full Log, which stays exactly as written
  * Theme - Match this device (the default), Light or Dark
  * Font size

API keys live in the install's settings file and are never written to a Save, because Saves are made to be shared.

Model switching is allowed mid-story, and a LoRA list carries across Saves, so it may need changing when switching to a Save with a different Art Style.

# Main Menu

* New Story
* Load Story \- load, duplicate, delete with confirmation, and import or export a Save file
* Settings

A story is always called by its Title, with its PC's name as a second line under it on Load Story and the Story's left page. A Save with no Title goes by the PC's name, as that's all that tells such Saves apart.

Every Turn saves automatically, so there is no manual save. Players branch a story by duplicating a Save, either from this menu or with “Duplicate from here” on any Message.

# Tech

NovelForge is a single-player app that runs on one person's machine. The server listens on the LAN as well as localhost, so other devices at home can play, with no accounts, hosting or cloud. Anyone on that network can reach everything the player can, and setting `HOST=127.0.0.1` keeps it to this machine.

The app is a web based SPA with a local RESTful API server. Being API based, the coding agent building the app can easily test on its own and build its own testing harness.

The app is TypeScript on both ends, compiled with Bun into a single executable with the SPA embedded, so it has low system requirements and needs nothing else installed. Local model servers are the exception (see [ADR 0001](docs/adr/0001-connect-to-local-models-not-bundle.md)).

The server uses `Bun.serve` with no web framework, and Zod validates Narrator JSON and API requests. Hono is the fallback if routing gets messy. The SPA uses React with TypeScript, built by Bun and styled with plain CSS design tokens. It uses no Tailwind, component library or state library, and no client-side router library is planned.

## Server Log

Every part of the app logs through `src/logger.ts`, so a problem can be traced from the Server Log alone. A line is the time, Log Level, area, message and JSON fields, in that order. Lines go to the console and to `logs/novelforge.log` beside `Saves`, created owner-only, which rotates at 10 MB and keeps one older file. If the file can't be written, the app carries on with the console and warns once.

Each Log Level includes the ones above it here:

| Level | Use it for | Console |
|---|---|---|
| Error | Something the player asked for or expected didn't happen, or a bug | `console.error` |
| Warning | Something went wrong and the app recovered, or carried on with less | `console.warn` |
| Info | One line per decision or finished step | `console.info` |
| Verbose | The steps in between, and anything frequent | `console.debug` |

The default is Verbose running from source, and Warning on a compiled build. A saved Log Level beats it, and a build with none saved keeps following its default. The startup lines, with the app's addresses, always print.

The Server Log holds no World Bible, Plot Thread, world rule, story text, player input, Image Prompt or API key at any level, so it can be shared for help. A line about a Save gives its Save id, and its Message id or image where it has one, so the text can be found in the Save. A retried or failed Narrator reply is in no Save, so its line gives the generation id, which finds it in the provider's own logs where the provider keeps them. Requests log by route pattern, never the real path, and Settings changes by field name, never value.

An error is logged by type, status and message, never its `cause`. Text from a Text Provider goes in at Verbose only, without the key, cut short, and held back if it repeats the prompt. An image model's error text is left out altogether, as it can lead with the Image Prompt, so that line gives the type and status.

The page reports what only it can see to `POST /log`: stream lost, polling fallback, Turn resumed after a reload, polling gave up, narration restarted and uncaught page error. The route takes only those names, numbers and a Save id, with a 1 KB cap, as the app listens on the network, and anything else gets a 400. A line from the page has the area `page`, and a failed report never bothers the player.

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

A Resolution setting of 480p, 720p (the default), 1080p or 4K sizes every image, for both providers. On ComfyUI, in both modes, these are 848 x 480, 1280 x 720, 1920 x 1088 and 3840 x 2160 at 16:9, and other shapes keep the same area. On OpenRouter they ask for the size the model lists nearest to 768, 1K, 2K or 4K, and a model that lists no sizes is left to its own. Checkpoint type no longer sets the size: Settings warns when the resolution is too big for it.

At the bottom of the ComfyUI settings, a Test image box and button draw one image from a prompt with the saved Settings, in either mode. The image shows there with its time, size and file size, plus its model, steps and seed in Simple Mode, and goes into no Save.

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
| `{{npc_1}}`, `{{npc_2}}`, ... | Portraits of NPCs marked in this image who have one, in the order they're marked, so a number is a position and not a set person |
| `{{previous_scene}}`, `{{pc}}` | The previous Scene Image, and the PC's portrait when the PC is marked in this image |
| `{{reference_1}}`, `{{reference_2}}`, ... | Every reference in priority order: NPCs, previous Scene, PC |
| `{{has_npc_1}}`, `{{has_previous_scene}}`, `{{has_reference_1}}`, ... | 1 if that reference exists for this image, otherwise 0 |

* A placeholder that is a whole input value keeps its type, and one inside longer text joins it. Values are filled into the parsed JSON, in `inputs` only, so story text can't alter the graph.
* Only the image payload reaches a workflow, never the World Bible, Plot Threads or Checks.
* References beyond the workflow's slots aren't sent. Portraits and first Scenes have no references, so a slot with no image gets a blank grey one and the job still runs. A `{{has_...}}` switch used as a weight or strength turns that slot off. An img2img workflow can't turn off that way, so it starts those images from grey.
* The image kept is the highest numbered node's `SaveImage`, or `PreviewImage` if there's none. An id like `12:3` from a subgraph counts as higher than any plain number. Saved copies also stay in ComfyUI's output folder. A job that fails keeps no image, even if an earlier node finished one.
* The Simple Mode model choices, LoRA list and trigger words are ignored. A workflow brings its own.
* A failed job leaves the Turn alone, and Settings shows the node and error type of the last failure. The Server Log has the same words. ComfyUI's full text goes nowhere, as it can repeat the prompt.

## Testing

A fake LLM provider and a controllable dice roller let Turns be tested deterministically. Checks are tested through the REST API by scripting the dice and asserting what the Narrator receives, and tests confirm no player-facing response reveals them.

## UI/UX

An old book, open on a desk: aged paper, ink browns and bottle green, the story on the right page, and bookmarks hanging from the top right. It is responsive to screen size. The dark theme is the same book on charcoal laid paper.

World creation, Settings, Load Story, Inventory and the Gallery use the Index Sheet layout from the layout options report: one sheet with a side index, a column that fills the rest of the sheet, and a pinned bottom bar, plus a down arrow whenever a page runs past the fold. Settings shows one section at a time. The Ready page, from its options report, runs down one scrolling page: the cover, the title and World Brief, then the PC's portrait, with Open the book pinned at the bottom. Everything else stays a two-page book. A new Turn snaps the player's words to the top of the view, and the response streams in below them, with blank room under short ones and a down arrow to the newest text once text runs past the bottom. The view never jumps when the response ends. Scrolling the story stops the following at once, while a tap leaves it alone. A Turn goes on while the player visits another screen, and the Story picks it up on their return, with any failure shown then. Reloading or closing the page still ends it. On a phone, the Story's picture folds away behind a toggle by the title and starts folded, and its Condition is left to the Inventory. As pictures are out of sight there, each Scene Image and NPC portrait also sits folded in the story under the response it came with, as a one-line row that opens it in place. On a wider screen, an arrow on the left page folds it away to get the same reading: a strip with the title and Main Menu, one column of story, and folded rows for images. It starts open, and each browser remembers the choice.

**An HTML report of UI options is only made when the user asks for one, for a large visual change.** Other UI changes are built directly. The first report showed 3 distinct visual directions, each mocking up the main story screen, a wizard step, the Journal and the inventory at desktop and phone widths using a sample story, plus the Chat style options. The mockups are throwaway, and the user can pick one direction or mix parts. The player-facing UI contains no Check elements.

# Build order

Everything in this spec is in v1.

1. Fake provider, minimal story creation, Turns, Snapshots, Checks, Revert, and OpenRouter text, with no UI
2. UI options report, then the user chooses
3. Journal, inventory, status, and Rewrite/Regenerate/Director's Notes
4. Full story-creation wizard and World Bible generation
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
