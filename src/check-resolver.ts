import { z } from "zod";

/** Returns a d20 result, from 1 to 20. */
export type Dice = () => number;

const DC = { Easy: 5, Moderate: 10, Hard: 15, "Very Hard": 20 };

export const CheckRequest = z.object({
  action: z.string().min(1),
  difficulty: z.enum(["Easy", "Moderate", "Hard", "Very Hard"]),
  // Kept for the result, as one told without them won a failure its prize and undid a success later.
  stakes: z.string().optional(),
  // The most those it touches would truly give, set before the roll, as a success made a killer confess to the man he served.
  at_most: z.string().nullish(),
});

function judge(roll: number, dc: number, nearMissMargin: number) {
  if (roll === 20) return { outcome: "success", degree: "strong" };
  if (roll === 1) return { outcome: "failure", degree: "bad" };
  // Just making it, or just missing, succeeds at a cost: only beating the target is clean. A margin of 0 has no cost band.
  if (nearMissMargin > 0 && roll <= dc && dc - roll <= nearMissMargin) return { outcome: "success", degree: "mixed" };
  if (roll >= dc) return { outcome: "success", degree: "clean" };
  return { outcome: "failure", degree: "plain" };
}

export function resolveCheck(request: z.infer<typeof CheckRequest>, dice: Dice, nearMissMargin: number) {
  const roll = dice();
  return { ...request, roll, ...judge(roll, DC[request.difficulty], nearMissMargin) };
}

export type Check = ReturnType<typeof resolveCheck>;

export const StoredCheck = CheckRequest.extend({
  roll: z.number(),
  outcome: z.string(),
  degree: z.string(),
}) satisfies z.ZodType<Check>;
