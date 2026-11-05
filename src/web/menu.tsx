import { type ReactNode, useEffect, useRef, useState } from "react";
import { DownIcon } from "./icons";

export function Book(props: { left: ReactNode; children: ReactNode; tabs?: ReactNode; narrowLeft?: boolean; lockLeft?: boolean }) {
  return (
    <main className="desk">
      <div className={props.narrowLeft ? "book narrow-left" : "book"}>
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
      {more && (
        <div className="more-below">
          <button
            type="button"
            className="icon"
            title="More below"
            aria-label="More below"
            onClick={() => scroller.current!.scrollBy({ top: scroller.current!.clientHeight * 0.8 })}
          >
            {DownIcon}
          </button>
        </div>
      )}
    </div>
  );
}

/** A single sheet for screens of fields: an index down the side, then one scrolling column above a pinned `foot`. */
export function Sheet(props: { rail: ReactNode; children: ReactNode; foot?: ReactNode; tabs?: ReactNode; lockRail?: boolean; view?: unknown }) {
  return (
    <main className="desk">
      <div className="book sheet">
        <aside className="sheet-rail" inert={props.lockRail}>{props.rail}</aside>
        <section className="sheet-main">
          <Fold view={props.view}>{props.children}</Fold>
          {props.foot && <div className="sheet-foot">{props.foot}</div>}
        </section>
        {props.tabs}
      </div>
    </main>
  );
}

export function BookTabs({ id, current }: { id: string; current: "Story" | "Journal" | "Gallery" | "Inventory" | "Settings" }) {
  const here = (tab: typeof current) => (tab === current ? "page" : undefined);
  return (
    <nav className="tabs" aria-label="Book sections">
      <a href={`#/play/${id}`} aria-current={here("Story")}>Story</a>
      <a href={`#/journal/${id}`} aria-current={here("Journal")}>Journal</a>
      <a href={`#/gallery/${id}`} aria-current={here("Gallery")}>Gallery</a>
      <a href={`#/inventory/${id}`} aria-current={here("Inventory")}>Inventory</a>
      <a href={`#/settings/${id}`} aria-current={here("Settings")}>Settings</a>
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
        <a href="#/new">New Game</a>
        <a href="#/load">Load Game</a>
        <a href="#/settings">Settings</a>
      </nav>
    </Book>
  );
}
