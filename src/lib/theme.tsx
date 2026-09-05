"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "light" | "dark";

const ThemeContext = createContext<{
  theme: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
}>({ theme: "light", toggle: () => {}, setTheme: () => {} });

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    const stored = localStorage.getItem("diary.theme");
    const next: Theme = stored === "dark" ? "dark" : "light";
    setTheme(next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }, []);

  const apply = (next: Theme) => {
    localStorage.setItem("diary.theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    return next;
  };

  const toggle = () => {
    setTheme((prev) => apply(prev === "dark" ? "light" : "dark"));
  };

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggle,
        setTheme: (next) => setTheme(apply(next)),
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
