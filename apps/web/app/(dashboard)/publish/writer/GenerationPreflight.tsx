'use client';

import type { AppLocale } from '@prolora/shared';

export type PreflightLanguage = 'de' | 'en' | 'both';
export type PreflightMention = 'adaptive' | 'include' | 'exclude';

export function GenerationPreflight({
  language,
  mention,
  disabled,
  onLanguageChange,
  onMentionChange,
  allowBoth = true,
  locale = 'de',
}: {
  language: PreflightLanguage;
  mention: PreflightMention;
  disabled?: boolean;
  onLanguageChange: (value: PreflightLanguage) => void;
  onMentionChange: (value: PreflightMention) => void;
  allowBoth?: boolean;
  locale?: AppLocale;
}) {
  const copy = PREFLIGHT_COPY[locale];
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-label="Generation preflight">
      <h2 className="text-sm font-semibold text-gray-950">{copy.title}</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">{copy.language}</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {([['de', copy.german], ['en', copy.english], ...(allowBoth ? [['both', copy.both] as const] : [])] as const).map(([value, label]) => (
              <Choice key={value} name="writer-language" checked={language === value} disabled={disabled} onChange={() => onLanguageChange(value)} label={label} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pathly</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {([['adaptive', copy.adaptive], ['include', copy.include], ['exclude', copy.exclude]] as const).map(([value, label]) => (
              <Choice key={value} name="writer-mention" checked={mention === value} disabled={disabled} onChange={() => onMentionChange(value)} label={label} />
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

const PREFLIGHT_COPY: Record<AppLocale, {
  title: string; language: string; german: string; english: string; both: string;
  adaptive: string; include: string; exclude: string;
}> = {
  de: { title: 'Ausgabe vor dem Generieren festlegen', language: 'Sprache', german: 'Deutsch', english: 'English', both: 'Beide', adaptive: 'Adaptiv', include: 'Erwähnen', exclude: 'Nicht erwähnen' },
  en: { title: 'Choose the output before generating', language: 'Language', german: 'German', english: 'English', both: 'Both', adaptive: 'Adaptive', include: 'Mention', exclude: 'Do not mention' },
  es: { title: 'Elige la salida antes de generar', language: 'Idioma', german: 'Alemán', english: 'Inglés', both: 'Ambos', adaptive: 'Adaptativo', include: 'Mencionar', exclude: 'No mencionar' },
};

function Choice({ name, checked, disabled, onChange, label }: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <label className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium ${checked ? 'border-primary-400 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-600'}`}>
      <input className="sr-only" type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}
