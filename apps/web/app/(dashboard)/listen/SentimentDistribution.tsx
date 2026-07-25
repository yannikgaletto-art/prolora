import type { AppLocale, FeedbackSentiment } from '@prolora/shared';
import { getRun7Dict } from '@/lib/i18n/run7';

const SENTIMENT_ORDER: FeedbackSentiment[] = ['positive', 'neutral', 'mixed', 'negative'];

const SENTIMENT_BAR_COLOR: Record<FeedbackSentiment, string> = {
  positive: 'bg-green-500',
  neutral: 'bg-gray-400',
  mixed: 'bg-amber-500',
  negative: 'bg-red-500',
};

export interface SentimentDistributionProps {
  bySentiment: Record<FeedbackSentiment, number>;
  locale: AppLocale;
}

// Pure-CSS stacked bar — no chart library.
export function SentimentDistribution({ bySentiment, locale }: SentimentDistributionProps) {
  const dict = getRun7Dict(locale).listen;
  const total = SENTIMENT_ORDER.reduce((sum, key) => sum + bySentiment[key], 0);

  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <p className="text-sm font-medium text-gray-900">
        {dict.sentimentTitle}{' '}
        <span className="font-normal text-gray-500">· {dict.window30d}</span>
      </p>
      {total === 0 ? (
        <p className="mt-3 text-sm text-gray-500">{dict.sentimentEmpty}</p>
      ) : (
        <>
          <div className="mt-3 flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
            {SENTIMENT_ORDER.map((key) => {
              const count = bySentiment[key];
              if (count === 0) return null;
              return (
                <div
                  key={key}
                  className={SENTIMENT_BAR_COLOR[key]}
                  style={{ width: `${(count / total) * 100}%` }}
                  title={`${dict.sentimentLabels[key]}: ${count}`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {SENTIMENT_ORDER.map((key) => (
              <div key={key} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span className={`h-2 w-2 rounded-full ${SENTIMENT_BAR_COLOR[key]}`} />
                {dict.sentimentLabels[key]}
                <span className="text-gray-400">
                  {bySentiment[key]} ({total > 0 ? Math.round((bySentiment[key] / total) * 100) : 0}
                  %)
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
