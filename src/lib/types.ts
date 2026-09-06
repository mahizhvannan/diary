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
  packedHash?: string;
  reply: string;
  at: string;
};

export type PeriodQaFile = {
  answers: PeriodQaEntry[];
};

export type TrackSample = {
  date: string;
  value: number;
  at: string;
  note?: string;
  source?: "chat" | "ui";
};

export type TrackStatic = {
  id: string;
  name: string;
  value: string;
  description: string;
};

export type TrackVariable = {
  id: string;
  name: string;
  description: string;
  unit: string;
  samples: TrackSample[];
};

export type TrackCollection = {
  id: string;
  name: string;
  statics: TrackStatic[];
  variables: TrackVariable[];
};

export type CollectionsFile = {
  collections: TrackCollection[];
};

export type CollectionsMetaFile = {
  collections: {
    id: string;
    name: string;
    statics: TrackStatic[];
    variables: Omit<TrackVariable, "samples">[];
  }[];
};

export type TrackMonthFile = {
  month: string;
  samples: {
    variableId: string;
    date: string;
    value: number;
    at: string;
    note?: string;
    source?: "chat" | "ui";
  }[];
};

export type Manifest = {
  folderId: string;
  calorieGoal?: number;
  days: ManifestDay[];
  calorieDays?: { date: string; fileId: string }[];
  recentSessions?: RecentSession[];
  monthSummaries?: { month: string; fileId: string }[];
  periodQaFileId?: string;
  collectionsFileId?: string;
  trackMonths?: { month: string; fileId: string }[];
  monthFolders?: { month: string; folderId: string }[];
  customSkillsFileId?: string;
  artifactsFileId?: string;
  artifactFiles?: { id: string; fileId: string }[];
};

export type CustomSkill = {
  id: string;
  tag: string;
  hint: string;
  intent: string;
  instructions: string;
  uses: {
    nutrition: boolean;
    collections: boolean;
    diary: boolean;
    range: "none" | "day" | "week" | "month";
  };
  createdAt: string;
  updatedAt: string;
};

export type CustomSkillsFile = {
  skills: CustomSkill[];
};

export type ArtifactKind = "html" | "svg" | "md" | "json" | "png" | "csv" | "text" | "other";

export type ArtifactFile = {
  id: string;
  title: string;
  kind: ArtifactKind;
  mimeType: string;
  content: string;
  encoding: "utf8" | "base64";
  sourcePath?: string;
  createdAt: string;
  note?: string;
};

export type ArtifactsIndex = {
  items: {
    id: string;
    title: string;
    kind: ArtifactKind;
    mimeType: string;
    createdAt: string;
    fileId: string;
    note?: string;
  }[];
};

export type Skill = {
  id: string;
  tag: string;
  hint: string;
  custom?: boolean;
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
