import { useTheme } from "../lib/theme";

type Tab = "chat" | "log" | "export";

type Props = {
  tab: Tab;
  onTab: (tab: Tab) => void;
  placement?: "side" | "bottom";
  settingsOpen?: boolean;
  onSettings: () => void;
};

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
        title="Export (beta)"
        aria-label="Export, beta"
        aria-pressed={tab === "export"}
        onClick={() => onTab("export")}
        className={`relative flex h-12 w-12 items-center justify-center ${tab === "export" ? "text-ink" : "text-ink-mute"}`}
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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M12 3.5v2.2M12 18.3V20.5M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12H20.5M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"
            stroke="currentColor"
            strokeWidth="1.4"
          />
        </svg>
      </button>
    </nav>
  );
}

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark";
  return (
    <div className="flex h-full flex-col bg-paper">
      <div className="flex items-center justify-between border-b border-ink/15 px-4 py-3">
        <h2 className="font-serif text-lg">Settings</h2>
        <button type="button" className="text-sm text-ink-mute" onClick={onClose}>
          Close
        </button>
      </div>
      <label className="flex items-center justify-between gap-4 px-4 py-4">
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
    </div>
  );
}
