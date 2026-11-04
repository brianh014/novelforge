# NovelForge

A single-player, AI-driven choose-your-own visual novel. The player acts and speaks only as their character while an LLM runs the story and world.

## Language

### Roles

**Narrator**:
The LLM role that drives the story, voices NPCs, and proposes changes to the world.
_Avoid_: The LLM, the AI, GM

**PC**:
The character the player controls. The player may only say and do things as the PC.
_Avoid_: Character (alone), player (when the character is meant)

**NPC**:
Any character in the world voiced by the Narrator.

### Story structure

**Message**:
A single entry in the chat history, and the unit the player can revert to.

**Turn**:
One player input together with the Narrator's response to it.
_Avoid_: Message (when the input-and-response pair is meant)

**Scene**:
A continuous place and situation in the story. A Scene can have several Scene Images over time, such as when its cast changes.

**Cover**:
The book-cover art of a story, with its title lettered into the picture, generated with its world from what the player can read, and kept in the Save through every Revert.
_Avoid_: Title image, world image

**Opening**:
The Narrator's first Message, which brings the player up to speed before they act. It is a first Turn whose stored player Message the story never shows.

**Scene Image**:
A generated image showing the current moment of a Scene.

**Check**:
A hidden test of a risky PC action against a difficulty the Narrator sets before the outcome is known. The player never sees a Check.
_Avoid_: Roll, skill check, saving throw

### World

**World Brief**:
The player's wizard input that seeds the World Bible.
_Avoid_: World details

**World Bible**:
The full generated world used by the Narrator, kept secret from the player.
_Avoid_: World details, lore

**Starting Hook**:
The optional opening situation chosen during game creation.
_Avoid_: Hook (alone)

**Plot Thread**:
A secret storyline held by the Narrator that play can reveal.
_Avoid_: Hook (alone), plot

**World Overview**:
A short, spoiler-free description of the world as the PC would plausibly know it.
_Avoid_: World Bible, World Brief

**Lore Entry**:
One titled, self-contained piece of the World Bible, either always available to the Narrator or activated by keywords.
_Avoid_: World Info, lorebook entry

### Player controls

**Rewrite**:
Regenerating the latest Narrator response using the player's feedback.
_Avoid_: Edit

**Regenerate**:
Replacing the latest Narrator response without feedback.
_Avoid_: Retry, swipe

**Director's Note** (retired from play, see ticket 31):
A standing out-of-character instruction to the Narrator for one Save, such as correcting a fact without Reverting.
_Avoid_: Author's Note, edit

**Chat style**:
How the Story shows Messages: Script, Prose, Bubbles or Stage box. It never changes the Full Log.

**Beat**:
One line of a Message, spoken or not, and what a Stage box shows at a time.

**Model Instructions**:
The player's own global guidance to the Narrator, set in Settings and applying to every Save.
_Avoid_: System prompt

### State

**Snapshot**:
The complete, immutable game state belonging to a Message. Reverting to a Message restores its Snapshot.
_Avoid_: Save (a Snapshot is not a player-facing save)

**Journal**:
The player-facing record of only what the PC knows or has encountered.
_Avoid_: Log (the Full Log is one section of the Journal)

**Revert**:
Returning to an earlier Message and permanently deleting everything after it.
_Avoid_: Undo, rollback

**Save**:
One player-facing game on disk. Duplicating a Save is how the player branches a story.
_Avoid_: Branch, slot
