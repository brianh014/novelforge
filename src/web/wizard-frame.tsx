import { useEffect, useRef } from "react";
import { Quilling } from "./icons";

/** Stands in for the page's controls while the Narrator works, so nothing can change under it. */
export function Working({ message, onCancel }: { message: string; onCancel: () => void }) {
  return (
    <div className="working">
      <p role="status" className="waiting drawing">
        <Quilling />
        {message}
      </p>
      <div className="progress" />
      <button type="button" className="quiet" autoFocus onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

export function Heading({ step, title, busy }: { step: number; title: string; busy: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The control that led here is gone, so keyboard and screen reader users would otherwise restart from the top.
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [step, busy]);
  return (
    <>
      <p className="muted">Step {step} of 3</p>
      <h1 ref={heading} tabIndex={-1} className="big">
        {title}
      </h1>
    </>
  );
}

/** Asks before leaving the written world for an earlier step, which discards it. */
export function LeaveWorld({ to, onClose }: { to: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current!.showModal(), []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="leave-title">
      <h2 id="leave-title">Go back and discard this world?</h2>
      <p>Going back discards the generated world, and you'll generate a new one from your changes. Your pictures stay.</p>
      {/* Stay comes first because a modal focuses its first control, and that must not be the discarding one. */}
      <div className="row">
        <button type="button" className="quiet" onClick={() => dialog.current!.close()}>
          Stay
        </button>
        <button
          type="button"
          className="action"
          onClick={() => {
            location.hash = to;
            dialog.current!.close();
          }}
        >
          Go back
        </button>
      </div>
    </dialog>
  );
}

/** Says what Pick for me will do before it writes anything. */
export function PickForMe({ onPick, onClose }: { onPick: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current!.showModal(), []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="pick-title">
      <h2 id="pick-title">Pick for me?</h2>
      <p>The Narrator writes every empty box on this page for you. Boxes you've already filled stay as they are, and Important Characters are left alone.</p>
      <div className="row">
        <button type="button" className="quiet" onClick={() => dialog.current!.close()}>
          Cancel
        </button>
        <button
          type="button"
          className="action"
          onClick={() => {
            onPick();
            dialog.current!.close();
          }}
        >
          Pick for me
        </button>
      </div>
    </dialog>
  );
}
