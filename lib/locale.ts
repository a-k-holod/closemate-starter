export const LOCALES = ["en", "pl"] as const;
export type Locale = (typeof LOCALES)[number];

/** First-time visitors, the server render, and any invalid stored value. */
export const DEFAULT_LOCALE: Locale = "en";

/** Versioned so a future copy change can ignore an older selection. */
export const LOCALE_STORAGE_KEY = "closemate.locale.v1";

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "pl";
}

/** Only the explicit enum is accepted. Missing, empty, or any other value becomes English. */
export function parseLocale(value: unknown): Locale {
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function intlLocale(locale: Locale): "en-US" | "pl-PL" {
  return locale === "pl" ? "pl-PL" : "en-US";
}

export type LocaleStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/**
 * Reads the saved language. Unavailable storage, a thrown access, or an invalid
 * value all return English. Safe to call only after mount — the server render
 * must use {@link DEFAULT_LOCALE} so hydration matches.
 */
export function readStoredLocale(storage: LocaleStorage | null | undefined): Locale {
  if (!storage) return DEFAULT_LOCALE;
  try {
    return parseLocale(storage.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** Persists a validated locale. Returns false when storage is missing or throws. */
export function writeStoredLocale(storage: LocaleStorage | null | undefined, locale: Locale): boolean {
  if (!storage || !isLocale(locale)) return false;
  try {
    storage.setItem(LOCALE_STORAGE_KEY, locale);
    return true;
  } catch {
    return false;
  }
}

/** Locale used for the server render and the first client render. */
export function localeForHydration(): Locale {
  return DEFAULT_LOCALE;
}
