import { type ReactNode, useEffect, useRef, useState } from "react";
import { ArtStylePicker, artStyleText, Choices } from "./art-style-picker";
import { ART_STYLES } from "./art-styles";
import {
  beginStory,
  type Character,
  drawOnForm,
  type EnhanceField,
  enhance,
  generateWorld,
  getHeldImage,
  getSettings,
  type HeldImage,
  heldImageUrl,
  type ImageKind,
  type PcDraft,
  pickForMe,
  redrawHeldImage,
  regenerateWorld,
  setupProblem,
  type WorldChoices,
  type WorldField,
} from "./api";
import { DecideIcon } from "./icons";
import { Sheet } from "./menu";
import { PromptBox, RedrawPanel, Zoomable } from "./zoom";

/** Each description is shown to the player and sent to the Narrator with the theme's name. */
const THEMES: Record<string, string> = {
  "High Fantasy": "Wondrous realms of magic, ancient kingdoms and epic quests, where good and evil are clearly drawn.",
  "Dark Fantasy": "Grim lands where magic comes at a cost, monsters are real and heroes rarely stay clean.",
  "Urban Fantasy": "Vampires, witches and hidden courts live unseen in the cities of today.",
  Cyberpunk: "Neon megacities run by corporations, where chrome implants and stolen data are the way to get ahead.",
  "Space Opera": "Starships, galactic empires and mystic powers, in sweeping struggles across the stars.",
  "Sci Fi": "Plausible futures of space travel, advanced technology and first contact.",
  "Modern Day": "The world as it is now, with today's technology, cities and everyday stakes.",
  Steampunk: "A Victorian age of brass, steam and clockwork, with airships, inventors and rigid class lines.",
  "Realistic medieval": "Feudal life shaped by lords, faith, plague and the sword.",
  Western: "The American frontier, with dusty towns, outlaws, lawmen and land worth killing for.",
  "Post-Apocalyptic": "The ruins of a fallen world, where survivors fight over what's left.",
  Horror: "Ordinary lives unravel as something terrible closes in, and safety never lasts.",
  Noir: "Rain-slick streets, crooked cops and secrets that someone will kill to keep.",
};

const OWN_THEME = "Create your own";

const blank = {
  theme: "High Fantasy",
  ownTheme: "",
  worldBrief: "",
  title: "",
  hookOn: true,
  startingHook: "",
  characters: [] as Character[],
  artStyle: Object.keys(ART_STYLES)[0]!,
  ownArtStyle: "",
  pc: { name: "", background: "", physicalTraits: "", inventory: "" } as PcDraft,
  /** What the server holds this form's images and world under, once it holds any. */
  id: undefined as string | undefined,
  /** Each image asked for, and how many times it has changed, so that a new image is a new address. */
  drawn: {} as Partial<Record<ImageKind, number>>,
  /** The choices that made this world, as the form can change after it was generated. */
  world: undefined as { overview: string; choices: WorldChoices; form: string } | undefined,
};

const STORAGE_KEY = "novelforge-new-story";

// Kept for the tab, so a reload or a trip to Settings to fix a failure doesn't lose what the player wrote. It only ever holds player-facing text.
const stored = () => {
  const draft = { ...blank, ...(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<typeof blank>) };
  // A form kept from before the Important Characters were a list, or from when the PC had more boxes.
  const pc = Object.fromEntries(Object.keys(blank.pc).map((field) => [field, draft.pc[field as keyof PcDraft] ?? ""])) as PcDraft;
  return { ...draft, pc, characters: Array.isArray(draft.characters) ? draft.characters : [] };
};

const MAX_CHARACTERS = 10;

const redrew = (drawn: typeof blank.drawn, kind: ImageKind) => ({ ...drawn, [kind]: (drawn[kind] ?? 0) + 1 });

const IMAGE_NAMES: Record<ImageKind, { name: string; alt: string }> = {
  cover: { name: "Cover", alt: "The cover of your story" },
  portrait: { name: "portrait", alt: "Your PC's portrait" },
};

/**
 * A Cover or portrait the server holds, which may still be painting. A failed one offers its prompt to try again.
 * `onLost` is for one the server no longer holds or never drew, so that the form can offer it again.
 */
function HeldArt(props: { id: string; kind: ImageKind; version: number; onRedrawn: () => void; onLost: () => void }) {
  const { id, kind, version, onRedrawn, onLost } = props;
  const [image, setImage] = useState<HeldImage>();
  const [redrawing, setRedrawing] = useState(false);
  const [failure, setFailure] = useState("");
  const { name, alt } = IMAGE_NAMES[kind];

  useEffect(() => {
    let leaving = false;
    getHeldImage(id, kind).then(
      (details) => {
        if (leaving) return;
        setImage(details);
        setFailure(details.failure);
        if (!details.hasImage && !details.failure) onLost();
      },
      () => !leaving && onLost(),
    );
    return () => {
      leaving = true;
    };
  }, [id, kind, version]);

  if (!image) return <p className="waiting">The {name} is being painted…</p>;

  const redraw = (prompt: string) => {
    setRedrawing(true);
    setFailure("");
    redrawHeldImage(id, kind, prompt).then(onRedrawn, (error: Error) => setFailure(error.message)).finally(() => setRedrawing(false));
  };
  const box = <PromptBox prompt={image.prompt} redrawing={redrawing} failure={failure} canRedraw={image.canRedraw} onRedraw={redraw} />;

  if (!image.hasImage) {
    return failure || redrawing ? (
      <>
        <p className="muted">The {name} couldn't be painted. You can try again, or carry on without one.</p>
        {box}
      </>
    ) : null;
  }
  return (
    <>
      <figure className={kind === "cover" ? "plate cover" : "plate"}>
        <Zoomable src={heldImageUrl(id, kind, version)} alt={alt}>
          <RedrawPanel busy={redrawing || !!failure}>{box}</RedrawPanel>
        </Zoomable>
      </figure>
      {redrawing && <p className="waiting">Redrawing the {name}…</p>}
      {failure && <p className="error">Redraw failed. Open the {name} to see why.</p>}
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
      <p className="muted">Step {step} of 2</p>
      <h1 ref={heading} tabIndex={-1} className="big">{title}</h1>
    </>
  );
}

/** Steps live in the hash like screens, so the browser's back button walks them. `step` is the part after `#/new/`. */
export function NewStory({ step }: { step?: string }) {
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [setupNotice, setSetupNotice] = useState<string>();
  const [imagesReady, setImagesReady] = useState<boolean>();
  /** True while a draw is being asked for, so that a form's first two draws can't each get an id of their own. */
  const [asking, setAsking] = useState(false);
  /** What each box held before Enhance, as replacing a box's value leaves nothing for the browser's own undo. */
  // Keyed by field, and by row as well for an Important Character's.
  const [enhanced, setEnhanced] = useState<Record<string, { was: string; now: string }>>({});
  const set = (change: Partial<typeof blank>) => setDraft((current) => ({ ...current, ...change }));
  const running = useRef<AbortController>(undefined);

  useEffect(() => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft)), [draft]);
  // Otherwise a world finishing later would pull the player back here from wherever they went.
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => setError(""), [step]);
  useEffect(() => {
    getSettings().then((settings) => {
      setSetupNotice(setupProblem(settings));
      setImagesReady(settings.imagesReady);
    }, () => {});
  }, []);

  const theme = draft.theme === OWN_THEME ? draft.ownTheme.trim() : draft.theme;
  const description = THEMES[draft.theme];
  const themeForNarrator = description ? `${theme}: ${description}` : theme;
  const artStyle = artStyleText(draft.artStyle, draft.ownArtStyle);

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

  const worldChoices = { title: draft.title, theme: themeForNarrator, worldBrief: draft.worldBrief, startingHook: draft.hookOn ? draft.startingHook : "", characters: draft.characters };

  /** What a world was written from, to tell if the form has moved on from it. */
  const formNow = JSON.stringify([worldChoices, draft.pc]);

  const fillForm = () =>
    run("The Narrator is thinking…", async (signal) => {
      const { title, worldBrief, startingHook, pc } = draft;
      const picked = Object.entries(await pickForMe(themeForNarrator, { title, worldBrief, ...(draft.hookOn && { startingHook }), pc }, signal));
      const isPc = ([field]: [string, unknown]) => field in blank.pc;
      setDraft((current) => ({
        ...current,
        ...Object.fromEntries(picked.filter((box) => !isPc(box))),
        pc: { ...current.pc, ...Object.fromEntries(picked.filter(isPc)) },
      }));
    });

  /** A first draw, or a Redo with a new prompt from the form as it is now. A drawn image's Redraw keeps its old prompt instead. */
  async function drawFirst(ask: Parameters<typeof drawOnForm>[0]) {
    setAsking(true);
    setError("");
    try {
      const { id } = await drawOnForm({ ...ask, id: draft.id });
      setDraft((current) => ({ ...current, id, drawn: redrew(current.drawn, ask.kind) }));
    } catch (failure) {
      setError((failure as Error).message);
    }
    setAsking(false);
  }

  function generate() {
    const choices = { ...worldChoices, artStyle };
    // Checked here, not by `required`, as the images' Redraw forms can't sit inside a form of their own. Spaces would pass that anyway, and a Starting Hook of spaces would quietly become a sandbox start.
    if (!theme || !draft.worldBrief.trim() || !draft.title.trim() || (draft.hookOn && !draft.startingHook.trim()) || !artStyle.trim()) {
      return setError("Fill in each box with some words, use Pick for me, or turn the Starting Hook off.");
    }
    if (!draft.pc.name.trim()) return setError("Give your character a name, or use Pick for me.");
    const characters = draft.characters.map(({ name, description }) => ({ name: name.trim(), description: description.trim() })).filter(({ name, description }) => name || description);
    if (characters.some(({ name }) => !name)) return setError("Give each Important Character a name.");
    choices.characters = characters;
    const { inventory, ...pc } = draft.pc;
    return run("The Narrator is building the world. This can take a few minutes.", async (signal) => {
      const { id, overview } = await generateWorld({ ...choices, id: draft.id, pc, inventory }, signal);
      setDraft((current) => ({ ...current, id, world: { overview, choices, form: formNow }, drawn: redrew(redrew(current.drawn, "cover"), "portrait") }));
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

  const frame = (here: number, content: ReactNode, foot: ReactNode) => (
    <Sheet
      view={here}
      foot={
        !busy && (
          <>
            {feedback}
            <div className="row">
              {/* The only way out, with no index beside the page. */}
              <a className="quiet leave" href={here === 0 ? "#/" : "#/new"}>{here === 0 ? "Main Menu" : "Back"}</a>
              {foot}
            </div>
          </>
        )
      }
    >
      {busy ? <Working message={busy} onCancel={() => running.current?.abort()} /> : content}
    </Sheet>
  );

  const setCharacter = (index: number, change: Partial<Character>) =>
    setDraft((current) => ({ ...current, characters: current.characters.map((character, at) => (at === index ? { ...character, ...change } : character)) }));

  const setPc = (field: keyof PcDraft, text: string) =>
    setDraft((current) => ({ ...current, pc: { ...current.pc, [field]: text } }));

  const enhanceTools = (field: EnhanceField, label: string, value: string, write: (text: string) => void, row?: { key: string; character: Character }) => {
    const key = row?.key ?? field;
    const before = enhanced[key];
    const action = value.trim() ? "Enhance" : "Write";
    const improve = () =>
      run("The Narrator is thinking…", async (signal) => {
        const now = await enhance(field, value, { ...worldChoices, pc: draft.pc, ...(row && { character: row.character }) }, signal);
        setEnhanced((current) => ({ ...current, [key]: { was: value, now } }));
        write(now);
      });
    return (
      <div className="row">
        {before?.now === value && (
          <button type="button" className="quiet" aria-label={`Undo Enhance: ${label}`} onClick={() => write(before.was)}>
            Undo
          </button>
        )}
        <button type="button" className="icon" title={action} aria-label={`${action}: ${label}`} disabled={!!busy} onClick={improve}>
          {DecideIcon}
        </button>
      </div>
    );
  };

  const worldTools = (field: WorldField, label: string) => enhanceTools(field, label, draft[field], (text) => set({ [field]: text }));

  const heldArt = (kind: ImageKind, version: number) => (
    <HeldArt
      id={draft.id!}
      kind={kind}
      version={version}
      // The player may have gone on by the time a Redraw ends, so these go by what the draft holds then.
      onRedrawn={() => setDraft((current) => ({ ...current, drawn: redrew(current.drawn, kind) }))}
      onLost={() =>
        setDraft((current) => {
          const { [kind]: _, ...drawn } = current.drawn;
          return { ...current, drawn };
        })
      }
    />
  );

  const { world, id: worldId } = draft;

  if (world && worldId && step === "overview") {
    const regenerate = () =>
      run("The Narrator is rebuilding the world. This can take a few minutes.", async (signal) => {
        const { overview } = await regenerateWorld(worldId, { ...world.choices, artStyle }, signal);
        setDraft((current) => ({ ...current, world: { ...world, overview }, drawn: redrew(redrew(current.drawn, "cover"), "portrait") }));
      });
    const begin = () =>
      run("Opening the book…", async (signal) => {
        const { id } = await beginStory(worldId, artStyle, signal);
        sessionStorage.removeItem(STORAGE_KEY);
        location.hash = `/play/${id}`;
      });
    return frame(
      1,
      <>
        <Heading step={2} title="The World Overview" busy={!!busy} />
        <p className="muted">What your PC would know. Begin the story in this world, or have the Narrator make another. Your PC and the pictures stay either way.</p>
        {world.form !== formNow && (
          <p className="notice">
            The form has changed since this world was written, and Begin and Regenerate won't use those changes. <a href="#/new">Go back</a> and generate the world to use them.
          </p>
        )}
        <div className="drawn-pair">
          {draft.drawn.cover !== undefined && <div>{heldArt("cover", draft.drawn.cover)}</div>}
          {draft.drawn.portrait !== undefined && <div>{heldArt("portrait", draft.drawn.portrait)}</div>}
        </div>
        <div className="overview">
          <p>{world.overview}</p>
        </div>
      </>,
      <>
        <button type="button" className="quiet" onClick={regenerate}>
          Regenerate
        </button>
        <button type="button" className="action" onClick={begin}>
          {error ? "Try again" : "Begin"}
        </button>
      </>,
    );
  }

  // `short` names the box on its buttons, as a question makes a clumsy one.
  const pcBox = (field: Exclude<keyof PcDraft, "name">, label: string, short: string, rows: number) => (
    <div className="enhanceable">
      <label>
        {label}
        <textarea rows={rows} value={draft.pc[field]} onChange={(e) => setPc(field, e.target.value)} />
      </label>
      {enhanceTools(field, short, draft.pc[field], (text) => setPc(field, text))}
    </div>
  );

  /** `missing` says what must be filled before this image can be drawn, and `ask` is what it's drawn from. */
  const imageSection = (kind: ImageKind, legend: string, missing: string, ask: Parameters<typeof drawOnForm>[0]) => {
    const version = draft.drawn[kind];
    return (
      <fieldset id={kind}>
        <legend>{legend}</legend>
        {imagesReady === false ? (
          <p className="muted">Images are turned off or not set up in Settings.</p>
        ) : draft.id && version !== undefined ? (
          <>
            {heldArt(kind, version)}
            <div className="row">
              <button type="button" className="quiet" disabled={!!missing || asking} title="Write a new prompt from the form as it is now, and draw it" onClick={() => drawFirst(ask)}>
                Redo the {IMAGE_NAMES[kind].name}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted">{missing || `Draw it now to see it, or leave it and it's drawn when the world is written.`}</p>
            <div className="row">
              <button type="button" className="quiet" disabled={!!missing || asking} onClick={() => drawFirst(ask)}>
                Draw the {IMAGE_NAMES[kind].name}
              </button>
            </div>
          </>
        )}
      </fieldset>
    );
  };

  const { title, worldBrief } = draft;
  const worldBoxes = [draft.worldBrief, draft.title, ...(draft.hookOn ? [draft.startingHook] : [])];
  const physicalTraits = draft.pc.physicalTraits;

  // Not a form, as the images' Redraw forms sit inside it.
  return frame(
    0,
    <div className="fields wizard">
      <div id="world-choices" className="fields wizard">
        <div>
          <Heading step={1} title="Your New World and Character" busy={!!busy} />
        </div>
        <Choices
          legend="What kind of story is it?"
          options={[...Object.keys(THEMES), OWN_THEME]}
          value={draft.theme}
          onChange={(theme) => set({ theme })}
        />
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
            What is your world like?
            <textarea rows={3} value={draft.worldBrief} onChange={(e) => set({ worldBrief: e.target.value })} />
          </label>
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
          <p className="muted">People you want in the story besides your PC. Pick for me leaves these alone, so there are only those you add.</p>
        </div>
        {draft.characters.map((character, index) => {
          const label = character.name.trim() || `Character ${index + 1}`;
          const box = (field: keyof Character, enhanceField: EnhanceField, name: string, input: ReactNode) => (
            <div className="enhanceable">
              <label>
                {name}
                {input}
              </label>
              {enhanceTools(enhanceField, `${name}: ${label}`, character[field], (text) => setCharacter(index, { [field]: text }), { key: `${enhanceField}:${index}`, character })}
            </div>
          );
          return (
            <fieldset key={index}>
              <legend>{label}</legend>
              {box("name", "characterName", "Name", <input maxLength={80} value={character.name} onChange={(e) => setCharacter(index, { name: e.target.value })} />)}
              {box(
                "description",
                "characterDescription",
                "Description",
                <textarea rows={3} maxLength={1000} value={character.description} onChange={(e) => setCharacter(index, { description: e.target.value })} />,
              )}
              <div className="row">
                <button type="button" className="quiet" aria-label={`Remove ${label}`} onClick={() => set({ characters: draft.characters.filter((_, at) => at !== index) })}>
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
            onClick={() => set({ characters: [...draft.characters, { name: "", description: "" }] })}
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
              <textarea rows={3} value={draft.startingHook} onChange={(e) => set({ startingHook: e.target.value })} />
            </label>
            {worldTools("startingHook", "Starting Hook")}
          </div>
        ) : (
          <p className="muted">Your PC just starts in the world, with no immediate hook.</p>
        )}
      </div>
      <div id="art-style" className="fields wizard">
        <ArtStylePicker
          name={draft.artStyle}
          own={draft.ownArtStyle}
          onName={(artStyle) => set({ artStyle })}
          onOwn={(ownArtStyle) => set({ ownArtStyle })}
        />
        <p className="muted">You can change this during the story. It affects new images only.</p>
      </div>
      {imageSection("cover", "Cover", theme && title.trim() && worldBrief.trim() ? "" : "Fill in the Title, theme and World Brief to draw this.", {
        kind: "cover",
        title,
        theme: themeForNarrator,
        worldBrief,
        pc: { name: draft.pc.name, physicalTraits },
        characters: draft.characters,
        inventory: draft.pc.inventory,
        artStyle,
      })}
      {imageSection("portrait", "Portrait", physicalTraits.trim() ? "" : "Say what your character looks like to draw this.", {
        kind: "portrait",
        name: draft.pc.name,
        physicalTraits,
        inventory: draft.pc.inventory,
        theme: themeForNarrator,
        worldBrief,
        artStyle,
      })}
    </div>,
    <>
      <span className="muted">Fills only the empty boxes.</span>
      <button type="button" className="quiet" disabled={!theme || [...worldBoxes, ...Object.values(draft.pc)].every((text) => text.trim())} onClick={fillForm}>
        Pick for me
      </button>
      <button type="button" className="action" onClick={generate}>
        {error ? "Try again" : "Generate the world"}
      </button>
    </>,
  );
}
