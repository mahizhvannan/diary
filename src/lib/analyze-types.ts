export type DiarySnapshot = {
  days: Record<string, unknown>;
  calories: Record<string, unknown>;
  monthSummaries: Record<string, unknown>;
  collections: unknown;
  customSkills: unknown;
  periodQa: unknown;
  manifest?: unknown;
};

export type WorkspaceArtifact = {
  relativePath: string;
  name: string;
  size: number;
  updatedAt: string;
};
