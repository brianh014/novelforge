import { useEffect, useState } from "react";
import { getImages, getJournal, getSave, type Journal as JournalContent, type Save, type SceneImageInfo } from "./api";
import { readable } from "./chat-style";
import { Book, BookTabs } from "./menu";
import { IMAGE_CHECK_MS, SceneImage } from "./play";
import { Person } from "./zoom";

export function Journal({ id }: { id: string }) {
  const [save, setSave] = useState<Save>();
  const [journal, setJournal] = useState<JournalContent>();
  const [images, setImages] = useState<SceneImageInfo[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let leaving = false;
    let loaded = false;
    const load = () =>
      Promise.all([getSave(id), getJournal(id), getImages(id)]).then(([save, journal, { images, pending }]) => {
        setSave(save);
        setJournal(journal);
        setImages(images);
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
            <p>{save.worldBrief}</p>
            <h2>Recent summary</h2>
            {journal.summary ? <p>{journal.summary}</p> : <p className="muted">Nothing to look back on yet.</p>}
            <h2>What {save.pc.name} knows</h2>
            {journal.facts.length > 0 ? (
              <ul>{journal.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
            ) : (
              <p className="muted">Nothing certain yet.</p>
            )}
            <h2>NPCs</h2>
            {journal.npcs.length > 0 ? (
              <ul className="people">
                {journal.npcs.map((name) => (
                  <li key={name} className="person">
                    <Person id={id} name={name} portrait={journal.portraits.find(({ npc }) => npc === name)} who={journal.npcSummaries[name]} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">No one yet.</p>
            )}
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
              <p>{message.text}</p>
            </div>
          );
        })}
      </div>
    </Book>
  );
}
