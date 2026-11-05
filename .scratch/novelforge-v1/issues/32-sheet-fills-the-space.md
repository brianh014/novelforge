# 32: Index Sheet pages fill the space

**What to build:** Pages on the Index Sheet stopped at a 780px column and left the rest of the sheet empty. They take up all the available space.

**Blocked by:** none

**Status:** done

## Criteria

- [x] World creation, Settings, Load Game and Inventory use the sheet's full width, in a real browser at 1559px and 1366px
- [x] Art Style adds thumbnails on wider screens instead of enlarging them
- [x] Phone width keeps its two Art Style columns, with no sideways scrolling
- [x] World creation scrolls in its column only, without a second scrollbar on the page

## Comments

The user asked for this directly, with a screenshot of step 1, so no options report was needed.

The second scrollbar was a separate bug: the hidden radios on step 1 were positioned outside the scrolling column, which made the whole page 247px taller at 1559 by 1081.

Limit: the book itself still stops at 1500px, for the two-page screens too, so a wider monitor keeps its dark margins. Line lengths in the text boxes are now long on wide screens.
