import { type ReactNode, useEffect, useState } from "react";
import { editJournal, getImages, getJournal, getRequestedImages, getSave, type Journal as JournalContent, type RequestedImage, type Save, type SceneImageInfo, tellNarrator } from "./api";
import { readable } from "./chat-style";
import { Book, BookTabs } from "./menu";
import { IMAGE_CHECK_MS, RequestedPicture, SceneImage } from "./play";
import { Person } from "./zoom";

/** Text the player can change where it stands. A failure keeps what they typed, and the server's refusal during a Turn shows here. */
function Editable(props: { label: string; text: string; opener?: string; onSave: (text: string) => Promise<unknown>; onRemove?: () => Promise<unknown>; children?: ReactNode }) {
  const { label, text, opener = "Edit", onSave, onRemove, children } = props;
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const run = async (change: () => Promise<unknown>) => {
    setBusy(true);
    setError("");
    try {
      await change();
      setDraft(undefined);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (draft === undefined) {
    return (
      <div className="editable">
        {children}
        <button className="quiet" aria-label={`${opener}: ${label}`} onClick={() => setDraft(text)}>
          {opener}
        </button>
      </div>
    );
  }
  return (
    <form
      className="edit-box"
      onSubmit={(event) => {
        event.preventDefault();
        void run(() => onSave(draft));
      }}
    >
      <label>
        {label}
        <textarea rows={4} value={draft} autoFocus onChange={(event) => setDraft(event.target.value)} />
      </label>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="action" disabled={busy || !draft.trim()}>
          Save
        </button>
        <button type="button" className="quiet" disabled={busy} onClick={() => setDraft(undefined)}>
          Cancel
        </button>
        {onRemove && (
          <button type="button" className="quiet" disabled={busy} onClick={() => void run(onRemove)}>
            Remove
          </button>
        )}
      </div>
    </form>
  );
}

/** Words about the hidden world, which the player never sees changed, so all this can show is that it was done or that it failed. */
function TellTheNarrator({ id }: { id: string }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const tell = async () => {
    setBusy(true);
    setDone(false);
    setError("");
    try {
      await tellNarrator(id, text);
      setText("");
      setDone(true);
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="edit-box"
      onSubmit={(event) => {
        event.preventDefault();
        void tell();
      }}
    >
      <h2>Tell the Narrator</h2>
      <label>
        <span className="muted">Change what's hidden from you, such as “the mayor is secretly a smuggler”. You won't see what changes.</span>
        <textarea rows={3} value={text} disabled={busy} onChange={(event) => setText(event.target.value)} />
      </label>
      {busy && <p role="status" className="waiting">The Narrator is changing the world…</p>}
      {done && <p role="status" className="muted">Done. The next Turn uses it.</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="action" disabled={busy || !text.trim()}>
          Tell the Narrator
        </button>
      </div>
    </form>
  );
}

export function Journal({ id }: { id: string }) {
  const [save, setSave] = useState<Save>();
  const [journal, setJournal] = useState<JournalContent>();
  const [images, setImages] = useState<SceneImageInfo[]>([]);
  const [requested, setRequested] = useState<RequestedImage[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let leaving = false;
    let loaded = false;
    const load = () =>
      Promise.all([getSave(id), getJournal(id), getImages(id), getRequestedImages(id)]).then(([save, journal, { images, pending }, asked]) => {
        setSave(save);
        setJournal(journal);
        setImages(images);
        setRequested(asked.images);
        loaded = true;
        if (pending && !leaving) timer = setTimeout(load, IMAGE_CHECK_MS);
      }, (failure: Error) => {
        // A failed look for a portrait mustn't take away a Journal already on the page.
        if (!loaded) setLoadError(failure.message);
      });
    load();
    return () => {
      leaving = true;
      clearTimeout(timer);
    };
  }, [id]);

  if (loadError) {
    return (
      <Book left={<h1 className="big">Journal</h1>}>
        <p role="alert" className="error">{loadError}</p>
        <a className="quiet" href="#/">Main Menu</a>
      </Book>
    );
  }
  if (!save || !journal) return <Book left={null}>{null}</Book>;
  const edit = async (change: Parameters<typeof editJournal>[1]) => {
    await editJournal(id, change);
    const [save, journal] = await Promise.all([getSave(id), getJournal(id)]);
    setSave(save);
    setJournal(journal);
  };
  const pcPortrait = journal.portraits.find(({ npc }) => npc === null);
  const log = readable(journal.fullLog);

  return (
    <Book
      left={
        <>
          <h1 className="big">Journal</h1>
          <div className="journal">
            {pcPortrait && (
              <p className="person">
                <Person id={id} name={save.pc.name} portrait={pcPortrait} />
              </p>
            )}
            <h2>World Brief</h2>
            <Editable label="World Brief" text={save.worldBrief} onSave={(text) => edit({ edit: "worldBrief", text })}>
              <p>{save.worldBrief}</p>
            </Editable>
            <h2>Recent summary</h2>
            <Editable label="Recent summary" text={journal.summary} onSave={(text) => edit({ edit: "summary", text })}>
              {journal.summary ? <p>{journal.summary}</p> : <p className="muted">Nothing to look back on yet.</p>}
            </Editable>
            <h2>What {save.pc.name} knows</h2>
            {journal.facts.length > 0 ? (
              <ul>
                {journal.facts.map((fact) => (
                  <li key={fact}>
                    <Editable
                      label={`What ${save.pc.name} knows`}
                      text={fact}
                      onSave={(text) => edit({ edit: "fact", old: fact, new: text })}
                      onRemove={() => edit({ edit: "fact", old: fact, new: null })}
                    >
                      <span>{fact}</span>
                    </Editable>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Nothing certain yet.</p>
            )}
            <Editable label={`New fact ${save.pc.name} knows`} text="" opener="Add a fact" onSave={(text) => edit({ edit: "fact", old: null, new: text })} />
            <h2>NPCs</h2>
            {journal.npcs.length > 0 ? (
              <ul className="people">
                {journal.npcs.map((name) => (
                  <li key={name}>
                    <Editable label={`Who ${name} is`} text={journal.npcSummaries[name] ?? ""} onSave={(text) => edit({ edit: "npcSummary", name, text })}>
                      <span className="person">
                        <Person id={id} name={name} portrait={journal.portraits.find(({ npc }) => npc === name)} who={journal.npcSummaries[name]} />
                      </span>
                    </Editable>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No one yet.</p>
            )}
            <TellTheNarrator id={id} />
          </div>
        </>
      }
      tabs={<BookTabs id={id} current="Journal" />}
    >
      <h2>Full Log</h2>
      <div className="full-log" tabIndex={0} role="region" aria-label="Full Log">
        {log.length === 0 && <p className="muted">The page is blank.</p>}
        {log.map((message) => {
          const image = images.find(({ messageId }) => messageId === message.id);
          return (
            <div key={message.id} className={`message ${message.role}`}>
              {image && <SceneImage id={id} image={image} />}
              {requested
                .filter(({ messageId }) => messageId === message.id)
                .map((image) => (
                  <RequestedPicture key={image.ref} id={id} image={image} />
                ))}
              <p>{message.text}</p>
            </div>
          );
        })}
      </div>
    </Book>
  );
}
