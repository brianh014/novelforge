import { type FormEvent, useEffect, useState } from "react";
import { getSave, getSettings, OPENROUTER_URL, saveArtStyle, saveSettings, type Settings } from "./api";
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

function InstallSettings({ initial }: { initial: Settings }) {
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState(initial);
  // Only ever what the player types now, because the server never sends a stored key.
  const [textKey, setTextKey] = useState("");
  const [imageKey, setImageKey] = useState("");
  const set = (change: Partial<Settings>) => setDraft({ ...draft, ...change });

  const local = draft.textBaseUrl !== OPENROUTER_URL;
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
        <input value={draft.textModel} onChange={(e) => set({ textModel: e.target.value })} />
      </label>
      <label>
        Text API key
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
      <label>
        Image model
        <input value={draft.imageModel} onChange={(e) => set({ imageModel: e.target.value })} />
      </label>
      {draft.imageProvider === "openrouter" && (
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
