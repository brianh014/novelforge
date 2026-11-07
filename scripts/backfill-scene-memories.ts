// One-off: writes Scene Memories for the Messages of a Save copy that are older than its window, on the Text Provider
// in the settings file named. It sends those Messages to that provider, and writes only to the copy. The copy is the
// backup, so check it, then overwrite the real Save yourself:
//   bun run scripts/backfill-scene-memories.ts <Save copy> <settings.json>
import { existsSync, realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { MEMORY_MESSAGES, olderMessages } from "../src/prompt-assembler";
import { addOlderMemories, InvalidSave, readSaveCopy } from "../src/save-store";
import { settingsStore } from "../src/settings-store";
import { textProvider } from "../src/text-provider";
import { askForMemory, type TextProvider, TurnFailed } from "../src/turn-engine";
import { readable } from "../src/web/chat-style";

export class Refused extends Error {}

/** Worked out from this script's own folder, so a worktree finds the checkout it came from. */
export function mainSavesFolder() {
  const git = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: import.meta.dir });
  if (!git.success) throw new Refused("Can't find the main checkout, so can't tell which Saves are real.");
  return join(dirname(git.stdout.toString().trim()), "Saves");
}

const fileId = (path: string) => {
  const { dev, ino } = statSync(path, { bigint: true });
  return `${dev}/${ino}`;
};

/** By file identity, not by text, as case, slashes, \\?\ and \\localhost prefixes and junctions all reach the same folder. */
export function assertIsACopy(path: string, savesFolder = mainSavesFolder()) {
  if (!existsSync(path)) throw new Refused(`There's no file at ${path}.`);
  const saves = existsSync(savesFolder) ? fileId(savesFolder) : undefined;
  for (let at = realpathSync.native(path); ; at = dirname(at)) {
    if (fileId(at) === saves) throw new Refused(`${path} is inside the main checkout's Saves folder. Give the path of a copy.`);
    if (dirname(at) === at) break;
  }
  if (statSync(path).nlink > 1) throw new Refused(`${path} is a hard link, so writing to it would change its other name too. Give the path of a real copy.`);
}

/** Writes nothing until every batch has its memory, so a failure costs the calls made and leaves the story as it was. */
export async function backfill(path: string, provider: TextProvider, savesFolder = mainSavesFolder(), print: (line: string) => void = console.log) {
  assertIsACopy(path, savesFolder);
  const { messages, sceneMemories, memoryStart } = readSaveCopy(path);
  // What the player read, as the page hides the Opening's stored Message. Text is never edited in place: a Rewrite stores a new Message.
  const older = readable(olderMessages(messages, sceneMemories, memoryStart));
  const batches = Array.from({ length: Math.ceil(older.length / MEMORY_MESSAGES) }, (_, index) => older.slice(index * MEMORY_MESSAGES, (index + 1) * MEMORY_MESSAGES));
  if (batches.length === 0) return print("No older Message needs a Scene Memory, so nothing was written.");

  print(`${older.length} older Messages, in ${batches.length} batches.`);
  const memories = [];
  for (const [index, batch] of batches.entries()) {
    print(`Batch ${index + 1} of ${batches.length}`);
    const text = await askForMemory(provider, batch, memories.at(-1)?.text, new AbortController().signal);
    memories.push({ firstMessage: batch[0]!.id, lastMessage: batch.at(-1)!.id, text });
  }
  addOlderMemories(path, memories);
  print(`Wrote ${memories.length} Scene Memories covering ${older.length} Messages to ${path}`);
}

if (import.meta.main) {
  const [copy, settingsPath] = process.argv.slice(2);
  try {
    if (!copy || !settingsPath) throw new Refused("Give the path of a Save copy, then the path of a settings file.");
    if (!existsSync(settingsPath)) throw new Refused(`There's no settings file at ${settingsPath}.`);
    await backfill(copy, textProvider(settingsStore(settingsPath)));
  } catch (error) {
    // Only messages written here, as any other could quote the story or the key.
    const safe = error instanceof Refused || error instanceof InvalidSave || error instanceof TurnFailed;
    console.error(`Stopped, with no memories written: ${safe ? error.message : (error as Error).name}`);
    process.exitCode = 1;
  }
}
