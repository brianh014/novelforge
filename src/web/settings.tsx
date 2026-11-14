import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { WORKFLOW_EXAMPLE } from "../comfy-workflow";
import { chosenModels, familyDefaults, switchFamily } from "../graph-builder";
import { ArtStylePicker, artStyleText, readArtStyle } from "./art-style-picker";
import {
  askTextTest,
  type ComfyModels,
  drawComfyTest,
  getComfyModels,
  getSave,
  getSettings,
  getTextHosts,
  getImageModels,
  GOOGLE_URL,
  NANOGPT_URL,
  getTextModels,
  OPENROUTER_URL,
  type PlayMode,
  saveArtStyle,
  savePlayMode,
  saveSettings,
  type Settings,
  type TextHost,
  type TextTest,
} from "./api";
import { ChoicesIcon } from "./icons";
import { BookTabs, MenuRibbon, Sheet } from "./menu";
import { UpdatesSection } from "./new-version";
import { PlayModePicker } from "./play-choices";

const SECTIONS = ["Text", "Images", "Reading", "Advanced"];

const LOG_LEVELS = [
  ["error", "Error"],
  ["warning", "Warning"],
  ["info", "Info"],
  ["verbose", "Verbose"],
] as const;
const RESOLUTIONS = [
  ["0.5k", "0.5K (512 × 512 portrait, 688 × 384 scene)"],
  ["1k", "1K (1024 × 1024 portrait, 1360 × 768 scene)"],
  ["1.5k", "1.5K (1536 × 1536 portrait, 2048 × 1152 scene)"],
  ["2k", "2K (2048 × 2048 portrait, 2736 × 1536 scene)"],
] as const;
const THIS_STORY = "This story";
/** Not a setting, so outside the form and its Save. */
const UPDATES = "Updates";

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
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
  return { busy, submit, feedback };
}

function ArtStyle({ id }: { id: string }) {
  const [artStyle, setArtStyle] = useState<ReturnType<typeof readArtStyle>>();
  const [loadError, setLoadError] = useState("");
  const { busy, submit, feedback } = useSubmit(async () => {
    await saveArtStyle(id, artStyleText(artStyle!.name, artStyle!.own));
    return "Art Style saved.";
  });

  useEffect(() => {
    getSave(id).then(
      (save) => setArtStyle(readArtStyle(save.artStyle)),
      (failure: Error) => setLoadError(failure.message),
    );
  }, [id]);

  if (loadError)
    return (
      <p role="alert" className="error">
        {loadError}
      </p>
    );
  if (artStyle === undefined) return null;
  return (
    <form className="fields" onSubmit={submit}>
      <ArtStylePicker
        name={artStyle.name}
        own={artStyle.own}
        onName={(name) => setArtStyle({ ...artStyle, name })}
        onOwn={(own) => setArtStyle({ ...artStyle, own })}
      />
      <p className="muted">This Save only. Changing it affects new images, not existing ones.</p>
      {feedback}
      <button type="submit" className="action" aria-disabled={busy}>
        Save Art Style
      </button>
    </form>
  );
}

function PlayModeSetting({ id }: { id: string }) {
  const [playMode, setPlayMode] = useState<PlayMode>();
  const { busy, submit, feedback } = useSubmit(async () => {
    await savePlayMode(id, playMode!);
    return "Play Mode saved.";
  });

  useEffect(() => {
    // ArtStyle shows a failure to load, which this shares.
    getSave(id).then(
      (save) => setPlayMode(save.playMode),
      () => {},
    );
  }, [id]);

  if (playMode === undefined) return null;
  return (
    <form className="fields" onSubmit={submit}>
      <PlayModePicker value={playMode} onChange={setPlayMode} />
      <p className="muted">
        This Save only. A response written in Free Text has no Choices: Regenerate it, or switch with the button by the story's text box, which offers to.
      </p>
      {feedback}
      <button type="submit" className="action" aria-disabled={busy}>
        Save Play Mode
      </button>
    </form>
  );
}

function ModelSelect({ label, value, list, onChange }: { label: string; value: string; list: string[]; onChange: (value: string) => void }) {
  return (
    <Picker
      label={label}
      empty="Choose a model"
      value={value}
      // A saved model that's gone stays as it is, with a notice, until the player changes it.
      choices={[...new Set([value, ...list])].filter(Boolean).map((model) => ({ value: model, label: model }))}
      onChange={onChange}
    />
  );
}

// The named text providers, by the address each is reached at.
const TEXT_PROVIDERS = { openrouter: OPENROUTER_URL, google: GOOGLE_URL, nanogpt: NANOGPT_URL };

// Not a model id, as those always hold a letter.
const TYPE_OWN = "\u0000type";

/**
 * A provider's models to choose from, and a way to type one the list leaves out, such as a Wiro model past its first 500. With
 * no list, or one typed, it's a text box. Give it a `key` per provider, so a switch shows the new one's list.
 */
function ModelField({ label, value, list, onChange }: { label: string; value: string; list?: string[]; onChange: (value: string) => void }) {
  const [typing, setTyping] = useState(false);
  if (!list?.length || typing) {
    return (
      <div className="typed-model">
        <label>
          {label}
          <input value={value} onChange={(e) => onChange(e.target.value)} />
        </label>
        {!!list?.length && (
          <button
            type="button"
            className="icon"
            title="Choose from the list"
            aria-label={`Choose the ${label.toLowerCase()} from the list`}
            onClick={() => setTyping(false)}
          >
            {ChoicesIcon}
          </button>
        )}
      </div>
    );
  }
  return (
    <Picker
      label={label}
      empty="Choose a model"
      value={value}
      // A typed model the list leaves out stays as it is until the player changes it.
      choices={[
        ...[...new Set([value, ...list])].filter(Boolean).map((model) => ({ value: model, label: model })),
        { value: TYPE_OWN, label: "Type a model name…" },
      ]}
      onChange={(chosen) => (chosen === TYPE_OWN ? setTyping(true) : onChange(chosen))}
    />
  );
}

/** Whether `text` holds every word searched for, in any order, so "mimo pro" finds "xiaomi/mimo-v2.6-pro". */
export function matches(text: string, search: string) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return words.every((word) => text.toLowerCase().includes(word));
}

/** A dropdown drawn in the page rather than the browser's own, so it looks like the book and opens the same everywhere. Long lists get a search box. */
function Picker<T extends string>({
  label,
  empty,
  value,
  choices,
  onChange,
}: {
  label: string;
  empty?: string;
  value: T;
  choices: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const searchable = choices.length > 8;
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
    // Tabbing away closes it too. A press on an option of a searchable list moves focus nowhere, and must not close it before the click.
    const left = ({ relatedTarget }: FocusEvent) => relatedTarget && !picker.current?.contains(relatedTarget as Node) && setOpen(false);
    const at = picker.current;
    document.addEventListener("pointerdown", away);
    at?.addEventListener("focusout", left);
    return () => {
      document.removeEventListener("pointerdown", away);
      at?.removeEventListener("focusout", left);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  // React's autoFocus only reaches form controls, so a list with no search box is focused here.
  useEffect(() => {
    if (open && !searchable) list.current?.focus();
  }, [open, searchable]);

  const choose = (chosen: T) => {
    onChange(chosen);
    setOpen(false);
    button.current?.focus();
  };

  function keys(event: KeyboardEvent<HTMLElement>) {
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
          setActive(
            Math.max(
              choices.findIndex((choice) => choice.value === value),
              0,
            ),
          );
          setOpen(!open);
        }}
      >
        <span id={`${id}-value`}>{choices.find((choice) => choice.value === value)?.label ?? (value || empty)}</span>
      </button>
      {open && (
        <div className="picker-panel">
          {searchable && (
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
          )}
          {/* With no search box, the list itself takes focus and the arrow keys. */}
          <ul
            id={`${id}-list`}
            // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA listbox pattern, moved through by aria-activedescendant.
            role="listbox"
            aria-labelledby={`${id}-label`}
            ref={list}
            {...(!searchable && {
              tabIndex: -1,
              "aria-activedescendant": found[active] && `${id}-${active}`,
              onKeyDown: keys,
            })}
          >
            {found.map((choice, at) => (
              // biome-ignore lint/a11y/useFocusableInteractive: an option of the listbox above, reached by its arrow keys, not by focus of its own.
              // biome-ignore lint/a11y/useKeyWithClickEvents: as above, the keys are handled on the search box or the list.
              <li
                key={choice.value}
                id={`${id}-${at}`}
                // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: an option of the ARIA listbox above.
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
        Build the workflow in ComfyUI, use Export (API), and paste that file here. Then put these in its input values. A placeholder can be a whole value or sit
        inside longer text. Any you leave out are simply not used, but <code>{"{{prompt}}"}</code> is required.
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
        <dd>The shape, such as 16:9, and a size at the Resolution below, in multiples of 16. For SD 1.5, type your own size instead.</dd>
        <dt>
          <code>{"{{seed}}"}</code>
        </dt>
        <dd>A new random number for each image.</dd>
        <dt>
          <code>{"{{npc_1}}"}</code>, <code>{"{{npc_2}}"}</code> and on
        </dt>
        <dd>
          Portraits of visible NPCs, for a <code>LoadImage</code> node. Number 1 is the first visible NPC who has a portrait, not a set person, and the slot
          changes as the cast does.
        </dd>
        <dt>
          <code>{"{{pc}}"}</code>
        </dt>
        <dd>The PC's portrait.</dd>
        <dt>
          <code>{"{{reference_1}}"}</code>, <code>{"{{reference_2}}"}</code> and on
        </dt>
        <dd>Every reference in order of priority: the PC, then NPCs.</dd>
        <dt>
          <code>{"{{has_npc_1}}"}</code>, <code>{"{{has_reference_1}}"}</code> and so on
        </dt>
        <dd>1 if that reference exists for this image, otherwise 0. Use one as an IPAdapter weight to turn its slot off.</dd>
      </dl>
      <p>
        Portraits and first Scenes have no references, so a slot with no image gets a small grey one and the workflow still runs. Give each slot a{" "}
        <code>has_</code> switch, or the grey will show. An img2img workflow can't turn off that way, so it starts those images from grey. References beyond
        your slots aren't sent.
      </p>
      <p>
        NovelForge keeps one image: a <code>SaveImage</code> if there is one, otherwise a <code>PreviewImage</code>, from the highest numbered node of that
        kind. An id like 12:3 from a subgraph counts as higher than any plain number. <code>SaveImage</code> also leaves a copy in ComfyUI's output folder.
      </p>
      <p>Your workflow brings its own models and LoRAs, so the LoRA list and trigger words here aren't used.</p>
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
    job.current = new AbortController();
    const { signal } = job.current;
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
      <img src={drawn.url} alt={alt} onLoad={({ currentTarget: { naturalWidth, naturalHeight } }) => setSize(`${naturalWidth} × ${naturalHeight}, `)} />
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

function ComfySettings({ draft, saved, set }: { draft: Settings; saved: Settings; set: (change: Partial<Settings>) => void }) {
  const [models, setModels] = useState<ComfyModels>();
  const [refreshes, setRefreshes] = useState(0);
  const addLora = useRef<HTMLButtonElement>(null);
  // A key per LoRA row that stays with it when one above is removed, as the same file may be listed twice.
  const loraKeys = useRef<number[]>([]);
  const nextLoraKey = useRef(0);
  const { comfySdBase, imageResolution } = draft;
  const tooBig =
    comfySdBase === "sd15" && imageResolution !== "0.5k"
      ? "SD 1.5 models are trained for small images, so this resolution may double faces and figures. 0.5K suits them best."
      : comfySdBase === "sdxl" && imageResolution !== "1k"
        ? "SDXL models are trained for about 1K, so larger sizes may repeat subjects. 1K suits them best."
        : "";

  useEffect(() => {
    setModels(undefined);
    let current = true;
    const none = {
      reachable: false,
      hasFlux2: false,
      hasQwen21: false,
      checkpoints: [],
      diffusionModels: [],
      textEncoders: [],
      vaes: [],
      loras: [],
      samplers: [],
      schedulers: [],
    };
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
  const qwen21 = draft.comfyFamily === "qwen21";
  const loras = models?.loras ?? [];
  loraKeys.current.length = Math.min(loraKeys.current.length, draft.comfyLoras.length);
  while (loraKeys.current.length < draft.comfyLoras.length) loraKeys.current.push(nextLoraKey.current++);
  const setLora = (index: number, change: Partial<Settings["comfyLoras"][number]>) =>
    set({ comfyLoras: draft.comfyLoras.map((lora, i) => (i === index ? { ...lora, ...change } : lora)) });

  const installed = models ? [...models.checkpoints, ...models.diffusionModels, ...models.textEncoders, ...models.vaes, ...loras] : [];
  const chosen = advanced ? [] : [...chosenModels(draft), ...draft.comfyLoras.map(({ name }) => name)];
  const missing = models?.reachable ? chosen.filter((name) => name && !installed.includes(name)) : [];

  return (
    <>
      <label>
        ComfyUI address
        <input type="url" required placeholder="http://127.0.0.1:8188" value={draft.comfyUrl} onChange={(e) => set({ comfyUrl: e.target.value })} />
      </label>
      <Picker
        label="ComfyUI mode"
        value={draft.comfyMode}
        choices={[
          { value: "simple", label: "Simple Mode" },
          { value: "advanced", label: "Advanced workflow" },
        ]}
        onChange={(comfyMode) => set({ comfyMode })}
      />
      <label className="toggle">
        <input type="checkbox" checked={draft.comfyFreeMemory} onChange={(e) => set({ comfyFreeMemory: e.target.checked })} />
        Free GPU memory after each picture
      </label>
      <p className="muted">
        Frees the GPU for other programs, such as a local text model or a game. ComfyUI then loads its model again for each picture, which takes a few seconds
        more.
      </p>
      {advanced ? (
        <>
          <label>
            Workflow JSON (API format)
            <textarea className="workflow" rows={12} spellCheck={false} value={draft.comfyWorkflow} onChange={(e) => set({ comfyWorkflow: e.target.value })} />
          </label>
          {saved.workflowProblem && <p className="notice">The last image failed. {saved.workflowProblem}</p>}
          <WorkflowGuide />
        </>
      ) : (
        <>
          <Picker
            label="Model family"
            value={draft.comfyFamily}
            choices={[
              { value: "sd", label: "SD 1.5/SDXL (faces change between pictures)" },
              { value: "flux2", label: "FLUX.2" },
              { value: "qwen21", label: "Qwen Image 2.1" },
            ]}
            onChange={(family) => {
              // A new list of LoRAs, so new rows, or a strength box would keep the last family's value.
              loraKeys.current = [];
              set(switchFamily(draft, family));
            }}
          />
          {flux2 || qwen21 ? (
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
              <ModelSelect label="VAE" value={draft.comfyVae} list={models?.vaes ?? []} onChange={(comfyVae) => set({ comfyVae })} />
            </>
          ) : (
            <>
              <ModelSelect
                label="Checkpoint"
                value={draft.comfyCheckpoint}
                list={models?.checkpoints ?? []}
                onChange={(comfyCheckpoint) => set({ comfyCheckpoint })}
              />
              <Picker
                label="Checkpoint type"
                value={draft.comfySdBase}
                choices={[
                  { value: "sdxl", label: "SDXL" },
                  { value: "sd15", label: "SD 1.5" },
                ]}
                onChange={(comfySdBase) => set({ comfySdBase })}
              />
              {tooBig && <p className="notice">{tooBig}</p>}
              <p className="muted">
                SD 1.5 and SDXL draw from words alone. They can't use portraits or edit an image, so faces change from picture to picture, and Update draws a
                new face. FLUX.2 and Qwen Image 2.1 keep faces the same.
              </p>
            </>
          )}
          <label className="toggle">
            <input
              type="checkbox"
              checked={draft.comfyDefaults}
              onChange={(e) => {
                // Turning it off starts from the defaults, so the player tweaks what the model was using.
                const own = familyDefaults(draft);
                const filled = { comfySteps: own.steps, comfyCfg: own.cfg, comfySampler: own.sampler, comfyScheduler: own.scheduler };
                set(e.target.checked ? { comfyDefaults: true } : { comfyDefaults: false, ...filled });
              }}
            />
            Use model defaults for steps, CFG, sampler and scheduler
          </label>
          {!draft.comfyDefaults && (
            <>
              <label>
                Steps
                <input
                  type="number"
                  required
                  min={1}
                  max={150}
                  value={draft.comfySteps ?? ""}
                  onChange={(e) => set({ comfySteps: Number.isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber })}
                />
              </label>
              {!flux2 && (
                <label>
                  CFG
                  <input
                    type="number"
                    required
                    min={0}
                    max={30}
                    step="any"
                    value={draft.comfyCfg ?? ""}
                    onChange={(e) => set({ comfyCfg: Number.isNaN(e.target.valueAsNumber) ? null : e.target.valueAsNumber })}
                  />
                </label>
              )}
              <ModelSelect label="Sampler" value={draft.comfySampler} list={models?.samplers ?? []} onChange={(comfySampler) => set({ comfySampler })} />
              <Picker
                label="Scheduler"
                value={draft.comfyScheduler}
                choices={[
                  ...(flux2 || qwen21 ? [{ value: "", label: flux2 ? "FLUX.2's own (default)" : "Qwen Turbo's own (default)" }] : []),
                  ...[...new Set([draft.comfyScheduler, ...(models?.schedulers ?? [])])]
                    .filter(Boolean)
                    .map((scheduler) => ({ value: scheduler, label: scheduler })),
                ]}
                onChange={(comfyScheduler) => set({ comfyScheduler })}
              />
              <p className="muted">
                Distilled models, such as Turbo or Lightning, need the settings their page gives.
                {qwen21 && " Qwen Turbo's own scheduler is for 8 steps, and other counts use simple. The base model wants about 25 steps."}
              </p>
            </>
          )}
          <fieldset>
            <legend>LoRAs</legend>
            {draft.comfyLoras.map((lora, index) => (
              <div className="lora" key={loraKeys.current[index]}>
                <ModelSelect label={`LoRA ${index + 1}`} value={lora.name} list={loras} onChange={(name) => setLora(index, { name })} />
                <label>
                  Strength
                  {/* Uncontrolled, so the box can be empty while the player types. Keyed by the name too, so a changed file resets the box. */}
                  <input
                    key={lora.name}
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
                    loraKeys.current.splice(index, 1);
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
      {addressSaved && !advanced && qwen21 && models?.reachable && !models.hasQwen21 && (
        <p className="notice">This ComfyUI doesn't have Qwen Image 2.1's nodes yet. Update it to 0.37 or later to use this family.</p>
      )}
      <p className="muted">
        {advanced
          ? "Your workflow decides which references it uses, and which models and LoRAs."
          : qwen21
            ? "Uses the PC's and pictured NPCs' portraits as references, up to 10."
            : flux2
              ? "Uses visible NPCs' portraits, the previous Scene Image and the PC's portrait as references, up to 10. Set up for FLUX.2 Dev and Klein 9B, so other Klein models may need an Advanced workflow."
              : "Uses the previous Scene Image as a reference. NPC references need FLUX.2 or an Advanced workflow."}
      </p>
      <TestBox title="Test image" hint="Uses your saved Settings. The image isn't kept." working="Drawing…" run={drawComfyTest}>
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

  // An address that is one of the named providers picks it, and any other is a local or OpenAI-compatible server.
  const textChoice = (Object.entries(TEXT_PROVIDERS).find(([, url]) => url === draft.textBaseUrl)?.[0] ?? "local") as keyof typeof TEXT_PROVIDERS | "local";
  const local = textChoice === "local";
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

  // A provider that doesn't answer keeps the text box.
  const [imageModels, setImageModels] = useState<string[]>();

  useEffect(() => {
    setImageModels(undefined);
    if (draft.imageProvider === "local") return;
    let current = true;
    const show = (list: string[]) => current && setImageModels(list);
    getImageModels(draft.imageProvider).then(show, () => show([]));
    return () => {
      current = false;
    };
  }, [draft.imageProvider, saved]);

  const [hosts, setHosts] = useState<TextHost[]>([]);
  const hostsListed = textChoice === "openrouter" && addressSaved && !!models?.includes(draft.textModel);

  useEffect(() => {
    setHosts([]);
    if (!hostsListed) return;
    let current = true;
    getTextHosts(draft.textModel).then(
      (list) => current && setHosts(list),
      () => {},
    );
    return () => {
      current = false;
    };
  }, [hostsListed, draft.textModel]);

  // Hosts differ by model, so the old one may not offer a new one.
  const chooseModel = (textModel: string) => set({ textModel, textHost: textModel === draft.textModel ? draft.textHost : "" });

  // A server or provider switched to brings back its own settings, and one never used starts with no model, as each names them its own way.
  const switchText = (provider: keyof typeof TEXT_PROVIDERS | "local") => {
    // Local brings back the last local server used, if any.
    const local = Object.keys(saved.textProfiles).findLast((at) => !Object.values(TEXT_PROVIDERS).includes(at)) ?? "";
    const textBaseUrl = provider === "local" ? local : TEXT_PROVIDERS[provider];
    set({ textBaseUrl, ...(saved.textProfiles[textBaseUrl] ?? { textModel: "", textHost: "" }) });
  };
  const needsKey = saved.hasTextApiKey && draft.textBaseUrl !== saved.textBaseUrl && !saved.textKeysFor.includes(draft.textBaseUrl) && !textKey.trim();
  const keyHint = (stored: boolean) => (stored ? "Saved. Type a new key to replace it." : "None saved");

  const { busy, submit, feedback } = useSubmit(async () => {
    const { hasTextApiKey, hasImageApiKey, textKeysFor, imageKeysFor, textProfiles, imageProfiles, workflowProblem, ...change } = draft;
    const next = await saveSettings({
      ...change,
      ...(textKey.trim() && { textApiKey: textKey.trim() }),
      // Its field is hidden for Local, and a key the player can't see must not be stored.
      ...(draft.imageProvider !== "local" && imageKey.trim() && { imageApiKey: imageKey.trim() }),
    });
    setSaved(next);
    setDraft(next);
    setTextKey("");
    setImageKey("");
    applyLook(next);
    return saved.hasTextApiKey && !next.hasTextApiKey ? "Saved. This server has no text API key yet, so enter one for it." : "Saved.";
  });

  return frame(
    <form
      id="settings-form"
      className="fields settings"
      hidden={section === THIS_STORY || section === UPDATES}
      onSubmit={submit}
      // A required box in a hidden section stops Save with nothing to show for it, so go there. In time for the browser to point at the box.
      onInvalidCapture={(event) => {
        const box = (event.target as HTMLElement).closest<HTMLElement>("[data-section]");
        if (box) flushSync(() => onSection(box.dataset.section!));
      }}
    >
      <div data-section="Text" className="fields" hidden={section !== "Text"}>
        <h2>Text</h2>
        <Picker
          label="Text provider"
          value={textChoice}
          choices={[
            { value: "openrouter", label: "OpenRouter" },
            { value: "google", label: "Google AI Studio" },
            { value: "nanogpt", label: "NanoGPT" },
            { value: "local", label: "Local / OpenAI server" },
          ]}
          onChange={switchText}
        />
        {local && (
          <label>
            Server address
            <input
              type="url"
              required
              placeholder="http://localhost:1234/v1"
              value={draft.textBaseUrl}
              onChange={(e) => set({ textBaseUrl: e.target.value })}
            />
          </label>
        )}
        <ModelField key={draft.textBaseUrl} label="Text model" value={draft.textModel} list={addressSaved ? models : undefined} onChange={chooseModel} />
        {local && !addressSaved && <p className="muted">Save the address to choose from this server's models.</p>}
        {textChoice === "google" && (
          <p className="muted">
            {!addressSaved && "Save your key to choose from Google's models. "}
            Its free key needs only a Google account, but on the free tier Google may use what you send, your story among it, to improve its products.
          </p>
        )}
        {addressSaved && models?.length === 0 && <p className="muted">No models listed. Make sure the server is running, or type the model's name.</p>}
        {textChoice === "openrouter" && (
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
                <input type="checkbox" checked={draft.textHostFallback} onChange={(e) => set({ textHostFallback: e.target.checked })} />
                If this provider is down, let OpenRouter use another
              </label>
            ) : (
              <Picker
                label="Routing"
                value={draft.textRouting}
                choices={[
                  { value: "price", label: "Cheapest" },
                  { value: "throughput", label: "Fastest writing" },
                  { value: "latency", label: "Quickest to start" },
                  { value: "default", label: "OpenRouter's choice" },
                ]}
                onChange={(textRouting) => set({ textRouting })}
              />
            )}
            <p className="muted">Staying on one provider keeps its prompt cache, which can cut the cost of a Turn.</p>
          </>
        )}
        <label>
          {local ? "Text API key (most local servers need none)" : "Text API key"}
          <input
            type="password"
            autoComplete="new-password"
            placeholder={keyHint(saved.textKeysFor.includes(draft.textBaseUrl))}
            value={textKey}
            onChange={(e) => setTextKey(e.target.value)}
          />
        </label>
        {needsKey && (
          <p className="notice">
            A key only goes to the server it was entered for, so this server needs its own. Enter it above. The old server's key is kept for when you switch
            back.
          </p>
        )}
        <label>
          Extra Narrator Instructions
          <textarea rows={5} value={draft.modelInstructions} onChange={(e) => set({ modelInstructions: e.target.value })} />
        </label>
        <p className="muted">Your own guidance to the Narrator, for every Save.</p>
        <label>
          Longest reply, in tokens
          <input
            type="number"
            required
            min={1000}
            max={200000}
            step={1000}
            value={draft.textMaxTokens}
            onChange={(e) => set({ textMaxTokens: e.target.valueAsNumber })}
          />
        </label>
        <label>
          Longest reply, in minutes
          <input type="number" required min={1} max={60} value={draft.textReplyMinutes} onChange={(e) => set({ textReplyMinutes: e.target.valueAsNumber })} />
        </label>
        <p className="muted">
          A reply that runs past either limit is stopped and nothing is saved, so a stuck model can't run up your bill. Reasoning counts toward the tokens, and
          the minutes start once the reply begins.
        </p>
        <label>
          Recent Messages sent to the Narrator
          <input
            type="number"
            required
            min={40}
            max={400}
            step={10}
            value={draft.textRecentMessages}
            onChange={(e) => set({ textRecentMessages: e.target.valueAsNumber })}
          />
        </label>
        <p className="muted">
          Sent in full on every Turn. Older Messages reach the Narrator as Old Memories. More remembers detail better but makes each Turn cost more, and fewer
          saves money. A lower number catches up one Old Memory a Turn.
        </p>
        <label>
          Longest Question answer, in words
          <input
            type="number"
            required
            min={80}
            max={1000}
            step={10}
            value={draft.answerRejectWords}
            onChange={(e) => set({ answerRejectWords: e.target.valueAsNumber })}
          />
        </label>
        <p className="muted">
          The Narrator is asked for about 60 words and at most 80. An answer over this limit is thrown out and asked for again, up to three tries.
        </p>
        <TestBox
          title="Test text"
          hint="Sends this prompt to your saved model, with the saved Extra Narrator Instructions above. A paid provider may charge for each test."
          working="Asking…"
          run={askTextTest}
        >
          {(result) => <TextResult {...result} />}
        </TestBox>
      </div>

      <div data-section="Images" className="fields" hidden={section !== "Images"}>
        <h2>Images</h2>
        <label className="toggle">
          <input type="checkbox" checked={draft.imagesEnabled} onChange={(e) => set({ imagesEnabled: e.target.checked })} />
          Create new images
        </label>
        <p className="muted">Images you already have stay on show either way.</p>
        <label className="toggle">
          <input type="checkbox" checked={draft.openNewImages} onChange={(e) => set({ openNewImages: e.target.checked })} />
          Open new pictures in the story
        </label>
        <p className="muted">Pictures that arrive while you play open by themselves. After a load or refresh, every picture starts folded.</p>
        <label className="toggle">
          <input type="checkbox" checked={draft.drawScenes} onChange={(e) => set({ drawScenes: e.target.checked })} />
          Draw scene pictures
        </label>
        <p className="muted">A picture of the scene as the story moves. Off, only the pictures you ask for and portraits are drawn.</p>
        <label className="toggle">
          <input type="checkbox" checked={draft.updatePortraits} onChange={(e) => set({ updatePortraits: e.target.checked })} />
          Update portraits as the story goes
        </label>
        <p className="muted">
          When the story changes how someone looks, or what your character wears, their portrait is drawn again, keeping their face. Each one is a new picture,
          which may cost money, and it replaces a portrait you uploaded.
        </p>
        <label>
          Extra Image Instructions
          <textarea
            rows={4}
            placeholder="Keep faces in soft light; favour wide shots."
            value={draft.imageInstructions}
            onChange={(e) => set({ imageInstructions: e.target.value })}
          />
        </label>
        <p className="muted">Your own guidance for every picture's prompt, for every Save. Extra Narrator Instructions don't reach pictures.</p>
        <Picker
          label="Image provider"
          value={draft.imageProvider}
          choices={[
            { value: "openrouter", label: "OpenRouter" },
            { value: "wiro", label: "Wiro" },
            { value: "google", label: "Google AI Studio" },
            { value: "nanogpt", label: "NanoGPT" },
            { value: "local", label: "Local (ComfyUI)" },
          ]}
          onChange={(imageProvider) => set({ imageProvider, ...(saved.imageProfiles[imageProvider] ?? { imageModel: "" }) })}
        />
        <Picker
          label="Resolution"
          value={draft.imageResolution}
          choices={RESOLUTIONS.map(([value, label]) => ({ value, label }))}
          onChange={(imageResolution) => set({ imageResolution })}
        />
        {draft.imageProvider !== "local" ? (
          <>
            <p className="muted">
              {{ openrouter: "OpenRouter", wiro: "Wiro", google: "Google", nanogpt: "NanoGPT" }[draft.imageProvider]} uses the nearest size your model offers,
              so the image may not match exactly. Larger sizes can cost more, and some models have no size choice, so this changes nothing for them.
              {draft.imageProvider === "wiro" && " Set your Wiro project to API key only, not signatures."}
              {draft.imageProvider === "google" &&
                " Pictures aren't on Google's free tier, so its key needs billing turned on. Save your key to choose a model."}
            </p>
            <ModelField
              key={draft.imageProvider}
              label="Image model"
              value={draft.imageModel}
              list={imageModels}
              onChange={(imageModel) => set({ imageModel })}
            />
            <label>
              Image API key
              <input
                type="password"
                autoComplete="new-password"
                placeholder={keyHint(saved.imageKeysFor.includes(draft.imageProvider))}
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
        <Picker
          label="Theme"
          value={draft.theme}
          choices={[
            { value: "system", label: "Match this device" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          onChange={(theme) => set({ theme })}
        />
        <Picker
          label="Chat style"
          value={draft.chatStyle}
          choices={[
            { value: "script", label: "Script" },
            { value: "prose", label: "Prose" },
            { value: "bubbles", label: "Bubbles" },
          ]}
          onChange={(chatStyle) => set({ chatStyle })}
        />
        <Picker
          label="Font size"
          value={draft.fontSize}
          choices={[
            { value: "small", label: "Small" },
            { value: "medium", label: "Medium" },
            { value: "large", label: "Large" },
          ]}
          onChange={(fontSize) => set({ fontSize })}
        />
      </div>

      <div data-section="Advanced" className="fields" hidden={section !== "Advanced"}>
        <h2>Advanced</h2>
        <Picker
          label="Log Level"
          value={draft.logLevel ?? ""}
          choices={[
            { value: "", label: `Default (${LOG_LEVELS.find(([value]) => value === draft.defaultLogLevel)?.[1]})` },
            ...LOG_LEVELS.map(([value, label]) => ({ value, label })),
          ]}
          onChange={(level) => set({ logLevel: level || null })}
        />
        <p className="muted">
          How much the app writes to its Server Log, from Error, only what failed, to Verbose, every step. It changes as soon as you save, and the log never
          holds story text.
        </p>
      </div>
    </form>,
    section !== THIS_STORY && section !== UPDATES && (
      <>
        {feedback}
        <div className="row">
          <button type="submit" form="settings-form" className="action" aria-disabled={busy}>
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
      tabs={id ? <BookTabs id={id} current="Settings" /> : <MenuRibbon />}
      rail={
        <>
          <h1 className="big">Settings</h1>
          <nav aria-label="Settings sections">
            {[...(id ? [THIS_STORY] : []), ...SECTIONS, UPDATES].map((name) => (
              <button key={name} type="button" aria-current={name === section || undefined} onClick={() => setSection(name)}>
                {name}
              </button>
            ))}
          </nav>
          {!id && <p className="muted so-far">Open a story to change its Art Style.</p>}
        </>
      }
    >
      {loadError && (
        <p role="alert" className="error">
          {loadError}
        </p>
      )}
      {/* Stays mounted, so an unsaved edit survives a look at another section. */}
      {id && (
        <div hidden={section !== THIS_STORY}>
          <PlayModeSetting key={`${id}-play`} id={id} />
          <ArtStyle key={id} id={id} />
        </div>
      )}
      {section === UPDATES && <UpdatesSection />}
      {content}
    </Sheet>
  );

  return settings ? <InstallSettings initial={settings} section={section} onSection={setSection} frame={frame} /> : frame(null);
}
