import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api } from "@/lib/api";
import { en, type MessageKey } from "@/lib/locales/en";

export type Locale = "auto" | "en" | "zh" | "ja";
type Concrete = "en" | "zh" | "ja";
export type { MessageKey };

type Vars = Record<string, string | number>;

// English is bundled as the fallback; the other locales are code-split and
// fetched the first time they are selected.
const cache: Partial<Record<Concrete, Record<MessageKey, string>>> = { en };
let currentLocale: Concrete = "en";
let current: Record<MessageKey, string> = en;

/** resolveLocale turns "auto" into a concrete locale from the browser. */
export function resolveLocale(locale: Locale): Concrete {
  if (locale === "en" || locale === "zh" || locale === "ja") return locale;
  const lang = (typeof navigator !== "undefined" ? navigator.language : "").toLowerCase();
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("ja")) return "ja";
  return "en";
}

/** loadLocale fetches (and caches) a locale's messages on demand. */
export async function loadLocale(locale: Locale): Promise<void> {
  const target = resolveLocale(locale);
  if (cache[target]) {
    if (currentLocale === target) current = cache[target]!;
    return;
  }
  if (target === "zh") {
    const m = await import("@/lib/locales/zh");
    cache.zh = m.zh;
  } else if (target === "ja") {
    const m = await import("@/lib/locales/ja");
    cache.ja = m.ja;
  }
  if (currentLocale === target) current = cache[target] ?? en;
}

/** setGlobalLocale points the module-level translator at a locale (using the
 * bundled English dictionary until the requested one has loaded). */
export function setGlobalLocale(locale: Locale) {
  currentLocale = resolveLocale(locale);
  current = cache[currentLocale] ?? en;
}

function format(str: string, vars?: Vars): string {
  if (!vars) return str;
  for (const [k, v] of Object.entries(vars)) {
    str = str.replaceAll(`{${k}}`, String(v));
  }
  return str;
}

// Module-level so non-React code (e.g. the Zustand store) can translate.
export function translate(key: MessageKey, vars?: Vars): string {
  return format(current[key] ?? key, vars);
}

export const LOCALES: { value: Locale; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
  { value: "ja", label: "日本語" },
];

export type Theme = "auto" | "light" | "dark";

/** resolveTheme turns "auto" into a concrete theme from the OS preference. */
export function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

type I18nContextValue = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: MessageKey, vars?: Vars) => string;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
};

const I18nContext = createContext<I18nContextValue | null>(null);

const STORAGE_KEY = "curlui.locale";
const THEME_KEY = "curlui.theme";

function readLocale(): Locale {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "auto" || saved === "en" || saved === "zh" || saved === "ja") return saved;
  return "auto";
}

function readTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "auto" || saved === "light" || saved === "dark") return saved;
  return "auto";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  // Bumped once a lazily-loaded dictionary arrives so consumers re-render.
  const [dictTick, setDictTick] = useState(0);
  const syncedRef = useRef(false);

  // Apply language and load its dictionary on demand.
  useEffect(() => {
    document.documentElement.lang = resolveLocale(locale);
    setGlobalLocale(locale);
    let active = true;
    void loadLocale(locale).then(() => {
      if (active) setDictTick((v) => v + 1);
    });
    return () => {
      active = false;
    };
  }, [locale]);

  // Apply theme (following the OS when set to "auto").
  useEffect(() => {
    const apply = () => document.documentElement.classList.toggle("dark", resolveTheme(theme) === "dark");
    apply();
    if (theme !== "auto") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [theme]);

  // Pull persisted preferences from the backend once (survives cleared cache
  // and follows the user across browsers/devices).
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    api
      .getSettings()
      .then((s) => {
        // The backend setting is a shared default: only adopt it when this
        // browser has no preference of its own (otherwise one user's choice
        // would override everyone else's, including a fresh "auto").
        const l = s.language;
        const hasLocal = localStorage.getItem(STORAGE_KEY);
        if (!hasLocal && (l === "auto" || l === "en" || l === "zh" || l === "ja")) {
          setGlobalLocale(l);
          setLocaleState(l);
          localStorage.setItem(STORAGE_KEY, l);
        }
        const th = s.theme;
        if (!localStorage.getItem(THEME_KEY) && (th === "auto" || th === "light" || th === "dark")) {
          setThemeState(th);
          localStorage.setItem(THEME_KEY, th);
        }
      })
      .catch(() => {});
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setGlobalLocale(l);
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
    void api.saveSettings({ language: l }).catch(() => {});
  }, []);

  const setTheme = useCallback((th: Theme) => {
    setThemeState(th);
    localStorage.setItem(THEME_KEY, th);
    void api.saveSettings({ theme: th }).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(resolveTheme(theme) === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const t = useCallback(
    (key: MessageKey, vars?: Vars) => format(current[key] ?? key, vars),
    // dictTick forces a new callback once the active dictionary loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale, dictTick],
  );

  return (
    <I18nContext.Provider value={{ locale, setLocale, t, theme, setTheme, toggleTheme }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
