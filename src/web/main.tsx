import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Journal } from "./journal";
import { Menu, NewGame, Placeholder } from "./menu";
import { Play } from "./play";

const onHashChange = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

/** Screens live in the URL hash, so a reload keeps the place and the server only ever serves `/`. */
function App() {
  const [, screen, id] = useSyncExternalStore(onHashChange, () => location.hash).split("/");
  if (screen === "play" && id) return <Play key={id} id={id} />;
  if (screen === "journal" && id) return <Journal key={id} id={id} />;
  if (screen === "new") return <NewGame />;
  if (screen === "load") return <Placeholder title="Load Game">Saved games aren't listed here yet.</Placeholder>;
  if (screen === "settings") {
    return (
      <Placeholder title="Settings">
        This screen isn't written yet. For now, set <code>textModel</code> and <code>textApiKey</code> in{" "}
        <code>settings.json</code> beside the app.
      </Placeholder>
    );
  }
  return <Menu />;
}

createRoot(document.getElementById("root")!).render(<App />);
