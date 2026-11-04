import { type FormEvent, useEffect, useRef, useState } from "react";
import { createSave, generateWorld, getSettings, pickForMe, regenerateWorld, setupProblem, type PickField, type WorldChoices } from "./api";
import { Book } from "./menu";

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

const ART_STYLES: Record<string, string> = {
  "Cinematic Photorealism":
    "Ultra-detailed photorealistic style capturing hyper-accurate physics, micro-surface textures, natural volumetric light dispersion, realistic lens depth of field, and true-to-life subsurface scattering, indistinguishable from high-resolution digital cinema footage.",
  "Modern Digital Painting & Concept Art":
    "Clean, high-definition digital realism combining smooth blended gradients, rich volumetric atmosphere, dynamic lighting, and expressive digital brushwork—balancing sharp edge control with polished character and environment art rendering.",
  "Graphic Novel & Comic Illustration":
    "Bold graphic aesthetic defined by clean ink linework, stylized cell-shading, dynamic speed lines, sharp silhouettes, and saturated flat tones with optional Ben-Day halftone dot patterns.",
  "Cybertech & Retro-Futuristic Neon":
    "High-contrast, rain-slicked sci-fi aesthetic blending 1980s low-life street aesthetics with glowing neon-cyan and magenta palettes, hard-edged cyberware detail, dark atmospheric chiaroscuro, and wireframe perspective grids.",
  "Traditional Impasto Oil Painting":
    "Richly textured painterly realism featuring visible expressive brushstrokes, dynamic palette knife work, deep glazes, physical impasto texture, and dramatic chiaroscuro lighting across vibrant, wet-on-wet blended pigments.",
  "Luminous Fluid Watercolor":
    "Soft semi-translucent aesthetic characterized by delicate watery washes, soft-edge color bleeding, visible paper grain texture, expressive paint splatters, and vibrant pigment pooling along fine hand-drawn ink contours.",
  "Impressionism, Post-Impressionism & Expressionism":
    "Vibrant, light-focused style featuring rapid broken brushstrokes, unblended pure pigments, raw jagged linework, and non-naturalistic, emotionally intense color choices with visible motion.",
  "Medieval Romanesque & Gothic Manuscript":
    "Flat two-dimensional composition with bold ink outlines, stylized expressive figures, luminous gilded leafing, geometric drapery folds, and hierarchical scaling set against saturated primary pigments and intricate architectural border ornamentation.",
  "Japanese Ukiyo-e Woodblock":
    "Traditional Edo-period aesthetic defined by flat graphic compositions, strong black ink outlines, rhythmic wave and cloud motifs, subtle paper grain, and layered block-printed pigment washes.",
  "Art Nouveau Decorative Illustration":
    "Ornate turn-of-the-century aesthetic featuring sweeping organic curves, flowing stylized hair and drapery, flat-toned figures, and intricate floral frame borders inspired by Alphonse Mucha.",
  "Retro Sci-Fi Pulp Illustration":
    "High-contrast 1970s and 80s book-cover art featuring bold gouache and airbrush gradients, vivid speculative color palettes, dramatic heroic staging, painterly space hardware, and atmospheric cosmic dust.",
  "Architectural Blueprint & Technical Drafting":
    "Precision monochrome drafting style featuring crisp white or cyan vector linework on a dark background, grid overlays, detailed cross-sections, schematic callouts, and clean geometric typography.",
  "Surrealism & Dream Logic":
    "Mind-bending realism blending precise, dreamlike detail with impossible juxtaposition, melting forms, hyper-smooth gradients, and unsettling atmospheric lighting inspired by Salvador Dalí and René Magritte.",
  "Cubism & Geometric Abstraction":
    "Deconstructed perspective breaking subjects into sharp faceted geometric planes, overlapping angular shapes, and muted monochromatic tone palettes.",
  "Art Deco & Streamline Moderne":
    "Symmetrical luxury aesthetic featuring sharp geometric line work, metallic gold/bronze accents, sleek aerodynamic curves, high-contrast black-and-gold tones, and sunburst motifs.",
  "Modern Anime & Manga Illustration":
    "Polished Japanese graphic art style featuring sharp ink contour lines, vibrant cell-shading, expressive eye dynamics, clean hair clumps, and dramatic action-line perspective.",
};
const OWN_ART_STYLE = "Describe your own art style";

const blank = {
  theme: THEMES[0]!,
  ownTheme: "",
  worldBrief: "",
  hookOn: true,
  startingHook: "",
  artStyle: Object.keys(ART_STYLES)[0]!,
  ownArtStyle: "",
  name: "",
  /** The choices that made this world, as the form can change after it was generated. */
  world: undefined as { id: string; overview: string; choices: WorldChoices } | undefined,
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

function Heading({ step, title }: { step: number; title: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  // The control that led here is gone, so keyboard and screen reader users would otherwise restart from the top.
  useEffect(() => heading.current?.focus(), [step]);
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
  const leaving = useRef(new AbortController());
  const { signal } = leaving.current;

  useEffect(() => sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft)), [draft]);
  // Otherwise a world finishing later would pull the player back here from wherever they went.
  useEffect(() => () => leaving.current.abort(), []);
  useEffect(() => setError(""), [step]);
  useEffect(() => {
    getSettings().then((settings) => setSetupNotice(setupProblem(settings)), () => {});
  }, []);

  const theme = draft.theme === OWN_THEME ? draft.ownTheme.trim() : draft.theme;

  /** A failure changes nothing here, so everything the player wrote stays on the page to retry. */
  async function run(waiting: string, work: () => Promise<void>) {
    if (busy) return;
    setBusy(waiting);
    setError("");
    try {
      await work();
    } catch (failure) {
      setError((failure as Error).message);
    }
    setBusy("");
  }

  const pick = (field: PickField) =>
    run("The Narrator is thinking…", async () => {
      const text = await pickForMe(field, theme, draft.worldBrief, signal);
      // The box stays editable while this runs, and what the player typed wins.
      setDraft((current) => (current[field] ? current : { ...current, [field]: text }));
    });

  function generate(event: FormEvent) {
    event.preventDefault();
    const choices = { theme, worldBrief: draft.worldBrief, startingHook: draft.hookOn ? draft.startingHook : "" };
    // `required` accepts spaces, and a Starting Hook of spaces would quietly become a sandbox start.
    if (!theme || !draft.worldBrief.trim() || (draft.hookOn && !draft.startingHook.trim())) {
      return setError("Fill in each box with some words, use Pick for me, or turn the Starting Hook off.");
    }
    return run("The Narrator is building the world. This can take a minute or two.", async () => {
      set({ world: { ...(await generateWorld(choices, signal)), choices } });
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
      <p role="status" className="waiting">{busy}</p>
      {error && <p role="alert" className="error">{error}</p>}
    </>
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
      run("The Narrator is rebuilding the world. This can take a minute or two.", async () => {
        const { overview } = await regenerateWorld(world.id, world.choices, signal);
        set({ world: { ...world, overview } });
      });
    return (
      <Book
        left={
          <>
            <Heading step={2} title="The World Overview" />
            <p className="muted">What your PC would know. Accept this world, or have the Narrator make another.</p>
            <a className="quiet" href="#/new">Back to your choices</a>
          </>
        }
      >
        <div className="overview">
          <p>{world.overview}</p>
        </div>
        {feedback}
        <div className="row">
          <button type="button" className="quiet" disabled={!!busy} onClick={regenerate}>
            Regenerate
          </button>
          <a className="action" aria-disabled={!!busy || undefined} href={busy ? undefined : "#/new/pc"}>
            Accept
          </a>
        </div>
      </Book>
    );
  }

  if (world && step === "pc") {
    const begin = (event: FormEvent) => {
      event.preventDefault();
      const { worldBrief, startingHook } = world.choices;
      const artStyle =
        draft.artStyle === OWN_ART_STYLE ? draft.ownArtStyle : `${draft.artStyle}: ${ART_STYLES[draft.artStyle]}`;
      return run("Opening the book…", async () => {
        const { id } = await createSave({ worldId: world.id, worldBrief, startingHook, artStyle, pc: { name: draft.name } });
        sessionStorage.removeItem(STORAGE_KEY);
        location.hash = `/play/${id}`;
      });
    };
    return (
      <Book
        left={
          <>
            <Heading step={3} title="Of the PC" />
            <p className="muted">Name your PC, and the story starts on the next page.</p>
            <a className="quiet" href="#/new/overview">Back to the World Overview</a>
          </>
        }
      >
        <form className="fields" onSubmit={begin}>
          <label>
            PC name
            <input required value={draft.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          {feedback}
          <button className="action" disabled={!!busy}>
            Begin
          </button>
        </form>
      </Book>
    );
  }

  return (
    <Book
      left={
        <>
          <Heading step={1} title="Of the World" />
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
        </>
      }
    >
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
        <button className="action" disabled={!!busy}>
          {error ? "Try again" : "Generate the world"}
        </button>
      </form>
    </Book>
  );
}
