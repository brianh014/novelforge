# 27: Pick for me hint reads as belonging to the next box

**What to build:** With a World Brief filled in, the player can tell the Title's Pick for me is ready. The brief's hint doesn't read as being about the Title.

**Blocked by:** none

**Status:** done

## Criteria

- [x] A filled box shows no Pick for me button, as it did nothing there. An empty box still has one
- [x] The hint names its own field, such as "Clear the World Brief to pick again."
- [x] With a World Brief filled in, the Title's Pick for me works and sends the brief. Clearing the box brings the button back. Checked in a real browser at 1366x800, with the world call faked, and no overflow at 390px

## Comments

- Raised by the user on 2026-11-04: picking a Title said to clear the World Brief.
- Cause: the hint said only "the box" and sat directly above the Title label, beside a disabled button that looked the same as a live one. Pick for me itself was fine: the Title's own button stayed enabled.
- No options report: a small adjustment to an existing control.
