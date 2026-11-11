import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { editJournal, getImages, renameNpc, getJournal, getRequestedImages, getSave, type Journal as JournalContent, type RequestedImage, type Save, type SceneImageInfo, statusWords, tellNarrator } from "./api";
import { ContinueRule, isContinue, readable } from "./chat-style";
import { EditIcon } from "./icons";
import { Book, BookTabs } from "./menu";
import { IMAGE_CHECK_MS, RequestedPicture, SceneImage } from "./play";
import { Person } from "./zoom";

const FIRST_SHOWN = 5;
const MORE_SHOWN = 10;

/** A list newest first, as the latest is what play needs. `items` come oldest first, and each `children` gives an `li` with its key. */
function NewestFirst<T>({ items, className, children }: { items: T[]; className?: string; children: (item: T) => ReactNode }) {
  const [shown, setShown] = useState(FIRST_SHOWN);
  const newest = items.toReversed();
  return (
    <>
      <ul className={className}>{newest.slice(0, shown).map(children)}</ul>
      {newest.length > shown && (
        <button className="quiet show-more" onClick={() => setShown(shown + MORE_SHOWN)}>
          Show more ({newest.length - shown} older)
        </button>
      )}
    </>
  );
}

/** Long text cut to three lines, with More to show it all. More appears only when the text runs past them. */
function Clamped({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  const shown = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    const paragraph = shown.current;
    if (paragraph && !open) setCut(paragraph.scrollHeight > paragraph.clientHeight);
  }, [text, open]);
  return (
    <div>
      <p ref={shown} className={open ? undefined : "brief clamp-3"}>{text}</p>
      {(cut || open) && (
        <button className="quiet show-more" aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? "Less" : "More"}
        </button>
      )}
    </div>
  );
}

/** Text the player can change where it stands. A failure keeps what they typed, and the server's refusal during a Turn shows here. */
function Editable(props: { label: string; text: string; opener?: string; onSave: (text: string) => Promise<unknown>; onRemove?: () => Promise<unknown>; children?: ReactNode }) {
  const { label, text, opener, onSave, onRemove, children } = props;
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
        <button className={opener ? "quiet" : "icon"} aria-label={`${opener ?? "Edit"}: ${label}`} title={opener ?? "Edit"} onClick={() => setDraft(text)}>
          {opener ?? EditIcon}
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

/** Words about the world, hidden parts included, so the reply can only say that it was done or that it failed. Stays open until it's answered, as nothing else would tell the player. */
export function TellTheNarrator({ id, onDone, onClose }: { id: string; onDone: () => Promise<unknown>; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => dialog.current!.showModal(), []);

  const tell = async () => {
    setBusy(true);
    setDone(false);
    setError("");
    try {
      await tellNarrator(id, text);
      setText("");
      setDone(true);
      await onDone();
    } catch (failure) {
      setError((failure as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} onClose={onClose} onCancel={(event) => busy && event.preventDefault()} aria-labelledby="tell-title">
      <form
        className="edit-box"
        onSubmit={(event) => {
          event.preventDefault();
          void tell();
        }}
      >
        <h2 id="tell-title">Tell Narrator what to change</h2>
        <label>
          <span className="muted">Nudge the story or correct a mistake, such as “the mayor is secretly a smuggler”. This can change anything in the world, and secrets stay hidden from you.</span>
          <textarea rows={4} value={text} autoFocus disabled={busy} onChange={(event) => setText(event.target.value)} />
        </label>
        {busy && <p role="status" className="waiting">The Narrator is changing the world…</p>}
        {done && <p role="status" className="muted">Done. The next Turn uses it.</p>}
        {error && <p role="alert" className="error">{error}</p>}
        <div className="row">
          <button type="submit" className="action" disabled={busy || !text.trim()}>
            Tell Narrator
          </button>
          <button type="button" className="quiet" disabled={busy} onClick={() => dialog.current!.close()}>
            {done ? "Close" : "Cancel"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function Journal({ id }: { id: string }) {
  const [save, setSave] = useState<Save>();
  const [journal, setJournal] = useState<JournalContent>();
  const [images, setImages] = useState<SceneImageInfo[]>([]);
  const [requested, setRequested] = useState<RequestedImage[]>([]);
  const [loadError, setLoadError] = useState("");
  const [telling, setTelling] = useState(false);
  const [reading, setReading] = useState<number>();

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
  const reread = async () => {
    const [save, journal] = await Promise.all([getSave(id), getJournal(id)]);
    setSave(save);
    setJournal(journal);
  };
  const edit = async (change: Parameters<typeof editJournal>[1]) => {
    await editJournal(id, change);
    await reread();
  };
  const pcPortrait = journal.portraits.find(({ npc }) => npc === null);
  const { chapters } = journal;
  const chapterName = (index: number) => `Chapter ${index + 1}${chapters[index]?.title ? ` · ${chapters[index].title}` : ""}`;
  // A Chapter holds the Messages after the one before it, up to its own last, and the open one runs on to the latest.
  const chapterLog = (index: number) => {
    const start = chapters[index - 1]?.lastMessage ?? 0;
    const end = chapters[index]?.lastMessage ?? Infinity;
    return readable(journal.fullLog).filter(({ id }) => id > start && id <= end);
  };

  return (
    <Book
      left={
        <>
          <div className="journal-head">
            <h1 className="big">Journal</h1>
            <button className="quiet" onClick={() => setTelling(true)}>
              Tell Narrator what to change
            </button>
          </div>
          {telling && <TellTheNarrator id={id} onDone={reread} onClose={() => setTelling(false)} />}
          <div className="journal">
            {journal.storyTime && (
              <>
                <h2>Story Time</h2>
                <Editable label="Date" text={journal.storyTime.date} onSave={(date) => edit({ edit: "storyTime", date, timeOfDay: journal.storyTime!.timeOfDay })}>
                  <p>{journal.storyTime.date}</p>
                </Editable>
                <Editable label="Time of day" text={journal.storyTime.timeOfDay} onSave={(timeOfDay) => edit({ edit: "storyTime", date: journal.storyTime!.date, timeOfDay })}>
                  <p>{journal.storyTime.timeOfDay}</p>
                </Editable>
              </>
            )}
            <p className="person">
              <Person id={id} name={save.pc.name} portrait={pcPortrait} who={statusWords(journal.status)} />
            </p>
            <h2>World Brief</h2>
            <Editable label="World Brief" text={save.worldBrief} onSave={(text) => edit({ edit: "worldBrief", text })}>
              <Clamped text={save.worldBrief} />
            </Editable>
            <h2>Recent summary</h2>
            <Editable label="Recent summary" text={journal.recentSummary} onSave={(text) => edit({ edit: "recentSummary", text })}>
              {journal.recentSummary ? <p>{journal.recentSummary}</p> : <p className="muted">Nothing recent yet.</p>}
            </Editable>
            <h2>Loose Ends</h2>
            {journal.looseEnds.length > 0 ? (
              <NewestFirst items={journal.looseEnds}>
                {(looseEnd) => (
                  <li key={looseEnd}>
                    <Editable
                      label="Loose End"
                      text={looseEnd}
                      onSave={(text) => edit({ edit: "looseEnd", old: looseEnd, new: text })}
                      onRemove={() => edit({ edit: "looseEnd", old: looseEnd, new: null })}
                    >
                      <span>{looseEnd}</span>
                    </Editable>
                  </li>
                )}
              </NewestFirst>
            ) : (
              <p className="muted">Nothing left open.</p>
            )}
            <Editable label="New Loose End" text="" opener="Add a Loose End" onSave={(text) => edit({ edit: "looseEnd", old: null, new: text })} />
            <h2>Scene Memories</h2>
            {journal.sceneMemories.length > 0 ? (
              <NewestFirst items={journal.sceneMemories}>
                {({ firstMessage, text }) => (
                  <li key={firstMessage}>
                    <Editable label="Scene Memory" text={text} onSave={(next) => edit({ edit: "sceneMemory", firstMessage, text: next })}>
                      <span>{text}</span>
                    </Editable>
                  </li>
                )}
              </NewestFirst>
            ) : (
              <p className="muted">Nothing has faded yet.</p>
            )}
            <h2>What {save.pc.name} knows</h2>
            {journal.facts.length > 0 ? (
              <NewestFirst items={journal.facts}>
                {(fact) => (
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
                )}
              </NewestFirst>
            ) : (
              <p className="muted">Nothing certain yet.</p>
            )}
            <Editable label={`New fact ${save.pc.name} knows`} text="" opener="Add a fact" onSave={(text) => edit({ edit: "fact", old: null, new: text })} />
            <h2>NPCs</h2>
            {journal.npcs.length > 0 ? (
              <NewestFirst items={journal.npcs} className="people">
                {(name) => (
                  <li key={name}>
                    <Editable label={`Who ${name} is`} text={journal.npcSummaries[name] ?? ""} onSave={(text) => edit({ edit: "npcSummary", name, text })}>
                      <span className="person">
                        <Person id={id} name={name} portrait={journal.portraits.find(({ npc }) => npc === name)} who={journal.npcSummaries[name]} />
                      </span>
                    </Editable>
                    <Editable
                      label={`Rename ${name} everywhere in the story`}
                      text={name}
                      opener="Rename"
                      onSave={async (newName) => {
                        await renameNpc(id, name, newName.trim());
                        await reread();
                      }}
                    />
                  </li>
                )}
              </NewestFirst>
            ) : (
              <p className="muted">No one yet.</p>
            )}
          </div>
        </>
      }
      tabs={<BookTabs id={id} current="Journal" />}
    >
      {reading === undefined ? (
        <>
          <h2>Story Summary</h2>
          <Editable label="Story Summary" text={journal.summary} onSave={(text) => edit({ edit: "summary", text })}>
            {journal.summary ? <Clamped text={journal.summary} /> : <p className="muted">Nothing to look back on yet.</p>}
          </Editable>
          <h2>Chapters</h2>
          <ol className="chapters">
            {chapters
              .map((chapter, index) => ({ chapter, index }))
              .toReversed()
              .map(({ chapter, index }) => (
                <li key={index}>
                  <button className="chapter" onClick={() => setReading(index)}>
                    {chapterName(index)}
                    {chapter.lastMessage === null && <span className="muted"> · in progress</span>}
                  </button>
                </li>
              ))}
          </ol>
        </>
      ) : (
        <>
          <button className="quiet back" onClick={() => setReading(undefined)}>
            Back to chapters
          </button>
          {chapters[reading]?.lastMessage === null ? (
            <h2>{chapterName(reading)} <span className="muted">· in progress</span></h2>
          ) : (
            <Editable label="Chapter title" text={chapters[reading]?.title ?? ""} onSave={(title) => edit({ edit: "chapterTitle", index: reading, title })}>
              <h2>{chapterName(reading)}</h2>
            </Editable>
          )}
          <ChapterText messages={chapterLog(reading)} id={id} images={images} requested={requested} />
        </>
      )}
    </Book>
  );
}

function ChapterText({ id, messages, images, requested }: { id: string; messages: ReturnType<typeof readable>; images: SceneImageInfo[]; requested: RequestedImage[] }) {
  return (
    <div className="full-log" tabIndex={0} role="region" aria-label="Chapter">
      {messages.length === 0 && <p className="muted">The page is blank.</p>}
      {messages.map((message) => {
        const image = images.find(({ messageId }) => messageId === message.id);
        return (
          <div key={message.id} className={`message ${message.role}`}>
            {image && <SceneImage id={id} image={image} />}
            {requested
              .filter(({ messageId }) => messageId === message.id)
              .map((image) => (
                <RequestedPicture key={image.ref} id={id} image={image} />
              ))}
            {isContinue(message) ? <ContinueRule /> : <p>{message.text}</p>}
          </div>
        );
      })}
    </div>
  );
}
