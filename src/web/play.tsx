import { type FormEvent, type KeyboardEvent, type ReactNode, type Ref, useEffect, useRef, useState } from "react";
import {
  addNote,
  coverUrl,
  decideForMe,
  duplicateFrom,
  editNote,
  getMessages,
  getNotes,
  getImages,
  getJournal,
  getSave,
  imageUrl,
  type OpenSave,
  getSettings,
  getStatus,
  type Message,
  playOpening,
  playTurn,
  type Portrait,
  portraitUrl,
  previewRevert,
  removeNote,
  replaceResponse,
  revert,
  type SceneImageInfo,
  type SceneImages,
  setupProblem,
  type Status,
  statusWords,
  type TurnResult,
} from "./api";
import { type Beat, BeatLine, type ChatStyle, messageBeats, openingBeat, readable, type StageBeat, stageBeats, type TurnInProgress } from "./chat-style";
import { DecideIcon, DuplicateIcon, RegenerateIcon, RevertIcon, RewriteIcon } from "./icons";
import { Book, BookTabs } from "./menu";
import { Zoomable } from "./zoom";

// Text from a Turn cut short by leaving the screen, to put back in the box on return.
const unsent = new Map<string, string>();
// An item's action, which the Story plays as a Turn once it has loaded, so it streams like any other.
const itemActions = new Map<string, string>();

export function playItemAction(id: string, input: string) {
  itemActions.set(id, input);
  location.hash = `/play/${id}`;
}

// Often enough to feel prompt, as an image takes many seconds anyway.
export const IMAGE_CHECK_MS = 2000;

const WRITING = "The Narrator is writing…";

export function SceneImage({ id, image }: { id: string; image: SceneImageInfo }) {
  return (
    <figure className="plate">
      <Zoomable lazy src={imageUrl(id, image)} alt={image.caption ? `Scene Image: ${image.caption}` : "Scene Image"} />
      {image.caption && <figcaption aria-hidden="true">{image.caption}</figcaption>}
    </figure>
  );
}

export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form!.requestSubmit();
}

export function Play({ id, worldChanged }: { id: string; worldChanged: boolean }) {
  const [save, setSave] = useState<OpenSave>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>();
  const [notes, setNotes] = useState<string[]>();
  const [images, setImages] = useState<SceneImages>({ images: [], pending: false, session: 0 });
  const [editingNotes, setEditingNotes] = useState(false);
  const [setupNotice, setSetupNotice] = useState<string>();
  const [chatStyle, setChatStyle] = useState<ChatStyle>("prose");
  const [portraits, setPortraits] = useState<Portrait[]>([]);
  // Unset until the player moves, so that each new response opens on its first beat.
  const [chosenBeat, setChosenBeat] = useState<number>();
  const [draft, setDraft] = useState(unsent.get(id) ?? "");
  const [turn, setTurn] = useState<TurnInProgress>();
  const [deciding, setDeciding] = useState(false);
  // The response being rewritten, by id, so the box goes if the story moves on from it.
  const [rewriting, setRewriting] = useState<number>();
  const [feedback, setFeedback] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reverting, setReverting] = useState<Message>();
  const inputBox = useRef<HTMLTextAreaElement>(null);
  const story = useRef<HTMLDivElement>(null);
  const rewriteButton = useRef<HTMLButtonElement>(null);
  const leaving = useRef(new AbortController());
  const imageCheck = useRef<ReturnType<typeof setTimeout>>(undefined);
  const duplicating = useRef(false);

  useEffect(() => {
    const action = itemActions.get(id);
    itemActions.delete(id);
    // Without Settings the story still reads, in Prose.
    const reading = getSettings().catch(() => undefined);
    Promise.all([getSave(id), getMessages(id), getStatus(id), getNotes(id), reading]).then(([save, messages, status, notes, settings]) => {
      if (settings) {
        setSetupNotice(setupProblem(settings));
        setChatStyle(settings.chatStyle);
      }
      setSave(save);
      setMessages(messages);
      setStatus(status);
      setNotes(notes);
      if (action) playInput(action, messages);
      // Without a working Narrator this would only fail, and the page already says what to fix.
      else if (messages.length === 0 && settings && !setupProblem(settings)) openStory();
    }, (failure: Error) => setLoadError(failure.message));
    checkImages();
    return () => {
      leaving.current.abort();
      clearTimeout(imageCheck.current);
    };
  }, [id]);

  // Images draw in the background, so the page looks for them apart from the Turn, for as long as any are on the way.
  function checkImages() {
    clearTimeout(imageCheck.current);
    getImages(id).then((next) => {
      setImages(next);
      if (next.pending && !leaving.current.signal.aborted) imageCheck.current = setTimeout(checkImages, IMAGE_CHECK_MS);
      // Once, when drawing stops, as this holds the whole Full Log.
      else getJournal(id).then((journal) => setPortraits(journal.portraits), () => {});
    }, () => {});
  }

  function send(event: FormEvent) {
    event.preventDefault();
    if (turn || !draft.trim()) return;
    unsent.delete(id);
    setDraft("");
    playInput(draft, messages);
  }

  function openStory() {
    run({ input: "", narration: "" }, [], (show, signal) => playOpening(id, show, signal));
  }

  async function decide() {
    if (turn || deciding || draft.trim()) return;
    setDeciding(true);
    setError("");
    try {
      setDraft(await decideForMe(id, leaving.current.signal));
      inputBox.current?.focus();
    } catch (failure) {
      if (!leaving.current.signal.aborted) setError((failure as Error).message);
    }
    setDeciding(false);
  }

  function replace(input: string) {
    // The control that asked for this goes with the response, and focus must not fall back to the page.
    story.current!.focus();
    playInput(input, messages.slice(0, -1), messages.at(-1));
  }

  function sendFeedback(event: FormEvent) {
    event.preventDefault();
    if (feedback.trim()) replace(feedback);
  }

  function startRewrite(message: Message) {
    if (rewriting === message.id) return;
    setRewriting(message.id);
    setFeedback("");
  }

  function cancelRewrite() {
    setRewriting(undefined);
    setFeedback("");
    // Back in a Stage box can have taken the button away.
    (rewriteButton.current ?? story.current)?.focus();
  }

  async function duplicateHere(message: Message) {
    if (duplicating.current) return;
    duplicating.current = true;
    setError("");
    try {
      location.hash = `/play/${(await duplicateFrom(id, message.id)).id}`;
    } catch (failure) {
      setError((failure as Error).message);
    }
    duplicating.current = false;
  }

  // `before` is passed in because the load effect runs this before `messages` is set.
  function playInput(input: string, before: Message[], replaces?: Message) {
    return run({ input, narration: "", replaces }, before, (show, signal) =>
      replaces ? replaceResponse(id, replaces.id, input, show, signal) : playTurn(id, input, before.at(-1)?.id ?? 0, show, signal),
    );
  }

  async function run(
    started: TurnInProgress,
    before: Message[],
    play: (show: (narration: string) => void, signal: AbortSignal) => Promise<TurnResult>,
  ) {
    const { replaces } = started;
    let streamed = false;
    setError("");
    setAnnouncement("");
    setRewriting(undefined);
    setChosenBeat(undefined);
    setTurn(started);
    const show = (narration: string) => {
      streamed = true;
      setTurn({ ...started, narration });
    };
    const { signal } = leaving.current;
    const result = await play(show, signal);
    setTurn(undefined);
    if ("messages" in result) {
      setFeedback("");
      setMessages([...before, ...result.messages]);
      // Streamed text was already read out by the live region, and the Message list isn't live.
      if (!streamed) setAnnouncement(result.messages.at(-1)!.text);
    } else {
      if (replaces) {
        setRewriting(result.input ? replaces.id : undefined);
      } else {
        if (signal.aborted) unsent.set(id, result.input);
        setDraft(result.input);
      }
      setError(result.error);
      // A stale Turn means the story moved on without this page.
      getMessages(id).then(setMessages, () => {});
    }
    getStatus(id).then(setStatus, () => {});
    checkImages();
  }

  if (loadError) {
    return (
      <Book left={<h1 className="big">NovelForge</h1>}>
        <p role="alert" className="error">{loadError}</p>
        <a className="quiet" href="#/">Main Menu</a>
      </Book>
    );
  }
  if (!save || !status || !notes) return <Book left={null}>{null}</Book>;
  const pc = save.pc.name;
  const latest = messages.at(-1);
  const replaceable = !turn && latest?.role === "narrator" ? latest : undefined;
  const scene = images.images.at(-1);
  const told = readable(turn?.replaces ? messages.slice(0, -1) : messages);
  const staged = chatStyle === "stage" && (told.length > 0 || !!turn);
  const sceneImage = (image = scene) => image && <SceneImage id={id} image={image} />;
  const cover = save.hasCover && (
    <figure className="plate">
      <Zoomable src={coverUrl(id)} alt={`Cover of ${pc}'s story`} />
    </figure>
  );

  const line = (beat: Beat, key: number) => {
    const portrait = portraits.find(({ npc }) => npc === beat.speaker);
    return <BeatLine key={key} beat={beat} style={chatStyle} pc={pc} face={portrait && portraitUrl(id, portrait)} />;
  };

  const controls = (message: Message) =>
    !turn && (
      <div className="row actions">
        {message !== latest && (
          <button
            className="icon revert"
            title="Revert to here"
            aria-label={`Revert to this Message: ${message.text.slice(0, 40)}`}
            onClick={() => setReverting(message)}
          >
            {RevertIcon}
          </button>
        )}
        <button
          className="icon revert"
          title="Duplicate from here"
          aria-label={`Duplicate from this Message: ${message.text.slice(0, 40)}`}
          onClick={() => duplicateHere(message)}
        >
          {DuplicateIcon}
        </button>
        {message === replaceable && (
          <>
            <button
              ref={rewriteButton}
              className="icon"
              title="Rewrite"
              aria-label="Rewrite"
              aria-expanded={rewriting === message.id}
              onClick={() => startRewrite(message)}
            >
              {RewriteIcon}
            </button>
            <button className="icon" title="Regenerate" aria-label="Regenerate" onClick={() => replace("")}>
              {RegenerateIcon}
            </button>
          </>
        )}
      </div>
    );

  return (
    <Book
      narrowLeft
      left={
        <>
          {/* A Save from before titles has only its PC. */}
          <div className="story-title">
            <h1 className="title">{save.title || pc}</h1>
            {save.title && <p className="muted">{pc}</p>}
          </div>
          {!staged && (sceneImage() || cover)}
          <div className="condition">
            <h2>Condition</h2>
            <p className="status">{statusWords(status)}</p>
            <p className="muted">{plural(images.session, "image")} this session</p>
          </div>
          <div className="notes">
            <h2>
              <button className="quiet" aria-haspopup="dialog" onClick={() => setEditingNotes(true)}>
                Director's Notes
              </button>
            </h2>
            {notes.length > 0 && (
              <ul>
                {notes.map((note, index) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            )}
          </div>
          <a className="quiet" href="#/">Main Menu</a>
        </>
      }
      tabs={<BookTabs id={id} current="Story" />}
    >
      {staged ? (
        <StageBox
          story={story}
          beats={stageBeats(told, turn)}
          chosen={chosenBeat}
          onChoose={setChosenBeat}
          line={line}
          controls={controls}
          waiting={!!turn && !turn.narration}
        >
          {/* Back should show what that moment looked like, not the newest image. */}
          {(message) => sceneImage(message && images.images.findLast(({ messageId }) => messageId <= message.id))}
        </StageBox>
      ) : (
        <div ref={story} className={`story chat-${chatStyle}`} tabIndex={0} role="region" aria-label="Story">
          <div>
            {worldChanged && told.length < 2 && (
              <p className="notice">{pc} didn't fit the world as it stood, so the world has changed to fit them.</p>
            )}
            {messages.length === 0 && !turn && (
              <>
                <p className="muted">{save.startingHook || "The page is blank."}</p>
                <button className="quiet" onClick={openStory}>
                  Have the Narrator open the story
                </button>
              </>
            )}
            {told.map((message) => (
              <div key={message.id} className={`message ${message.role}`}>
                {messageBeats(message).map(line)}
                {controls(message)}
              </div>
            ))}
            {turn?.input && !turn.replaces && (
              <div className="message player">{messageBeats({ role: "player", text: turn.input }).map(line)}</div>
            )}
            {/* Mounted before any text arrives, or screen readers would not announce it. */}
            <div aria-live="polite" className="message narrator">
              {turn &&
                (turn.narration ? (
                  messageBeats({ role: "narrator", text: turn.narration }).map(line)
                ) : (
                  <p className="waiting">{WRITING}</p>
                ))}
            </div>
          </div>
        </div>
      )}
      <div className="visually-hidden" aria-live="polite">
        {staged && turn ? (
          turn.narration ? messageBeats({ role: "narrator", text: turn.narration }).map(line) : WRITING
        ) : (
          <p>{announcement}</p>
        )}
      </div>
      {setupNotice && (
        <p className="notice">
          {setupNotice} The Narrator can't reply until then. <a href={`#/settings/${id}`}>Open Settings</a>
        </p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      {replaceable && rewriting === replaceable.id && (
        <form className="ask" onSubmit={sendFeedback}>
          <label>
            What should the Narrator change?
            <textarea
              autoFocus
              rows={2}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              onKeyDown={sendOnEnter}
            />
          </label>
          <div className="row">
            <button type="button" className="quiet" onClick={cancelRewrite}>
              Cancel
            </button>
            <button className="action" aria-disabled={!feedback.trim()}>
              Rewrite the response
            </button>
          </div>
        </form>
      )}
      <form className="compose" onSubmit={send}>
        <label>
          <span className="visually-hidden">What does {pc} say or do?</span>
          <textarea
            ref={inputBox}
            rows={2}
            placeholder={deciding ? "The Narrator is deciding…" : `What does ${pc} say or do?`}
            value={draft}
            readOnly={!!turn}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={sendOnEnter}
          />
        </label>
        <div className="compose-actions">
          <button
            type="button"
            className="icon"
            title={draft.trim() ? "Decide for me: clear the box first" : "Decide for me"}
            aria-label="Decide for me"
            aria-disabled={!!turn || deciding || !!draft.trim()}
            onClick={decide}
          >
            {DecideIcon}
          </button>
          {/* aria-disabled, because a disabled button would drop keyboard focus at every Send. */}
          <button className="action" aria-disabled={!!turn || !draft.trim()}>
            Send
          </button>
        </div>
      </form>
      {editingNotes && (
        <NotesDialog id={id} notes={notes} onChange={setNotes} onClose={() => setEditingNotes(false)} />
      )}
      {reverting && (
        <RevertDialog
          id={id}
          message={reverting}
          onClose={() => setReverting(undefined)}
          onReverted={() => {
            setMessages(messages.filter((message) => message.id <= reverting.id));
            setChosenBeat(undefined);
            getStatus(id).then(setStatus, () => {});
            getNotes(id).then(setNotes, () => {});
            checkImages();
            // The button that opened the dialog goes with the Messages, and focus must not fall back to the page.
            inputBox.current!.focus();
          }}
        />
      )}
    </Book>
  );
}

/** One beat shows at a time. The rest stay in the DOM, visually hidden, so that a screen reader can reach them all. */
function StageBox(props: {
  story: Ref<HTMLDivElement>;
  beats: StageBeat[];
  chosen: number | undefined;
  onChoose: (beat: number) => void;
  line: (beat: Beat, key: number) => ReactNode;
  controls: (message: Message) => ReactNode;
  waiting: boolean;
  children: (message?: Message) => ReactNode;
}) {
  const { beats, chosen, onChoose, waiting } = props;
  const last = beats.length - 1;
  const at = Math.min(chosen ?? openingBeat(beats), last);
  const current = beats[at]!;
  return (
    <div ref={props.story} className="stage" tabIndex={-1} role="region" aria-label="Story">
      {props.children(current.message)}
      <div className="stage-box">
        {beats.map(({ beat, message }, index) =>
          index === at ? (
            // Focusable, because a long beat has to scroll by keyboard.
            <div key={index} className={beat.player ? "beat player" : "beat"} tabIndex={0}>
              {props.line(beat, index)}
            </div>
          ) : (
            // A Turn in progress is read out by the live region, so it mustn't be reached twice.
            <div key={index} className="visually-hidden" aria-hidden={!message}>
              {props.line(beat, index)}
            </div>
          ),
        )}
        {waiting && <p className="waiting">{WRITING}</p>}
        <div className="row stage-foot">
          <span className="muted">
            Beat {current.number} of {current.of}
          </span>
          <button className="quiet" aria-disabled={at === 0} onClick={() => at > 0 && onChoose(at - 1)}>
            Back
          </button>
          <button className="action" aria-disabled={at === last} onClick={() => at < last && onChoose(at + 1)}>
            Next
          </button>
        </div>
        {current.message && props.controls(current.message)}
      </div>
    </div>
  );
}

function NotesDialog(props: {
  id: string;
  notes: string[];
  onChange: (notes: string[]) => void;
  onClose: () => void;
}) {
  const { id, notes, onChange } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<number>();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => dialog.current!.showModal(), []);

  function startEditing(index: number | undefined, note: string) {
    setEditing(index);
    setText(note);
    box.current!.focus();
  }

  async function attempt(action: () => Promise<string[]>, textAfter = "") {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      onChange(await action());
      startEditing(undefined, textAfter);
    } catch (failure) {
      setError((failure as Error).message);
      // Notes are addressed by position, so a change from another tab must show before the next try.
      getNotes(id).then(onChange, () => {});
    }
    setBusy(false);
  }

  function submitNote(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    attempt(() => (editing === undefined ? addNote(id, text) : editNote(id, editing, text)));
  }

  return (
    <dialog ref={dialog} onClose={props.onClose} aria-labelledby="notes-title">
      <h2 id="notes-title">Director's Notes</h2>
      <p className="muted">Standing instructions the Narrator follows from now on. Older text stays as written.</p>
      {notes.length > 0 && (
        <ul className="note-list">
          {notes.map((note, index) => (
            <li key={index}>
              <p>{note}</p>
              <div className="row">
                <button
                  className="quiet"
                  aria-label={`Edit note: ${note.slice(0, 40)}`}
                  onClick={() => startEditing(index, note)}
                >
                  Edit
                </button>
                <button
                  className="quiet"
                  aria-label={`Remove note: ${note.slice(0, 40)}`}
                  // Positions shift, so an edit in progress ends, but a new Note being typed stays.
                  onClick={() => attempt(() => removeNote(id, index), editing === undefined ? text : "")}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form className="note-form" onSubmit={submitNote}>
        <label>
          {editing === undefined ? "Add a note" : "Edit this note"}
          <textarea
            ref={box}
            rows={2}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={sendOnEnter}
          />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="row">
          <button type="button" className="quiet" onClick={() => dialog.current!.close()}>
            Close
          </button>
          {editing !== undefined && (
            <button type="button" className="quiet" onClick={() => startEditing(undefined, "")}>
              Cancel edit
            </button>
          )}
          <button className="action" aria-disabled={busy || !text.trim()}>
            {editing === undefined ? "Add" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function RevertDialog(props: { id: string; message: Message; onClose: () => void; onReverted: () => void }) {
  const { id, message } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ messages: number; images: number; portraits: number }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    dialog.current!.showModal();
    previewRevert(id, message.id).then(setPreview, (failure: Error) => setError(failure.message));
  }, [id, message.id]);

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  const confirmRevert = () =>
    attempt(async () => {
      await revert(id, message.id);
      // Gone if the player pressed Escape while this was in flight, and the Revert happened all the same.
      dialog.current?.close();
      props.onReverted();
    });

  const duplicate = () =>
    attempt(async () => {
      location.hash = `/play/${(await duplicateFrom(id, message.id)).id}`;
    });

  return (
    <dialog ref={dialog} onClose={props.onClose} aria-labelledby="revert-title">
      <h2 id="revert-title">Revert to this Message?</h2>
      <blockquote>{message.text}</blockquote>
      {preview && (
        <p>
          This permanently deletes the {plural(preview.messages, "Message")} after it
          {preview.images > 0 && ` and ${plural(preview.images, "Scene Image")}`}
          {preview.portraits > 0 && ` and ${plural(preview.portraits, "portrait")}`}.
        </p>
      )}
      <p className="muted">“Duplicate from here” keeps this story and carries on in a new Save instead.</p>
      {error && <p role="alert" className="error">{error}</p>}
      {/* Cancel comes first because a modal focuses its first control, and that must not be the deleting one. */}
      <div className="row">
        <button className="quiet" onClick={() => dialog.current!.close()}>
          Cancel
        </button>
        <button className="quiet" disabled={busy || !preview} onClick={duplicate}>
          Duplicate from here
        </button>
        <button className="action" disabled={busy || !preview} onClick={confirmRevert}>
          Revert
        </button>
      </div>
    </dialog>
  );
}
