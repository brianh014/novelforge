import type { LoreEntry } from "./state-applier";

// shortcut: four characters per token is a rough average, use the model's tokenizer if budgets prove too loose.
export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

// Whole words only, so "art" does not activate on "party". The lookarounds exist because \b only knows ASCII letters.
const wholeWord = (keyword: string) => new RegExp(`(?<![\\p{L}\\p{N}])${RegExp.escape(keyword)}(?![\\p{L}\\p{N}])`, "giu");

/** Where in `text` any keyword last appears, or -1. */
const lastMention = (text: string, { keywords }: LoreEntry) =>
  Math.max(...keywords.map((keyword) => [...text.matchAll(wholeWord(keyword))].at(-1)?.index ?? -1));

const mentions = (text: string, entry: LoreEntry) => lastMention(text, entry) >= 0;

const textOf = ({ title, content }: LoreEntry) => `${title}\n${content}`;

/**
 * Always-on entries are never dropped and spend the budget first, then entries `recentText` mentions, latest mention
 * first so that what's in play beats the world's background, then entries those mention.
 */
export function activateLore(entries: LoreEntry[], recentText: string, tokenBudget: number) {
  const alwaysOn = entries.filter((entry) => entry.alwaysOn);
  let remaining = tokenBudget - estimateTokens(alwaysOn.map(textOf).join("\n"));
  const withinBudget = (entry: LoreEntry) => {
    const cost = estimateTokens(textOf(entry));
    if (cost > remaining) return false;
    remaining -= cost;
    return true;
  };

  const keyworded = entries.filter((entry) => !entry.alwaysOn);
  const mentioned = keyworded
    .map((entry) => ({ entry, at: lastMention(recentText, entry) }))
    .filter(({ at }) => at >= 0)
    .toSorted((a, b) => b.at - a.at)
    .map(({ entry }) => entry)
    .filter(withinBudget);
  // Always-on content is not scanned, or its keywords would be active forever.
  const activatedText = mentioned.map(textOf).join("\n");
  const recursed = keyworded
    .filter((entry) => !mentioned.includes(entry) && mentions(activatedText, entry))
    .filter(withinBudget);
  return [...alwaysOn, ...mentioned, ...recursed];
}
