import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  duplicateFrom,
  getMessages,
  getSave,
  getSettings,
  getStatus,
  type Message,
  playTurn,
  previewRevert,
  revert,
  type Save,
  setupProblem,
  type Status,
  statusWords,
} from "./api";
import { Book, BookTabs } from "./menu";

// Text from a Turn cut short by leaving the screen, to put back in the box on return.
const unsent = new Map<string, string>();
// An item's action, which the Story plays as a Turn once it has loaded, so it streams like any other.
const itemActions = new Map<string, string>();

export function playItemAction(id: string, input: string) {
  itemActions.set(id, input);
  location.hash = `/play/${id}`;
}

export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form!.requestSubmit();
}

export function Play({ id }: { id: string }) {
  const [save, setSave] = useState<Save>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<Status>();
  const [setupNotice, setSetupNotice] = useState<string>();
  const [draft, setDraft] = useState(unsent.get(id) ?? "");
  const [turn, setTurn] = useState<{ input: string; narration: string }>();
  const [announcement, setAnnouncement] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reverting, setReverting] = useState<Message>();
  const inputBox = useRef<HTMLTextAreaElement>(null);
  const leaving = useRef(new AbortController());

  useEffect(() => {
    const action = itemActions.get(id);
    itemActions.delete(id);
    Promise.all([getSave(id), getMessages(id), getStatus(id)]).then(([save, messages, status]) => {
      setSave(save);
      setMessages(messages);
      setStatus(status);
      if (action) playInput(action, messages);
    }, (failure: Error) => setLoadError(failure.message));
    getSettings().then((settings) => setSetupNotice(setupProblem(settings)), () => {});
    return () => leaving.current.abort();
  }, [id]);

  function send(event: FormEvent) {
    event.preventDefault();
    if (turn || !draft.trim()) return;
    unsent.delete(id);
    setDraft("");
    playInput(draft, messages);
  }

  // `before` is passed in because the load effect runs this before `messages` is set.
  async function playInput(input: string, before: Message[]) {
    let streamed = false;
    setError("");
    setAnnouncement("");
    setTurn({ input, narration: "" });
    const show = (narration: string) => {
      streamed = true;
      setTurn({ input, narration });
    };
    const result = await playTurn(id, input, before.at(-1)?.id ?? 0, show, leaving.current.signal);
    setTurn(undefined);
    if ("messages" in result) {
      setMessages([...before, ...result.messages]);
      // Streamed text was already read out by the live region, and the Message list isn't live.
      if (!streamed) setAnnouncement(result.messages.at(-1)!.text);
    } else {
      if (leaving.current.signal.aborted) unsent.set(id, result.input);
      setDraft(result.input);
      setError(result.error);
      // A stale Turn means the story moved on without this page.
      getMessages(id).then(setMessages, () => {});
    }
    getStatus(id).then(setStatus, () => {});
  }

  if (loadError) {
    return (
      <Book left={<h1 className="big">NovelForge</h1>}>
        <p role="alert" className="error">{loadError}</p>
        <a className="quiet" href="#/">Main Menu</a>
      </Book>
    );
  }
  if (!save || !status) return <Book left={null}>{null}</Book>;
  const pc = save.pc.name;

  return (
    <Book
      narrowLeft
      left={
        <>
          <h1 className="title">{pc}</h1>
          <div className="condition">
            <h2>Condition</h2>
            <p className="status">{statusWords(status)}</p>
          </div>
          <div className="world">
            <h2>World Brief</h2>
            <p>{save.worldBrief}</p>
          </div>
          <a className="quiet" href="#/">Main Menu</a>
        </>
      }
      tabs={<BookTabs id={id} current="Story" />}
    >
      <div className="story" tabIndex={0} role="region" aria-label="Story">
        <div>
          {messages.length === 0 && !turn && <p className="muted">The page is blank. What does {pc} do first?</p>}
          {messages.map((message, index) => (
            <div key={message.id} className={`message ${message.role}`}>
              <p>{message.text}</p>
              {!turn && index < messages.length - 1 && (
                <button
                  className="quiet revert"
                  aria-label={`Revert to this Message: ${message.text.slice(0, 40)}`}
                  onClick={() => setReverting(message)}
                >
                  Revert to here
                </button>
              )}
            </div>
          ))}
          {turn && (
            <div className="message player">
              <p>{turn.input}</p>
            </div>
          )}
          {/* Mounted before any text arrives, or screen readers would not announce it. */}
          <div aria-live="polite" className="message narrator">
            {turn && (turn.narration ? <p>{turn.narration}</p> : <p className="waiting">The Narrator is writing…</p>)}
          </div>
        </div>
      </div>
      <p className="visually-hidden" aria-live="polite">{announcement}</p>
      {setupNotice && (
        <p className="notice">
          {setupNotice} The Narrator can't reply until then. <a href="#/settings">Open Settings</a>
        </p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
      <form className="compose" onSubmit={send}>
        <label>
          <span className="visually-hidden">What does {pc} say or do?</span>
          <textarea
            ref={inputBox}
            rows={2}
            placeholder={`What does ${pc} say or do?`}
            value={draft}
            readOnly={!!turn}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={sendOnEnter}
          />
        </label>
        {/* aria-disabled, because a disabled button would drop keyboard focus at every Send. */}
        <button className="action" aria-disabled={!!turn || !draft.trim()}>
          Send
        </button>
      </form>
      {reverting && (
        <RevertDialog
          id={id}
          message={reverting}
          onClose={() => setReverting(undefined)}
          onReverted={() => {
            setMessages(messages.filter((message) => message.id <= reverting.id));
            getStatus(id).then(setStatus, () => {});
            // The button that opened the dialog goes with the Messages, and focus must not fall back to the page.
            inputBox.current!.focus();
          }}
        />
      )}
    </Book>
  );
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function RevertDialog(props: { id: string; message: Message; onClose: () => void; onReverted: () => void }) {
  const { id, message } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ messages: number; images: number }>();
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
          {preview.images > 0 && ` and ${plural(preview.images, "Scene Image")}`}.
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
