import { type FormEvent, type ReactNode, useState } from "react";
import { createSave } from "./api";

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

export function BookTabs({ id, current }: { id: string; current: "Story" | "Journal" | "Inventory" }) {
  const here = (tab: typeof current) => (tab === current ? "page" : undefined);
  return (
    <nav className="tabs" aria-label="Book sections">
      <a href={`#/play/${id}`} aria-current={here("Story")}>Story</a>
      <a href={`#/journal/${id}`} aria-current={here("Journal")}>Journal</a>
      <a href={`#/inventory/${id}`} aria-current={here("Inventory")}>Inventory</a>
      <a href="#/settings">Settings</a>
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

export function NewGame() {
  const [worldBrief, setWorldBrief] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function begin(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await createSave({ worldBrief, pc: { name } });
      location.hash = `/play/${id}`;
    } catch (failure) {
      setError((failure as Error).message);
      setBusy(false);
    }
  }

  return (
    <Book
      left={
        <>
          <h1 className="big">New Game</h1>
          <p className="muted">Describe a world, name your PC, and the story starts on the next page.</p>
          <a className="quiet" href="#/">
            Main Menu
          </a>
        </>
      }
    >
      <form className="fields" onSubmit={begin}>
        <label>
          World Brief
          <textarea required rows={5} value={worldBrief} onChange={(e) => setWorldBrief(e.target.value)} />
        </label>
        <label>
          PC name
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {error && <p role="alert" className="error">{error}</p>}
        <button className="action" disabled={busy}>
          Begin
        </button>
      </form>
    </Book>
  );
}

// shortcut: an empty screen behind a menu entry, tickets 13 and 14 replace it.
export function Placeholder({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Book left={<h1 className="big">{title}</h1>}>
      <p>{children}</p>
      <div className="row">
        <button className="quiet" onClick={() => history.back()}>
          Back
        </button>
        <a className="quiet" href="#/">
          Main Menu
        </a>
      </div>
    </Book>
  );
}
