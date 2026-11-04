# 08: UI options report

**What to build:** A published HTML report showing 3 distinct visual directions, so the user can choose how NovelForge looks before any UI code exists. This ticket writes no app code.

**Blocked by:** 07

**Status:** ready-for-agent

- [x] Each direction mocks up the main game screen, a wizard step, the Journal and the inventory
- [x] Each mockup is shown at desktop and phone widths
- [ ] Mockups use real sample Turn output from the game
- [x] The report shows Chat style options, which the spec leaves undefined
- [x] No mockup contains dice, difficulty or Check elements
- [x] Mockups are throwaway and aren't carried into the app
- [x] The user has chosen a direction or a mix of parts, and that choice is recorded in this ticket

## Comments

- Report: https://claude.ai/artifact/ECMLArh6mhCKNAkxWredZ6 (private Artifact). Source: `.scratch/novelforge-v1/ui-options-report.html`.
- Directions: A Proscenium, B Folio, C Inkline. Parts are labeled A1 to C4 (1 game screen, 2 wizard step, 3 Journal, 4 inventory), so the user can mix them. Chat styles: 1 Script, 2 Prose, 3 Bubbles, 4 Stage box.
- "Mockups use real sample Turn output from the game" stays unticked. No real-model Turn has been run, so the story text is hand-written, and the report says so. It follows the game's shape: `narration` plus `state_operations`, and `id`, `role` and `text` on Messages. Its operations were replayed through `applyOperations` and gave the report's Snapshot. Swap in real Turn output, or at least review the fit, once the real-model run from ticket 07 happens.
- Chat styles 3 and 4 need each spoken line on its own `[Name]:` line, as in the spec's example. The Narrator prompt doesn't ask for that yet, so if either ships, ticket 22 needs a prompt change.
- `scene_changed` and `visual_description` aren't in the code yet, so the sample leaves them out. Scene Images and portraits are drawn stand-ins.
- **Choice (2026-11-03): Direction B, Folio, for all parts (B1 to B4).** The user said "I like B the most". Chat style wasn't chosen separately, so the default is Prose, the style B1 shows. Which other Chat styles ship is still open for ticket 22.
