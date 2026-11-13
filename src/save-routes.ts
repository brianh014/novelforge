import { z } from "zod";
import { knownPortraits } from "./gallery-routes";
import { ArtStyleRequest, imageResponse, NoFields, parseBody, routes, type ServerContext, someWords } from "./http";
import { pcNow, restyledBy } from "./image-pipeline";
import { log } from "./logger";
import { NoteNotFound, PlayMode, StaleTurn } from "./save-store";
import { VisibleEdit, type WorldEdit } from "./state-applier";
import { askForChapterTitle, TurnFailed } from "./turn-engine";
import { readable } from "./web/chat-style";
import { changeWorld } from "./world-creation";
import { NamedPc } from "./world-routes";

const NewSaveRequest = z.object({
  worldBrief: z.string().min(1),
  pc: NamedPc,
  artStyle: z.string().optional(),
  startingHook: z.string().optional(),
});

/** The fewest Messages the open Chapter needs before a Narrator's suggestion to end it shows. The player can end one sooner. */
export const MIN_CHAPTER_MESSAGES = 10;
const CHAPTER_TITLE_MESSAGES = 20;
const RECENT_CHARACTERS = 6;

const NoteRequest = z.object({ text: z.string().trim().min(1) });

// No quote or backslash, which every JSON column would hold escaped. One line, as a name.
const RenameRequest = z.object({
  name: z.string().min(1),
  newName: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[^"\\\n\r]+$/, "A name can't have quotes, backslashes or line breaks"),
});

// shortcut: Notes are addressed by position, so a second tab can change the wrong one, give them ids if that ever matters.
function spliceNote(notes: string[], index: string, ...replacement: string[]) {
  const position = Number(index);
  if (notes[position] === undefined) throw new NoteNotFound();
  return notes.toSpliced(position, 1, ...replacement);
}

const SaveChange = z.object({ artStyle: ArtStyleRequest.shape.artStyle.optional(), playMode: PlayMode.optional() });

const WorldChangeRequest = z.object({ change: someWords });

const DuplicateRequest = z.object({ fromMessage: z.number().optional() });

/** Saves and what they hold: opening, importing and exporting, the Journal, Chapters, edits and Reverts. */
export function saveRoutes({ options, saves, turns, images }: ServerContext) {
  /** Every Chapter, oldest first, ending with the open one, whose `lastMessage` is null. A Chapter holds the Messages after the one before it, up to its own `lastMessage`. */
  function chaptersOf(id: string) {
    const { chapters, chapterReady, sceneMemories } = saves.latestState(id);
    const latest = saves.latestMessageId(id);
    const closed = chapters.map(({ title, lastMessage }) => ({ title, lastMessage: lastMessage ?? latest }));
    const start = closed.at(-1)?.lastMessage ?? 0;
    const open = saves.messages(id).filter(({ id }) => id > start);
    return {
      chapters: [...closed, { title: "", lastMessage: null }],
      open,
      openMemories: sceneMemories.filter(({ firstMessage }) => firstMessage > start).map(({ text }) => text),
      // Below this, a suggestion would end a chapter every few Turns.
      offer: chapterReady && open.length >= MIN_CHAPTER_MESSAGES,
    };
  }

  return routes({
    "/saves": {
      GET: () => Response.json({ saves: saves.list() }),
      POST: async (req) => {
        const save = await parseBody(req, NewSaveRequest);
        const id = saves.create(save);
        images.saveCreated(id);
        return Response.json({ id }, { status: 201 });
      },
    },

    "/saves/import": {
      POST: async (req) => {
        // A type no form can send, so other websites need a CORS preflight to post here, like the JSON routes.
        if (req.headers.get("content-type") !== "application/octet-stream") {
          return Response.json({ error: "A Save must be sent as application/octet-stream" }, { status: 415 });
        }
        return Response.json({ id: saves.import(new Uint8Array(await req.arrayBuffer())) }, { status: 201 });
      },
    },
    "/saves/:id": {
      GET: (req) => {
        // An allowlist, so a secret added to the Save can never reach the player by default.
        const { title, worldBrief, pc, artStyle, startingHook, hasCover, coverRedraws, playMode } = saves.read(req.params.id);
        log.info("saves", "Save opened");
        return Response.json({ title, worldBrief, pc: { name: pc.name }, artStyle, startingHook, hasCover, coverRedraws, playMode });
      },
      PATCH: async (req) => {
        const { artStyle, playMode } = await parseBody(req, SaveChange);
        if (artStyle !== undefined) saves.setArtStyle(req.params.id, artStyle);
        if (playMode) saves.setPlayMode(req.params.id, playMode);
        return Response.json({ artStyle, playMode });
      },
      DELETE: (req) => {
        // A running Turn would go on paying the model for a story that is gone.
        turns.stop(req.params.id);
        saves.delete(req.params.id);
        // Below 0, because the PC's portrait belongs to no Message.
        images.forget(req.params.id, -1, "the Save was deleted");
        return new Response(null, { status: 204 });
      },
    },
    "/saves/:id/cover": {
      GET: (req) => {
        const bytes = saves.cover(req.params.id);
        return bytes ? imageResponse(bytes) : Response.json({ error: "This story has no cover" }, { status: 404 });
      },
    },
    "/saves/:id/export": {
      GET: (req) =>
        new Response(saves.export(req.params.id), {
          headers: {
            "Content-Type": "application/vnd.sqlite3",
            "Content-Disposition": `attachment; filename="novelforge-save-${req.params.id}.sqlite"`,
          },
        }),
    },
    "/saves/:id/journal": {
      GET: (req) => {
        // An allowlist, so the World Bible, Plot Threads and NPC appearance text can never reach the player by default.
        // shortcut: the summary, facts, Loose Ends and Scene Memories are Narrator free text, kept clean only by its prompt, screen them if models leak.
        const { summary, recentSummary, pcKnown, looseEnds, sceneMemories, scene, storyTime, status } = saves.latestState(req.params.id);
        // Everyone in the scene, then the last seen. The filter keeps an NPC the PC doesn't know yet hidden.
        const seen = [...new Set([...scene.visibleCast, ...saves.recentCast(req.params.id)])].filter((name) => pcKnown.npcs.includes(name));
        const fullLog = saves.messages(req.params.id);
        const lastMention = (name: string) => fullLog.findLastIndex(({ text }) => text.includes(name));
        return Response.json({
          status,
          // Without the day count, which only the Narrator uses.
          storyTime: storyTime && { date: storyTime.date, timeOfDay: storyTime.timeOfDay },
          summary,
          recentSummary,
          facts: pcKnown.facts,
          looseEnds,
          sceneMemories,
          // Least recently seen first, as the Journal shows them newest first. Anyone never in a scene's cast goes below, by their last mention.
          npcs: [...pcKnown.npcs.filter((name) => !seen.includes(name)).sort((a, b) => lastMention(a) - lastMention(b)), ...seen.toReversed()],
          npcSummaries: pcKnown.summaries ?? {},
          recentNpcs: seen.slice(0, Math.max(RECENT_CHARACTERS, scene.visibleCast.length)),
          portraits: knownPortraits(saves, req.params.id),
          fullLog,
          chapters: chaptersOf(req.params.id).chapters,
        });
      },
    },
    "/saves/:id/chapters": {
      GET: (req) => {
        const { chapters, offer } = chaptersOf(req.params.id);
        return Response.json({ chapters, offer });
      },
      /** Closes the open Chapter after the latest Message. A title the model won't give leaves it untitled, which the player can fix in the Journal. */
      POST: async (req) => {
        const { id } = req.params;
        const basedOn = saves.latestMessageId(id);
        const release = turns.hold(id);
        try {
          const { chapters, open, openMemories } = chaptersOf(id);
          if (open.length === 0) return Response.json({ error: "This chapter has no Messages yet" }, { status: 409 });
          let title = "";
          try {
            title = await askForChapterTitle(options.textProvider, openMemories, readable(open).slice(-CHAPTER_TITLE_MESSAGES), req.signal);
          } catch (error) {
            if (!(error instanceof TurnFailed)) throw error;
            log.warning("chapters", "Chapter title missed", { failure: error.failure, message: error.message });
          }
          if (saves.latestMessageId(id) !== basedOn) throw new StaleTurn();
          saves.addEdit(id, { edit: "closeChapter", title });
          log.info("chapters", "Chapter closed", { chapter: chapters.length, messages: open.length, titled: !!title });
          return Response.json({});
        } finally {
          release();
        }
      },
    },
    "/saves/:id/inventory": {
      GET: (req) => {
        // An allowlist, like the Journal and the status below.
        // shortcut: items and status are Narrator free text, kept clean only by its prompt, screen them if models leak.
        const { wearing, carrying } = saves.latestState(req.params.id).inventory;
        return Response.json({ wearing, carrying });
      },
    },
    "/saves/:id/status": {
      GET: (req) => {
        const { health, injuries, conditions } = saves.latestState(req.params.id).status;
        return Response.json({ health, injuries, conditions });
      },
    },
    // shortcut: no screen uses these since Director's Notes left the UI, kept as the user may bring them back (ticket 31).
    "/saves/:id/notes": {
      GET: (req) => Response.json({ notes: saves.latestState(req.params.id).directorsNotes }),
      POST: async (req) => {
        const { text } = await parseBody(req, NoteRequest);
        return Response.json({ notes: saves.changeNotes(req.params.id, (notes) => [...notes, text]) }, { status: 201 });
      },
    },
    "/saves/:id/notes/:index": {
      PATCH: async (req) => {
        const { text } = await parseBody(req, NoteRequest);
        return Response.json({ notes: saves.changeNotes(req.params.id, (notes) => spliceNote(notes, req.params.index, text)) });
      },
      DELETE: (req) => Response.json({ notes: saves.changeNotes(req.params.id, (notes) => spliceNote(notes, req.params.index)) }),
    },
    "/saves/:id/edits": {
      POST: async (req) => {
        const edit = await parseBody(req, VisibleEdit);
        const { id } = req.params;
        turns.assertIdle(id);
        saves.addEdit(id, edit);
        return Response.json({});
      },
    },
    "/saves/:id/rename": {
      POST: async (req) => {
        const { name, newName } = await parseBody(req, RenameRequest);
        const { id } = req.params;
        turns.assertIdle(id);
        saves.rename(id, name, newName);
        return Response.json({});
      },
    },
    // Answers with nothing but whether it was done, as the reply holds the hidden world, and so can any error that quotes the provider.
    "/saves/:id/world-change": {
      POST: async (req) => {
        const { change } = await parseBody(req, WorldChangeRequest);
        const { id } = req.params;
        const basedOn = saves.latestMessageId(id);
        const release = turns.hold(id);
        try {
          const before = saves.latestState(id);
          // The PC's looks as they stand, so a change to them keeps all they don't change.
          const looksNow = pcNow(saves.read(id).pc, before).physicalTraits ?? "";
          const { world_brief, summary, facts, npc_summaries, npc_looks, pc_looks, inventory, status, ...update } = await changeWorld(
            options,
            { ...before, pcAppearance: looksNow },
            change,
            req.signal,
          );
          if (saves.latestMessageId(id) !== basedOn) throw new StaleTurn();
          const journal: WorldEdit[] = [
            ...(world_brief === null ? [] : [{ edit: "worldBrief" as const, text: world_brief }]),
            ...(summary === null ? [] : [{ edit: "summary" as const, text: summary }]),
            ...facts.map((fact) => ({ edit: "fact" as const, ...fact })),
            ...npc_summaries.map(({ name, summary }) => ({ edit: "npcSummary" as const, name, text: summary })),
            ...(inventory === null ? [] : [{ edit: "inventory" as const, ...inventory }]),
            ...(status === null ? [] : [{ edit: "status" as const, ...status }]),
          ];
          const looks = [
            ...npc_looks.map(({ name, appearance }) => ({ edit: "npcLooks" as const, name, appearance })),
            ...(pc_looks === null ? [] : [{ edit: "pcLooks" as const, appearance: pc_looks }]),
          ];
          for (const edit of [{ edit: "world" as const, update }, ...looks, ...journal]) saves.addEdit(id, edit);
          const after = saves.latestState(id);
          images.restyled(id, restyledBy(before, after), after.inventory.wearing);
          // Counts only, so that the log never repeats the world.
          log.info("world", "World Change applied", () => ({
            lore: update.lore_entries.length,
            removed: update.removed_lore.length,
            rules: update.world_rules.length,
            threads: update.plot_threads.length,
            journal: journal.length,
            looks: looks.length,
          }));
          return Response.json({});
        } catch (error) {
          if (!(error instanceof TurnFailed)) throw error;
          (error.failure === "refused" ? log.warning : log.error)("world", "A World Change failed", { failure: error.failure, message: error.message });
          return Response.json({ error: error.message }, { status: error.failure === "refused" ? 422 : 502 });
        } finally {
          release();
        }
      },
    },
    "/saves/:id/duplicate": {
      POST: async (req) => {
        const { fromMessage } = await parseBody(req, DuplicateRequest);
        return Response.json({ id: saves.duplicate(req.params.id, fromMessage) }, { status: 201 });
      },
    },

    "/saves/:id/messages": {
      // Only the latest response's Choices, as no other can be picked.
      GET: (req) => Response.json({ messages: saves.messages(req.params.id), choices: saves.latestChoices(req.params.id) }),
    },

    "/saves/:id/messages/:messageId/snapshot": {
      GET: (req) => {
        // An allowlist, so a new secret section can never reach the player by default.
        const { inventory, status, pcKnown } = saves.snapshot(req.params.id, Number(req.params.messageId));
        return Response.json({ inventory, status, pcKnown });
      },
    },

    "/saves/:id/messages/:messageId/revert": {
      GET: (req) => Response.json(saves.revertPreview(req.params.id, Number(req.params.messageId))),
      POST: async (req) => {
        await parseBody(req, NoFields);
        const deleted = saves.revert(req.params.id, Number(req.params.messageId));
        images.forget(req.params.id, Number(req.params.messageId), "revert");
        return Response.json(deleted);
      },
    },
  });
}
