import { type ReactNode, useEffect, useRef, useState } from "react";
import { DownIcon } from "./icons";

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
        <section className="page left" inert={props.lockLeft}>{props.left}</section>
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
        {props.rail !== undefined && <aside className="sheet-rail" inert={props.lockRail}>{props.rail}</aside>}
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
export function DeleteDialog(props: { name: string; warning: string; onDelete: () => Promise<unknown>; onClose: () => void; onDeleted: (name: string) => void }) {
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

export function BookTabs({ id, current }: { id: string; current: "Story" | "Journal" | "Gallery" | "Settings" }) {
  const here = (tab: typeof current) => (tab === current ? "page" : undefined);
  return (
    <nav className="tabs" aria-label="Book sections">
      <a href={`#/play/${id}`} aria-current={here("Story")}>Story</a>
      <a href={`#/journal/${id}`} aria-current={here("Journal")}>Journal</a>
      <a href={`#/gallery/${id}`} aria-current={here("Gallery")}>Gallery</a>
      <a href={`#/settings/${id}`} aria-current={here("Settings")}>Settings</a>
      <a href="#/">Menu</a>
    </nav>
  );
}

export function Menu() {
  return (
    <Book
      left={
        <>
          <h1 className="big">NovelForge</h1>
          <p className="muted">A choose-your-own visual novel, written as you play.</p>
        </>
      }
    >
      <nav className="menu" aria-label="Main Menu">
        <a href="#/new">New Story</a>
        <a href="#/load">Load Story</a>
        <a href="#/settings">Settings</a>
      </nav>
    </Book>
  );
}
