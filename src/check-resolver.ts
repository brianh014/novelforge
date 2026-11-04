import { z } from "zod";

/** Returns a d20 result, from 1 to 20. */
export type Dice = () => number;

const DC = { Easy: 5, Moderate: 10, Hard: 15, "Very Hard": 20 };

export const CheckRequest = z.object({
  action: z.string().min(1),
  difficulty: z.enum(["Easy", "Moderate", "Hard", "Very Hard"]),
});

function judge(roll: number, dc: number, nearMissMargin: number) {
  if (roll === 20) return { outcome: "success", degree: "strong" };
  if (roll === 1) return { outcome: "failure", degree: "bad" };
  if (roll >= dc) return { outcome: "success", degree: "clean" };
  if (dc - roll <= nearMissMargin) return { outcome: "success", degree: "mixed" };
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
