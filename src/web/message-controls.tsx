import type { Ref } from "react";
import type { Message } from "./api";
import { ChapterIcon, DuplicateIcon, EditIcon, RegenerateIcon, RevertIcon, RewriteIcon } from "./icons";

/** What a Message's row of tools does. Only the latest response is replaceable, and only once no Turn is running. */
export type MessageActions = {
  replay: (message: Message) => void;
  revert: (message: Message) => void;
  duplicate: (message: Message) => void;
  toggleChapterEnd: () => void;
  rewrite: (message: Message) => void;
  edit: (message: Message) => void;
  regenerate: () => void;
};

/** The tools under one Message. */
export function MessageControls(props: {
  message: Message;
  latest: boolean;
  replaceable: boolean;
  /** Whether there is a Message before it, which an Edit and replay goes back to. */
  replayable: boolean;
  open: { rewrite: boolean; edit: boolean; chapterEnd: boolean };
  rewriteButton: Ref<HTMLButtonElement>;
  actions: MessageActions;
}) {
  const { message, latest, replaceable, replayable, open, rewriteButton, actions } = props;
  return (
    <div className="row actions">
      {message.role === "player" && replayable && (
        <button
          type="button"
          className="icon"
          title="Edit and replay from here"
          aria-label={`Edit and replay from your words: ${message.text.slice(0, 40)}`}
          onClick={() => actions.replay(message)}
        >
          {EditIcon}
        </button>
      )}
      {!latest && (
        <button
          type="button"
          className="icon revert"
          title="Revert to here"
          aria-label={`Revert to this Message: ${message.text.slice(0, 40)}`}
          onClick={() => actions.revert(message)}
        >
          {RevertIcon}
        </button>
      )}
      <button
        type="button"
        className="icon revert"
        title="Duplicate from here"
        aria-label={`Duplicate from this Message: ${message.text.slice(0, 40)}`}
        onClick={() => actions.duplicate(message)}
      >
        {DuplicateIcon}
      </button>
      {latest && (
        <button
          type="button"
          className="icon"
          title="End the chapter here"
          aria-label="End the chapter here"
          aria-expanded={open.chapterEnd}
          onClick={actions.toggleChapterEnd}
        >
          {ChapterIcon}
        </button>
      )}
      {replaceable && (
        <>
          <button
            type="button"
            ref={rewriteButton}
            className="icon"
            title="Rewrite"
            aria-label="Rewrite"
            aria-expanded={open.rewrite}
            onClick={() => actions.rewrite(message)}
          >
            {RewriteIcon}
          </button>
          <button type="button" className="icon" title="Edit" aria-label="Edit" aria-expanded={open.edit} onClick={() => actions.edit(message)}>
            {EditIcon}
          </button>
          <button type="button" className="icon" title="Regenerate" aria-label="Regenerate" onClick={actions.regenerate}>
            {RegenerateIcon}
          </button>
        </>
      )}
    </div>
  );
}
