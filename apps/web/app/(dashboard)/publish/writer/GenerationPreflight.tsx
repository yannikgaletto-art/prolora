'use client';

export type PreflightLanguage = 'de' | 'en' | 'both';
export type PreflightMention = 'adaptive' | 'include' | 'exclude';

export function GenerationPreflight({
  language,
  mention,
  disabled,
  onLanguageChange,
  onMentionChange,
  allowBoth = true,
}: {
  language: PreflightLanguage;
  mention: PreflightMention;
  disabled?: boolean;
  onLanguageChange: (value: PreflightLanguage) => void;
  onMentionChange: (value: PreflightMention) => void;
  allowBoth?: boolean;
}) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4" aria-label="Generation preflight">
      <h2 className="text-sm font-semibold text-gray-950">Ausgabe vor dem Generieren festlegen</h2>
      <div className="mt-3 grid gap-4 sm:grid-cols-2">
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Sprache</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {([['de', 'Deutsch'], ['en', 'English'], ...(allowBoth ? [['both', 'Beide'] as const] : [])] as const).map(([value, label]) => (
              <Choice key={value} name="writer-language" checked={language === value} disabled={disabled} onChange={() => onLanguageChange(value)} label={label} />
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide text-gray-500">Pathly</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {([['adaptive', 'Adaptiv'], ['include', 'Erwähnen'], ['exclude', 'Nicht erwähnen']] as const).map(([value, label]) => (
              <Choice key={value} name="writer-mention" checked={mention === value} disabled={disabled} onChange={() => onMentionChange(value)} label={label} />
            ))}
          </div>
        </fieldset>
      </div>
    </section>
  );
}

function Choice({ name, checked, disabled, onChange, label }: { name: string; checked: boolean; disabled?: boolean; onChange: () => void; label: string }) {
  return (
    <label className={`cursor-pointer rounded-xl border px-3 py-2 text-sm font-medium ${checked ? 'border-primary-400 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-600'}`}>
      <input className="sr-only" type="radio" name={name} checked={checked} disabled={disabled} onChange={onChange} />
      {label}
    </label>
  );
}
