import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { ArtStylePicker, artStyleText, Choices, OWN_ART_STYLE } from "./art-style-picker";
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
  type HeldPicture,
  heldImageUrl,
  type PcDraft,
  pickForMe,
  redrawHeldImage,
  regenerateWorld,
  setupProblem,
  uploadHeldImage,
  type WorldField,
} from "./api";
import { LONG_TEXT } from "../limits";
import { DecideIcon, RegenerateIcon } from "./icons";
import { Sheet } from "./menu";
import { NudgeButton, PromptBox, RedrawPanel, UploadButton, Zoomable } from "./zoom";

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

/** `ref` is what the server holds their portrait under, so it stays theirs through a rename or a row removed above. */
type FormCharacter = Character & { ref: string };

/** On the Cover only when the player says so, as the server puts a character it isn't told about on it. */
const withCoverChoice = (characters: FormCharacter[]) => characters.map((character) => ({ ...character, onCover: !!character.onCover }));

// Not crypto.randomUUID, which a page reached over the network without HTTPS doesn't have. Only unique within one form.
const newRef = (length = 8) => Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join("");

const blank = {
  theme: "High Fantasy",
  ownTheme: "",
  worldBrief: "",
  title: "",
  hookOn: true,
  startingHook: "",
  characters: [] as FormCharacter[],
  artStyle: Object.keys(ART_STYLES)[0]!,
  ownArtStyle: "",
  pc: { name: "", background: "", physicalTraits: "", inventory: "" } as PcDraft,
  /** Whether the Cover shows the PC, as the Important Characters each say for themselves. */
  pcOnCover: true,
  /** What the server holds this form's images and world under, once it holds any. */
  id: undefined as string | undefined,
  /** The player's own few words for each picture's next prompt, such as "smiling". */
  nudges: {} as Record<HeldPicture, string>,
  /** Each picture asked for or uploaded, and how many times it has changed, so that a new image is a new address. */
  drawn: {} as Record<HeldPicture, number>,
  /** The world written from this form. Going back to change the form discards it. */
  world: undefined as { overview: string } | undefined,
};

const STORAGE_KEY = "novelforge-new-story";

const STEPS = [
  { name: "World and Characters", hash: "/new" },
  { name: "Art", hash: "/new/art" },
  { name: "Your World", hash: "/new/overview" },
];

// Kept for the tab, so a reload or a trip to Settings to fix a failure doesn't lose what the player wrote. It only ever holds player-facing text.
const stored = () => {
  const draft = { ...blank, ...(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<typeof blank>) };
  // A form kept from before the Important Characters were a list, or had portraits, or from when the PC had more boxes.
  const pc = Object.fromEntries(Object.keys(blank.pc).map((field) => [field, draft.pc[field as keyof PcDraft] ?? ""])) as PcDraft;
  const characters = Array.isArray(draft.characters) ? draft.characters.map((character) => ({ ...character, ref: character.ref ?? newRef() })) : [];
  // A form kept from when pictures went by kind, whose numbers still name the Cover and portrait.
  const drawn = typeof draft.drawn === "object" && draft.drawn ? draft.drawn : {};
  return { ...draft, pc, characters, drawn };
};

const MAX_CHARACTERS = 10;

/** Says why typing stopped, as a full box gives no sign of its own. */
const full = (text: string) => text.length >= LONG_TEXT && <p className="muted">That's the most this box can hold: {LONG_TEXT} characters.</p>;

const redrew = (drawn: typeof blank.drawn, ...pictures: HeldPicture[]) => ({ ...drawn, ...Object.fromEntries(pictures.map((picture) => [picture, (drawn[picture] ?? 0) + 1])) });

const npcPicture = ({ ref }: FormCharacter) => `npcs/${ref}`;

/** What a picture is called, and how it's described to a screen reader. */
type Naming = { name: string; alt: string };

/**
 * A Cover or portrait the server holds, which may still be painting. A failed one offers its prompt to try again.
 * `onLost` is for one the server no longer holds or never drew, so that the form can offer it again.
 */
function HeldArt(props: { id: string; picture: HeldPicture; naming: Naming; version: number; onRedrawn: () => void; onLost: () => void }) {
  const { id, picture, version, onRedrawn, onLost } = props;
  const { name, alt } = props.naming;
  const [image, setImage] = useState<HeldImage>();
  const [redrawing, setRedrawing] = useState(false);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let leaving = false;
    setImage(undefined);
    getHeldImage(id, picture).then(
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
  }, [id, picture, version]);

  if (!image) return <p className="waiting">The {name} is being painted…</p>;

  const redraw = (prompt: string) => {
    setRedrawing(true);
    setFailure("");
    redrawHeldImage(id, picture, prompt).then(onRedrawn, (error: Error) => setFailure(error.message)).finally(() => setRedrawing(false));
  };
  const box = <PromptBox prompt={image.prompt} redrawing={redrawing} failure={failure} canRedraw={image.canRedraw} onRedraw={redraw} />;

  if (!image.hasImage) {
    return failure || redrawing ? (
      <>
        <p className="muted">The {name} couldn't be painted. You can try again, upload your own, or carry on without one.</p>
        {box}
      </>
    ) : null;
  }
  return (
    <>
      <figure className={picture === "cover" ? "plate cover" : "plate"}>
        <Zoomable src={heldImageUrl(id, picture, version)} alt={alt}>
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
      <p className="muted">Step {step} of 3</p>
      <h1 ref={heading} tabIndex={-1} className="big">{title}</h1>
    </>
  );
}

/** Asks before leaving the written world for an earlier step, which discards it. */
function LeaveWorld({ to, onClose }: { to: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => dialog.current!.showModal(), []);
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="leave-title">
      <h2 id="leave-title">Go back and discard this world?</h2>
      <p>Going back discards the generated world, and you'll generate a new one from your changes. Your pictures stay.</p>
      {/* Stay comes first because a modal focuses its first control, and that must not be the discarding one. */}
      <div className="row">
        <button className="quiet" onClick={() => dialog.current!.close()}>
          Stay
        </button>
        <button
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

/** Steps live in the hash like screens, so the browser's back button walks them. `step` is the part after `#/new/`: none, "art" or "overview". */
export function NewStory({ step }: { step?: string }) {
  const [draft, setDraft] = useState(stored);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [setupNotice, setSetupNotice] = useState<string>();
  const [imagesReady, setImagesReady] = useState<boolean>();
  /** True while a picture is being asked for, so that a form's first two can't each get an id of their own. */
  const [asking, setAsking] = useState(false);
  /** Where the player asked to go back to from the world, while they confirm it. */
  const [leaving, setLeaving] = useState<string>();
  /** What each box held before Enhance, as replacing a box's value leaves nothing for the browser's own undo. */
  // Keyed by field, and by row as well for an Important Character's.
  const [enhanced, setEnhanced] = useState<Record<string, { was: string; now: string }>>({});
  const set = (change: Partial<typeof blank>) => setDraft((current) => ({ ...current, ...change }));
  const running = useRef<AbortController>(undefined);

  const { world, id: worldId } = draft;
  const page = step === "overview" && world && worldId ? "overview" : step === "art" ? "art" : "form";

  useEffect(() => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft)), [draft]);
  // Otherwise a world finishing later would pull the player back here from wherever they went.
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => setError(""), [step]);
  // However the player came back, the world no longer matches what they may now change.
  useEffect(() => {
    if (page !== "overview" && world) set({ world: undefined });
  }, [page]);
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

  const worldChoices = { title: draft.title, theme: themeForNarrator, worldBrief: draft.worldBrief, startingHook: draft.hookOn ? draft.startingHook : "", characters: withCoverChoice(draft.characters), pcOnCover: draft.pcOnCover };

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

  /** Checked here, not by `required`, as spaces would pass that, and a Starting Hook of spaces would quietly become a sandbox start. */
  function formProblem() {
    if (!theme || !draft.worldBrief.trim() || !draft.title.trim() || (draft.hookOn && !draft.startingHook.trim())) {
      return "Fill in each box with some words, use Pick for me, or turn the Starting Hook off.";
    }
    if (!draft.pc.name.trim()) return "Give your character a name, or use Pick for me.";
    if (draft.characters.some(({ name, description }) => !name.trim() && description.trim())) return "Give each Important Character a name.";
    return "";
  }

  function next() {
    const problem = formProblem();
    if (problem) return setError(problem);
    // An empty row is one the player added and never used.
    set({ characters: draft.characters.filter(({ name, description }) => name.trim() || description.trim()) });
    location.hash = "/new/art";
  }

  /** Every picture the world draws if it's missing, so the form looks for each once the world is written. */
  const allPictures = ["portrait", ...draft.characters.map(npcPicture), "cover"];

  function generate() {
    const problem = formProblem() || (artStyle.trim() ? "" : "Describe your art style, or pick one.");
    if (problem) return setError(problem);
    const characters = worldChoices.characters.map(({ name, description, ref, onCover }) => ({ name: name.trim(), description: description.trim(), ref, onCover }));
    const { inventory, ...pc } = draft.pc;
    return run("The Narrator is building the world. Missing pictures are drawn as well. This can take a few minutes.", async (signal) => {
      const { id, overview } = await generateWorld({ ...worldChoices, characters, artStyle, id: draft.id, pc, inventory }, signal);
      setDraft((current) => ({ ...current, id, world: { overview }, drawn: redrew(current.drawn, ...allPictures) }));
      location.hash = "/new/overview";
    });
  }

  /** A first picture, or a Redo or upload in place of one. `send` answers with the id the form's pictures are held under. */
  async function hold(picture: HeldPicture, send: () => Promise<string>) {
    setAsking(true);
    setError("");
    try {
      const id = await send();
      setDraft((current) => ({ ...current, id, drawn: redrew(current.drawn, picture) }));
    } catch (failure) {
      setError((failure as Error).message);
    }
    setAsking(false);
  }

  /** `nudge` is kept for the picture, so its next Draw or Redo asks for the same. */
  const drawFirst = (picture: HeldPicture, ask: Parameters<typeof drawOnForm>[0], nudge = draft.nudges[picture] ?? "") => {
    setDraft((current) => ({ ...current, nudges: { ...current.nudges, [picture]: nudge } }));
    return hold(picture, async () => (await drawOnForm({ ...ask, id: draft.id, nudge })).id);
  };

  const uploadOwn = (picture: HeldPicture, file: File) =>
    hold(picture, async () => {
      const id = draft.id ?? newRef(24);
      await uploadHeldImage(id, picture, file);
      return id;
    });

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

  const frame = (here: number, content: ReactNode, back: ReactNode, foot: ReactNode) => (
    <Sheet
      view={here}
      lockRail={!!busy}
      rail={
        <nav aria-label="Steps" className="wizard-steps">
          {STEPS.map(({ name, hash }, index) => {
            const label = `${index + 1}. ${name}`;
            if (index === here) return <a key={name} href={`#${hash}`} aria-current="step">{label}</a>;
            // Only back, as a later step needs the earlier ones done. Leaving the world asks first, as it discards it.
            if (index > here) return <span key={name}>{label}</span>;
            return page === "overview" ? (
              <button key={name} type="button" aria-haspopup="dialog" onClick={() => setLeaving(hash)}>
                {label}
              </button>
            ) : (
              <a key={name} href={`#${hash}`}>{label}</a>
            );
          })}
        </nav>
      }
      foot={
        !busy && (
          <>
            {feedback}
            <div className="row">
              {/* The only way out, with no index beside the page. */}
              {back}
              {foot}
            </div>
          </>
        )
      }
    >
      {busy ? <Working message={busy} onCancel={() => running.current?.abort()} /> : content}
      {leaving && <LeaveWorld to={leaving} onClose={() => setLeaving(undefined)} />}
    </Sheet>
  );

  const backTo = (hash: string, label = "Back") => (
    <a className="quiet leave" href={`#${hash}`}>
      {label}
    </a>
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

  const { title, worldBrief } = draft;
  const physicalTraits = draft.pc.physicalTraits;
  const characterLabel = (character: FormCharacter, index: number) => character.name.trim() || `Character ${index + 1}`;

  /** Everyone the player put on the Cover, who each need a picture before it's drawn, as it draws them from those pictures. */
  const unpictured = [...(draft.pcOnCover ? ["portrait"] : []), ...draft.characters.filter(({ onCover }) => onCover).map(npcPicture)].filter(
    (picture) => draft.drawn[picture] === undefined,
  );

  /**
   * One picture with its Draw or Redo and an upload. `missing` says what must be filled before it can be drawn, and `ask` is
   * what it's drawn from. Each stays in place after the world is written, as changing a picture changes nothing in the world.
   */
  /** `onCover` is a character's choice to be on the Cover, which a Cover has none of. */
  const pictureSection = (picture: HeldPicture, legend: string, naming: Naming, missing: string, ask: Parameters<typeof drawOnForm>[0], onCover?: { on: boolean; set: (on: boolean) => void }) => {
    const version = draft.drawn[picture];
    const held = draft.id && version !== undefined;
    return (
      <div key={picture}>
        <fieldset>
          <legend>{legend}</legend>
          {onCover && (
            <label className="toggle">
              <input type="checkbox" checked={onCover.on} onChange={(e) => onCover.set(e.target.checked)} />
              On the Cover
            </label>
          )}
          {held && (
            <HeldArt
              id={draft.id!}
              picture={picture}
              naming={naming}
              version={version}
              // The player may have gone on by the time a Redraw ends, so these go by what the draft holds then.
              onRedrawn={() => setDraft((current) => ({ ...current, drawn: redrew(current.drawn, picture) }))}
              onLost={() =>
                setDraft((current) => {
                  const { [picture]: _, ...drawn } = current.drawn;
                  return { ...current, drawn };
                })
              }
            />
          )}
          {imagesReady === false ? (
            <p className="muted">Images are turned off or not set up in Settings, but you can upload your own.</p>
          ) : (
            (missing || !held) && <p className="muted">{missing || "Draw it now to see it, or leave it and it's drawn when the world is written."}</p>
          )}
          <div className="row">
            {imagesReady !== false && (
              // Redo is an icon beside Nudge and Upload, as the Gallery's Update is. A first Draw stays in words, as nothing is there yet.
              held ? (
                <button
                  type="button"
                  className="icon"
                  title="Redo: write a new prompt from your choices as they are now, and draw it"
                  aria-label={`Redo the ${naming.name}: ${legend}`}
                  disabled={!!missing || asking}
                  onClick={() => drawFirst(picture, ask)}
                >
                  {RegenerateIcon}
                </button>
              ) : (
                <button type="button" className="quiet" disabled={!!missing || asking} onClick={() => drawFirst(picture, ask)}>
                  Draw the {naming.name}
                </button>
              )
            )}
            {imagesReady !== false && (
              <NudgeButton label={`Nudge the ${naming.name}: ${legend}`} disabled={!!missing || asking} initial={draft.nudges[picture]} onNudge={(nudge) => drawFirst(picture, ask, nudge)} />
            )}
            <UploadButton label={`Upload your own ${naming.name}: ${legend}`} disabled={asking} onFile={(file) => uploadOwn(picture, file)} />
          </div>
        </fieldset>
      </div>
    );
  };

  const setting = { theme: themeForNarrator, worldBrief, artStyle };

  const pcPicture = pictureSection(
    "portrait",
    draft.pc.name.trim() || "Your Character",
    { name: "portrait", alt: "Your PC's portrait" },
    physicalTraits.trim() ? "" : "Say what your character looks like in step 1 to draw this.",
    { kind: "portrait", name: draft.pc.name, physicalTraits, inventory: draft.pc.inventory, ...setting },
    { on: draft.pcOnCover, set: (pcOnCover) => set({ pcOnCover }) },
  );

  const characterPictures = draft.characters.map((character, index) =>
    pictureSection(
      npcPicture(character),
      characterLabel(character, index),
      { name: "portrait", alt: `${characterLabel(character, index)}'s portrait` },
      character.description.trim() ? "" : "Describe them in step 1 to draw this.",
      { kind: "npc", ref: character.ref, name: character.name, pcName: draft.pc.name, description: character.description, ...setting },
      { on: !!character.onCover, set: (onCover) => setCharacter(index, { onCover }) },
    ),
  );

  const coverPicture = pictureSection(
    "cover",
    "Cover",
    { name: "Cover", alt: "The cover of your story" },
    !theme || !title.trim() || !worldBrief.trim()
      ? "Fill in the Title, theme and World Brief in step 1 to draw this."
      : unpictured.length > 0
        ? "Everyone on the Cover needs a picture first, as it draws them from those pictures. Draw or upload theirs, or take them off the Cover."
        : "",
    { kind: "cover", title, ...setting, pc: { name: draft.pc.name, physicalTraits }, pcOnCover: draft.pcOnCover, characters: worldChoices.characters, inventory: draft.pc.inventory },
  );

  if (page === "overview") {
    const regenerate = () =>
      run("The Narrator is rebuilding the world. This can take a few minutes.", async (signal) => {
        const { overview } = await regenerateWorld(worldId!, { ...worldChoices, artStyle }, signal);
        setDraft((current) => ({ ...current, world: { overview }, drawn: redrew(current.drawn, ...allPictures) }));
      });
    const begin = () =>
      run("Opening the book…", async (signal) => {
        const { id } = await beginStory(worldId!, artStyle, signal);
        sessionStorage.removeItem(STORAGE_KEY);
        location.hash = `/play/${id}`;
      });
    const edit = (to: string, label: string) => (
      <button type="button" className="quiet" aria-haspopup="dialog" onClick={() => setLeaving(to)}>
        {label}
      </button>
    );
    const shown = (term: string, text: string) =>
      text.trim() && (
        <>
          <dt>{term}</dt>
          <dd>{text}</dd>
        </>
      );
    return frame(
      2,
      <div className="fields wizard review">
        <div>
          <Heading step={3} title={draft.title} busy={!!busy} />
          <p className="muted">What your PC would know. Begin the story in this world, or have the Narrator make another. Changing a picture keeps the world.</p>
        </div>
        <div className="overview">
          <p>{world!.overview}</p>
        </div>
        <section className="fields wizard">
          <div className="row">
            <h2>Your choices</h2>
            {edit("/new", "Edit")}
          </div>
          <dl>
            {shown("Theme", theme)}
            {shown("World Brief", draft.worldBrief)}
            {shown("Starting Hook", worldChoices.startingHook || "None. Your PC just starts in the world.")}
            {shown("Your Character", draft.pc.name)}
            {shown("Background", draft.pc.background)}
            {shown("Looks", draft.pc.physicalTraits)}
            {shown("Wearing and carrying", draft.pc.inventory)}
            {draft.characters.map((character, index) => (
              <Fragment key={character.ref}>{shown(characterLabel(character, index), character.description || "No description.")}</Fragment>
            ))}
          </dl>
        </section>
        <section className="fields wizard">
          <div className="row">
            <h2>Art</h2>
            {edit("/new/art", "Edit")}
          </div>
          <dl>{shown("Art Style", draft.artStyle === OWN_ART_STYLE ? draft.ownArtStyle : draft.artStyle)}</dl>
          <div className="drawn-pair">
            {coverPicture}
            {pcPicture}
            {characterPictures}
          </div>
        </section>
      </div>,
      <button type="button" className="quiet leave" aria-haspopup="dialog" onClick={() => setLeaving("/new/art")}>
        Back
      </button>,
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

  if (page === "art") {
    return frame(
      1,
      <div className="fields wizard">
        <div>
          <Heading step={2} title="Art" busy={!!busy} />
        </div>
        <div id="art-style" className="fields wizard">
          <ArtStylePicker
            name={draft.artStyle}
            own={draft.ownArtStyle}
            intro={<p className="muted">Every picture in your story is drawn in this style. You can change it during the story, and it affects new pictures only.</p>}
            onName={(artStyle) => set({ artStyle })}
            onOwn={(ownArtStyle) => set({ ownArtStyle })}
          />
        </div>
        <div>
          <h2>Pictures</h2>
          <p className="muted">
            A portrait of your character and each Important Character, and the Cover, which shows them. Draw or upload each now, or leave any and it's drawn when the world is
            written.
          </p>
        </div>
        <div className="drawn-pair">
          {pcPicture}
          {characterPictures}
        </div>
        <div className="drawn-pair">{coverPicture}</div>
      </div>,
      backTo("/new"),
      <button type="button" className="action" onClick={generate}>
        {error ? "Try again" : "Generate the world"}
      </button>,
    );
  }

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

  const worldBoxes = [draft.worldBrief, draft.title, ...(draft.hookOn ? [draft.startingHook] : [])];

  return frame(
    0,
    <div className="fields wizard">
      <div id="world-choices" className="fields wizard">
        <div>
          <Heading step={1} title="Your World and Characters" busy={!!busy} />
        </div>
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
          <p className="muted">People you want in the story besides your PC. Each gets a portrait drawn from their description. Pick for me leaves these alone, so there are only those you add.</p>
        </div>
        {draft.characters.map((character, index) => {
          const label = characterLabel(character, index);
          const box = (field: "name" | "description", enhanceField: EnhanceField, name: string, input: ReactNode) => (
            <div className="enhanceable">
              <label>
                {name}
                {input}
              </label>
              {enhanceTools(enhanceField, `${name}: ${label}`, character[field] ?? "", (text) => setCharacter(index, { [field]: text }), { key: `${enhanceField}:${character.ref}`, character })}
            </div>
          );
          return (
            <fieldset key={character.ref}>
              <legend>{label}</legend>
              {box("name", "characterName", "Name", <input maxLength={80} value={character.name} onChange={(e) => setCharacter(index, { name: e.target.value })} />)}
              {box(
                "description",
                "characterDescription",
                "Description",
                <textarea rows={3} maxLength={LONG_TEXT} value={character.description} onChange={(e) => setCharacter(index, { description: e.target.value })} />,
              )}
              {full(character.description)}
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
    </div>,
    backTo("/", "Main Menu"),
    <>
      <span className="muted">Fills only the empty boxes.</span>
      <button type="button" className="quiet" disabled={!theme || [...worldBoxes, ...Object.values(draft.pc)].every((text) => text.trim())} onClick={fillForm}>
        Pick for me
      </button>
      <button type="button" className="action" onClick={next}>
        Next
      </button>
    </>,
  );
}
