"use client";

import { useEffect, useState } from "react";
import { useTheme } from "../lib/theme";
import {
  CHEAP_GEMINI_MODELS,
  DEFAULT_AI_SETTINGS,
  loadAiSettings,
  loadAiUsage,
  saveAiSettings,
  type AiSettings,
} from "../lib/ai-settings";
import { formatStamp } from "../lib/dates";
import { DEFAULT_CALORIE_GOAL } from "../lib/nutrition";
import type { ArtifactFile, ArtifactsIndex, CollectionsFile, CustomSkill, CustomSkillsFile } from "../lib/types";
import type { TrackableRow } from "../lib/trackables";
import { BUILTIN_SKILLS, normalizeSkillTag, skillTagConflict } from "../lib/skills";
import { callGemini } from "../lib/gemini-client";
import { CollectionsView } from "./CollectionsView";
import { ArtifactViewerPanel } from "./ArtifactViewer";

type Tab = "chat" | "log" | "analyze";
type Screen =
  | "root"
  | "usage"
  | "ai"
  | "tracked"
  | "nutrition"
  | "collections-list"
  | "collections-manage"
  | "skills"
  | "skills-new"
  | "artifacts"
  | "artifact-view";

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  placement?: "side" | "bottom";
  settingsOpen?: boolean;
  onSettings: () => void;
};

function Chevron() {
  return <span className="text-ink-mute">›</span>;
}

function SettingsGearIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M19.4 13.5a7.7 7.7 0 0 0 .1-1.5 7.7 7.7 0 0 0-.1-1.5l2-1.5-2-3.5-2.4 1a7.4 7.4 0 0 0-2.6-1.5L14 2h-4l-.4 2.5a7.4 7.4 0 0 0-2.6 1.5l-2.4-1-2 3.5 2 1.5a7.7 7.7 0 0 0-.1 1.5c0 .5 0 1 .1 1.5l-2 1.5 2 3.5 2.4-1a7.4 7.4 0 0 0 2.6 1.5L10 22h4l.4-2.5a7.4 7.4 0 0 0 2.6-1.5l2.4 1 2-3.5-2-1.5Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconRail({ tab, onTab, placement = "side", settingsOpen, onSettings }: Props) {
  const bottom = placement === "bottom";
  return (
    <nav
      className={`flex shrink-0 items-center border-ink/15 bg-paper-2 ${
        bottom
          ? "order-last w-full justify-around border-t pb-[env(safe-area-inset-bottom)]"
          : "flex-row md:h-full md:w-14 md:flex-col md:border-r"
      }`}
    >
      <button
        type="button"
        title="Chat"
        aria-label="Chat"
        aria-pressed={tab === "chat"}
        onClick={() => onTab("chat")}
        className={`flex h-12 w-12 items-center justify-center ${tab === "chat" ? "text-ink" : "text-ink-mute"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 6.5h14v9.5H9l-4 3V6.5Z" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <button
        type="button"
        title="Logs"
        aria-label="Logs"
        aria-pressed={tab === "log"}
        onClick={() => onTab("log")}
        className={`flex h-12 w-12 items-center justify-center ${tab === "log" ? "text-ink" : "text-ink-mute"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="4" y="5" width="16" height="15" stroke="currentColor" strokeWidth="1.4" />
          <path d="M4 10h16M8 5v3M16 5v3" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      </button>
      <button
        type="button"
        title="Analyze (beta)"
        aria-label="Analyze, beta"
        aria-pressed={tab === "analyze"}
        onClick={() => onTab("analyze")}
        className={`relative flex h-12 w-12 items-center justify-center ${tab === "analyze" ? "text-ink" : "text-ink-mute"}`}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M4 18V6M8 14l3-8 3 5 2-3 4 6" stroke="currentColor" strokeWidth="1.4" />
        </svg>
        <span className="absolute right-0.5 bottom-1 rounded-sm bg-accent px-0.5 text-[8px] leading-3 tracking-wide text-paper uppercase">
          beta
        </span>
      </button>
      <button
        type="button"
        title="Settings"
        aria-label="Settings"
        aria-pressed={settingsOpen}
        onClick={onSettings}
        className={`flex h-12 w-12 items-center justify-center ${settingsOpen ? "text-ink" : "text-ink-mute"} ${bottom ? "" : "ml-auto md:mt-auto md:ml-0 md:mb-2"}`}
      >
        <SettingsGearIcon />
      </button>
    </nav>
  );
}

function RowButton({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between gap-3 border-b border-ink/10 px-4 py-4 text-left hover:bg-paper-2"
    >
      <span>
        <span className="block text-sm">{label}</span>
        {hint ? <span className="mt-0.5 block text-xs text-ink-mute">{hint}</span> : null}
      </span>
      <Chevron />
    </button>
  );
}

function TrackableList({ rows }: { rows: TrackableRow[] }) {
  if (rows.length === 0) {
    return <p className="px-4 py-3 text-sm text-ink-mute">None yet.</p>;
  }
  return (
    <ul className="divide-y divide-ink/10">
      {rows.map((r) => (
        <li key={r.id} className="px-4 py-3 text-sm">
          <p className="font-medium">
            {r.collectionName ? `${r.collectionName} / ` : ""}
            {r.name}
            {r.unit ? <span className="font-normal text-ink-mute"> · {r.unit}</span> : null}
          </p>
          {r.lastValue != null ? (
            <p className="mt-0.5 text-xs text-ink-mute">
              Last {r.lastValue}
              {r.unit ? ` ${r.unit}` : ""}
              {r.lastAt ? ` · ${formatStamp(r.lastAt)}` : ""}
            </p>
          ) : (
            <p className="mt-0.5 text-xs text-ink-mute">No entry yet</p>
          )}
        </li>
      ))}
    </ul>
  );
}

export function SettingsPanel({
  onClose,
  onDownloadData,
  nutritionRows,
  collectionRows,
  collections,
  collectionsSyncLabel,
  onCollectionsChange,
  calorieGoal,
  onCalorieGoalChange,
  customSkills,
  trackablesCatalog,
  onCustomSkillsChange,
  artifactsIndex,
  onDeleteArtifact,
  onOpenArtifact,
}: {
  onClose: () => void;
  onDownloadData?: () => Promise<void> | void;
  nutritionRows: TrackableRow[];
  collectionRows: TrackableRow[];
  collections: CollectionsFile;
  collectionsSyncLabel?: string | null;
  onCollectionsChange: (next: CollectionsFile) => Promise<void> | void;
  calorieGoal: number;
  onCalorieGoalChange: (goal: number) => Promise<void> | void;
  customSkills: CustomSkillsFile;
  trackablesCatalog: string;
  onCustomSkillsChange: (next: CustomSkillsFile) => Promise<void> | void;
  artifactsIndex: ArtifactsIndex;
  onDeleteArtifact: (id: string) => Promise<void> | void;
  onOpenArtifact: (id: string) => Promise<ArtifactFile | null>;
}) {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  const [screen, setScreen] = useState<Screen>("root");
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [usage, setUsage] = useState(() => loadAiUsage());
  const [showKey, setShowKey] = useState(false);
  const [aiSaved, setAiSaved] = useState(false);
  const [goalDraft, setGoalDraft] = useState(String(calorieGoal || DEFAULT_CALORIE_GOAL));
  const [goalBusy, setGoalBusy] = useState(false);
  const [skillTag, setSkillTag] = useState("@");
  const [skillIntent, setSkillIntent] = useState("");
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [draftSkill, setDraftSkill] = useState<CustomSkill | null>(null);
  const [artifactBusyId, setArtifactBusyId] = useState<string | null>(null);
  const [viewingArtifact, setViewingArtifact] = useState<ArtifactFile | null>(null);
  const [artifactLoadError, setArtifactLoadError] = useState<string | null>(null);

  useEffect(() => {
    setAi(loadAiSettings());
    setUsage(loadAiUsage());
  }, []);

  useEffect(() => {
    setGoalDraft(String(calorieGoal || DEFAULT_CALORIE_GOAL));
  }, [calorieGoal]);

  const usedGemini = usage.geminiRequests;
  const budgetGemini = Math.max(1, ai.dailyRequestBudget);
  const leftGemini = Math.max(0, budgetGemini - usedGemini);
  const pctGemini = Math.min(100, Math.round((usedGemini / budgetGemini) * 100));

  const title =
    screen === "root"
      ? "Settings"
      : screen === "usage"
        ? "Usage limit"
        : screen === "ai"
          ? "AI provider"
          : screen === "tracked"
            ? "Tracked items"
            : screen === "nutrition"
              ? "Default · Nutrition"
              : screen === "collections-list"
                ? "Collections"
                : screen === "skills"
                  ? "Skills"
                  : screen === "skills-new"
                    ? "New skill"
                    : screen === "artifacts"
                      ? "Artifacts"
                      : screen === "artifact-view"
                        ? viewingArtifact?.title || "Artifact"
                        : "Manage collections";

  const back = () => {
    if (screen === "nutrition" || screen === "collections-list") setScreen("tracked");
    else if (screen === "collections-manage") setScreen("collections-list");
    else if (screen === "skills-new") setScreen("skills");
    else if (screen === "artifact-view") {
      setViewingArtifact(null);
      setArtifactLoadError(null);
      setScreen("artifacts");
    } else setScreen("root");
  };

  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex items-center justify-between border-b border-ink/15 px-4 py-3">
        {screen === "root" ? (
          <h2 className="font-serif text-lg">{title}</h2>
        ) : (
          <button type="button" className="text-sm text-ink-mute" onClick={back}>
            ← Back
          </button>
        )}
        <button type="button" className="text-sm text-ink-mute" onClick={onClose}>
          Close
        </button>
      </div>

      {screen !== "root" && screen !== "artifact-view" ? (
        <h2 className="border-b border-ink/10 px-4 py-3 font-serif text-lg">{title}</h2>
      ) : null}

      <div className={`min-h-0 flex-1 ${screen === "artifact-view" ? "overflow-hidden" : "overflow-y-auto"}`}>
        {screen === "root" ? (
          <>
            <label className="flex items-center justify-between gap-4 border-b border-ink/10 px-4 py-4">
              <span className="text-sm">Dark mode</span>
              <button
                type="button"
                role="switch"
                aria-checked={dark}
                onClick={() => setTheme(dark ? "light" : "dark")}
                className={`relative h-6 w-11 rounded-full ${dark ? "bg-accent" : "bg-ink/20"}`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper transition-[left] ${dark ? "left-5" : "left-0.5"}`}
                />
              </button>
            </label>
            <RowButton
              label="Usage limit"
              hint={`${leftGemini} of ${budgetGemini} Gemini requests left`}
              onClick={() => {
                setUsage(loadAiUsage());
                setScreen("usage");
              }}
            />
            <RowButton
              label="Configure AI provider"
              hint={ai.geminiApiKey ? "Using device key · Gemini" : "Server key · Gemini"}
              onClick={() => {
                setAi(loadAiSettings());
                setScreen("ai");
              }}
            />
            <RowButton
              label="Tracked items"
              hint="Default nutrition and collections"
              onClick={() => setScreen("tracked")}
            />
            <RowButton
              label="Skills"
              hint="Chat @mentions and what they do"
              onClick={() => setScreen("skills")}
            />
            <RowButton
              label="Artifacts"
              hint={`${artifactsIndex.items.length} logged from Analyze`}
              onClick={() => setScreen("artifacts")}
            />
            <div className="border-t border-ink/10 px-4 py-4">
              <p className="text-sm">Download my data</p>
              <button
                type="button"
                disabled={!onDownloadData || downloading}
                className="mt-2 border border-ink/40 px-3 py-1.5 text-sm disabled:opacity-40"
                onClick={() => {
                  if (!onDownloadData) return;
                  setDownloading(true);
                  setDownloadError(null);
                  void Promise.resolve(onDownloadData())
                    .catch((e) =>
                      setDownloadError(e instanceof Error ? e.message : "Download failed"),
                    )
                    .finally(() => setDownloading(false));
                }}
              >
                {downloading ? "Preparing…" : "Download .zip"}
              </button>
              {downloadError ? <p className="mt-2 text-sm">{downloadError}</p> : null}
            </div>
          </>
        ) : null}

        {screen === "usage" ? (
          <div className="px-4 py-4">
            <p className="text-sm font-medium">Gemini (AI Studio API)</p>
            <div className="mt-2 h-2 w-full overflow-hidden bg-ink/10">
              <div
                className="h-full bg-accent transition-[width]"
                style={{ width: `${pctGemini}%` }}
              />
            </div>
            <p className="mt-2 text-sm">
              {leftGemini} of {budgetGemini} requests left · {usedGemini} used today
            </p>
            <p className="mt-2 text-xs text-ink-mute">
              Soft local cap. Real Google AI Studio / API quota is separate from Gemini web chat.
            </p>
            <label className="mt-3 block text-sm">
              Daily request budget
              <input
                type="number"
                min={1}
                value={ai.dailyRequestBudget}
                onChange={(e) =>
                  setAi({ ...ai, dailyRequestBudget: Math.max(1, Number(e.target.value) || 1) })
                }
                className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1.5 text-sm"
              />
            </label>
            <button
              type="button"
              className="mt-4 border border-ink bg-ink px-3 py-1.5 text-sm text-paper"
              onClick={() => {
                saveAiSettings({ ...loadAiSettings(), dailyRequestBudget: ai.dailyRequestBudget });
                setAiSaved(true);
                window.setTimeout(() => setAiSaved(false), 1200);
              }}
            >
              Save budget
            </button>
            {aiSaved ? <p className="mt-2 text-xs text-ink-mute">Saved.</p> : null}
          </div>
        ) : null}

        {screen === "ai" ? (
          <div className="px-4 py-4">
            <p className="text-xs text-ink-mute">
              Uses Google AI Studio API quotas for your key. Cannot use the free Gemini web-app chat
              allowance.
            </p>
            <label className="mt-4 block text-sm">
              Provider
              <select
                value={ai.provider}
                onChange={(e) => setAi({ ...ai, provider: e.target.value as AiSettings["provider"] })}
                className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1.5 text-sm"
              >
                <option value="gemini">Gemini (Google AI Studio)</option>
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Cheap model
              <select
                value={ai.model}
                onChange={(e) => setAi({ ...ai, model: e.target.value })}
                className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1.5 text-sm"
              >
                {CHEAP_GEMINI_MODELS.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              Alternative API key (optional)
              <div className="mt-1 flex gap-2">
                <input
                  type={showKey ? "text" : "password"}
                  value={ai.geminiApiKey}
                  onChange={(e) => setAi({ ...ai, geminiApiKey: e.target.value })}
                  placeholder="Blank = server GEMINI_API_KEY"
                  autoComplete="off"
                  spellCheck={false}
                  className="block w-full border border-ink/20 bg-paper px-2 py-1.5 font-mono text-sm"
                />
                <button
                  type="button"
                  className="shrink-0 text-xs text-ink-mute"
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <button
              type="button"
              className="mt-4 border border-ink bg-ink px-3 py-1.5 text-sm text-paper"
              onClick={() => {
                saveAiSettings(ai);
                setAiSaved(true);
                window.setTimeout(() => setAiSaved(false), 1200);
              }}
            >
              Save
            </button>
            {aiSaved ? <p className="mt-2 text-xs text-ink-mute">Saved on this device.</p> : null}
          </div>
        ) : null}

        {screen === "skills" ? (
          <div>
            <p className="border-b border-ink/10 px-4 py-3 text-xs text-ink-mute">
              Built-in skills plus your custom @triggers. Type @ in chat to use them.
            </p>
            <p className="px-4 py-2 text-xs tracking-[0.14em] text-ink-mute uppercase">Built-in</p>
            <ul className="divide-y divide-ink/10 border-b border-ink/10">
              {BUILTIN_SKILLS.map((s) => (
                <li key={s.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{s.tag}</p>
                  <p className="mt-1 text-sm text-ink-mute">{s.hint}</p>
                </li>
              ))}
            </ul>
            <p className="px-4 py-2 text-xs tracking-[0.14em] text-ink-mute uppercase">Custom</p>
            {customSkills.skills.length === 0 ? (
              <p className="px-4 py-3 text-sm text-ink-mute">No custom skills yet.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {customSkills.skills.map((s) => (
                  <li key={s.id} className="px-4 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{s.tag}</p>
                        <p className="mt-1 text-sm text-ink-mute">{s.hint}</p>
                        <p className="mt-2 text-xs text-ink-mute whitespace-pre-wrap">{s.instructions}</p>
                      </div>
                      <button
                        type="button"
                        className="shrink-0 text-xs text-ink-mute"
                        onClick={() => {
                          if (!confirm(`Delete ${s.tag}?`)) return;
                          void onCustomSkillsChange({
                            skills: customSkills.skills.filter((x) => x.id !== s.id),
                          });
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="px-4 py-4">
              <button
                type="button"
                className="border border-ink bg-ink px-3 py-1.5 text-sm text-paper"
                onClick={() => {
                  setSkillTag("@");
                  setSkillIntent("");
                  setDraftSkill(null);
                  setSkillError(null);
                  setScreen("skills-new");
                }}
              >
                Add new skill
              </button>
            </div>
          </div>
        ) : null}

        {screen === "skills-new" ? (
          <div className="px-4 py-4">
            <p className="text-xs text-ink-mute">
              Describe what the skill should do. We will compile it with your trackables into clear
              instructions.
            </p>
            <label className="mt-4 block text-sm">
              How to trigger
              <input
                value={skillTag}
                onChange={(e) => setSkillTag(e.target.value)}
                placeholder="@checkin"
                className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1.5 font-mono text-sm"
              />
            </label>
            {skillTagConflict(skillTag, customSkills.skills) ? (
              <p className="mt-1 text-xs text-ink-mute">{skillTagConflict(skillTag, customSkills.skills)}</p>
            ) : (
              <p className="mt-1 text-xs text-ink-mute">Will save as {normalizeSkillTag(skillTag) || "…"}</p>
            )}
            <label className="mt-3 block text-sm">
              What should this skill do?
              <textarea
                value={skillIntent}
                onChange={(e) => setSkillIntent(e.target.value)}
                rows={5}
                placeholder="e.g. When I write @checkin, summarize this week's carbs vs my weight trend and say if I am on track."
                className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1.5 font-serif text-sm leading-6"
              />
            </label>
            <button
              type="button"
              disabled={
                skillBusy ||
                !skillIntent.trim() ||
                Boolean(skillTagConflict(skillTag, customSkills.skills))
              }
              className="mt-3 border border-ink bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-40"
              onClick={() => {
                const tag = normalizeSkillTag(skillTag);
                const conflict = skillTagConflict(tag, customSkills.skills);
                if (conflict || !tag) {
                  setSkillError(conflict || "Invalid trigger");
                  return;
                }
                setSkillBusy(true);
                setSkillError(null);
                void callGemini({
                  mode: "skill_compile",
                  tag,
                  intent: skillIntent.trim(),
                  catalog: trackablesCatalog,
                  reservedTags: [
                    ...BUILTIN_SKILLS.map((s) => s.tag),
                    ...customSkills.skills.map((s) => s.tag),
                  ],
                })
                  .then((result) => {
                    if (!result.ok) {
                      setSkillError(result.message);
                      return;
                    }
                    if (result.mode !== "skill_compile") {
                      setSkillError("Could not compile skill");
                      return;
                    }
                    const now = new Date().toISOString();
                    setDraftSkill({
                      id: crypto.randomUUID(),
                      tag,
                      hint: result.data.hint,
                      intent: skillIntent.trim(),
                      instructions: result.data.instructions,
                      uses: result.data.uses,
                      createdAt: now,
                      updatedAt: now,
                    });
                  })
                  .finally(() => setSkillBusy(false));
              }}
            >
              {skillBusy ? "Generating…" : "Generate skill"}
            </button>
            {skillError ? <p className="mt-2 text-sm">{skillError}</p> : null}
            {draftSkill ? (
              <div className="mt-4 border border-ink/15 p-3">
                <p className="text-xs tracking-[0.12em] text-ink-mute uppercase">Generated</p>
                <p className="mt-2 text-sm font-medium">{draftSkill.tag}</p>
                <p className="mt-1 text-sm text-ink-mute">{draftSkill.hint}</p>
                <p className="mt-2 text-xs text-ink-mute">
                  Uses: nutrition {draftSkill.uses.nutrition ? "yes" : "no"} · collections{" "}
                  {draftSkill.uses.collections ? "yes" : "no"} · diary{" "}
                  {draftSkill.uses.diary ? "yes" : "no"} · range {draftSkill.uses.range}
                </p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6">{draftSkill.instructions}</p>
                <button
                  type="button"
                  className="mt-3 border border-ink bg-ink px-3 py-1.5 text-sm text-paper"
                  onClick={() => {
                    void Promise.resolve(
                      onCustomSkillsChange({
                        skills: [...customSkills.skills, draftSkill],
                      }),
                    ).then(() => {
                      setDraftSkill(null);
                      setScreen("skills");
                    });
                  }}
                >
                  Save skill
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {screen === "artifacts" ? (
          <div>
            <p className="border-b border-ink/10 px-4 py-3 text-xs text-ink-mute">
              Logged AnalyzeBeta outputs on Drive. Tap one to open it in-app.
            </p>
            {artifactLoadError ? <p className="px-4 py-2 text-sm">{artifactLoadError}</p> : null}
            {artifactsIndex.items.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-mute">No artifacts yet. Log from Analyze.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {artifactsIndex.items.map((a) => (
                  <li key={a.id} className="flex items-start justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        setArtifactBusyId(a.id);
                        setArtifactLoadError(null);
                        void Promise.resolve(onOpenArtifact(a.id))
                          .then((file) => {
                            if (!file) {
                              setArtifactLoadError("Could not load artifact.");
                              return;
                            }
                            setViewingArtifact(file);
                            setScreen("artifact-view");
                          })
                          .catch((e) =>
                            setArtifactLoadError(e instanceof Error ? e.message : "Load failed"),
                          )
                          .finally(() => setArtifactBusyId(null));
                      }}
                    >
                      <p className="truncate text-sm font-medium">{a.title}</p>
                      <p className="mt-1 text-xs text-ink-mute">
                        {a.kind} · {formatStamp(a.createdAt)}
                        {artifactBusyId === a.id ? " · opening…" : ""}
                      </p>
                      {a.note ? <p className="mt-1 text-xs text-ink-mute">{a.note}</p> : null}
                    </button>
                    <button
                      type="button"
                      disabled={artifactBusyId === a.id}
                      className="shrink-0 text-xs text-ink-mute disabled:opacity-40"
                      onClick={() => {
                        if (!confirm(`Delete artifact “${a.title}”?`)) return;
                        setArtifactBusyId(a.id);
                        void Promise.resolve(onDeleteArtifact(a.id)).finally(() =>
                          setArtifactBusyId(null),
                        );
                      }}
                    >
                      Delete
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {screen === "artifact-view" && viewingArtifact ? (
          <div className="flex h-full min-h-[50vh] flex-col">
            <ArtifactViewerPanel
              artifact={viewingArtifact}
              onClose={() => {
                setViewingArtifact(null);
                setScreen("artifacts");
              }}
              onDelete={() => {
                if (!confirm(`Delete artifact “${viewingArtifact.title}”?`)) return;
                const id = viewingArtifact.id;
                setArtifactBusyId(id);
                void Promise.resolve(onDeleteArtifact(id))
                  .then(() => {
                    setViewingArtifact(null);
                    setScreen("artifacts");
                  })
                  .finally(() => setArtifactBusyId(null));
              }}
              deleting={artifactBusyId === viewingArtifact.id}
            />
          </div>
        ) : null}

        {screen === "tracked" ? (
          <>
            <RowButton
              label="Default"
              hint="Nutrition"
              onClick={() => setScreen("nutrition")}
            />
            <RowButton
              label="Collections"
              hint={`${collections.collections.length} collection${collections.collections.length === 1 ? "" : "s"}`}
              onClick={() => setScreen("collections-list")}
            />
          </>
        ) : null}

        {screen === "nutrition" ? (
          <div>
            <div className="border-b border-ink/10 px-4 py-4">
              <label className="block text-sm">
                Calories goal per day
                <input
                  type="number"
                  min={1}
                  value={goalDraft}
                  onChange={(e) => setGoalDraft(e.target.value)}
                  className="mt-1 block w-full border border-ink/20 bg-paper px-2 py-1.5 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={goalBusy}
                className="mt-3 border border-ink bg-ink px-3 py-1.5 text-sm text-paper disabled:opacity-40"
                onClick={() => {
                  const n = Math.max(1, Math.round(Number(goalDraft) || DEFAULT_CALORIE_GOAL));
                  setGoalBusy(true);
                  void Promise.resolve(onCalorieGoalChange(n))
                    .then(() => setGoalDraft(String(n)))
                    .finally(() => setGoalBusy(false));
                }}
              >
                {goalBusy ? "Saving…" : "Save goal"}
              </button>
            </div>
            <p className="px-4 py-2 text-xs tracking-[0.14em] text-ink-mute uppercase">
              Nutrition variables
            </p>
            <TrackableList rows={nutritionRows} />
          </div>
        ) : null}

        {screen === "collections-list" ? (
          <div>
            {collections.collections.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-mute">No collections yet.</p>
            ) : (
              <ul className="divide-y divide-ink/10">
                {collections.collections.map((c) => {
                  const vars = collectionRows.filter((r) => r.collectionName === c.name);
                  const latest = vars
                    .map((v) => v.lastAt)
                    .filter(Boolean)
                    .sort()
                    .at(-1);
                  return (
                    <li key={c.id} className="px-4 py-3 text-sm">
                      <p className="font-medium">{c.name}</p>
                      <p className="mt-0.5 text-xs text-ink-mute">
                        {c.variables.length} var · {c.statics.length} static
                        {latest ? ` · last ${formatStamp(latest)}` : " · no entry yet"}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="px-4 py-4">
              <button
                type="button"
                className="border border-ink bg-ink px-3 py-1.5 text-sm text-paper"
                onClick={() => setScreen("collections-manage")}
              >
                Manage collections
              </button>
            </div>
          </div>
        ) : null}

        {screen === "collections-manage" ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <CollectionsView
              file={collections}
              syncLabel={collectionsSyncLabel}
              onChange={onCollectionsChange}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
