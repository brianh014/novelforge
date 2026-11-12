import { z } from "zod";
import { IMAGES_OFF, imageResponse, Nudge, parseBody, PromptRequest, routes, type ServerContext, uploaded } from "./http";
import { coverPeople, pcLooks, pcNow, visibleNpcs } from "./image-pipeline";
import { log } from "./logger";
import { PortraitNotFound, type SaveStore } from "./save-store";
import { withArtStyleFor } from "./web/art-styles";
import { promptStyle } from "./graph-builder";
import { type PictureAsk, writeImagePrompt } from "./world-creation";

// The form's Art Style can change after a first draw.
const RedrawRequest = PromptRequest.extend({ kind: z.enum(["cover", "portrait", "original", "scene", "requested"]), ref: z.number().int().nonnegative() });

// Only these have a prompt the text model writes from the story, as a Scene Image's comes from its Turn.
const UpdateRequest = z.object({ kind: z.enum(["cover", "portrait", "original"]), ref: z.number().int().nonnegative(), nudge: Nudge });

// Besides the PC, so a cover isn't crowded.
const COVER_NPCS = 3;

// An allowlist, as the Cover and portraits are never the player's to delete.
const DeleteImageRequest = z.object({ kind: z.enum(["scene", "requested"]), ref: z.number().int().nonnegative() });

// Blank draws the scene as it stands.
const ImageRequest = z.object({ words: z.string().trim().max(300) });

/** An allowlist, so a visible NPC the PC doesn't know yet stays hidden, and a Revert of that knowledge hides their portrait again. */
export function knownPortraits(saves: SaveStore, id: string) {
  const known = saves.latestState(id).pcKnown.npcs;
  return saves.portraits(id).filter(({ npc }) => npc === null || known.includes(npc));
}

/** A Save's pictures: Scene Images, Requested Images, the Gallery and its Redraws, and portraits. */
export function galleryRoutes({ options, saves, turns, images }: ServerContext) {
  const { settings } = options;
  /** Every image the player may see or Redraw, by the same allowlist. */
  const visibleImages = (id: string) => {
    const known = saves.latestState(id).pcKnown.npcs;
    return saves.gallery(id).filter(({ npc }) => npc === null || known.includes(npc));
  };

  return routes({
    "/saves/:id/images": {
      // shortcut: the caption is Narrator free text, kept clean only by its prompt, screen it if models leak.
      GET: (req) => Response.json({ images: saves.sceneImages(req.params.id), ...images.status(req.params.id) }),
    },
    "/saves/:id/requested-images": {
      GET: (req) => Response.json({ images: saves.requestedImages(req.params.id), drawing: images.drawing(req.params.id) }),
      // Answers at once, as the player can go on while it's written and drawn. What it's drawn from is read now, as this moment is the one they meant.
      POST: async (req) => {
        const { words } = await parseBody(req, ImageRequest);
        const ask = words || "the whole scene, as the latest Message leaves it";
        const { id } = req.params;
        if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
        turns.assertIdle(id);
        const messageId = saves.latestMessageId(id);
        if (messageId === 0) return Response.json({ error: "There's no story to draw from yet." }, { status: 409 });
        const story = { save: withArtStyleFor(saves.read(id), settings.read()), state: saves.latestState(id), messages: saves.messages(id) };
        const style = promptStyle(settings.read());
        // Only those in the Scene, so a mark can't put anyone else's stored looks in a prompt the player reads.
        const moment = { location: story.state.scene.location, npcs: visibleNpcs(story.state), wearing: story.state.inventory.wearing };
        images.drawRequested(id, messageId, words, moment, (signal) => writeImagePrompt(options, story, ask, style, signal));
        return Response.json({}, { status: 202 });
      },
    },
    "/saves/:id/requested-images/failure": {
      GET: (req) => Response.json({ failure: images.takeRequestFailure(req.params.id) }),
    },
    "/saves/:id/requested-images/:ref/image": {
      GET: (req) => imageResponse(saves.requestedImage(req.params.id, Number(req.params.ref))),
    },
    "/saves/:id/gallery": {
      // An allowlist of fields too, so nothing added to an image reaches the player by default.
      // shortcut: a Scene Image's prompt is Narrator free text, kept clean only by its instructions, screen it if models leak.
      GET: (req) => {
        const { id } = req.params;
        const { pc } = saves.read(id);
        const label = ({ kind, npc, caption }: ReturnType<typeof visibleImages>[number]) =>
          kind === "cover" ? "Cover" : kind === "portrait" || kind === "original" ? (npc ?? pc.name) : caption;
        return Response.json({
          images: visibleImages(id).map((image) => {
            const { kind, ref, prompt, redraws } = image;
            return { kind, ref, label: label(image), prompt, redraws, ...images.redrawState(id, image) };
          }),
          pending: images.status(id).pending,
          canRedraw: images.ready(),
        });
      },
    },
    "/saves/:id/gallery/redraw": {
      POST: async (req) => {
        const { id } = req.params;
        const { prompt, kind, ref } = await parseBody(req, RedrawRequest);
        const image = visibleImages(id).find((candidate) => candidate.kind === kind && candidate.ref === ref);
        if (!image) return Response.json({ error: "Image not found" }, { status: 404 });
        if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
        if (!images.redraw(id, { kind, ref }, image.messageId, prompt)) {
          return Response.json({ error: "This image is already being redrawn." }, { status: 409 });
        }
        return Response.json({}, { status: 202 });
      },
    },
    // A Redraw from a new Image Prompt, written from the story as it stands, by the same allowlist as the first.
    "/saves/:id/gallery/update": {
      POST: async (req) => {
        const { id } = req.params;
        const { kind, ref, nudge } = await parseBody(req, UpdateRequest);
        const image = visibleImages(id).find((candidate) => candidate.kind === kind && candidate.ref === ref);
        if (!image) return Response.json({ error: "Image not found" }, { status: 404 });
        if (!images.ready()) return Response.json({ error: IMAGES_OFF }, { status: 409 });
        const { pc, title, theme, artStyle, importantCharacters, pcOnCover } = saves.read(id);
        const state = saves.latestState(id);
        const { inventory, npcs, scene, worldBrief, pcKnown } = state;
        const looksOf = (name: string) => npcs.find((npc) => npc.name === name)?.appearance.trim() ?? "";
        const pcLooksNow = pcLooks(pcNow(pc, state), inventory.wearing);
        // Those the player put on the Cover, as the story shows them now if met. A Save from before kept no list, so it shows the PC and those met lately.
        const coverCast = () => {
          if (importantCharacters) {
            const now = importantCharacters.map((character) => ({ ...character, description: looksOf(character.name) || character.description }));
            return coverPeople(pcNow(pc, state), inventory.wearing, now, "", pcOnCover).map(({ looks }) => looks);
          }
          const met = [...new Set([...scene.visibleCast, ...saves.recentCast(id)])].filter((name) => pcKnown.npcs.includes(name)).slice(0, COVER_NPCS);
          return [pcLooksNow, ...met.map(looksOf)].filter(Boolean);
        };
        const setting = { theme, world: worldBrief, artStyle, ...(nudge && { nudge }) };
        const ask: PictureAsk =
          kind === "cover"
            ? { kind, title, ...setting, people: coverCast() }
            : { kind: "portrait", ...setting, looks: image.npc === null ? pcLooksNow : looksOf(image.npc) };
        if (ask.kind === "portrait" && !ask.looks) return Response.json({ error: "There are no looks to draw this from." }, { status: 409 });
        if (!images.redraw(id, { kind, ref }, image.messageId, ask)) {
          return Response.json({ error: "This image is already being redrawn." }, { status: 409 });
        }
        return Response.json({}, { status: 202 });
      },
    },
    // The player's own picture in place of a Cover or portrait. It keeps the old prompt, for a Redraw to go back to drawing.
    "/saves/:id/gallery/:kind/:ref": {
      PUT: async (req) => {
        const { id, kind } = req.params;
        const ref = Number(req.params.ref);
        const image = visibleImages(id).find((candidate) => candidate.kind === kind && candidate.ref === ref);
        if (!image || (kind !== "cover" && kind !== "portrait" && kind !== "original")) return Response.json({ error: "Image not found" }, { status: 404 });
        // Read first, as a Redraw could start while the body arrives.
        const bytes = await uploaded(req);
        if (images.redrawState(id, { kind, ref }).redrawing) {
          return Response.json({ error: "This image is being redrawn. Try again when it's done." }, { status: 409 });
        }
        saves.replaceImage(id, { kind, ref }, image.prompt, bytes);
        log.info("images", "Image uploaded", { save: id, kind });
        return Response.json({});
      },
    },
    "/saves/:id/gallery/delete": {
      POST: async (req) => {
        const { id } = req.params;
        const { kind, ref } = await parseBody(req, DeleteImageRequest);
        if (!visibleImages(id).some((candidate) => candidate.kind === kind && candidate.ref === ref)) {
          return Response.json({ error: "Image not found" }, { status: 404 });
        }
        if (images.redrawState(id, { kind, ref }).redrawing) {
          return Response.json({ error: "This image is being redrawn. Try again when it's done." }, { status: 409 });
        }
        saves.deleteImage(id, { kind, ref });
        return Response.json({});
      },
    },
    "/saves/:id/messages/:messageId/image": {
      GET: (req) => imageResponse(saves.sceneImage(req.params.id, Number(req.params.messageId))),
    },
    "/saves/:id/portraits/:portraitId": {
      GET: (req) => {
        const { id } = req.params;
        const portraitId = Number(req.params.portraitId);
        if (!knownPortraits(saves, id).some((portrait) => portrait.id === portraitId)) throw new PortraitNotFound();
        return imageResponse(saves.portrait(id, portraitId));
      },
    },
    "/saves/:id/portraits/:portraitId/original": {
      GET: (req) => {
        const { id } = req.params;
        const portraitId = Number(req.params.portraitId);
        const bytes = knownPortraits(saves, id).some((portrait) => portrait.id === portraitId) && saves.original(id, portraitId);
        if (!bytes) throw new PortraitNotFound();
        return imageResponse(bytes);
      },
    },
  });
}
