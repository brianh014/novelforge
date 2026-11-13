import { type ReactNode, useEffect, useRef, useState } from "react";
import { getSettings, getUpdate, installUpdate, quitApp, type UpdateStatus } from "./api";
import { DownIcon } from "./icons";
import logo from "./logo.svg";

const LEFT_FOLDED = "novelforge-left-folded";

/** One reader's choice, so it stays in their browser and out of the Save. Blocked storage only forgets it. */
export function leftFolded() {
  try {
    return localStorage.getItem(LEFT_FOLDED) === "yes";
  } catch {
    return false;
  }
}

export function rememberLeftFolded(folded: boolean) {
  try {
    localStorage.setItem(LEFT_FOLDED, folded ? "yes" : "no");
  } catch {}
}

export function Book(props: { left: ReactNode; children: ReactNode; tabs?: ReactNode; narrowLeft?: boolean; leftFolded?: boolean; lockLeft?: boolean }) {
  return (
    <main className="desk">
      <div className={`book${props.narrowLeft ? " narrow-left" : ""}${props.leftFolded ? " left-folded" : ""}`}>
        <section className="page left" inert={props.lockLeft}>
          {props.left}
        </section>
        <section className="page right">{props.children}</section>
        {props.tabs}
      </div>
    </main>
  );
}

/** A single sheet for screens of fields: an index down the side, then one scrolling column above a pinned `foot`. */
/** Scrolls its `children`, with a down arrow while any of them are below the fold. */
export function Fold({ children, view }: { children: ReactNode; view?: unknown }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);

  useEffect(() => {
    const area = scroller.current!;
    const check = () => setMore(area.scrollHeight - area.clientHeight - area.scrollTop > 8);
    // Fields, pictures and whole sections change the height without any scrolling.
    const resized = new ResizeObserver(check);
    resized.observe(area);
    resized.observe(area.firstElementChild!);
    area.addEventListener("scroll", check, { passive: true });
    return () => {
      resized.disconnect();
      area.removeEventListener("scroll", check);
    };
  }, []);

  useEffect(() => {
    // Braces matter: scrollTo can return a promise, which React would take for a cleanup function.
    scroller.current!.scrollTo({ top: 0, behavior: "instant" });
  }, [view]);

  return (
    <div className="sheet-view">
      <div ref={scroller} className="sheet-scroll">
        <div className="sheet-body">{children}</div>
      </div>
      {more && <MoreBelow onClick={() => scroller.current!.scrollBy({ top: scroller.current!.clientHeight * 0.8 })} />}
    </div>
  );
}

export function MoreBelow({ onClick }: { onClick: () => void }) {
  return (
    <div className="more-below">
      <button type="button" className="icon" title="More below" aria-label="More below" onClick={onClick}>
        {DownIcon}
      </button>
    </div>
  );
}

/** A single sheet for screens of fields: an index down the side, then one scrolling column above a pinned `foot`. */
/** Without a `rail`, the page takes the whole sheet. */
export function Sheet(props: { rail?: ReactNode; children: ReactNode; foot?: ReactNode; tabs?: ReactNode; lockRail?: boolean; view?: unknown }) {
  return (
    <main className="desk">
      <div className="book sheet">
        {props.rail !== undefined && (
          <aside className="sheet-rail" inert={props.lockRail}>
            {props.rail}
          </aside>
        )}
        <section className="sheet-main">
          <Fold view={props.view}>{props.children}</Fold>
          {props.foot && <div className="sheet-foot">{props.foot}</div>}
        </section>
        {props.tabs}
      </div>
    </main>
  );
}

/** Asks before anything permanent goes. `onDelete` does it, and its failure stays in the dialog. */
export function DeleteDialog(props: {
  name: string;
  warning: string;
  onDelete: () => Promise<unknown>;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => dialog.current!.showModal(), []);

  async function confirmDelete() {
    setBusy(true);
    setError("");
    try {
      await props.onDelete();
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
      <p>{props.warning}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {/* Cancel comes first because a modal focuses its first control, and that must not be the deleting one. */}
      <div className="row">
        <button type="button" className="quiet" onClick={() => dialog.current!.close()}>
          Cancel
        </button>
        <button type="button" className="action" disabled={busy} onClick={confirmDelete}>
          Delete
        </button>
      </div>
    </dialog>
  );
}

/** Asks before one click does something big. `children` say what it does; `confirm` names the button that does it. */
export function ConfirmDialog(props: { title: string; confirm: string; children: ReactNode; onConfirm: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current!.showModal(), []);
  return (
    <dialog ref={dialog} onClose={props.onClose} aria-labelledby="confirm-title">
      <h2 id="confirm-title">{props.title}</h2>
      {props.children}
      {/* Cancel comes first because a modal focuses its first control, and that must not be the one that acts. */}
      <div className="row">
        <button type="button" className="quiet" onClick={() => dialog.current!.close()}>
          Cancel
        </button>
        <button
          type="button"
          className="action"
          onClick={() => {
            dialog.current!.close();
            props.onConfirm();
          }}
        >
          {props.confirm}
        </button>
      </div>
    </dialog>
  );
}

export function BookTabs({ id, current }: { id: string; current: "Story" | "Journal" | "Gallery" | "Settings" }) {
  const here = (tab: typeof current) => (tab === current ? "page" : undefined);
  return (
    <nav className="tabs" aria-label="Book sections">
      <a href={`#/play/${id}`} aria-current={here("Story")}>
        Story
      </a>
      <a href={`#/journal/${id}`} aria-current={here("Journal")}>
        Journal
      </a>
      <a href={`#/gallery/${id}`} aria-current={here("Gallery")}>
        Gallery
      </a>
      <a href={`#/settings/${id}`} aria-current={here("Settings")}>
        Settings
      </a>
      <a href="#/">Menu</a>
    </nav>
  );
}

/** The way back to the main menu, as a ribbon, for screens outside a story. */
export const MenuRibbon = () => (
  <nav className="tabs" aria-label="Book sections">
    <a href="#/">Menu</a>
  </nav>
);

/** A newer release, with an Install that puts it in place, restarts NovelForge and reloads this page as the new version. */
function NewVersion({ status }: { status: UpdateStatus }) {
  const latest = status.latest!;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"" | "Downloading" | "Restarting">("");
  const [error, setError] = useState("");

  async function install() {
    setBusy("Downloading");
    setError("");
    try {
      await installUpdate();
      setBusy("Restarting");
      for (let tries = 0; tries < 120; tries++) {
        await new Promise((done) => setTimeout(done, 1000));
        const now = await getUpdate().catch(() => undefined);
        if (now?.version === latest.version) return location.reload();
      }
      setError("NovelForge hasn't come back. Open it again.");
    } catch (failure) {
      setError((failure as Error).message);
    }
    setBusy("");
  }

  return (
    <div className="notice new-version" role="status">
      <p>
        NovelForge {latest.version} is out.{" "}
        <a href={latest.url} target="_blank" rel="noreferrer">
          What's new
        </a>
      </p>
      {busy ? (
        <p className="muted">{busy}…</p>
      ) : status.installable ? (
        <button type="button" className="action" onClick={() => setAsking(true)}>
          Install
        </button>
      ) : (
        <p className="muted">Download it from its page, or pull it with git if you run NovelForge from source.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {asking && (
        <ConfirmDialog title={`Install NovelForge ${latest.version}?`} confirm="Install" onConfirm={install} onClose={() => setAsking(false)}>
          <p>NovelForge downloads it, restarts and comes back to this page. Your stories and Settings stay as they are.</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

export function Menu() {
  const [canQuit, setCanQuit] = useState(false);
  const [closed, setClosed] = useState(false);
  const [update, setUpdate] = useState<UpdateStatus>();

  useEffect(() => {
    getSettings().then(
      (settings) => setCanQuit(settings.canQuit),
      () => {},
    );
    getUpdate().then(setUpdate, () => {});
  }, []);

  return (
    <Book
      left={
        <div className="brand">
          <img className="logo" src={logo} alt="" width="264" height="197" />
          <h1>NovelForge</h1>
          {/* Each half stays whole, so a wrap falls after the comma. */}
          <p className="muted">
            <span>A choose-your-own visual novel,</span> <span>written as you play.</span>
          </p>
        </div>
      }
    >
      {closed ? (
        <div className="menu">
          <h2>NovelForge has closed</h2>
          <p className="muted">Your stories are saved. Close this tab, and open NovelForge again to keep playing.</p>
        </div>
      ) : (
        <div className="menu">
          <p className="eyebrow" aria-hidden="true">
            Contents
          </p>
          <nav aria-label="Main Menu">
            <a href="#/new">New Story</a>
            <a href="#/load">Load Story</a>
            <a href="#/guide">Reader's Guide</a>
            <a href="#/settings">Settings</a>
            {/* A server gone by now still counts as closed. */}
            {canQuit && (
              <button
                type="button"
                onClick={() =>
                  void quitApp()
                    .catch(() => {})
                    .then(() => setClosed(true))
                }
              >
                Quit
              </button>
            )}
          </nav>
          {update?.latest && <NewVersion status={update} />}
          {update && <p className="muted version">Version {update.version}</p>}
        </div>
      )}
    </Book>
  );
}
