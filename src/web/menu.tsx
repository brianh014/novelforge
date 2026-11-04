import type { ReactNode } from "react";

export function Book(props: { left: ReactNode; children: ReactNode; tabs?: ReactNode; narrowLeft?: boolean }) {
  return (
    <main className="desk">
      <div className={props.narrowLeft ? "book narrow-left" : "book"}>
        <section className="page left">{props.left}</section>
        <section className="page right">{props.children}</section>
        {props.tabs}
      </div>
    </main>
  );
}

export function BookTabs({ id, current }: { id: string; current: "Story" | "Journal" | "Inventory" | "Settings" }) {
  const here = (tab: typeof current) => (tab === current ? "page" : undefined);
  return (
    <nav className="tabs" aria-label="Book sections">
      <a href={`#/play/${id}`} aria-current={here("Story")}>Story</a>
      <a href={`#/journal/${id}`} aria-current={here("Journal")}>Journal</a>
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
