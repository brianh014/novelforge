import { type FormEvent, Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { ART_EXAMPLES } from "./art-examples";
import { ART_STYLES } from "./art-styles";
import {
  createSave,
  type EnhanceField,
  enhance,
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
  type WorldChoices,
  type WorldField,
  worldCoverUrl,
} from "./api";
import { DecideIcon } from "./icons";
import { Book, Sheet } from "./menu";
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
const STEPS = [
  { href: "#/new", name: "Of the World" },
  { href: "#/new/overview", name: "The World Overview" },
  { href: "#/new/pc", name: "Of the PC" },
];

const OWN_THEME = "Create your own";

const OWN_ART_STYLE = "Describe your own art style";

const blank = {
  theme: THEMES[0]!,
  ownTheme: "",
  worldBrief: "",
  title: "",
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
            {props.art &&
              (ART_EXAMPLES[option] ? <img src={ART_EXAMPLES[option]} alt="" /> : <span className="no-example" aria-hidden="true">No example</span>)}
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
  /** What each box held before Enhance, as replacing a box's value leaves nothing for the browser's own undo. */
  const [enhanced, setEnhanced] = useState<Partial<Record<EnhanceField, { was: string; now: string }>>>({});
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

  const worldChoices = { title: draft.title, theme, worldBrief: draft.worldBrief, startingHook: draft.hookOn ? draft.startingHook : "" };

  const fillWorld = () =>
    run("The Narrator is thinking…", async (signal) => {
      const { title, worldBrief, startingHook } = draft;
      set(await pickForMe(theme, { title, worldBrief, ...(draft.hookOn && { startingHook }) }, signal));
    });

  function generate(event: FormEvent) {
    event.preventDefault();
    const choices = { ...worldChoices, artStyle };
    // `required` accepts spaces, and a Starting Hook of spaces would quietly become a sandbox start.
    if (!theme || !draft.worldBrief.trim() || !draft.title.trim() || (draft.hookOn && !draft.startingHook.trim())) {
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

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView();

  const frame = (here: number, content: ReactNode, foot: ReactNode) => (
    <Sheet
      view={here}
      lockRail={!!busy}
      foot={
        !busy && (
          <>
            {feedback}
            <div className="row">{foot}</div>
          </>
        )
      }
      rail={
        <>
          <nav aria-label="Steps">
            {STEPS.map(({ href, name }, index) => (
              <Fragment key={name}>
                {index === 0 || draft.world ? (
                  <a href={href} aria-current={index === here ? "step" : undefined}>{index + 1}. {name}</a>
                ) : (
                  <span>{index + 1}. {name}</span>
                )}
                {index === 0 && here === 0 && (
                  <>
                    <button type="button" className="jump" onClick={() => jump("world-choices")}>World choices</button>
                    <button type="button" className="jump" onClick={() => jump("art-style")}>Art Style</button>
                  </>
                )}
              </Fragment>
            ))}
          </nav>
          <p className="muted so-far">
            <b>So far</b>
            {[theme, draft.title.trim(), draft.artStyle === OWN_ART_STYLE ? "Your own Art Style" : draft.artStyle].filter(Boolean).map((choice) => (
              <span key={choice}>{choice}</span>
            ))}
          </p>
          <a className="quiet" href="#/">Main Menu</a>
        </>
      }
    >
      {busy ? <Working message={busy} onCancel={() => running.current?.abort()} /> : content}
    </Sheet>
  );

  const pickRow = (filled: boolean, fill: () => void) => (
    <>
      <span className="muted">Fills only the empty boxes.</span>
      <button type="button" className="quiet" disabled={filled} onClick={fill}>
        Pick for me
      </button>
    </>
  );

  const enhanceTools = (
    field: EnhanceField,
    label: string,
    value: string,
    write: (text: string) => void,
    choices: Parameters<typeof enhance>[2],
  ) => {
    const before = enhanced[field];
    const improve = () =>
      run("The Narrator is thinking…", async (signal) => {
        const now = await enhance(field, value, choices, signal);
        setEnhanced((current) => ({ ...current, [field]: { was: value, now } }));
        write(now);
      });
    return (
      <div className="row">
        {before?.now === value && (
          <button type="button" className="quiet" aria-label={`Undo Enhance: ${label}`} onClick={() => write(before.was)}>
            Undo
          </button>
        )}
        {value.trim() && (
          <button type="button" className="icon" title="Enhance" aria-label={`Enhance: ${label}`} disabled={!!busy} onClick={improve}>
            {DecideIcon}
          </button>
        )}
      </div>
    );
  };

  const worldTools = (field: WorldField, label: string) =>
    enhanceTools(field, label, draft[field], (text) => set({ [field]: text }), worldChoices);

  const { world } = draft;

  if (world && step === "overview") {
    const regenerate = () =>
      run("The Narrator is rebuilding the world. This can take a few minutes.", async (signal) => {
        const { overview } = await regenerateWorld(world.id, world.choices, signal);
        set({ world: { ...world, overview, coverVersion: world.coverVersion + 1 } });
      });
    return frame(
      1,
      <>
        <Heading step={2} title="The World Overview" busy={!!busy} />
        <p className="muted">What your PC would know. Accept this world, or have the Narrator make another.</p>
        <CoverArt key={world.coverVersion} src={worldCoverUrl(world.id, world.coverVersion)} />
        <div className="overview">
          <p>{world.overview}</p>
        </div>
      </>,
      <>
        <button type="button" className="quiet" onClick={regenerate}>
          Regenerate
        </button>
        <a className="action" href="#/new/pc">
          Accept
        </a>
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

    const box = (field: Exclude<keyof PcDraft, "name">, label: string, rows: number) => (
      <div className="enhanceable">
        <label>
          {label}
          <textarea rows={rows} value={draft.pc[field]} onChange={(e) => setPc(field, e.target.value)} />
        </label>
        {enhanceTools(field, label, draft.pc[field], (text) => setPc(field, text), { ...world.choices, pc: draft.pc })}
      </div>
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
    return frame(
      2,
      <form id="pc" className="fields wizard" onSubmit={begin}>
        <div>
          <Heading step={3} title="Of the PC" busy={!!busy} />
          <p className="muted">Play whomever you want. What you write is canon, and the world changes if it must.</p>
        </div>
        <label>
          PC name
          <input required value={draft.pc.name} onChange={(e) => setPc("name", e.target.value)} />
        </label>
        {box("background", "Background", 3)}
        {box("physicalTraits", "Physical traits", 3)}
        {box("skills", "Skills and experience", 3)}
        {box("inventory", "Starting inventory, one item per line", 4)}
        {box("other", "Anything else", 2)}
      </form>,
      <>
        {pickRow(Object.values(draft.pc).every((text) => text.trim()), fillPc)}
        <button form="pc" className="action">{error ? "Try again" : "Begin"}</button>
      </>,
    );
  }

  return frame(
    0,
    <form id="world" className="fields wizard" onSubmit={generate}>
      <div id="world-choices" className="fields wizard">
        <div>
          <Heading step={1} title="Of the World" busy={!!busy} />
        </div>
        <Choices
          legend="Theme"
          options={[...THEMES, OWN_THEME]}
          value={draft.theme}
          onChange={(theme) => set({ theme })}
        />
        {draft.theme === OWN_THEME && (
          <label>
            Your theme
            <input required value={draft.ownTheme} onChange={(e) => set({ ownTheme: e.target.value })} />
          </label>
        )}
        <div className="enhanceable">
          <label>
            World Brief
            <textarea required rows={3} value={draft.worldBrief} onChange={(e) => set({ worldBrief: e.target.value })} />
          </label>
          {worldTools("worldBrief", "World Brief")}
        </div>
        <div className="enhanceable">
          <label>
            Title
            <input required maxLength={80} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
          {worldTools("title", "Title")}
        </div>
        <label className="toggle">
          <input type="checkbox" checked={draft.hookOn} onChange={(e) => set({ hookOn: e.target.checked })} />
          Starting Hook
        </label>
        {draft.hookOn ? (
          <div className="enhanceable">
            <label>
              What opens the story?
              <textarea required rows={3} value={draft.startingHook} onChange={(e) => set({ startingHook: e.target.value })} />
            </label>
            {worldTools("startingHook", "Starting Hook")}
          </div>
        ) : (
          <p className="muted">Your PC just starts in the world, with no immediate hook.</p>
        )}
      </div>
      <div id="art-style" className="fields wizard">
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
      </div>
    </form>,
    <>
      {pickRow(!theme || [draft.worldBrief, draft.title, ...(draft.hookOn ? [draft.startingHook] : [])].every((text) => text.trim()), fillWorld)}
      <button form="world" className="action">{error ? "Try again" : "Generate the world"}</button>
    </>,
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
