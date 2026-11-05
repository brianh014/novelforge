# 36: Ready page is one centered page

**What to build:** The Ready page, shown after world creation, drops the two-page layout and centers its content.

**Blocked by:** none

**Status:** done

## Criteria

- [x] The cover, title, World Brief, message, Open the book and PC portrait present on one page
- [x] Everything fits without scrolling at 1546 by 1180, 1366 by 800 and 1024 by 700, and stacks in order at phone width

## Comments

The user asked for this directly, which replaces the earlier decision to keep this screen two-page.

Checked on a copy of the user's Save, so the portrait-still-being-painted state and a Save with no portrait weren't seen.

Later the user asked for a full presentation of the cover art, title, brief, then PC art. It reads left to right on one screen, and stacks in that order at phone width, where the page scrolls to Open the book. Without art, the text fills the page alone.

Limit: the page reads the Save again only while the portrait paints, so a cover that lands after the portrait needs a reload. Recorded as a `shortcut:` comment in `src/web/wizard.tsx`.
