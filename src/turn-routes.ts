import { z } from "zod";
import { errorResponse, NoFields, parseBody, routes, type ServerContext } from "./http";
import { type BegunTurn, STOPPED_STATUS } from "./live-turns";
import { errorFields, log } from "./logger";
import type { Message } from "./save-store";
import { editResponse, playOpening, playTurn, replaceResponse, TurnFailed, type TurnEvents } from "./turn-engine";
import { answerQuestion, decideForPc } from "./world-creation";

// A `draft` is the player's own move to Enhance. Without one, the PC's next move is written from scratch.
const DecideRequest = z.object({ draft: z.string().trim().max(4000).default("") });
const QuestionRequest = z.object({ question: z.string().trim().min(1).max(1000) });

const NewTurnRequest = z.object({ input: z.string().min(1) });

const RewriteRequest = z.object({ feedback: z.string().trim().min(1) });

const EditRequest = z.object({ text: z.string().trim().min(1) });

// A Turn outlives its request, so the player can switch away. Only Stop or the Text Provider's silence limit ends one early.

/** Answers with the committed Messages, as one JSON body or, if the client asks, as a stream of the Turn. */
async function turnResponse(req: Request, turn: BegunTurn, run: (emit: TurnEvents, signal: AbortSignal) => Promise<Message[]>) {
  const streaming = req.headers.get("accept")?.includes("text/event-stream");
  let client: TurnEvents = () => {};
  // Not started yet, as a reply can begin at once and the stream below must be there to hear it.
  const played = Promise.resolve()
    .then(() =>
      run((event, data) => {
        turn.heard(event, data);
        client(event, data);
      }, turn.signal),
    )
    .then(
      (messages) => {
        turn.end();
        return { messages };
      },
      async (error: unknown) => {
        if (turn.signal.aborted) {
          log.info("turn", "A Turn was stopped");
          const body = { error: "", input: turn.input };
          turn.end(streaming ? { ...body, replaces: turn.replaces, status: STOPPED_STATUS } : undefined);
          return { status: STOPPED_STATUS, body };
        }
        // In this log, as the client's copy is gone once the page moves on.
        if (!(error instanceof TurnFailed)) log.error("turn", "A Turn failed", errorFields(error));
        const response = errorResponse(error);
        const body = (await response.json()) as { error: string };
        // A plain JSON client gets its answer here, and has no page to come back to.
        turn.end(streaming ? { ...body, input: turn.input, replaces: turn.replaces, status: response.status } : undefined);
        return { status: response.status, body };
      },
    );
  if (!streaming) {
    const result = await played;
    return "messages" in result ? Response.json(result, { status: 201 }) : Response.json(result.body, { status: result.status });
  }
  let gone = false;
  const stream = new ReadableStream({
    async start(controller) {
      // A client that leaves stops hearing the Turn. A write to a closed stream throws, and that must never reach the Turn.
      const there = () => !gone && !req.signal.aborted;
      const send = (event: string, data: object) => {
        if (there()) controller.enqueue(`event: ${event}
data: ${JSON.stringify(data)}

`);
      };
      client = send;
      const result = await played;
      if (!there()) log.info("turn", "A Turn ended after its client left");
      if ("messages" in result) send("done", result);
      else send("error", { status: result.status, ...result.body });
      if (there()) controller.close();
    },
    cancel() {
      gone = true;
      log.info("turn", "A Turn lost its client", { save: turn.id });
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}

/** Turns and every other reply the Narrator writes into the story, and the questions it answers outside it. */
export function turnRoutes({ options, saves, turns, images }: ServerContext) {
  const engine = { ...options, images };

  return routes({
    "/saves/:id/turns": {
      POST: async (req) => {
        const { input } = await parseBody(req, NewTurnRequest);
        const { id } = req.params;
        return turnResponse(req, turns.begin(id, saves.latestMessageId(id), input), (emit, signal) =>
          playTurn(saves, engine, id, input, signal, emit),
        );
      },
    },
    "/saves/:id/opening": {
      POST: async (req) => {
        await parseBody(req, NoFields);
        const { id } = req.params;
        return turnResponse(req, turns.begin(id, saves.latestMessageId(id), ""), (emit, signal) =>
          playOpening(saves, engine, id, signal, emit),
        );
      },
    },
    "/saves/:id/turn": {
      GET: (req) => Response.json(turns.status(req.params.id)),
      DELETE: (req) => new Response(null, { status: turns.stop(req.params.id) ? 204 : 404 }),
    },
    "/saves/:id/decide": {
      POST: async (req) => {
        const { draft } = await parseBody(req, DecideRequest);
        const { id } = req.params;
        const story = { save: saves.read(id), state: saves.latestState(id), messages: saves.messages(id) };
        return Response.json({ text: await decideForPc(options, story, req.signal, draft) });
      },
    },
    "/saves/:id/questions": {
      POST: async (req) => {
        const { question } = await parseBody(req, QuestionRequest);
        const { id } = req.params;
        const story = { save: saves.read(id), state: saves.latestState(id), messages: saves.messages(id) };
        return Response.json({ text: await answerQuestion(options, story, question, req.signal) });
      },
    },

    "/saves/:id/messages/:messageId/rewrite": {
      POST: async (req) => {
        const { feedback } = await parseBody(req, RewriteRequest);
        const { id, messageId } = req.params;
        return turnResponse(req, turns.begin(id, saves.latestMessageId(id), feedback, Number(messageId)), (emit, signal) =>
          replaceResponse(saves, engine, id, Number(messageId), feedback, signal, emit),
        );
      },
    },
    "/saves/:id/messages/:messageId/edit": {
      POST: async (req) => {
        const { text } = await parseBody(req, EditRequest);
        const { id, messageId } = req.params;
        return turnResponse(req, turns.begin(id, saves.latestMessageId(id), text, Number(messageId)), (emit, signal) =>
          editResponse(saves, engine, id, Number(messageId), text, signal, emit),
        );
      },
    },
    "/saves/:id/messages/:messageId/regenerate": {
      POST: async (req) => {
        await parseBody(req, NoFields);
        const { id, messageId } = req.params;
        return turnResponse(req, turns.begin(id, saves.latestMessageId(id), "", Number(messageId)), (emit, signal) =>
          replaceResponse(saves, engine, id, Number(messageId), undefined, signal, emit),
        );
      },
    },
  });
}
