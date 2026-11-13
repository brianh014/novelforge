import { useEffect, useState } from "react";
import { getUpdate, installUpdate, type UpdateStatus } from "./api";
import { ConfirmDialog } from "./menu";

/** A New Version: the toast on every screen, and Settings → Updates, which share the Install button. */

type Latest = NonNullable<UpdateStatus["latest"]>;

const DISMISSED = "novelforge-dismissed-version";

const WHATS_NEW = (latest: Latest) => (
  <a href={latest.url} target="_blank" rel="noreferrer">
    What's new
  </a>
);

/** Asks, installs, then waits for the server to answer as the new version and reloads the page as it. */
function InstallButton({ latest }: { latest: Latest }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState<"" | "Downloading" | "Restarting">("");
  const [error, setError] = useState("");

  async function install() {
    setBusy("Downloading");
    setError("");
    try {
      await installUpdate();
      setBusy("Restarting");
      for (let tries = 0; tries < 120; tries++) {
        await new Promise((done) => setTimeout(done, 1000));
        const now = await getUpdate().catch(() => undefined);
        // The old version answering means the new one failed to start and was swapped back.
        if (now && now.version !== latest.version) {
          setError(`NovelForge ${latest.version} didn't start, so ${now.version} is back. Try again later, or download it from its page.`);
          setBusy("");
          return;
        }
        if (now?.version === latest.version) {
          // A version put off and then installed anyway mustn't keep its toast away should it be offered again.
          try {
            localStorage.removeItem(DISMISSED);
          } catch {}
          return location.reload();
        }
      }
      setError("NovelForge hasn't come back. Open it again.");
    } catch (failure) {
      setError((failure as Error).message);
    }
    setBusy("");
  }

  return (
    <>
      {busy ? (
        <p role="status" className="muted">
          {busy}…
        </p>
      ) : (
        <button type="button" className="action" onClick={() => setAsking(true)}>
          Install
        </button>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {asking && (
        <ConfirmDialog title={`Install NovelForge ${latest.version}?`} confirm="Install" onConfirm={install} onClose={() => setAsking(false)}>
          <p>NovelForge downloads it, restarts and comes back to this page. Your stories and Settings stay as they are.</p>
        </ConfirmDialog>
      )}
    </>
  );
}

/** What to do about a New Version: Install, or where to get it when this copy can't replace itself. */
function NewVersionOffer({ status, latest }: { status: UpdateStatus; latest: Latest }) {
  return (
    <>
      <p>
        NovelForge {latest.version} is out. {WHATS_NEW(latest)}
      </p>
      {status.installable ? (
        <InstallButton latest={latest} />
      ) : (
        <p className="muted">Download it from its page, or pull it with git if you run NovelForge from source.</p>
      )}
    </>
  );
}

const ASK_EVERY_MS = 60 * 60_000;

/** On every screen, as players rarely go back to the Menu. Dismissed, it stays away until the next version. */
export function NewVersionToast() {
  const [status, setStatus] = useState<UpdateStatus>();
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISSED);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    // The server only asks GitHub every few hours, so asking it is cheap.
    const ask = () => getUpdate().then(setStatus, () => {});
    ask();
    const timer = setInterval(ask, ASK_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  const latest = status?.latest;
  if (!status || !latest || dismissed === latest.version) return null;
  const dismiss = () => {
    setDismissed(latest.version);
    try {
      localStorage.setItem(DISMISSED, latest.version);
    } catch {}
  };
  return (
    <aside className="notice dismissable toast" aria-label="New version">
      <div className="toast-body">
        <NewVersionOffer status={status} latest={latest} />
      </div>
      <button type="button" className="quiet" title="Not now" aria-label="Dismiss the new version" onClick={dismiss}>
        ×
      </button>
    </aside>
  );
}

/** Settings → Updates: this copy's version, a check that skips the server's wait, and Install. */
export function UpdatesSection() {
  const [status, setStatus] = useState<UpdateStatus>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const check = (fresh: boolean) => {
    setChecking(true);
    setError("");
    getUpdate(fresh)
      .then(setStatus, (failure: Error) => setError(failure.message))
      .finally(() => setChecking(false));
  };
  useEffect(() => check(false), []);

  return (
    <div className="fields updates">
      <h2>Updates</h2>
      {status && <p>This is NovelForge {status.version}.</p>}
      {status?.latest ? (
        <NewVersionOffer status={status} latest={status.latest} />
      ) : status?.failed ? (
        <p className="muted">Couldn't reach GitHub to check. Try again when you're online.</p>
      ) : (
        status && <p className="muted">It's the newest version.</p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="row">
        <button type="button" className="quiet" aria-disabled={checking} onClick={() => !checking && check(true)}>
          {checking ? "Checking…" : "Check now"}
        </button>
      </div>
      <p className="muted">NovelForge also checks by itself every few hours, and shows a notice when a new version is out.</p>
    </div>
  );
}
