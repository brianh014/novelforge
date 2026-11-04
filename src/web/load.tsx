import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { coverUrl, deleteSave, duplicateSave, importSave, type ListedSave, listSaves } from "./api";
import { Book } from "./menu";
import { Zoomable } from "./zoom";

const lastChanged = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function LoadGame() {
  const [saves, setSaves] = useState<ListedSave[]>();
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ListedSave>();
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    listSaves().then(setSaves, (failure: Error) => setError(failure.message));
  }, []);

  async function attempt(action: () => Promise<unknown>, done: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setSaves(await listSaves());
      setNotice(done);
    } catch (failure) {
      setError((failure as Error).message);
    }
    setBusy(false);
  }

  function importChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same file again still fires a change.
    event.target.value = "";
    if (file) attempt(() => importSave(file), `Imported ${file.name}.`);
  }

  return (
    <Book
      left={
        <>
          <h1 className="big" ref={heading} tabIndex={-1}>Load Game</h1>
          <p className="muted">Pick up a story, branch it, or carry it to another machine.</p>
          <button className="action import" aria-disabled={busy} onClick={() => busy || fileInput.current!.click()}>
            Import a Save
          </button>
          <input ref={fileInput} type="file" accept=".sqlite" hidden onChange={importChosen} />
          <a className="quiet" href="#/">Main Menu</a>
        </>
      }
    >
      <div role="status">{notice && <p className="notice">{notice}</p>}</div>
      {error && <p role="alert" className="error">{error}</p>}
      {saves?.length === 0 && (
        <p className="muted">
          No Saves yet. <a href="#/new">Start a New Game</a>.
        </p>
      )}
      <ul className="saves">
        {saves?.map((save) => {
          const name = "unreadable" in save ? "Unreadable Save" : save.pc.name;
          return (
            <li key={save.id} className={"hasCover" in save && save.hasCover ? "with-cover" : undefined}>
              {"hasCover" in save && save.hasCover && <Zoomable lazy src={coverUrl(save.id)} alt={`Cover of ${name}'s story`} />}
              <p className="title">{("title" in save && save.title) || name}</p>
              {"title" in save && save.title && <p className="muted">{name}</p>}
              {"unreadable" in save ? (
                <p className="muted">This file can't be opened. A newer version of NovelForge may have made it.</p>
              ) : (
                <p className="brief">{save.worldBrief}</p>
              )}
              <p className="muted">Last changed {lastChanged.format(save.updatedAt)}</p>
              <div className="row">
                {!("unreadable" in save) && (
                  <>
                    <a className="action" href={`#/play/${save.id}`} aria-label={`Load ${name}`}>
                      Load
                    </a>
                    <button
                      className="quiet"
                      aria-label={`Duplicate ${name}`}
                      aria-disabled={busy}
                      onClick={() => attempt(() => duplicateSave(save.id), `Duplicated ${name}.`)}
                    >
                      Duplicate
                    </button>
                    <a className="quiet" href={`/saves/${save.id}/export`} download aria-label={`Export ${name}`}>
                      Export
                    </a>
                  </>
                )}
                <button
                  className="quiet"
                  aria-label={`Delete ${name}`}
                  aria-haspopup="dialog"
                  onClick={() => setDeleting(save)}
                >
                  Delete
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {deleting && (
        <DeleteDialog
          id={deleting.id}
          name={"unreadable" in deleting ? "this unreadable Save" : deleting.pc.name}
          onClose={() => setDeleting(undefined)}
          onDeleted={(name) => {
            // The button that opened the dialog went with the Save, and focus must not fall back to the page.
            heading.current!.focus();
            attempt(async () => {}, `Deleted ${name}.`);
          }}
        />
      )}
    </Book>
  );
}

function DeleteDialog(props: { id: string; name: string; onClose: () => void; onDeleted: (name: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => dialog.current!.showModal(), []);

  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await deleteSave(props.id);
      // Gone if the player pressed Escape while this was in flight, and the delete happened all the same.
      dialog.current?.close();
      props.onDeleted(props.name);
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  return (
    <dialog ref={dialog} onClose={props.onClose} aria-labelledby="delete-title">
      <h2 id="delete-title">Delete {props.name}?</h2>
      <p>This permanently deletes the whole Save. It can't be undone.</p>
      {error && <p role="alert" className="error">{error}</p>}
      {/* Cancel comes first because a modal focuses its first control, and that must not be the deleting one. */}
      <div className="row">
        <button className="quiet" onClick={() => dialog.current!.close()}>
          Cancel
        </button>
        <button className="action" disabled={busy} onClick={confirmDelete}>
          Delete
        </button>
      </div>
    </dialog>
  );
}
