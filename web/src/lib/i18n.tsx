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

export type Locale = "en" | "zh" | "ja";
export type { MessageKey };

type Vars = Record<string, string | number>;

// English is bundled as the fallback; the other locales are code-split and
// fetched the first time they are selected.
const cache: Partial<Record<Locale, Record<MessageKey, string>>> = { en };
let currentLocale: Locale = "en";
let current: Record<MessageKey, string> = en;

/** loadLocale fetches (and caches) a locale's messages on demand. */
export async function loadLocale(locale: Locale): Promise<void> {
  if (cache[locale]) {
    if (currentLocale === locale) current = cache[locale]!;
    return;
  }
  if (locale === "zh") {
    const m = await import("@/lib/locales/zh");
    cache.zh = m.zh;
  } else if (locale === "ja") {
    const m = await import("@/lib/locales/ja");
    cache.ja = m.ja;
  }
  if (currentLocale === locale) current = cache[locale] ?? en;
}

/** setGlobalLocale points the module-level translator at a locale (using the
 * bundled English dictionary until the requested one has loaded). */
export function setGlobalLocale(locale: Locale) {
  currentLocale = locale;
  current = cache[locale] ?? en;
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
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
  { value: "ja", label: "日本語" },
];

export type Theme = "light" | "dark";

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
  if (saved === "en" || saved === "zh" || saved === "ja") return saved;
  const lang = navigator.language?.toLowerCase() ?? "";
  if (lang.startsWith("zh")) return "zh";
  if (lang.startsWith("ja")) return "ja";
  return "en";
}

function readTheme(): Theme {
  const saved = localStorage.getItem(THEME_KEY);
  return saved === "light" || saved === "dark" ? saved : "dark";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(readLocale);
  const [theme, setThemeState] = useState<Theme>(readTheme);
  // Bumped once a lazily-loaded dictionary arrives so consumers re-render.
  const [dictTick, setDictTick] = useState(0);
  const syncedRef = useRef(false);

  // Apply language and load its dictionary on demand.
  useEffect(() => {
    document.documentElement.lang = locale;
    setGlobalLocale(locale);
    let active = true;
    void loadLocale(locale).then(() => {
      if (active) setDictTick((v) => v + 1);
    });
    return () => {
      active = false;
    };
  }, [locale]);

  // Apply theme.
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // Pull persisted preferences from the backend once (survives cleared cache
  // and follows the user across browsers/devices).
  useEffect(() => {
    if (syncedRef.current) return;
    syncedRef.current = true;
    api
      .getSettings()
      .then((s) => {
        const l = s.language;
        if (l === "en" || l === "zh" || l === "ja") {
          setGlobalLocale(l);
          setLocaleState(l);
          localStorage.setItem(STORAGE_KEY, l);
        }
        const th = s.theme;
        if (th === "light" || th === "dark") {
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
    setTheme(theme === "dark" ? "light" : "dark");
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
