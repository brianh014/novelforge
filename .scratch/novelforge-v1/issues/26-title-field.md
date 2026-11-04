# 26: Title field in world creation

**What to build:** The player sets the story's title on step 1 of world creation, or uses Pick for me, so the Narrator doesn't invent one while generating the world.

**Blocked by:** none

**Status:** done

## Criteria

- [x] Step 1 has a required Title box, up to 80 characters, with Pick for me like the World Brief. Checked in a real browser at 1366x800 and 390px
- [x] Pick for me writes a Title from the theme and any World Brief, and a reply over 80 characters is retried
- [x] The world reply no longer holds a title. The player's title goes to the Narrator as a choice, onto the Cover and into the Save
- [x] Regenerate keeps the title

## Comments

- Raised by the user on 2026-11-04.
- No options report: it reuses the World Brief's box and button, so it isn't a new visual direction.
- Title sits under the World Brief, as Pick for me reads the brief. A World Brief picked after the Title doesn't read the Title.
- Checked in the browser with the world calls faked, so no model wrote a real title. Replaces ticket 25's criterion that the title changes on Regenerate.
