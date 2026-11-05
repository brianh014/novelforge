# 36: Ready page is one centered page

**What to build:** The Ready page, shown after world creation, drops the two-page layout and centers its content.

**Blocked by:** none

**Status:** done

## Criteria

- [x] The cover, title, World Brief and PC portrait run down one centered page, in that order
- [x] Open the book stays pinned at the bottom while the page scrolls, on desktop and at phone width

## Comments

The user asked for this directly, which replaces the earlier decision to keep this screen two-page.

Checked on a copy of the user's Save, so the portrait-still-being-painted state and a Save with no portrait weren't seen.

Later the user asked for a full presentation of the cover art, title, brief, then PC art. The user rejected a left-to-right version, then chose C, One long page, from `ready-page-options.html` (https://claude.ai/artifact/XjFkakBAEcyeNJDDdhY2MT).

Limit: the page reads the Save again only while the portrait paints, so a cover that lands after the portrait needs a reload. Recorded as a `shortcut:` comment in `src/web/wizard.tsx`.
