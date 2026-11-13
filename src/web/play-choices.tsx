import type { ReactNode } from "react";
import type { PlayMode } from "./api";
import { Choices } from "./art-style-picker";
import { RegenerateIcon } from "./icons";

const LABELS: Record<PlayMode, string> = { free: "Free Text", choices: "Choices" };

/** The Play Mode as chips, for the New Story wizard and Settings. */
export function PlayModePicker(props: { value: PlayMode; intro?: ReactNode; onChange: (playMode: PlayMode) => void }) {
  return (
    <Choices
      legend="How you play"
      intro={props.intro}
      options={Object.values(LABELS)}
      value={LABELS[props.value]}
      onChange={(label) => props.onChange(label === LABELS.choices ? "choices" : "free")}
    />
  );
}

/**
 * The latest response's Choices, in place of the text box. Picking one sends it at once, word for word. A response
 * without any says so, with a Regenerate when it can be replaced.
 */
export function ChoiceButtons(props: { choices?: string[]; onChoose: (choice: string) => void; onRegenerate?: () => void }) {
  if (!props.choices) {
    return (
      <div className="row no-choices">
        <p className="muted">The Narrator gave no choices this time.</p>
        {props.onRegenerate && (
          <button
            type="button"
            className="icon"
            title="Regenerate with Choices"
            aria-label="Regenerate with Choices"
            aria-haspopup="dialog"
            onClick={props.onRegenerate}
          >
            {RegenerateIcon}
          </button>
        )}
      </div>
    );
  }
  return (
    <fieldset className="choices">
      <legend className="visually-hidden">Choices</legend>
      {props.choices.map((choice) => (
        <button key={choice} type="button" className="choice" onClick={() => props.onChoose(choice)}>
          {choice}
        </button>
      ))}
    </fieldset>
  );
}
