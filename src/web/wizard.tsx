import { type FormEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { ART_STYLES } from "./art-styles";
import {
  createSave,
  generateWorld,
  getImages,
  getJournal,
  getSave,
  getSettings,
  type PcDraft,
  pickForMe,
  pickPc,
  type Portrait,
  portraitUrl,
  regenerateWorld,
  setupProblem,
  type PickField,
  type WorldChoices,
  worldCoverUrl,
} from "./api";
import { Book } from "./menu";
import { IMAGE_CHECK_MS } from "./play";
import { Zoomable } from "./zoom";

const THEMES = [
  "Fantasy",
  "Cyberpunk",
  "Sci Fi Fantasy",
  "Sci Fi",
  "Modern Day",
  "Steampunk",
  "Realistic medieval",
  "Western",
];
const OWN_THEME = "Create your own";

const OWN_ART_STYLE = "Describe your own art style";

const blank = {
  theme: THEMES[0]!,
  ownTheme: "",
  worldBrief: "",
  hookOn: true,
  startingHook: "",
  artStyle: Object.keys(ART_STYLES)[0]!,
  ownArtStyle: "",
  pc: { name: "", background: "", physicalTraits: "", skills: "", other: "", inventory: "" } as PcDraft,
  /** The choices that made this world, as the form can change after it was generated. */
  world: undefined as { id: string; overview: string; choices: WorldChoices; coverVersion: number } | undefined,
};

const STORAGE_KEY = "novelforge-new-game";

// Kept for the tab, so a reload or a trip to Settings to fix a failure doesn't lose what the player wrote. It only ever holds player-facing text.
const stored = () => ({ ...blank, ...(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<typeof blank>) });

function Choices(props: { legend: string; options: string[]; value: string; art?: boolean; onChange: (value: string) => void }) {
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
            {option}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** The story's cover, which is still being painted when this step opens, and never comes if images are off or it fails. */
function CoverArt({ src }: { src: string }) {
  const [state, setState] = useState<"painting" | "done" | "none">("painting");
  if (state === "none") return null;
  return (
    <>
      {state === "painting" && <p className="waiting">The cover is being painted…</p>}
      <figure className="plate cover" hidden={state !== "done"}>
        <Zoomable src={src} alt="The cover of your story" onLoad={() => setState("done")} onError={() => setState("none")} />
      </figure>
    </>
  );
}

/** Stands in for the page's controls while the Narrator works, so nothing can change under it. */
function Working({ message, onCancel }: { message: string; onCancel: () => void }) {
  return (
    <div className="working">
      <p role="status" className="waiting">{message}</p>
      <div className="progress" />
      <button type="button" className="quiet" autoFocus onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function Heading({ step, title, busy }: { step: number; title: string; busy: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The control that led here is gone, so keyboard and screen reader users would otherwise restart from the top.
  useEffect(() => {
    if (!busy) heading.current?.focus();
  }, [step, busy]);
  return (
    <>
      <p className="muted">Step {step} of 3</p>
      <h1 ref={heading} tabIndex={-1} className="big">{title}</h1>
    </>
  );
}

/** Steps live in the hash like screens, so the browser's back button walks them. `step` is the part after `#/new/`. */
export function NewGame({ step }: { step?: string }) {
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [setupNotice, setSetupNotice] = useState<string>();
  const set = (change: Partial<typeof blank>) => setDraft((current) => ({ ...current, ...change }));
  const running = useRef<AbortController>(undefined);

  useEffect(() => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft)), [draft]);
  // Otherwise a world finishing later would pull the player back here from wherever they went.
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => setError(""), [step]);
  useEffect(() => {
    getSettings().then((settings) => setSetupNotice(setupProblem(settings)), () => {});
  }, []);

  const theme = draft.theme === OWN_THEME ? draft.ownTheme.trim() : draft.theme;
  const artStyle = draft.artStyle === OWN_ART_STYLE ? draft.ownArtStyle : `${draft.artStyle}: ${ART_STYLES[draft.artStyle]}`;

  /** A failure changes nothing here, so everything the player wrote stays on the page to retry. */
  async function run(waiting: string, work: (signal: AbortSignal) => Promise<void>) {
    if (busy) return;
    const controller = new AbortController();
    running.current = controller;
    setBusy(waiting);
    setError("");
    try {
      await work(controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message);
    }
    setBusy("");
  }

  const pick = (field: PickField) =>
    run("The Narrator is thinking…", async (signal) => {
      set({ [field]: await pickForMe(field, theme, draft.worldBrief, signal) });
    });

  function generate(event: FormEvent) {
    event.preventDefault();
    const choices = { theme, worldBrief: draft.worldBrief, startingHook: draft.hookOn ? draft.startingHook : "", artStyle };
    // `required` accepts spaces, and a Starting Hook of spaces would quietly become a sandbox start.
    if (!theme || !draft.worldBrief.trim() || (draft.hookOn && !draft.startingHook.trim())) {
      return setError("Fill in each box with some words, use Pick for me, or turn the Starting Hook off.");
    }
    return run("The Narrator is building the world. This can take a few minutes.", async (signal) => {
      set({ world: { ...(await generateWorld(choices, signal)), choices, coverVersion: 0 } });
      location.hash = "/new/overview";
    });
  }

  const feedback = (
    <>
      {setupNotice && (
        <p className="notice">
          {setupNotice} The Narrator can't write the world until then. <a href="#/settings">Open Settings</a>
        </p>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </>
  );

  const open = (left: ReactNode, right: ReactNode) => (
    <Book lockLeft={!!busy} left={left}>
      {busy ? <Working message={busy} onCancel={() => running.current?.abort()} /> : right}
    </Book>
  );

  const pickButton = (field: PickField) => (
    <div className="row">
      {draft[field] && <span className="muted">Clear the box to pick again.</span>}
      <button
        type="button"
        className="quiet"
        disabled={!!busy || !!draft[field] || !theme}
        aria-label={`Pick for me: ${field === "worldBrief" ? "World Brief" : "Starting Hook"}`}
        onClick={() => pick(field)}
      >
        Pick for me
      </button>
    </div>
  );

  const { world } = draft;

  if (world && step === "overview") {
    const regenerate = () =>
      run("The Narrator is rebuilding the world. This can take a few minutes.", async (signal) => {
        const { overview } = await regenerateWorld(world.id, world.choices, signal);
        set({ world: { ...world, overview, coverVersion: world.coverVersion + 1 } });
      });
    return open(
      <>
        <Heading step={2} title="The World Overview" busy={!!busy} />
        <p className="muted">What your PC would know. Accept this world, or have the Narrator make another.</p>
        <CoverArt key={world.coverVersion} src={worldCoverUrl(world.id, world.coverVersion)} />
        <a className="quiet" href="#/new">Back to your choices</a>
      </>,
      <>
        <div className="overview">
          <p>{world.overview}</p>
        </div>
        {feedback}
        <div className="row">
          <button type="button" className="quiet" onClick={regenerate}>
            Regenerate
          </button>
          <a className="action" href="#/new/pc">
            Accept
          </a>
        </div>
      </>,
    );
  }

  if (world && step === "pc") {
    const setPc = (field: keyof PcDraft, text: string) =>
      setDraft((current) => ({ ...current, pc: { ...current.pc, [field]: text } }));

    const fillPc = () =>
      run("The Narrator is thinking…", async (signal) => {
        const picked = await pickPc(world.choices, draft.pc, signal);
        setDraft((current) => ({ ...current, pc: { ...current.pc, ...picked } }));
      });

    const box = (field: keyof PcDraft, label: string, rows: number) => (
      <label>
        {label}
        <textarea form="pc" rows={rows} value={draft.pc[field]} onChange={(e) => setPc(field, e.target.value)} />
      </label>
    );

    const begin = (event: FormEvent) => {
      event.preventDefault();
      // `required` accepts spaces.
      if (!draft.pc.name.trim()) return setError("Give your PC a name, or use Pick for me.");
      const { inventory, ...pc } = draft.pc;
      const items = inventory.split("\n").map((item) => item.trim()).filter(Boolean);
      const { worldBrief, startingHook } = world.choices;
      return run("The Narrator is fitting your PC into the world. This can take a few minutes.", async (signal) => {
        const { id, worldChanged } = await createSave(
          { worldId: world.id, worldBrief, startingHook, artStyle, pc, inventory: items },
          signal,
        );
        sessionStorage.removeItem(STORAGE_KEY);
        location.hash = `/new/ready/${id}${worldChanged ? "/world-changed" : ""}`;
      });
    };
    return open(
      <>
        <Heading step={3} title="Of the PC" busy={!!busy} />
        <p className="muted">Play whomever you want. What you write is canon, and the world changes if it must.</p>
        <div className="fields wizard">
          <label>
            PC name
            <input form="pc" required value={draft.pc.name} onChange={(e) => setPc("name", e.target.value)} />
          </label>
          {box("background", "Background", 3)}
          {box("physicalTraits", "Physical traits", 3)}
          <div className="row">
            <span className="muted">Fills only the empty boxes.</span>
            <button
              type="button"
              className="quiet"
              disabled={Object.values(draft.pc).every((text) => text.trim())}
              onClick={fillPc}
            >
              Pick for me
            </button>
          </div>
        </div>
        <a className="quiet" href="#/new/overview">Back to the World Overview</a>
      </>,
      <form id="pc" className="fields wizard" onSubmit={begin}>
        {box("skills", "Skills and experience", 3)}
        {box("inventory", "Starting inventory, one item per line", 4)}
        {box("other", "Anything else", 2)}
        {feedback}
        <button className="action">{error ? "Try again" : "Begin"}</button>
      </form>,
    );
  }

  return open(
    <>
      <Heading step={1} title="Of the World" busy={!!busy} />
      <div className="fields wizard">
        <Choices
          legend="Theme"
          options={[...THEMES, OWN_THEME]}
          value={draft.theme}
          onChange={(theme) => set({ theme })}
        />
        {draft.theme === OWN_THEME && (
          <label>
            Your theme
            <input form="world" required value={draft.ownTheme} onChange={(e) => set({ ownTheme: e.target.value })} />
          </label>
        )}
        <div>
          <label>
            World Brief
            <textarea
              form="world"
              required
              rows={4}
              value={draft.worldBrief}
              onChange={(e) => set({ worldBrief: e.target.value })}
            />
          </label>
          {pickButton("worldBrief")}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={draft.hookOn} onChange={(e) => set({ hookOn: e.target.checked })} />
          Starting Hook
        </label>
        {draft.hookOn ? (
          <div>
            <label>
              What opens the story?
              <textarea
                form="world"
                required
                rows={3}
                value={draft.startingHook}
                onChange={(e) => set({ startingHook: e.target.value })}
              />
            </label>
            {pickButton("startingHook")}
          </div>
        ) : (
          <p className="muted">Your PC just starts in the world, with no immediate hook.</p>
        )}
      </div>
      <a className="quiet" href="#/">Main Menu</a>
    </>,
    <form id="world" className="fields wizard" onSubmit={generate}>
      <Choices
        legend="Art Style"
        art
        options={[...Object.keys(ART_STYLES), OWN_ART_STYLE]}
        value={draft.artStyle}
        onChange={(artStyle) => set({ artStyle })}
      />
      {draft.artStyle === OWN_ART_STYLE ? (
        <label>
          Your Art Style
          <textarea required rows={3} value={draft.ownArtStyle} onChange={(e) => set({ ownArtStyle: e.target.value })} />
        </label>
      ) : (
        <p className="muted">{ART_STYLES[draft.artStyle]}</p>
      )}
      <p className="muted">You can change this in game. It affects new images only.</p>
      {feedback}
      <button className="action">{error ? "Try again" : "Generate the world"}</button>
    </form>,
  );
}

/** The finished PC, whose portrait starts drawing as the Save is made. */
export function Reveal({ id, worldChanged }: { id: string; worldChanged: boolean }) {
  const [name, setName] = useState("");
  const [portrait, setPortrait] = useState<Portrait>();
  const [drawing, setDrawing] = useState(true);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let leaving = false;
    const look = () =>
      getImages(id).then(async ({ pending }) => {
        if (leaving) return;
        if (pending) {
          timer = setTimeout(look, IMAGE_CHECK_MS);
          return;
        }
        const { portraits } = await getJournal(id);
        setPortrait(portraits.find(({ npc }) => npc === null));
        setDrawing(false);
      }, () => setDrawing(false));
    getSave(id).then(({ pc }) => setName(pc.name), () => {});
    look();
    return () => {
      leaving = true;
      clearTimeout(timer);
    };
  }, [id]);

  return (
    <Book
      left={
        <>
          <h1 className="big">{name}</h1>
          <p className="muted">Your story is ready.</p>
          {drawing && <p role="status" className="waiting">Your portrait is being painted…</p>}
          <a className="action begin" href={`#/play/${id}${worldChanged ? "/world-changed" : ""}`}>
            Open the book
          </a>
        </>
      }
    >
      {portrait && (
        <figure className="plate reveal">
          <Zoomable src={portraitUrl(id, portrait)} alt={`Portrait of ${name}`} />
        </figure>
      )}
    </Book>
  );
}
