import { lastSample } from "./track";
import type { CalorieDay, CollectionsFile } from "./types";
import { dayCalorieTotals, dayMacroTotals } from "./nutrition";

export type TrackableRow = {
  id: string;
  group: "app_default" | "collection";
  collectionName?: string;
  name: string;
  unit: string;
  description: string;
  lastAt: string | null;
  lastValue: string | null;
};

function latestCalorieAt(calories: Record<string, CalorieDay>): string | null {
  let best: string | null = null;
  for (const day of Object.values(calories)) {
    for (const item of day.items) {
      if (!best || item.at > best) best = item.at;
    }
  }
  return best;
}

export function nutritionTrackables(
  calories: Record<string, CalorieDay>,
  calorieGoal?: number,
): TrackableRow[] {
  const lastAt = latestCalorieAt(calories);
  const dates = Object.keys(calories).sort();
  const lastDay = dates.length ? calories[dates[dates.length - 1]] : null;
  const tot = dayCalorieTotals(lastDay);
  const macros = dayMacroTotals(lastDay);
  const goal = calorieGoal ?? lastDay?.goalKcal ?? null;
  const deficit =
    lastDay && lastDay.items.length
      ? lastDay.goalKcal - tot.net
      : null;

  const rows: Omit<TrackableRow, "lastAt">[] = [
    {
      id: "calorie_goal",
      group: "app_default",
      name: "Calories goal",
      unit: "kcal/day",
      description: "Daily calorie goal used for deficit",
      lastValue: goal != null ? String(Math.round(goal)) : null,
    },
    {
      id: "eaten",
      group: "app_default",
      name: "Calories eaten",
      unit: "kcal",
      description: "Food calories from the calorie log",
      lastValue: lastDay?.items.length ? String(Math.round(tot.eaten)) : null,
    },
    {
      id: "burned",
      group: "app_default",
      name: "Calories burned",
      unit: "kcal",
      description: "Activity calories from the calorie log",
      lastValue: lastDay?.items.length ? String(Math.round(tot.burned)) : null,
    },
    {
      id: "calorie_deficit",
      group: "app_default",
      name: "Calorie deficit",
      unit: "kcal",
      description: "Goal minus net (eaten − burned)",
      lastValue: deficit == null ? null : String(Math.round(deficit)),
    },
    {
      id: "protein",
      group: "app_default",
      name: "Protein",
      unit: "g",
      description: "Protein grams logged",
      lastValue: lastDay?.items.length ? String(Math.round(macros.protein)) : null,
    },
    {
      id: "carbs",
      group: "app_default",
      name: "Carbs",
      unit: "g",
      description: "Carbohydrate grams logged",
      lastValue: lastDay?.items.length ? String(Math.round(macros.carbs)) : null,
    },
    {
      id: "fat",
      group: "app_default",
      name: "Fat",
      unit: "g",
      description: "Fat grams logged",
      lastValue: lastDay?.items.length ? String(Math.round(macros.fat)) : null,
    },
  ];

  return rows.map((r) => ({
    ...r,
    lastAt: r.id === "calorie_goal" ? null : r.lastValue != null ? lastAt : null,
  }));
}

export function collectionTrackables(file: CollectionsFile): TrackableRow[] {
  return file.collections.flatMap((c) =>
    c.variables.map((v) => {
      const last = lastSample(v);
      return {
        id: v.id,
        group: "collection" as const,
        collectionName: c.name,
        name: v.name,
        unit: v.unit,
        description: v.description,
        lastAt: last?.at ?? null,
        lastValue: last ? String(last.value) : null,
      };
    }),
  );
}
