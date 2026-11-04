import { useEffect, useState } from "react";
import { getImages, getJournal, getSave, type Journal as JournalContent, type Save, type SceneImageInfo } from "./api";
import { Book, BookTabs } from "./menu";
import { SceneImage } from "./play";

export function Journal({ id }: { id: string }) {
  const [save, setSave] = useState<Save>();
  const [journal, setJournal] = useState<JournalContent>();
  const [images, setImages] = useState<SceneImageInfo[]>([]);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    Promise.all([getSave(id), getJournal(id), getImages(id)]).then(([save, journal, { images }]) => {
      setSave(save);
      setJournal(journal);
      setImages(images);
    }, (failure: Error) => setLoadError(failure.message));
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

  return (
    <Book
      left={
        <>
          <h1 className="big">Journal</h1>
          <div className="journal">
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
              <ul>{journal.npcs.map((name) => <li key={name}>{name}</li>)}</ul>
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
        {journal.fullLog.length === 0 && <p className="muted">The page is blank.</p>}
        {journal.fullLog.map((message) => {
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
