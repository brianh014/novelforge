import { type ChangeEvent, useEffect, useRef, useState } from "react";
import { coverUrl, deleteSave, duplicateSave, importSave, type ListedSave, listSaves, storyName } from "./api";
import { DeleteDialog, Sheet } from "./menu";
import { Zoomable } from "./zoom";

const lastChanged = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

export function LoadStory() {
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
    <Sheet
      rail={
        <>
          <h1 className="big" ref={heading} tabIndex={-1}>Load Story</h1>
          <p className="muted so-far">Pick up a story, branch it, or carry it to another machine.</p>
          <a className="quiet" href="#/">Main Menu</a>
        </>
      }
      foot={
        <>
          <div role="status">{notice && <p className="notice">{notice}</p>}</div>
          {error && <p role="alert" className="error">{error}</p>}
          <div className="row">
            <button className="action" aria-disabled={busy} onClick={() => busy || fileInput.current!.click()}>
              Import a Save
            </button>
            <input ref={fileInput} type="file" accept=".sqlite" hidden onChange={importChosen} />
          </div>
        </>
      }
    >
      {saves?.length === 0 && (
        <p className="muted">
          No Saves yet. <a href="#/new">Start a New Story</a>.
        </p>
      )}
      <ul className="saves">
        {saves?.map((save) => {
          const name = "unreadable" in save ? "Unreadable Save" : storyName(save);
          return (
            <li key={save.id} className={"hasCover" in save && save.hasCover ? "with-cover" : undefined}>
              {"hasCover" in save && save.hasCover && <Zoomable lazy src={coverUrl(save.id, save.coverRedraws)} alt={`Cover of ${name}`} />}
              <p className="title">{name}</p>
              {"title" in save && save.title && <p className="muted">{save.pc.name}</p>}
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
          name={"unreadable" in deleting ? "this unreadable Save" : storyName(deleting)}
          warning="This permanently deletes the whole Save. It can't be undone."
          onDelete={() => deleteSave(deleting.id)}
          onClose={() => setDeleting(undefined)}
          onDeleted={(name) => {
            // The button that opened the dialog went with the Save, and focus must not fall back to the page.
            heading.current!.focus();
            attempt(async () => {}, `Deleted ${name}.`);
          }}
        />
      )}
    </Sheet>
  );
}
