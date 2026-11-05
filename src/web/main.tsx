import { useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { Gallery } from "./gallery";
import { Inventory } from "./inventory";
import { Journal } from "./journal";
import { LoadGame } from "./load";
import { getSettings } from "./api";
import { Menu } from "./menu";
import { Play } from "./play";
import { applyLook, SettingsScreen } from "./settings";
import { NewGame, Reveal } from "./wizard";

const onHashChange = (listener: () => void) => {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
};

/** Screens live in the URL hash, so a reload keeps the place and the server only ever serves `/`. */
function App() {
  const [, screen, id, mark, worldChanged] = useSyncExternalStore(onHashChange, () => location.hash).split("/");
  if (screen === "new" && id === "ready" && mark) return <Reveal key={mark} id={mark} worldChanged={!!worldChanged} />;
  if (screen === "play" && id) return <Play key={id} id={id} worldChanged={mark === "world-changed"} />;
  if (screen === "journal" && id) return <Journal key={id} id={id} />;
  if (screen === "gallery" && id) return <Gallery key={id} id={id} />;
  if (screen === "inventory" && id) return <Inventory key={id} id={id} />;
  if (screen === "new") return <NewGame step={id} />;
  if (screen === "load") return <LoadGame />;
  if (screen === "settings") return <SettingsScreen id={id} />;
  return <Menu />;
}

// If this fails the app still works, at the default size and the system's theme.
getSettings().then(applyLook, () => {});

createRoot(document.getElementById("root")!).render(<App />);
