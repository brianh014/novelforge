import { type FormEvent, useEffect, useRef, useState } from "react";
import { getInventory, getSave, getStatus, type Inventory as Items, type Save, type Status, statusWords } from "./api";
import { Book, BookTabs } from "./menu";
import { playItemAction, sendOnEnter } from "./play";

export function Inventory({ id }: { id: string }) {
  const [save, setSave] = useState<Save>();
  const [inventory, setInventory] = useState<Items>();
  const [status, setStatus] = useState<Status>();
  const [loadError, setLoadError] = useState("");
  // By position, because the PC can hold two of the same item.
  const [chosen, setChosen] = useState<{ slot: keyof Items; index: number }>();
  const [action, setAction] = useState("");
  const opener = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    Promise.all([getSave(id), getInventory(id), getStatus(id)]).then(([save, inventory, status]) => {
      setSave(save);
      setInventory(inventory);
      setStatus(status);
    }, (failure: Error) => setLoadError(failure.message));
  }, [id]);

  function send(event: FormEvent) {
    event.preventDefault();
    // Naming the item, because the player's text often only says "it".
    if (action.trim()) playItemAction(id, `${item}: ${action}`);
  }

  function cancel() {
    setChosen(undefined);
    setAction("");
    opener.current?.focus();
  }

  if (loadError) {
    return (
      <Book left={<h1 className="big">Inventory</h1>}>
        <p role="alert" className="error">{loadError}</p>
        <a className="quiet" href="#/">Main Menu</a>
      </Book>
    );
  }
  if (!save || !inventory || !status) return <Book left={null}>{null}</Book>;
  const item = chosen && inventory[chosen.slot][chosen.index];

  const list = (slot: keyof Items, empty: string) => (
    <ul className="items">
      {inventory[slot].length === 0 && <li><p className="muted">{empty}</p></li>}
      {inventory[slot].map((name, index) => {
        const current = chosen?.slot === slot && chosen.index === index;
        return (
          <li key={index}>
            <button
              aria-label={`Use ${name}`}
              aria-current={current || undefined}
              onClick={(event) => {
                opener.current = event.currentTarget;
                if (current) return;
                setChosen({ slot, index });
                setAction("");
              }}
            >
              {name}
            </button>
          </li>
        );
      })}
    </ul>
  );

  return (
    <Book
      left={
        <>
          <h1 className="big">Inventory</h1>
          <div>
            <p className="title">{save.pc.name}</p>
            <p className="status">{statusWords(status)}</p>
          </div>
          <h2>Wearing</h2>
          {list("wearing", "Nothing worn.")}
        </>
      }
      tabs={<BookTabs id={id} current="Inventory" />}
    >
      <h2>Carrying</h2>
      {list("carrying", "Nothing carried.")}
      {chosen && (
        <form className="ask" onSubmit={send}>
          <label>
            {item}: what does {save.pc.name} do with it?
            <textarea
              key={`${chosen.slot}-${chosen.index}`}
              autoFocus
              rows={2}
              value={action}
              onChange={(e) => setAction(e.target.value)}
              onKeyDown={sendOnEnter}
            />
          </label>
          <div className="row">
            <button type="button" className="quiet" onClick={cancel}>
              Cancel
            </button>
            <button className="action" aria-disabled={!action.trim()}>
              Send to the story
            </button>
          </div>
        </form>
      )}
    </Book>
  );
}
