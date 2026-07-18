'use client';

import type { AppLocale, PlatformType } from '@prolora/shared';
import { FOLD_LIMITS, runDeterministicChecks } from '@/lib/scoring/deterministic';
import { getDict } from '@/lib/i18n';

export function FoldPreview({
  content,
  platform,
  locale,
}: {
  content: string;
  platform: PlatformType;
  locale: AppLocale;
}) {
  const limit = FOLD_LIMITS[platform];
  if (!limit || content.trim().length <= limit) return null;

  const dict = getDict(locale);
  const foldText = runDeterministicChecks(content, platform).fold_text;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
        {dict.impact_fold_label}
      </p>
      <div className="rounded-md border border-gray-200 bg-white px-3 py-3 shadow-sm">
        <p className="whitespace-pre-wrap text-sm leading-6 text-gray-900">{foldText}</p>
        <span className="mt-1 inline-block text-sm font-medium text-gray-400">
          {dict.impact_more}
        </span>
      </div>
    </div>
  );
}
