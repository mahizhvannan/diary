export type ChatRole = "user" | "assistant";

export type ChatAttachment = {
  id: string;
  name: string;
  mimeType: string;
  dataUrl: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  at: string;
  attachments?: ChatAttachment[];
  period?: {
    skill: "weekly" | "monthly";
    startLogId: string;
    endLogId: string;
    cached?: boolean;
  };
};

/** One chat session (user + assistant turns) is one diary entry. */
export type DiaryEntry = {
  id: string;
  startedAt: string;
  updatedAt: string;
  title: string;
  tags: string[];
  summary: string;
  messages: ChatMessage[];
  /** False until the user clicks Log. Chat-only sessions stay off Drive. */
  savedToDrive?: boolean;
};

export type DayFile = {
  date: string;
  timezone: string;
  summary: string;
  entries: DiaryEntry[];
};

export type ManifestDay = {
  date: string;
  fileId: string;
  summary: string;
  tags: string[];
  entryCount: number;
};

export type RecentSession = {
  date: string;
  entryId: string;
  title: string;
  updatedAt: string;
};

export type CalorieItem = {
  id: string;
  at: string;
  raw: string;
  kind: "food" | "activity";
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  minutes: number | null;
};

export type CalorieDay = {
  date: string;
  goalKcal: number;
  items: CalorieItem[];
};

export type MonthSummaryFile = {
  month: string;
  summary: string;
  generatedAt: string;
};

export type PeriodQaEntry = {
  skill: "weekly" | "monthly";
  question: string;
  startLogId: string;
  endLogId: string;
  reply: string;
  at: string;
};

export type PeriodQaFile = {
  answers: PeriodQaEntry[];
};

export type Manifest = {
  folderId: string;
  calorieGoal?: number;
  days: ManifestDay[];
  calorieDays?: { date: string; fileId: string }[];
  recentSessions?: RecentSession[];
  monthSummaries?: { month: string; fileId: string }[];
  periodQaFileId?: string;
};

export type GeminiNutritionResult = {
  reply: string;
  logDate?: string;
  items: Omit<CalorieItem, "id" | "at" | "raw">[];
};

export type GeminiLogResult = {
  title: string;
  tags: string[];
  reply: string;
  sessionSummary: string;
  daySummary: string;
};

export type GeminiAnswerResult = {
  reply: string;
  usedDates: string[];
};
