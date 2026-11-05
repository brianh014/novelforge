# 50: Image Prompts that stand alone, worded for the model

**What to build:** Every Scene Image and portrait prompt carries enough detail to draw the moment correctly with no story context, and is worded the way its kind of model reads best.

**Status:** ready-for-human

- [x] The Narrator writes a prompt only for a Turn that will draw, and none while images are off
- [x] A Turn with no prompt draws no image, rather than drawing from the location name
- [x] Prompt Style: Simple Mode's SD family gets keywords, and FLUX.2, OpenRouter and Advanced get prose
- [x] People are marked as `[Name]`, the PC included, and each mark becomes their stored looks, so no name reaches the model
- [x] Only people marked in an image send a portrait reference, and Redraw remembers who they were
- [x] The PC's looks are their physical traits and what they're wearing, and their portrait no longer gets background, personality or skills
- [x] FLUX.2 and OpenRouter put the Art Style after the prompt, and SD keeps it first
- [x] One real Klein draw from a hand-written prompt
- [ ] The real Narrator's prompts look right in play, judged by the user

## Comments

- **User request (2026-11-05):** "image prompts should be crafted on best practices based on the model family. They need to be detailed enough to draw an accurate image without context of the story so far. Include full descriptions so the model doesnt have to try to make something up that wouldnt match the story".
- Decided with the user in a grilling session. The PC can be in a scene when they're part of the moment, as this is a story engine and not a strict first person view.
- Why marks: on one real Save, the Scene's cast was empty for 11 of 12 Scene Images with prompts, and in 3 of those the Turn named someone in the state, so the cast can't decide who gets described. Stored looks were already 23 to 34 words.
- Keywords don't use marks. Q10 limits them to short phrases, and SD can't use people's portraits as references, so the Narrator writes those phrases itself.
- A Scene Image from before this has no record of who it shows, so its Redraw keeps going by the cast and the PC, as it did. Saves move to version 11, for the new `pictured` column.
- The Art Style's new position on FLUX.2 and OpenRouter applies to Covers too, though their prompt text is unchanged, as the graph can't tell them apart. Ticket 25's cover check still needs running.
- A PC with no physical traits now gets no portrait, even if their background describes them.
- **First real Turn (2026-11-05):** the user found a prompt of 410 words, and the NPC in it wasn't used. The Save showed 255 words of the PC's physical traits, with their name, pasted in whole. The NPC was "Dana Reyes", who came out as "a person" with no reference, most likely because the Narrator marked her by part of her name, which only the PC allowed. The marks themselves aren't stored, so that part is inferred. Marks now take a short phrase, which replaces stored looks for anyone whose portrait is sure to be sent, and part of a name counts when it can only mean one person. This matches the Klein guidance that images carry the detail and the text should stay simpler.
- **Real draw (2026-11-05):** 167 words plus the Art Style, 720p, `flux-2-klein-9b`, 20 seconds, no reference images. Both people, their clothing and positions, the rope, the lamp, the rain and the masts all came through, with no lettering. It missed two details: "cropped" hair came out pulled back, and "short stocky" came out average. The prompt was written by hand, so this shows the assembly and wording work, not that the Narrator will write this well.
- **Reference draw (2026-11-05):** two made-up portraits, then one 92-word scene with both as references, in 41 seconds on `flux-2-klein-9b`. Both faces and hair carried over, each person wore the phrase's new clothing rather than the portrait's, and neither portrait was pasted in. The prompt was hand-written again.
