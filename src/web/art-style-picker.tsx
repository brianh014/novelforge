import { useEffect, useState } from "react";
import { drawingFamily } from "../graph-builder";
import { getSettings, type Settings, SETTINGS_SAVED } from "./api";
import { ART_EXAMPLES, QWEN_ART_EXAMPLES } from "./art-examples";
import { ART_STYLES, artStyleFor } from "./art-styles";

export const OWN_ART_STYLE = "Describe your own art style";

/** What a Save stores: a named style with its description, or the player's own words. */
export const artStyleText = (name: string, own: string) => (name === OWN_ART_STYLE ? own : `${name}: ${ART_STYLES[name]}`);

/** Which named style a Save's text is. Anything else, such as a style whose description has since changed, is the player's own. */
export function readArtStyle(text: string) {
  const name = Object.keys(ART_STYLES).find((style) => text.trim() === artStyleText(style, ""));
  return name ? { name, own: "" } : { name: OWN_ART_STYLE, own: text };
}

/** Radio buttons drawn as chips, with each option's example image when `art` gives them. */
export function Choices(props: { legend: string; options: string[]; value: string; art?: Record<string, string>; onChange: (value: string) => void }) {
  return (
    <fieldset>
      <legend>{props.legend}</legend>
      <div className={props.art ? "chips art" : "chips"}>
        {props.options.map((option) => (
          <label key={option}>
            <input
              className="visually-hidden"
              type="radio"
              name={props.legend}
              checked={props.value === option}
              onChange={() => props.onChange(option)}
            />
            {props.art &&
              (props.art[option] ? <img src={props.art[option]} alt="" /> : <span className="no-example" aria-hidden="true">No example</span>)}
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Every Art Style with its example, shown as the family in Settings draws it. A family without examples of its own shows FLUX.2's. */
export function ArtStylePicker(props: { name: string; own: string; onName: (name: string) => void; onOwn: (own: string) => void }) {
  const [family, setFamily] = useState<ReturnType<typeof drawingFamily>>(null);
  useEffect(() => {
    const follow = (settings: Settings) => setFamily(drawingFamily(settings));
    const saved = (event: Event) => follow((event as CustomEvent<Settings>).detail);
    getSettings().then(follow, () => {});
    // The story's Settings tab stays mounted while the player switches models on another tab.
    addEventListener(SETTINGS_SAVED, saved);
    return () => removeEventListener(SETTINGS_SAVED, saved);
  }, []);

  return (
    <>
      <Choices
        legend="Art Style"
        art={family === "qwen21" ? QWEN_ART_EXAMPLES : ART_EXAMPLES}
        options={[...Object.keys(ART_STYLES), OWN_ART_STYLE]}
        value={props.name}
        onChange={props.onName}
      />
      {props.name === OWN_ART_STYLE ? (
        <label>
          Your Art Style
          <textarea rows={3} value={props.own} onChange={(e) => props.onOwn(e.target.value)} />
        </label>
      ) : (
        // The wording this family gets, which differs from the shared one only for a style tuned for it.
        <p className="muted">{artStyleFor(artStyleText(props.name, ""), family).slice(props.name.length + 2)}</p>
      )}
    </>
  );
}
