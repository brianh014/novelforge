import { Fragment, type ReactNode, useEffect, useRef, useState } from "react";
import { ArtStylePicker, artStyleText, OWN_ART_STYLE } from "./art-style-picker";
import { roman } from "./chat-style";
import { PlayModePicker } from "./play-choices";
import {
  beginStory,
  type Character,
  drawOnForm,
  type EnhanceField,
  enhance,
  generateWorld,
  getSettings,
  type HeldPicture,
  pickForMe,
  regenerateWorld,
  setupProblem,
  uploadHeldImage,
} from "./api";
import { DecideIcon, EditIcon } from "./icons";
import { ConfirmDialog, MenuRibbon, Sheet } from "./menu";
import { blank, characterLabel, type Draft, newRef, npcPicture, OWN_THEME, redrew, STEPS, STORAGE_KEY, stored, THEMES, withCoverChoice } from "./wizard-draft";
import { WorldForm } from "./wizard-form";
import { Heading, LeaveWorld, PickForMe, Working } from "./wizard-frame";
import { type Naming, PictureSection } from "./wizard-pictures";

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
  const [picking, setPicking] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  /** What each box held before Enhance, as replacing a box's value leaves nothing for the browser's own undo. */
  // Keyed by field, and by row as well for an Important Character's.
  const [enhanced, setEnhanced] = useState<Record<string, { was: string; now: string }>>({});
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));
  const running = useRef<AbortController>(undefined);

  const { world, id: worldId } = draft;
  const page = step === "overview" && world && worldId ? "overview" : step === "art" ? "art" : "form";

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {}
  }, [draft]);
  // Otherwise a world finishing later would pull the player back here from wherever they went.
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => setError(""), [step]);
  // However the player came back, the world no longer matches what they may now change.
  useEffect(() => {
    if (page !== "overview" && world) set({ world: undefined });
  }, [page]);
  useEffect(() => {
    getSettings().then(
      (settings) => {
        setSetupNotice(setupProblem(settings));
        setImagesReady(settings.imagesReady);
      },
      () => {},
    );
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

  const worldChoices = {
    title: draft.title,
    theme: themeForNarrator,
    worldBrief: draft.worldBrief,
    startingHook: draft.hookOn ? draft.startingHook : "",
    characters: withCoverChoice(draft.characters),
    pcOnCover: draft.pcOnCover,
  };

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
    const characters = worldChoices.characters.map(({ name, description, ref, onCover }) => ({
      name: name.trim(),
      description: description.trim(),
      ref,
      onCover,
    }));
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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );

  const frame = (here: number, content: ReactNode, back: ReactNode, foot: ReactNode) => (
    <Sheet
      view={here}
      lockRail={!!busy}
      // The first step's way back to the main menu, as the ribbon the other screens outside a story have.
      tabs={here === 0 && !busy && <MenuRibbon />}
      rail={
        <nav aria-label="Steps" className="wizard-steps">
          {STEPS.map(({ name, hash }, index) => {
            const label = `${roman(index + 1)}. ${name}`;
            if (index === here)
              return (
                <a key={name} href={`#${hash}`} aria-current="step">
                  {label}
                </a>
              );
            // Only back, as a later step needs the earlier ones done. Leaving the world asks first, as it discards it.
            if (index > here) return <span key={name}>{label}</span>;
            return page === "overview" ? (
              <button key={name} type="button" aria-haspopup="dialog" onClick={() => setLeaving(hash)}>
                {label}
              </button>
            ) : (
              <a key={name} href={`#${hash}`}>
                {label}
              </a>
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
      {picking && <PickForMe onPick={fillForm} onClose={() => setPicking(false)} />}
    </Sheet>
  );

  const backTo = (hash: string, label = "Back") => (
    <a className="quiet leave" href={`#${hash}`}>
      {label}
    </a>
  );

  const setCharacter = (index: number, change: Partial<Character>) =>
    setDraft((current) => ({ ...current, characters: current.characters.map((character, at) => (at === index ? { ...character, ...change } : character)) }));

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

  const { title, worldBrief } = draft;
  const physicalTraits = draft.pc.physicalTraits;

  /** Everyone the player put on the Cover, who each need a picture before it's drawn, as it draws them from those pictures. */
  const unpictured = [...(draft.pcOnCover ? ["portrait"] : []), ...draft.characters.filter(({ onCover }) => onCover).map(npcPicture)].filter(
    (picture) => draft.drawn[picture] === undefined,
  );

  /** `ask` is what the picture is drawn from. */
  const pictureSection = (
    picture: HeldPicture,
    legend: string,
    naming: Naming,
    missing: string,
    ask: Parameters<typeof drawOnForm>[0],
    onCover?: { on: boolean; set: (on: boolean) => void },
  ) => (
    <PictureSection
      key={picture}
      picture={picture}
      legend={legend}
      naming={naming}
      missing={missing}
      onCover={onCover}
      id={draft.id}
      version={draft.drawn[picture]}
      nudge={draft.nudges[picture]}
      imagesReady={imagesReady}
      asking={asking}
      onDraw={(nudge) => drawFirst(picture, ask, nudge)}
      onUpload={(file) => uploadOwn(picture, file)}
      // The player may have gone on by the time a Redraw ends, so these go by what the draft holds then.
      onRedrawn={() => setDraft((current) => ({ ...current, drawn: redrew(current.drawn, picture) }))}
      onLost={() =>
        setDraft((current) => {
          const { [picture]: _, ...drawn } = current.drawn;
          return { ...current, drawn };
        })
      }
    />
  );

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
    {
      kind: "cover",
      title,
      ...setting,
      pc: { name: draft.pc.name, physicalTraits },
      pcOnCover: draft.pcOnCover,
      characters: worldChoices.characters,
      inventory: draft.pc.inventory,
    },
  );

  if (page === "overview") {
    const regenerate = () =>
      run("The Narrator is rebuilding the world. This can take a few minutes.", async (signal) => {
        const { overview } = await regenerateWorld(worldId!, { ...worldChoices, artStyle }, signal);
        setDraft((current) => ({ ...current, world: { overview }, drawn: redrew(current.drawn, ...allPictures) }));
      });
    const begin = () =>
      run("Opening the book…", async (signal) => {
        const { id } = await beginStory(worldId!, artStyle, draft.playMode, signal);
        sessionStorage.removeItem(STORAGE_KEY);
        location.hash = `/play/${id}`;
      });
    const edit = (to: string, label: string) => (
      <button type="button" className="icon" title="Edit" aria-label={label} aria-haspopup="dialog" onClick={() => setLeaving(to)}>
        {EditIcon}
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
          <p className="muted">
            What your PC would know. Begin the story in this world, or have the Narrator make another. Changing a picture keeps the world.
          </p>
        </div>
        <div className="overview">
          <p>{world!.overview}</p>
        </div>
        <section className="fields wizard">
          <div className="row">
            <h2>Your choices</h2>
            {edit("/new", "Edit your choices")}
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
            {edit("/new/art", "Edit the art")}
          </div>
          <dl>{shown("Art Style", draft.artStyle === OWN_ART_STYLE ? draft.ownArtStyle : draft.artStyle)}</dl>
          <div className="drawn-pair">
            {coverPicture}
            {pcPicture}
            {characterPictures}
          </div>
        </section>
        <section className="fields wizard">
          <PlayModePicker
            value={draft.playMode}
            intro={<p className="muted">Type what your character does, or pick one of three Choices after each response. You can switch during the story.</p>}
            onChange={(playMode) => set({ playMode })}
          />
        </section>
      </div>,
      <button type="button" className="quiet leave" aria-haspopup="dialog" onClick={() => setLeaving("/new/art")}>
        Back
      </button>,
      <>
        <button type="button" className="quiet" aria-haspopup="dialog" onClick={() => setRebuilding(true)}>
          Regenerate
        </button>
        <button type="button" className="action" onClick={begin}>
          {error ? "Try again" : "Begin"}
        </button>
        {rebuilding && (
          <ConfirmDialog
            title="Regenerate this world?"
            confirm="Regenerate"
            onConfirm={() => {
              // Shut here too, as the foot goes while the Narrator works and the dialog's own close event goes with it.
              setRebuilding(false);
              regenerate();
            }}
            onClose={() => setRebuilding(false)}
          >
            <p>
              The Narrator builds the world again from your choices, which can take a few minutes. The world written now is gone for good. Your pictures stay.
            </p>
          </ConfirmDialog>
        )}
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
            intro={
              <p className="muted">Every picture in your story is drawn in this style. You can change it during the story, and it affects new pictures only.</p>
            }
            onName={(artStyle) => set({ artStyle })}
            onOwn={(ownArtStyle) => set({ ownArtStyle })}
          />
        </div>
        <div>
          <h2>Pictures</h2>
          <p className="muted">
            A portrait of your character and each Important Character, and the Cover, which shows them. Draw or upload each now, or leave any and it's drawn
            when the world is written.
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

  const worldBoxes = [draft.worldBrief, draft.title, ...(draft.hookOn ? [draft.startingHook] : [])];

  return frame(
    0,
    <WorldForm
      draft={draft}
      setDraft={setDraft}
      setCharacter={setCharacter}
      enhanceTools={enhanceTools}
      heading={<Heading step={1} title="Your World and Characters" busy={!!busy} />}
    />,
    null,
    <>
      <button
        type="button"
        className="icon pick"
        title="Pick for me"
        aria-label="Pick for me"
        aria-haspopup="dialog"
        disabled={!theme || [...worldBoxes, ...Object.values(draft.pc)].every((text) => text.trim())}
        onClick={() => setPicking(true)}
      >
        {DecideIcon}
      </button>
      <button type="button" className="action" onClick={next}>
        Next
      </button>
    </>,
  );
}
