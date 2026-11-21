// What code can tell wrong in a play's state without a judge, counted over its steps, as the one measure free of judge noise.
import { dayPart, type State } from "../src/state-applier";

/** Steps that tell new story; a Rewrite, Regenerate or Edit replaces a reply, so its time and Loose Ends may rightly go back. */
const TURNS = new Set(["opening", "choice", "move", "continue", "continue (no Choices)"]);
const wordsOf = (text: string) => new Set(text.toLowerCase().match(/\p{L}{4,}/gu) ?? []);
const denies = (text: string) => /\b(?:not|never|no|nothing|none|nobody)\b|n't\b/i.test(text);
/**
 * The same fact in other words: three or more longer words shared, most of them, and both saying or both denying it, as reworded
 * repeats got past the app's exact match while "is alive" and "is not alive" are a correction, not a repeat.
 */
function alike(a: string, b: string) {
  const [one, two] = [wordsOf(a), wordsOf(b)];
  const shared = [...one].filter((word) => two.has(word)).length;
  return shared >= 3 && shared / new Set([...one, ...two]).size >= 0.7 && denies(a) === denies(b);
}

/**
 * Counts over a play's steps, plus `ignored`, the reasons of the operations the app ignored ("npc_learns: already there"), as
 * an exact repeat or a fact of only what someone doesn't know is turned away before it is stored, yet the model still wrote it.
 */
export function stateFaults(steps: { action: string; before: State; after: State }[], ignored: string[] = []) {
  const faults = {
    timeBack: 0,
    repeatKnows: ignored.filter((reason) => reason === "npc_learns: already there").length,
    negativeKnows: ignored.filter((reason) => reason === "npc_learns: only what they don't know").length,
    looseEndReopened: 0,
  };
  const resolved = new Set<string>();
  for (const { action, before, after } of steps) {
    const turn = TURNS.has(action);
    const [was, now] = [before.storyTime, after.storyTime];
    if (turn && was && now) {
      const [wasPart, nowPart] = [dayPart(was.timeOfDay), dayPart(now.timeOfDay)];
      // By the clock where both have it, as "a quarter to one" after "half past midnight" read as going back by its words.
      const back =
        was.hours !== undefined && now.hours !== undefined
          ? now.hours < was.hours
          : now.day < was.day || (now.day === was.day && wasPart !== undefined && nowPart !== undefined && nowPart < wasPart);
      if (back) faults.timeBack++;
    }
    for (const [name, known] of Object.entries(after.npcKnows)) {
      const earlier = before.npcKnows[name] ?? [];
      known.forEach((fact, at) => {
        if (earlier.includes(fact)) return;
        if (known.some((other, otherAt) => otherAt !== at && alike(other, fact) && (otherAt < at || earlier.includes(other)))) faults.repeatKnows++;
      });
    }
    if (turn) for (const end of after.looseEnds) if (!before.looseEnds.includes(end) && resolved.has(end)) faults.looseEndReopened++;
    for (const end of before.looseEnds) if (!after.looseEnds.includes(end)) resolved.add(end);
  }
  const flat: Record<string, number> = Object.fromEntries(Object.entries(faults).map(([key, value]) => [`stateFaults.${key}`, value]));
  flat["stateFaults.total"] = Object.values(faults).reduce((a, b) => a + b, 0);
  return flat;
}
