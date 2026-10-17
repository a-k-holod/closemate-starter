"use client";

import { LOCALES, type Locale } from "@/lib/locale";

type LocaleSwitcherProps = {
  locale: Locale;
  label: string;
  names: Record<Locale, string>;
  onChange: (locale: Locale) => void;
};

export function LocaleSwitcher({ locale, label, names, onChange }: LocaleSwitcherProps) {
  return (
    <div className="locale-switch" role="group" aria-label={label}>
      {LOCALES.map((code) => {
        const selected = locale === code;
        return (
          <button key={code} type="button" className={selected ? "locale-option locale-option-active" : "locale-option"} aria-pressed={selected} aria-label={names[code]} lang={code} onClick={() => onChange(code)}>
            {code.toUpperCase()}
          </button>
        );
      })}
    </div>
  );
}
