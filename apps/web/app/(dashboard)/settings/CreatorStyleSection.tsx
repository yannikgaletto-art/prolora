'use client';

import { useState } from 'react';
import type { AppLocale, StylePreset } from '@prolora/shared';
import { Card } from '@/app/components/Card';
import { getDict } from '@/lib/i18n';
import { getCreatorStyleCopy } from '@/lib/i18n/creator-style';

const STYLE_OPTIONS: StylePreset[] = [
  'neutral', 'welsh_short', 'koe_pia', 'abdaal_evidence',
  'hormozi_carousel', 'ai_automation_screencast', 'doku_modus',
];

export function CreatorStyleSection({ initialStyle, locale }: { initialStyle: StylePreset; locale: AppLocale }) {
  const dict = getDict(locale);
  const styleCopy = getCreatorStyleCopy(locale);
  const [selected, setSelected] = useState(initialStyle);
  const [saved, setSaved] = useState(initialStyle);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  async function save() {
    setState('saving');
    try {
      const response = await fetch('/api/v1/workspace/creator-style', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ creator_style: selected }),
      });
      if (!response.ok) throw new Error('save failed');
      setSaved(selected);
      setState('saved');
    } catch {
      setState('error');
    }
  }

  return (
    <Card title={dict.creator_style_title} description={dict.creator_style_description}>
      <fieldset>
        <legend className="sr-only">{dict.creator_style_title}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {STYLE_OPTIONS.map((style) => {
            const active = selected === style;
            return (
              <label key={style} className={`cursor-pointer rounded-lg border p-4 transition-colors ${active ? 'border-primary-600 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="creator-style" value={style} checked={active}
                  onChange={() => { setSelected(style); setState('idle'); }} className="sr-only" />
                <span className="block text-sm font-semibold text-gray-900">{styleCopy[style].label}</span>
                <span className="mt-1 block text-sm text-gray-600">{styleCopy[style].description}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={selected === saved || state === 'saving'}
          className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">
          {state === 'saving' ? dict.creator_style_saving : dict.creator_style_save}
        </button>
        {state === 'saved' && <p className="text-sm text-green-700">{dict.creator_style_saved}</p>}
        {state === 'error' && <p role="alert" className="text-sm text-red-700">{dict.creator_style_error}</p>}
      </div>
    </Card>
  );
}
