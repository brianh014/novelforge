import { type FormEvent, type KeyboardEvent, type RefObject, useState } from "react";
import { askNarrator, closeChapter, requestImage } from "./api";
import { Quilling } from "./icons";

export function sendOnEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form!.requestSubmit();
}

/** Feedback for a Rewrite, or the response's own words for an Edit. */
export function FeedbackForm(props: {
  editing: boolean;
  feedback: string;
  onFeedback: (text: string) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const { editing, feedback } = props;
  return (
    <form className="ask" onSubmit={props.onSubmit}>
      <label>
        {editing ? "Edit the response" : "What should the Narrator change?"}
        <textarea
          autoFocus
          rows={editing ? 10 : 2}
          value={feedback}
          onChange={(e) => props.onFeedback(e.target.value)}
          // An Edit is many lines long, so Enter makes a new line.
          onKeyDown={editing ? undefined : sendOnEnter}
        />
      </label>
      <div className="row">
        <button type="button" className="quiet" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" className="action" aria-disabled={!feedback.trim()}>
          {editing ? "Save the edit" : "Rewrite the response"}
        </button>
      </div>
    </form>
  );
}

/**
 * Asks for a picture of the moment. `words` stay with the page, as a failed picture puts its words back, and so does
 * `drawing`, which a Cancel and reopen while the first is sent must not reset.
 */
export function PictureForm(props: {
  id: string;
  words: string;
  onWords: (words: string) => void;
  onDrawn: () => void;
  onCancel: () => void;
  onError: (error: string) => void;
  drawing: RefObject<boolean>;
}) {
  const { drawing } = props;

  async function draw(event: FormEvent) {
    event.preventDefault();
    // A second Enter or click while the first is sent would pay for a second picture.
    if (drawing.current) return;
    drawing.current = true;
    props.onError("");
    try {
      await requestImage(props.id, props.words);
      props.onDrawn();
    } catch (failure) {
      props.onError((failure as Error).message);
    } finally {
      drawing.current = false;
    }
  }

  return (
    <form className="ask" onSubmit={draw}>
      <label>
        What should the picture show?
        <textarea
          autoFocus
          rows={2}
          maxLength={300}
          placeholder="Describe what you want or leave blank to draw the current scene"
          value={props.words}
          onChange={(e) => props.onWords(e.target.value)}
          onKeyDown={sendOnEnter}
        />
      </label>
      <div className="row">
        <button type="button" className="quiet" onClick={props.onCancel}>
          Cancel
        </button>
        <button type="submit" className="action">
          Draw
        </button>
      </div>
    </form>
  );
}

/** Ask the Narrator's field, and its one answer, which go when the field closes or a Turn is sent. */
export function QuestionForm(props: { id: string; pc: string; signal: AbortSignal; onClose: () => void; onError: (error: string) => void }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [wondering, setWondering] = useState(false);

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (wondering || !question.trim()) return;
    props.onError("");
    setWondering(true);
    try {
      setAnswer(await askNarrator(props.id, question, props.signal));
    } catch (failure) {
      if (!props.signal.aborted) props.onError((failure as Error).message);
    }
    setWondering(false);
  }

  return (
    <form className="ask" onSubmit={ask}>
      <label>
        What do you ask the Narrator?
        <textarea
          autoFocus
          rows={2}
          maxLength={1000}
          placeholder={`What would ${props.pc} know about this place?`}
          value={question}
          readOnly={wondering}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={sendOnEnter}
        />
      </label>
      {(wondering || answer) && (
        <p role="status" className="answer">
          {wondering ? (
            <span className="waiting drawing">
              <Quilling />
              The Narrator is thinking…
            </span>
          ) : (
            answer
          )}
        </p>
      )}
      <div className="row">
        <button type="button" className="quiet" onClick={props.onClose}>
          {answer ? "Close" : "Cancel"}
        </button>
        <button type="submit" className="action" aria-disabled={wondering || !question.trim()}>
          Ask
        </button>
      </div>
    </form>
  );
}

/** Ending the chapter, when the player asked to from the latest Message or the Narrator offered it. Nothing shows while a Turn runs. */
export function ChapterEnd(props: {
  id: string;
  asked: boolean;
  offered: boolean;
  turnRunning: boolean;
  onCancel: () => void;
  onDismissOffer: () => void;
  onEnded: () => void;
  onError: (error: string) => void;
}) {
  const [closing, setClosing] = useState(false);

  async function end() {
    setClosing(true);
    try {
      await closeChapter(props.id);
      props.onEnded();
    } catch (failure) {
      props.onError((failure as Error).message);
    } finally {
      setClosing(false);
    }
  }

  if (closing) {
    return (
      <p role="status" className="waiting drawing">
        <Quilling />
        Ending the chapter…
      </p>
    );
  }
  if (props.turnRunning) return null;
  if (props.asked) {
    return (
      <div className="ask">
        <p>End this chapter after the latest Message? The Narrator gives it a title, and the next Turn starts a new chapter.</p>
        <div className="row">
          <button type="button" className="quiet" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="button" className="action" onClick={end}>
            End the chapter
          </button>
        </div>
      </div>
    );
  }
  return (
    props.offered && (
      <div className="notice dismissable">
        <p>This feels like the end of a chapter.</p>
        <button type="button" className="quiet chapter-end" onClick={end}>
          End the chapter
        </button>
        <button type="button" className="quiet" aria-label="Keep the chapter going" onClick={props.onDismissOffer}>
          ×
        </button>
      </div>
    )
  );
}
