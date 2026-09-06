import type { CalorieDay, CalorieItem } from "./types";

export const DEFAULT_CALORIE_GOAL = 2200;

export function emptyCalorieDay(date: string, goalKcal = DEFAULT_CALORIE_GOAL): CalorieDay {
  return { date, goalKcal, items: [] };
}

export function nutritionHeadline(day: CalorieDay | null | undefined): string {
  if (!day || day.items.length === 0) {
    return "No nutrition logged";
  }
  const eaten = day.items
    .filter((i) => i.kind === "food")
    .reduce((s, i) => s + Math.max(0, i.calories), 0);
  const burned = day.items
    .filter((i) => i.kind === "activity")
    .reduce((s, i) => s + Math.abs(Math.min(0, i.calories)), 0);
  const net = eaten - burned;
  const diff = day.goalKcal - net;
  const balance =
    diff >= 0 ? `calorie deficit ${Math.round(diff)}` : `calorie surplus ${Math.round(-diff)}`;
  const activities = day.items
    .filter((i) => i.kind === "activity")
    .map((i) => (i.minutes ? `${i.minutes} min ${i.name}` : i.name));
  const activity = activities.length ? activities.join(", ") : "none";
  return `${balance} | activity : ${activity}`;
}

export function dayCalorieTotals(day: CalorieDay | null | undefined): {
  eaten: number;
  burned: number;
  net: number;
} {
  if (!day) return { eaten: 0, burned: 0, net: 0 };
  const eaten = day.items
    .filter((i) => i.kind === "food")
    .reduce((s, i) => s + Math.max(0, i.calories), 0);
  const burned = day.items
    .filter((i) => i.kind === "activity")
    .reduce((s, i) => s + Math.abs(Math.min(0, i.calories)), 0);
  return { eaten, burned, net: eaten - burned };
}

export function dayMacroTotals(day: CalorieDay | null | undefined): {
  protein: number;
  carbs: number;
  fat: number;
} {
  if (!day) return { protein: 0, carbs: 0, fat: 0 };
  return day.items
    .filter((i) => i.kind === "food")
    .reduce(
      (s, i) => ({
        protein: s.protein + (Number(i.protein) || 0),
        carbs: s.carbs + (Number(i.carbs) || 0),
        fat: s.fat + (Number(i.fat) || 0),
      }),
      { protein: 0, carbs: 0, fat: 0 },
    );
}

export function formatNutritionReply(items: CalorieItem[], reply: string): string {
  const lines = items.map((i) => {
    if (i.kind === "activity") {
      const mins = i.minutes ? `${i.minutes} min, ` : "";
      return `• ${i.name}: ${mins}${i.calories} kcal`;
    }
    return `• ${i.name}: ${i.calories} kcal · P ${i.protein}g · C ${i.carbs}g · F ${i.fat}g`;
  });
  return [reply.trim(), "", ...lines].join("\n");
}
