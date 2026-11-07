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

**Story**:
One world and PC played from the Opening on, held in a Save and always called by its Title. A Save with no Title goes by the PC's name.
_Avoid_: Game

**Message**:
A single entry in the chat history, and the unit the player can revert to.

**Turn**:
One player input together with the Narrator's response to it.
_Avoid_: Message (when the input-and-response pair is meant)

**Scene**:
A continuous place and situation in the story. A Scene can have several Scene Images over time, such as when its cast changes.

**Cover**:
The book-cover art of a story, with its title lettered into the picture, drawn from what the player can read: the Title, theme and World Brief if the player draws it while creating the story, otherwise the World Overview. It is kept in the Save through every Revert.
_Avoid_: Title image, world image

**Opening**:
The Narrator's first Message, which brings the player up to speed before they act. It is a first Turn whose stored player Message the story never shows.

**Chapter**:
A titled run of consecutive Messages, read as one piece in the Journal. One Chapter is always open, the one play is adding to. Only the player closes it, sometimes on the Narrator's suggestion, and closing starts the next. The Opening begins Chapter 1, and a Chapter never splits a Turn. Chapters don't change what the Narrator is sent.
_Avoid_: Act, part, Scene (that is a place and situation, and a Chapter may hold many)

**Scene Image**:
A generated image showing the current moment of a Scene.

**Requested Image**:
An extra picture drawn on the spot from the player's own words and the recent story, which joins the latest Message beside any Scene Image. It is not a Turn, so the Narrator never hears about it.
_Avoid_: Scene Image (that is what a Turn draws)

**Image Prompt**:
The main text an image was drawn from, which the player can read and change. Art Style and other drawing choices are not part of it.
_Avoid_: Visual description (that is only the Narrator's part of a Scene Image's prompt)

**Prompt Style**:
How an Image Prompt is worded for the kind of image model drawing it: prose or keywords. It decides the wording, never what the image shows.
_Avoid_: Model family (that is the Settings choice of which models to load)

**Redraw**:
Drawing one existing image again from its Image Prompt, replacing that image and changing nothing else in the story.
_Avoid_: Regenerate (that redoes a Turn or a whole world)

**Check**:
A hidden test of a risky PC action against a difficulty the Narrator sets before the outcome is known. The player never sees a Check.
_Avoid_: Roll, skill check, saving throw

### World

**World Brief**:
The player's description of the world: written on the New Story form, where it seeds the World Bible, and editable in the Journal. A Snapshot holds the one in use.
_Avoid_: World details

**World Bible**:
The full generated world used by the Narrator, kept secret from the player.
_Avoid_: World details, lore

**Starting Hook**:
The optional opening situation chosen during story creation.
_Avoid_: Hook (alone)

**Plot Thread**:
A secret storyline held by the Narrator that play can reveal.
_Avoid_: Hook (alone), plot

**Loose End**:
Something the PC knows is still unresolved, such as an unanswered question, a promise, a plan, an invitation or someone still missing. It stays on the list until play settles it, and the player can read and edit it in the Journal.
_Avoid_: Open thread, Plot Thread (that is secret, and says where the story could go)

**Scene Memory**:
About 100 words on what happened in a batch of 20 older Messages, written by the Narrator before they leave the prompt and sent on every Turn after. The server records which Messages it covers. Only the player can change it, in the Journal.
_Avoid_: Summary (that is the one rolling account of the whole story), Scene (that is a place and situation in the story)

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
Replacing the latest Narrator response without feedback, or a world before play begins, which keeps the PC and every image already drawn.
_Avoid_: Retry, swipe

**World Change**:
A change to the world in the player's own plain words, to nudge the story or correct a mistake, given through Tell the Narrator in the Journal. The Narrator applies it to the World Bible, world rules and Plot Threads, and to the Journal's text where that no longer holds. The player sees only that it was done, and any change to the Journal.
_Avoid_: Edit (that is a change to text the player can read)

**Director's Note** (retired from play, see ticket 31):
A standing out-of-character instruction to the Narrator for one Save, such as correcting a fact without Reverting.
_Avoid_: Author's Note, edit

**Chat style**:
How the Story shows Messages: Script, Prose, Bubbles or Stage box. It never changes how Chapters read in the Journal.

**Beat**:
One line of a Message, spoken or not, and what a Stage box shows at a time.

**Model Instructions**:
The player's own global guidance to the Narrator, set in Settings and applying to every Save. Settings shows it as Extra Narrator Instructions, as the Narrator works without it.
_Avoid_: System prompt

### State

**Snapshot**:
The complete, immutable story state belonging to a Message. Reverting to a Message restores its Snapshot.
_Avoid_: Save (a Snapshot is not a player-facing save)

**Journal**:
The player-facing record of only what the PC knows or has encountered, where the player can edit that text. An edit lasts until a Revert to before it.
_Avoid_: Log

**Server Log**:
The app's own record of what it did, for tracing a problem: the console and `logs/novelforge.log`. It never holds story text, only ids that lead to it in the Save. It has nothing to do with the Chapters, which are the story's own record.
_Avoid_: Log (alone), debug log

**Log Level**:
How much goes in the Server Log: Error, Warning, Info or Verbose, each including the ones before it. A Default choice follows the build.
_Avoid_: Debug level

**Gallery**:
The part of the book holding every image the player may see, in three sections: Cover, Characters (the PC's portrait, then those of known NPCs) and Scenes (the Scene Images and the Requested Images). The player can delete an image in Scenes, and never the Cover or a portrait. Only the image goes: its Message and Snapshot stay, and a Revert doesn't bring it back.

**Revert**:
Returning to an earlier Message and permanently deleting everything after it.
_Avoid_: Undo, rollback

**Save**:
One story on disk, and the player-facing word for that file. Duplicating a Save is how the player branches a story.
_Avoid_: Branch, slot
