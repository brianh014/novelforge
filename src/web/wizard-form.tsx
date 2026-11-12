import type { Dispatch, ReactNode, SetStateAction } from "react";
import { Choices } from "./art-style-picker";
import type { Character, EnhanceField, PcDraft, WorldField } from "./api";
import { LONG_TEXT } from "../limits";
import { characterLabel, type Draft, MAX_CHARACTERS, newRef, OWN_THEME, THEMES } from "./wizard-draft";

/** A box's Enhance, or Write when it's empty, with an Undo. `row` is for an Important Character's box. */
export type EnhanceTools = (
  field: EnhanceField,
  label: string,
  value: string,
  write: (text: string) => void,
  row?: { key: string; character: Character },
) => ReactNode;

/** Says why typing stopped, as a full box gives no sign of its own. */
const full = (text: string) => text.length >= LONG_TEXT && <p className="muted">That's the most this box can hold: {LONG_TEXT} characters.</p>;

/** The first step's boxes: the world, the PC, the Important Characters and the Starting Hook. */
export function WorldForm(props: {
  draft: Draft;
  setDraft: Dispatch<SetStateAction<Draft>>;
  setCharacter: (index: number, change: Partial<Character>) => void;
  enhanceTools: EnhanceTools;
  heading: ReactNode;
}) {
  const { draft, setDraft, setCharacter, enhanceTools } = props;
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const setPc = (field: keyof PcDraft, text: string) => setDraft((current) => ({ ...current, pc: { ...current.pc, [field]: text } }));
  const worldTools = (field: WorldField, label: string) => enhanceTools(field, label, draft[field], (text) => set({ [field]: text }));
  const description = THEMES[draft.theme];

  // `short` names the box on its buttons, as a question makes a clumsy one.
  const pcBox = (field: Exclude<keyof PcDraft, "name">, label: string, short: string, rows: number) => (
    <div className="enhanceable">
      <label>
        {label}
        <textarea rows={rows} maxLength={LONG_TEXT} value={draft.pc[field]} onChange={(e) => setPc(field, e.target.value)} />
      </label>
      {full(draft.pc[field])}
      {enhanceTools(field, short, draft.pc[field], (text) => setPc(field, text))}
    </div>
  );

  return (
    <div className="fields wizard">
      <div id="world-choices" className="fields wizard">
        <div>{props.heading}</div>
        <Choices legend="What kind of story is it?" options={[...Object.keys(THEMES), OWN_THEME]} value={draft.theme} onChange={(theme) => set({ theme })} />
        {description && <p className="muted">{description}</p>}
        {draft.theme === OWN_THEME && (
          <label>
            What is your theme?
            <input value={draft.ownTheme} onChange={(e) => set({ ownTheme: e.target.value })} />
          </label>
        )}
        <div className="enhanceable">
          <label>
            What is your story called?
            <input maxLength={80} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          {worldTools("title", "Title")}
        </div>
        <div className="enhanceable">
          <label>
            Describe your world and story
            <textarea rows={3} maxLength={LONG_TEXT} value={draft.worldBrief} onChange={(e) => set({ worldBrief: e.target.value })} />
          </label>
          {full(draft.worldBrief)}
          {worldTools("worldBrief", "World Brief")}
        </div>
      </div>
      <div id="pc" className="fields wizard">
        <div>
          <h2>Your Character</h2>
          <p className="muted">Play whomever you want. What you write is canon, and the world changes if it must.</p>
        </div>
        <div className="enhanceable">
          <label>
            What is your character's name?
            <input value={draft.pc.name} onChange={(e) => setPc("name", e.target.value)} />
          </label>
          {enhanceTools("name", "Name", draft.pc.name, (text) => setPc("name", text))}
        </div>
        {pcBox("background", "Where do they come from, what have they done, and what are they good at?", "Background", 4)}
        {pcBox("physicalTraits", "What do they look like?", "Looks", 3)}
        {pcBox("inventory", "What is your character wearing and carrying?", "Wearing and carrying", 3)}
      </div>
      <div id="characters" className="fields wizard">
        <div>
          <h2>Important Characters</h2>
          <p className="muted">
            People you want in the story besides your PC. Each gets a portrait drawn from their description. Pick for me leaves these alone, so there are only
            those you add.
          </p>
        </div>
        {draft.characters.map((character, index) => {
          const label = characterLabel(character, index);
          const box = (field: "name" | "description", enhanceField: EnhanceField, name: string, input: ReactNode) => (
            <div className="enhanceable">
              {/* biome-ignore lint/a11y/noLabelWithoutControl: `input` is the control, passed in by the caller. */}
              <label>
                {name}
                {input}
              </label>
              {enhanceTools(enhanceField, `${name}: ${label}`, character[field] ?? "", (text) => setCharacter(index, { [field]: text }), {
                key: `${enhanceField}:${character.ref}`,
                character,
              })}
            </div>
          );
          return (
            <fieldset key={character.ref}>
              <legend>{label}</legend>
              {box(
                "name",
                "characterName",
                "Name",
                <input maxLength={80} value={character.name} onChange={(e) => setCharacter(index, { name: e.target.value })} />,
              )}
              {box(
                "description",
                "characterDescription",
                "Description",
                <textarea
                  rows={3}
                  maxLength={LONG_TEXT}
                  value={character.description}
                  onChange={(e) => setCharacter(index, { description: e.target.value })}
                />,
              )}
              {full(character.description)}
              <div className="row">
                <button
                  type="button"
                  className="quiet"
                  aria-label={`Remove ${label}`}
                  onClick={() => set({ characters: draft.characters.filter((_, at) => at !== index) })}
                >
                  Remove
                </button>
              </div>
            </fieldset>
          );
        })}
        <div className="row">
          <button
            type="button"
            className="quiet"
            disabled={draft.characters.length >= MAX_CHARACTERS}
            onClick={() => set({ characters: [...draft.characters, { name: "", description: "", ref: newRef() }] })}
          >
            Add a character
          </button>
          {draft.characters.length >= MAX_CHARACTERS && <span className="muted">That's the most a story can start with.</span>}
        </div>
      </div>
      <div id="hook" className="fields wizard">
        <label className="toggle">
          <input type="checkbox" checked={draft.hookOn} onChange={(e) => set({ hookOn: e.target.checked })} />
          Starting Hook
        </label>
        {draft.hookOn ? (
          <div className="enhanceable">
            <label>
              What opens the story?
              <textarea rows={3} maxLength={LONG_TEXT} value={draft.startingHook} onChange={(e) => set({ startingHook: e.target.value })} />
            </label>
            {full(draft.startingHook)}
            {worldTools("startingHook", "Starting Hook")}
          </div>
        ) : (
          <p className="muted">Your PC just starts in the world, with no immediate hook.</p>
        )}
      </div>
    </div>
  );
}
