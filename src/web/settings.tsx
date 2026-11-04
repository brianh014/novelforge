import { type FormEvent, useEffect, useRef, useState } from "react";
import { chosenModels } from "../graph-builder";
import {
  type ComfyModels,
  getComfyModels,
  getSave,
  getSettings,
  getTextModels,
  OPENROUTER_URL,
  saveArtStyle,
  saveSettings,
  type Settings,
} from "./api";
import { Book, BookTabs } from "./menu";

export const applyFontSize = ({ fontSize }: Settings) => {
  document.documentElement.dataset.fontSize = fontSize;
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
  const flux2 = draft.comfyFamily === "flux2";
  const loras = models?.loras ?? [];
  const setLora = (index: number, change: Partial<Settings["comfyLoras"][number]>) =>
    set({ comfyLoras: draft.comfyLoras.map((lora, i) => (i === index ? { ...lora, ...change } : lora)) });

  const installed = models ? [...models.checkpoints, ...models.diffusionModels, ...models.textEncoders, ...models.vaes, ...loras] : [];
  const chosen = [...chosenModels(draft), ...draft.comfyLoras.map(({ name }) => name)];
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
      <button
        type="button"
        className="quiet"
        aria-disabled={!models || !addressSaved}
        onClick={() => {
          if (models && addressSaved) setRefreshes(refreshes + 1);
        }}
      >
        Refresh lists
      </button>
      <p role="status" className="muted">
        {!addressSaved
          ? "Save the address to list this server's models."
          : !models
            ? "Asking ComfyUI what's installed."
            : models.reachable
              ? models.loras.length === 0 && "No LoRAs installed."
              : "ComfyUI can't be reached at this address. Check that it's running, then refresh."}
      </p>
      {addressSaved && missing.length > 0 && (
        <p className="notice">Not installed in ComfyUI: {missing.join(", ")}. Choose another or add the file, then refresh.</p>
      )}
      {addressSaved && flux2 && models?.reachable && !models.hasFlux2 && (
        <p className="notice">This ComfyUI doesn't have FLUX.2's nodes yet. Update it to use this family.</p>
      )}
      <p className="muted">
        {flux2
          ? "Uses visible NPCs' portraits, the previous Scene Image and the PC's portrait as references, up to 10. Set up for FLUX.2 Dev, so a Klein model may need an Advanced workflow."
          : "Uses the previous Scene Image as a reference. NPC references need FLUX.2 or an Advanced workflow."}
      </p>
    </>
  );
}

function InstallSettings({ initial }: { initial: Settings }) {
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
    if (saved.textBaseUrl === OPENROUTER_URL) return;
    let current = true;
    const show = (list: string[]) => current && setModels(list);
    getTextModels().then(show, () => show([]));
    return () => {
      current = false;
    };
  }, [saved]);

  const losesKey = saved.hasTextApiKey && draft.textBaseUrl !== saved.textBaseUrl && !textKey.trim();
  const keyHint = (stored: boolean) => (stored ? "Saved. Type a new key to replace it." : "None saved");

  const { busy, submit, feedback } = useSubmit(async () => {
    const { hasTextApiKey, hasImageApiKey, ...change } = draft;
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
    applyFontSize(next);
    return saved.hasTextApiKey && !next.hasTextApiKey
      ? "Saved. The text API key was cleared because the server changed."
      : "Saved.";
  });

  return (
    <form className="fields settings" onSubmit={submit}>
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
      <label>
        Text model
        {local && addressSaved && models?.length ? (
          <select value={draft.textModel} onChange={(e) => set({ textModel: e.target.value })}>
            {!draft.textModel && <option value="">Choose a model</option>}
            {/* A saved model the server doesn't list stays as it is until the player changes it. */}
            {[...new Set([draft.textModel, ...models])].filter(Boolean).map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        ) : (
          <input value={draft.textModel} onChange={(e) => set({ textModel: e.target.value })} />
        )}
      </label>
      {local && !addressSaved && <p className="muted">Save the address to choose from this server's models.</p>}
      {local && addressSaved && models?.length === 0 && (
        <p className="muted">No models listed. Check that the server is running, or type the model's name.</p>
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
        Model Instructions
        <textarea
          rows={5}
          value={draft.modelInstructions}
          onChange={(e) => set({ modelInstructions: e.target.value })}
        />
      </label>
      <p className="muted">Your own guidance to the Narrator, for every Save.</p>

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
      {draft.imageProvider === "openrouter" ? (
        <>
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

      <h2>Reading</h2>
      <label>
        Chat style
        <select
          value={draft.chatStyle}
          onChange={(e) => set({ chatStyle: e.target.value as Settings["chatStyle"] })}
        >
          <option value="prose">Prose</option>
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

      {feedback}
      <button className="action" aria-disabled={busy}>
        Save settings
      </button>
    </form>
  );
}

export function SettingsScreen({ id }: { id?: string }) {
  const [settings, setSettings] = useState<Settings>();
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    getSettings().then(setSettings, (failure: Error) => setLoadError(failure.message));
  }, []);

  return (
    <Book
      left={
        <>
          <h1 className="big">Settings</h1>
          {id ? <ArtStyle key={id} id={id} /> : <p className="muted">Open a game to change its Art Style.</p>}
          <a className="quiet" href="#/">
            Main Menu
          </a>
        </>
      }
      tabs={id && <BookTabs id={id} current="Settings" />}
    >
      {loadError && <p role="alert" className="error">{loadError}</p>}
      {settings && <InstallSettings initial={settings} />}
    </Book>
  );
}
