import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { WORKFLOW_EXAMPLE } from "../comfy-workflow";
import { chosenModels } from "../graph-builder";
import {
  askTextTest,
  type ComfyModels,
  drawComfyTest,
  getComfyModels,
  getSave,
  getSettings,
  getTextHosts,
  getTextModels,
  OPENROUTER_URL,
  saveArtStyle,
  saveSettings,
  type Settings,
  type TextHost,
  type TextTest,
} from "./api";
import { BookTabs, Sheet } from "./menu";

const SECTIONS = ["Text", "Images", "Reading", "Advanced"];

const LOG_LEVELS = [
  ["error", "Error"],
  ["warning", "Warning"],
  ["info", "Info"],
  ["verbose", "Verbose"],
] as const;
const RESOLUTIONS = [
  ["480p", "480p (848 × 480)"],
  ["720p", "720p (1280 × 720)"],
  ["1080p", "1080p (1920 × 1088)"],
  ["4k", "4K (3840 × 2160)"],
];
const THIS_STORY = "This story";

export const applyLook = ({ fontSize, theme }: Settings) => {
  document.documentElement.dataset.fontSize = fontSize;
  document.documentElement.dataset.theme = theme;
};

function useSubmit(save: () => Promise<string>) {
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setNotice("");
    setError("");
    try {
      setNotice(await save());
    } catch (failure) {
      setError((failure as Error).message);
    }
    setBusy(false);
  }

  const feedback = (
    <>
      <p role="status">{notice}</p>
      {error && <p role="alert" className="error">{error}</p>}
    </>
  );
  return { busy, submit, feedback };
}

function ArtStyle({ id }: { id: string }) {
  const [artStyle, setArtStyle] = useState<string>();
  const [loadError, setLoadError] = useState("");
  const { busy, submit, feedback } = useSubmit(async () => {
    await saveArtStyle(id, artStyle!);
    return "Art Style saved.";
  });

  useEffect(() => {
    getSave(id).then((save) => setArtStyle(save.artStyle), (failure: Error) => setLoadError(failure.message));
  }, [id]);

  if (loadError) return <p role="alert" className="error">{loadError}</p>;
  if (artStyle === undefined) return null;
  return (
    <form className="fields" onSubmit={submit}>
      <label>
        Art Style
        <textarea rows={4} value={artStyle} onChange={(e) => setArtStyle(e.target.value)} />
      </label>
      <p className="muted">This Save only. Changing it affects new images, not existing ones.</p>
      {feedback}
      <button className="action" aria-disabled={busy}>
        Save Art Style
      </button>
    </form>
  );
}

function ModelSelect({
  label,
  value,
  list,
  onChange,
}: {
  label: string;
  value: string;
  list: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">Choose a model</option>}
        {/* A saved model that's gone stays as it is, with a notice, until the player changes it. */}
        {[...new Set([value, ...list])].filter(Boolean).map((model) => (
          <option key={model}>{model}</option>
        ))}
      </select>
    </label>
  );
}

/** Whether `text` holds every word searched for, in any order, so "mimo pro" finds "xiaomi/mimo-v2.6-pro". */
export function matches(text: string, search: string) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => text.toLowerCase().includes(word));
}

type Choice = { value: string; label: string };

function Picker({
  label,
  empty,
  value,
  choices,
  onChange,
}: {
  label: string;
  empty?: string;
  value: string;
  choices: Choice[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [active, setActive] = useState(0);
  const picker = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const found = choices.filter((choice) => matches(choice.label, search));

  useEffect(() => {
    if (!open) return;
    const away = ({ target }: PointerEvent) => !picker.current?.contains(target as Node) && setOpen(false);
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const choose = (chosen: string) => {
    onChange(chosen);
    setOpen(false);
    button.current?.focus();
  };

  function keys(event: KeyboardEvent<HTMLInputElement>) {
    const moves: Record<string, () => void> = {
      ArrowDown: () => setActive(Math.min(active + 1, found.length - 1)),
      ArrowUp: () => setActive(Math.max(active - 1, 0)),
      // Enter would save the form, and Escape would close Settings.
      Enter: () => found[active] && choose(found[active].value),
      Escape: () => {
        setOpen(false);
        button.current?.focus();
      },
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    move();
  }

  return (
    <div className="picker" ref={picker}>
      <span id={`${id}-label`}>{label}</span>
      <button
        type="button"
        ref={button}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => {
          setSearch("");
          setActive(Math.max(choices.findIndex((choice) => choice.value === value), 0));
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>{choices.find((choice) => choice.value === value)?.label ?? (value || empty)}</span>
      </button>
      {open && (
        <div className="picker-panel">
          <input
            autoFocus
            role="combobox"
            aria-label={`Search ${label}`}
            aria-expanded
            aria-controls={`${id}-list`}
            aria-activedescendant={found[active] && `${id}-${active}`}
            autoComplete="off"
            placeholder={`Search ${choices.length} options`}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setActive(0);
            }}
            onKeyDown={keys}
          />
          <ul id={`${id}-list`} role="listbox" aria-labelledby={`${id}-label`} ref={list}>
            {found.map((choice, at) => (
              <li
                key={choice.value}
                id={`${id}-${at}`}
                role="option"
                aria-selected={choice.value === value}
                data-active={at === active || undefined}
                onClick={() => choose(choice.value)}
              >
                {choice.label}
              </li>
            ))}
            {found.length === 0 && <li className="muted">Nothing matches.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}

function WorkflowGuide() {
  return (
    <details className="workflow-guide">
      <summary>Placeholders and an example</summary>
      <p>
        Build the workflow in ComfyUI, use Export (API), and paste that file here. Then put these in its input values. A
        placeholder can be a whole value or sit inside longer text. Any you leave out are simply not used, but{" "}
        <code>{"{{prompt}}"}</code> is required.
      </p>
      <dl>
        <dt>
          <code>{"{{prompt}}"}</code>
        </dt>
        <dd>What the image shows. Art Style isn't included, so add it too if you want it.</dd>
        <dt>
          <code>{"{{negative_prompt}}"}</code>
        </dt>
        <dd>What to avoid.</dd>
        <dt>
          <code>{"{{art_style}}"}</code>
        </dt>
        <dd>This Save's Art Style.</dd>
        <dt>
          <code>{"{{aspect_ratio}}"}</code>, <code>{"{{width}}"}</code>, <code>{"{{height}}"}</code>
        </dt>
        <dd>
          The shape, such as 16:9, and a size of about one megapixel in multiples of 16. For SD 1.5, type your own size
          instead.
        </dd>
        <dt>
          <code>{"{{seed}}"}</code>
        </dt>
        <dd>A new random number for each image.</dd>
        <dt>
          <code>{"{{npc_1}}"}</code>, <code>{"{{npc_2}}"}</code> and on
        </dt>
        <dd>
          Portraits of visible NPCs, for a <code>LoadImage</code> node. Number 1 is the first visible NPC who has a portrait,
          not a set person, and the slot changes as the cast does.
        </dd>
        <dt>
          <code>{"{{previous_scene}}"}</code>, <code>{"{{pc}}"}</code>
        </dt>
        <dd>The previous Scene Image and the PC's portrait.</dd>
        <dt>
          <code>{"{{reference_1}}"}</code>, <code>{"{{reference_2}}"}</code> and on
        </dt>
        <dd>Every reference in order of priority: NPCs, then the previous Scene Image, then the PC.</dd>
        <dt>
          <code>{"{{has_npc_1}}"}</code>, <code>{"{{has_previous_scene}}"}</code>, <code>{"{{has_reference_1}}"}</code> and so
          on
        </dt>
        <dd>1 if that reference exists for this image, otherwise 0. Use one as an IPAdapter weight to turn its slot off.</dd>
      </dl>
      <p>
        Portraits and first Scenes have no references, so a slot with no image gets a small grey one and the workflow still
        runs. Give each slot a <code>has_</code> switch, or the grey will show. An img2img workflow can't turn off that way,
        so it starts those images from grey. References beyond your slots aren't sent.
      </p>
      <p>
        NovelForge keeps one image: a <code>SaveImage</code> if there is one, otherwise a <code>PreviewImage</code>, from
        the highest numbered node of that kind. An id like 12:3 from a subgraph counts as higher than any plain number.{" "}
        <code>SaveImage</code> also leaves a copy in ComfyUI's output folder.
      </p>
      <p>
        Your workflow brings its own models and LoRAs, so the LoRA list and trigger words here aren't used.
      </p>
      <pre>{WORKFLOW_EXAMPLE}</pre>
    </details>
  );
}

/** Tries the saved Settings without playing. `run` takes the prompt, and `children` shows what it returned. */
function TestBox<T>({
  title,
  hint,
  working,
  run,
  children,
}: {
  title: string;
  hint: string;
  working: string;
  run: (prompt: string, signal: AbortSignal) => Promise<T>;
  children: (result: T, prompt: string) => ReactNode;
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ value: T }>();
  const [error, setError] = useState("");
  const job = useRef<AbortController>(null);

  // Leaving Settings stops the job, so it doesn't hold up the GPU or run up a bill for something nobody will see.
  useEffect(() => () => job.current?.abort(), []);

  async function start() {
    if (busy || !prompt.trim()) return;
    const { signal } = (job.current = new AbortController());
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      setResult({ value: await run(prompt, signal) });
    } catch (failure) {
      if (!signal.aborted) setError((failure as Error).message);
    }
    setBusy(false);
  }

  return (
    <fieldset className="settings-test">
      <legend>{title}</legend>
      <label>
        Prompt
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <button type="button" className="action" aria-disabled={busy || !prompt.trim()} onClick={start}>
        {busy ? working : "Test"}
      </button>
      <p className="muted">{hint}</p>
      {error && <p className="notice">{error}</p>}
      {result && children(result.value, prompt)}
    </fieldset>
  );
}

function ComfyResult({ drawn, alt }: { drawn: Awaited<ReturnType<typeof drawComfyTest>>; alt: string }) {
  const [size, setSize] = useState("");
  useEffect(() => () => URL.revokeObjectURL(drawn.url), [drawn]);

  return (
    <>
      <img
        src={drawn.url}
        alt={alt}
        onLoad={({ currentTarget: { naturalWidth, naturalHeight } }) => setSize(`${naturalWidth} × ${naturalHeight}, `)}
      />
      <dl className="test-stats">
        <dt>Time</dt>
        <dd>{drawn.seconds.toFixed(1)}s</dd>
        <dt>Size</dt>
        <dd>
          {size}
          {(drawn.fileSize / 1e6).toFixed(1)} MB
        </dd>
        {drawn.model && (
          <>
            <dt>Model</dt>
            <dd>{drawn.model}</dd>
            <dt>Steps</dt>
            <dd>{drawn.steps}</dd>
            <dt>Seed</dt>
            <dd>{drawn.seed}</dd>
          </>
        )}
      </dl>
    </>
  );
}

function TextResult({ reply, seconds, firstSeconds, tokens, model }: TextTest) {
  // A server that sends the reply whole gives no writing time to measure.
  const writing = seconds - firstSeconds;
  return (
    <>
      {reply ? <p className="test-reply">{reply}</p> : <p className="notice">The model sent an empty reply.</p>}
      <dl className="test-stats">
        <dt>Time</dt>
        <dd>{seconds.toFixed(1)}s</dd>
        <dt>First word</dt>
        <dd>{firstSeconds.toFixed(1)}s</dd>
        <dt>Length</dt>
        <dd>About {tokens} tokens</dd>
        {writing >= 0.1 && (
          <>
            <dt>Speed</dt>
            <dd>About {Math.round(tokens / writing)} tokens/s</dd>
          </>
        )}
        <dt>Model</dt>
        <dd>{model}</dd>
      </dl>
    </>
  );
}

function ComfySettings({
  draft,
  saved,
  set,
}: {
  draft: Settings;
  saved: Settings;
  set: (change: Partial<Settings>) => void;
}) {
  const [models, setModels] = useState<ComfyModels>();
  const [refreshes, setRefreshes] = useState(0);
  const addLora = useRef<HTMLButtonElement>(null);
  const { comfySdBase, imageResolution } = draft;
  const tooBig =
    comfySdBase === "sd15" && imageResolution !== "480p"
      ? "SD 1.5 models are trained for small images, so this resolution may double faces and figures. 480p suits them best."
      : comfySdBase === "sdxl" && imageResolution === "4k"
        ? "SDXL models are trained for about 1024 pixels, so 4K may repeat subjects. 1080p or lower suits them best."
        : "";

  useEffect(() => {
    setModels(undefined);
    let current = true;
    const none = { reachable: false, hasFlux2: false, checkpoints: [], diffusionModels: [], textEncoders: [], vaes: [], loras: [] };
    getComfyModels().then(
      (list) => current && setModels(list),
      () => current && setModels(none),
    );
    return () => {
      current = false;
    };
  }, [saved, refreshes]);

  const addressSaved = draft.comfyUrl === saved.comfyUrl;
  const advanced = draft.comfyMode === "advanced";
  const flux2 = draft.comfyFamily === "flux2";
  const loras = models?.loras ?? [];
  const setLora = (index: number, change: Partial<Settings["comfyLoras"][number]>) =>
    set({ comfyLoras: draft.comfyLoras.map((lora, i) => (i === index ? { ...lora, ...change } : lora)) });

  const installed = models ? [...models.checkpoints, ...models.diffusionModels, ...models.textEncoders, ...models.vaes, ...loras] : [];
  const chosen = advanced ? [] : [...chosenModels(draft), ...draft.comfyLoras.map(({ name }) => name)];
  const missing = models?.reachable ? chosen.filter((name) => name && !installed.includes(name)) : [];

  return (
    <>
      <label>
        ComfyUI address
        <input
          type="url"
          required
          placeholder="http://127.0.0.1:8188"
          value={draft.comfyUrl}
          onChange={(e) => set({ comfyUrl: e.target.value })}
        />
      </label>
      <label>
        ComfyUI mode
        <select value={draft.comfyMode} onChange={(e) => set({ comfyMode: e.target.value as Settings["comfyMode"] })}>
          <option value="simple">Simple Mode</option>
          <option value="advanced">Advanced workflow</option>
        </select>
      </label>
      {advanced ? (
        <>
          <label>
            Workflow JSON (API format)
            <textarea
              className="workflow"
              rows={12}
              spellCheck={false}
              value={draft.comfyWorkflow}
              onChange={(e) => set({ comfyWorkflow: e.target.value })}
            />
          </label>
          {saved.workflowProblem && <p className="notice">The last image failed. {saved.workflowProblem}</p>}
          <WorkflowGuide />
        </>
      ) : (
        <>
          <label>
            Model family
            <select
              value={draft.comfyFamily}
              onChange={(e) => set({ comfyFamily: e.target.value as Settings["comfyFamily"] })}
            >
              <option value="sd">SD 1.5/SDXL</option>
              <option value="flux2">FLUX.2</option>
            </select>
          </label>
          {flux2 ? (
            <>
              <ModelSelect
                label="Diffusion model"
                value={draft.comfyDiffusionModel}
                list={models?.diffusionModels ?? []}
                onChange={(comfyDiffusionModel) => set({ comfyDiffusionModel })}
              />
              <ModelSelect
                label="Text encoder"
                value={draft.comfyTextEncoder}
                list={models?.textEncoders ?? []}
                onChange={(comfyTextEncoder) => set({ comfyTextEncoder })}
              />
              <ModelSelect
                label="VAE"
                value={draft.comfyVae}
                list={models?.vaes ?? []}
                onChange={(comfyVae) => set({ comfyVae })}
              />
            </>
          ) : (
            <>
              <ModelSelect
                label="Checkpoint"
                value={draft.comfyCheckpoint}
                list={models?.checkpoints ?? []}
                onChange={(comfyCheckpoint) => set({ comfyCheckpoint })}
              />
              <label>
                Checkpoint type
                <select
                  value={draft.comfySdBase}
                  onChange={(e) => set({ comfySdBase: e.target.value as Settings["comfySdBase"] })}
                >
                  <option value="sdxl">SDXL</option>
                  <option value="sd15">SD 1.5</option>
                </select>
              </label>
              {tooBig && <p className="notice">{tooBig}</p>}
            </>
          )}
          <fieldset>
            <legend>LoRAs</legend>
            {draft.comfyLoras.map((lora, index) => (
              <div className="lora" key={index}>
                <ModelSelect
                  label={`LoRA ${index + 1}`}
                  value={lora.name}
                  list={loras}
                  onChange={(name) => setLora(index, { name })}
                />
                <label>
                  Strength
                  {/* Uncontrolled, so the box can be empty while the player types. The key shows the right value after a removal. */}
                  <input
                    key={`${index} ${lora.name}`}
                    aria-label={`LoRA ${index + 1} strength`}
                    type="number"
                    required
                    step="0.05"
                    min="-100"
                    max="100"
                    defaultValue={lora.strength}
                    onChange={(e) => {
                      if (!Number.isNaN(e.target.valueAsNumber)) setLora(index, { strength: e.target.valueAsNumber });
                    }}
                  />
                </label>
                <label>
                  Trigger words (optional)
                  <input
                    aria-label={`LoRA ${index + 1} trigger words (optional)`}
                    value={lora.triggerWords}
                    onChange={(e) => setLora(index, { triggerWords: e.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="quiet"
                  aria-label={`Remove LoRA ${index + 1}`}
                  onClick={() => {
                    set({ comfyLoras: draft.comfyLoras.filter((_, i) => i !== index) });
                    // This button may be about to go, which would drop keyboard focus to the top of the page.
                    addLora.current?.focus();
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
            <button
              ref={addLora}
              type="button"
              className="quiet"
              aria-disabled={loras.length === 0}
              onClick={() => {
                if (loras.length > 0) {
                  set({ comfyLoras: [...draft.comfyLoras, { name: loras[0]!, strength: 1, triggerWords: "" }] });
                }
              }}
            >
              Add LoRA
            </button>
          </fieldset>
        </>
      )}
      <button
        type="button"
        className="quiet"
        aria-disabled={!models || !addressSaved}
        onClick={() => {
          if (models && addressSaved) setRefreshes(refreshes + 1);
        }}
      >
        {advanced ? "Test connection" : "Refresh lists"}
      </button>
      <p role="status" className="muted">
        {!addressSaved
          ? "Save the address to list this server's models."
          : !models
            ? "Asking ComfyUI what's installed."
            : models.reachable
              ? !advanced && models.loras.length === 0 && "No LoRAs installed."
              : "ComfyUI can't be reached at this address. Make sure it's running, then refresh."}
      </p>
      {addressSaved && missing.length > 0 && (
        <p className="notice">Not installed in ComfyUI: {missing.join(", ")}. Choose another or add the file, then refresh.</p>
      )}
      {addressSaved && !advanced && flux2 && models?.reachable && !models.hasFlux2 && (
        <p className="notice">This ComfyUI doesn't have FLUX.2's nodes yet. Update it to use this family.</p>
      )}
      <p className="muted">
        {advanced
          ? "Your workflow decides which references it uses, and which models and LoRAs."
          : flux2
            ? "Uses visible NPCs' portraits, the previous Scene Image and the PC's portrait as references, up to 10. Set up for FLUX.2 Dev and Klein 9B, so other Klein models may need an Advanced workflow."
            : "Uses the previous Scene Image as a reference. NPC references need FLUX.2 or an Advanced workflow."}
      </p>
      <TestBox
        title="Test image"
        hint="Uses your saved Settings. The image isn't kept."
        working="Drawing…"
        run={drawComfyTest}
      >
        {(drawn, prompt) => <ComfyResult drawn={drawn} alt={`Test image: ${prompt}`} />}
      </TestBox>
    </>
  );
}

function InstallSettings({
  initial,
  section,
  onSection,
  frame,
}: {
  initial: Settings;
  section: string;
  onSection: (section: string) => void;
  frame: (content: ReactNode, foot?: ReactNode) => ReactNode;
}) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  // Only ever what the player types now, because the server never sends a stored key.
  const [textKey, setTextKey] = useState("");
  const [imageKey, setImageKey] = useState("");
  const set = (change: Partial<Settings>) => setDraft({ ...draft, ...change });

  const local = draft.textBaseUrl !== OPENROUTER_URL;
  const addressSaved = draft.textBaseUrl === saved.textBaseUrl;
  // Not all servers list their models, so those keep the text box.
  const [models, setModels] = useState<string[]>();

  useEffect(() => {
    setModels(undefined);
    let current = true;
    const show = (list: string[]) => current && setModels(list);
    getTextModels().then(show, () => show([]));
    return () => {
      current = false;
    };
  }, [saved]);

  const [hosts, setHosts] = useState<TextHost[]>([]);
  const hostsListed = !local && addressSaved && !!models?.includes(draft.textModel);

  useEffect(() => {
    setHosts([]);
    if (!hostsListed) return;
    let current = true;
    getTextHosts(draft.textModel).then((list) => current && setHosts(list), () => {});
    return () => {
      current = false;
    };
  }, [hostsListed, draft.textModel]);

  // Hosts differ by model, so the old one may not offer a new one.
  const chooseModel = (textModel: string) => set({ textModel, textHost: textModel === draft.textModel ? draft.textHost : "" });

  const losesKey = saved.hasTextApiKey && draft.textBaseUrl !== saved.textBaseUrl && !textKey.trim();
  const keyHint = (stored: boolean) => (stored ? "Saved. Type a new key to replace it." : "None saved");

  const { busy, submit, feedback } = useSubmit(async () => {
    const { hasTextApiKey, hasImageApiKey, workflowProblem, ...change } = draft;
    const next = await saveSettings({
      ...change,
      ...(textKey.trim() && { textApiKey: textKey.trim() }),
      // Its field is hidden for Local, and a key the player can't see must not be stored.
      ...(draft.imageProvider === "openrouter" && imageKey.trim() && { imageApiKey: imageKey.trim() }),
    });
    setSaved(next);
    setDraft(next);
    setTextKey("");
    setImageKey("");
    applyLook(next);
    return saved.hasTextApiKey && !next.hasTextApiKey
      ? "Saved. The text API key was cleared because the server changed."
      : "Saved.";
  });

  return frame(
    <form
      id="settings-form"
      className="fields settings"
      hidden={section === THIS_STORY}
      onSubmit={submit}
      // A required box in a hidden section stops Save with nothing to show for it, so go there. In time for the browser to point at the box.
      onInvalidCapture={(event) => {
        const box = (event.target as HTMLElement).closest<HTMLElement>("[data-section]");
        if (box) flushSync(() => onSection(box.dataset.section!));
      }}
    >
      <div data-section="Text" className="fields" hidden={section !== "Text"}>
      <h2>Text</h2>
      <label>
        Text provider
        <select
          value={local ? "local" : "openrouter"}
          onChange={(e) => set({ textBaseUrl: e.target.value === "local" ? "" : OPENROUTER_URL })}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="local">Local</option>
        </select>
      </label>
      {local && (
        <label>
          Local server address
          <input
            type="url"
            required
            placeholder="http://localhost:1234/v1"
            value={draft.textBaseUrl}
            onChange={(e) => set({ textBaseUrl: e.target.value })}
          />
        </label>
      )}
      {addressSaved && models?.length ? (
        <Picker
          label="Text model"
          empty="Choose a model"
          value={draft.textModel}
          choices={models.map((model) => ({ value: model, label: model }))}
          onChange={chooseModel}
        />
      ) : (
        <label>
          Text model
          <input value={draft.textModel} onChange={(e) => chooseModel(e.target.value)} />
        </label>
      )}
      {local && !addressSaved && <p className="muted">Save the address to choose from this server's models.</p>}
      {addressSaved && models?.length === 0 && (
        <p className="muted">No models listed. Make sure the server is running, or type the model's name.</p>
      )}
      {!local && (
        <>
          <Picker
            label="Provider"
            value={draft.textHost}
            choices={[
              { value: "", label: "Any, using the routing below" },
              // A saved one stays as it is while its model's hosts load, or if they no longer include it.
              ...(draft.textHost && !hosts.some(({ slug }) => slug === draft.textHost) ? [{ value: draft.textHost, label: draft.textHost }] : []),
              ...hosts.map(({ slug, name }) => ({ value: slug, label: name })),
            ]}
            onChange={(textHost) => set({ textHost })}
          />
          {draft.textHost ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.textHostFallback}
                onChange={(e) => set({ textHostFallback: e.target.checked })}
              />
              If this provider is down, let OpenRouter use another
            </label>
          ) : (
            <label>
              Routing
              <select value={draft.textRouting} onChange={(e) => set({ textRouting: e.target.value as Settings["textRouting"] })}>
                <option value="price">Cheapest</option>
                <option value="throughput">Fastest writing</option>
                <option value="latency">Quickest to start</option>
                <option value="default">OpenRouter's choice</option>
              </select>
            </label>
          )}
          <p className="muted">Staying on one provider keeps its prompt cache, which can cut the cost of a Turn.</p>
        </>
      )}
      <label>
        {local ? "Text API key (most local servers need none)" : "Text API key"}
        <input
          type="password"
          autoComplete="new-password"
          placeholder={keyHint(saved.hasTextApiKey)}
          value={textKey}
          onChange={(e) => setTextKey(e.target.value)}
        />
      </label>
      {losesKey && (
        <p className="notice">
          A key only goes to the server it was entered for, so saving this new server clears the text API key. Enter
          a key above to use one with the new server.
        </p>
      )}
      <label>
        Extra Narrator Instructions
        <textarea
          rows={5}
          value={draft.modelInstructions}
          onChange={(e) => set({ modelInstructions: e.target.value })}
        />
      </label>
      <p className="muted">Your own guidance to the Narrator, for every Save.</p>
      <TestBox
        title="Test text"
        hint="Sends this prompt to your saved model, with the saved Extra Narrator Instructions above. OpenRouter may charge for each test."
        working="Asking…"
        run={askTextTest}
      >
        {(result) => <TextResult {...result} />}
      </TestBox>
      </div>

      <div data-section="Images" className="fields" hidden={section !== "Images"}>
      <h2>Images</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={draft.imagesEnabled}
          onChange={(e) => set({ imagesEnabled: e.target.checked })}
        />
        Create new images
      </label>
      <p className="muted">Images you already have stay on show either way.</p>
      <label>
        Image provider
        <select
          value={draft.imageProvider}
          onChange={(e) => set({ imageProvider: e.target.value as Settings["imageProvider"] })}
        >
          <option value="openrouter">OpenRouter</option>
          <option value="local">Local (ComfyUI)</option>
        </select>
      </label>
      <label>
        Resolution
        <select
          value={draft.imageResolution}
          onChange={(e) => set({ imageResolution: e.target.value as Settings["imageResolution"] })}
        >
          {RESOLUTIONS.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
      {draft.imageProvider === "openrouter" ? (
        <>
          <p className="muted">
            OpenRouter uses the nearest size your model offers, so the image may not match exactly. Larger sizes can cost
            more, and some models have no size choice, so this changes nothing for them.
          </p>
          <label>
            Image model
            <input value={draft.imageModel} onChange={(e) => set({ imageModel: e.target.value })} />
          </label>
          <label>
            Image API key
            <input
              type="password"
              autoComplete="new-password"
              placeholder={keyHint(saved.hasImageApiKey)}
              value={imageKey}
              onChange={(e) => setImageKey(e.target.value)}
            />
          </label>
        </>
      ) : (
        <ComfySettings draft={draft} saved={saved} set={set} />
      )}
      </div>

      <div data-section="Reading" className="fields" hidden={section !== "Reading"}>
      <h2>Reading</h2>
      <label>
        Theme
        <select value={draft.theme} onChange={(e) => set({ theme: e.target.value as Settings["theme"] })}>
          <option value="system">Match this device</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        Chat style
        <select
          value={draft.chatStyle}
          onChange={(e) => set({ chatStyle: e.target.value as Settings["chatStyle"] })}
        >
          <option value="script">Script</option>
          <option value="prose">Prose</option>
          <option value="bubbles">Bubbles</option>
          <option value="stage">Stage box</option>
        </select>
      </label>
      <label>
        Font size
        <select
          value={draft.fontSize}
          onChange={(e) => set({ fontSize: e.target.value as Settings["fontSize"] })}
        >
          <option value="small">Small</option>
          <option value="medium">Medium</option>
          <option value="large">Large</option>
        </select>
      </label>
      </div>

      <div data-section="Advanced" className="fields" hidden={section !== "Advanced"}>
      <h2>Advanced</h2>
      <label>
        Log Level
        <select
          value={draft.logLevel ?? ""}
          onChange={(e) => set({ logLevel: (e.target.value || null) as Settings["logLevel"] })}
        >
          <option value="">Default ({LOG_LEVELS.find(([value]) => value === draft.defaultLogLevel)?.[1]})</option>
          {LOG_LEVELS.map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <p className="muted">
        How much the app writes to its Server Log, from Error, only what failed, to Verbose, every step. It changes as soon as
        you save, and the log never holds story text.
      </p>
      </div>
    </form>,
    section !== THIS_STORY && (
      <>
        {feedback}
        <div className="row">
          <button form="settings-form" className="action" aria-disabled={busy}>
            Save settings
          </button>
        </div>
      </>
    ),
  );
}

export function SettingsScreen({ id }: { id?: string }) {
  const [settings, setSettings] = useState<Settings>();
  const [loadError, setLoadError] = useState("");
  const [section, setSection] = useState(SECTIONS[0]!);

  useEffect(() => {
    getSettings().then(setSettings, (failure: Error) => setLoadError(failure.message));
  }, []);

  const frame = (content: ReactNode, foot?: ReactNode) => (
    <Sheet
      view={section}
      foot={foot}
      tabs={id && <BookTabs id={id} current="Settings" />}
      rail={
        <>
          <h1 className="big">Settings</h1>
          <nav aria-label="Settings sections">
            {[...(id ? [THIS_STORY] : []), ...SECTIONS].map((name) => (
              <button key={name} type="button" aria-current={name === section || undefined} onClick={() => setSection(name)}>
                {name}
              </button>
            ))}
          </nav>
          {!id && <p className="muted so-far">Open a story to change its Art Style.</p>}
          <a className="quiet" href="#/">
            Main Menu
          </a>
        </>
      }
    >
      {loadError && <p role="alert" className="error">{loadError}</p>}
      {/* Stays mounted, so an unsaved edit survives a look at another section. */}
      {id && (
        <div hidden={section !== THIS_STORY}>
          <ArtStyle key={id} id={id} />
        </div>
      )}
      {content}
    </Sheet>
  );

  return settings ? <InstallSettings initial={settings} section={section} onSection={setSection} frame={frame} /> : frame(null);
}
