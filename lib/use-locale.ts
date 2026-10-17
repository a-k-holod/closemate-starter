"use client";

import { useEffect, useState } from "react";
import { DEFAULT_LOCALE, parseLocale, readStoredLocale, writeStoredLocale, type Locale, type LocaleStorage } from "./locale";
import { messagesFor, type Messages } from "./messages";

function browserStorage(): LocaleStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * English on the server and on the first client render. The saved language is
 * applied in an effect so localStorage cannot disagree with hydration.
 */
export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void; t: Messages } {
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);

  useEffect(() => {
    const stored = readStoredLocale(browserStorage());
    if (stored !== DEFAULT_LOCALE) setLocaleState(stored);
  }, []);

  useEffect(() => {
    const title = messagesFor(locale).meta.title;
    const apply = () => {
      document.documentElement.lang = locale;
      if (document.title !== title) document.title = title;
    };
    apply();
    // Next.js reapplies the server metadata <title> after hydration. Correct it
    // again whenever that node changes so a restored language keeps its title.
    const titleEl = document.querySelector("title");
    const observer = new MutationObserver(apply);
    if (titleEl) {
      observer.observe(titleEl, { childList: true, characterData: true, subtree: true });
    }
    const timer = window.setTimeout(apply, 0);
    return () => {
      observer.disconnect();
      window.clearTimeout(timer);
    };
  }, [locale]);

  const setLocale = (next: Locale) => {
    const value = parseLocale(next);
    setLocaleState(value);
    writeStoredLocale(browserStorage(), value);
  };

  return { locale, setLocale, t: messagesFor(locale) };
}
