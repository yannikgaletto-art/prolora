import Link from 'next/link';
import type { AppLocale } from '@prolora/shared';
import { getOnePathDict } from '@/lib/i18n/onepath';

// GOAL-RUN11 One Path: the eight equal-rank tabs collapse to Post + Verlauf.
// Everything else stays reachable — demoted into the Werkzeuge menu (D3:
// nothing is deleted, it just stops competing for attention). Still a plain
// Server Component: the dropdown is a native <details>, no client JS.
export function PublishTabs({
  active,
  locale = 'de',
}: {
  active: 'start' | 'writer' | 'compose' | 'pipeline' | 'calendar' | 'hub' | 'posts' | 'media';
  locale?: AppLocale;
}) {
  const dict = getOnePathDict(locale).tabs;

  const primary = [
    { key: 'compose' as const, label: dict.post, href: '/publish' },
    { key: 'posts' as const, label: dict.history, href: '/publish/posts' },
  ];

  const tools = [
    { key: 'start' as const, label: dict.guided, href: '/publish/start' },
    { key: 'writer' as const, label: 'Writer', href: '/publish/writer' },
    { key: 'pipeline' as const, label: 'Fabrik', href: '/publish/pipeline' },
    { key: 'calendar' as const, label: 'Calendar', href: '/publish/calendar' },
    { key: 'hub' as const, label: 'Content Hub', href: '/publish/hub' },
    { key: 'media' as const, label: 'Media', href: '/publish/media' },
    // Kein eigener active-Key: die Templates-Seite rendert diese Tabs nicht.
    // Der Eintrag existiert, damit der Vorlagen-Katalog erreichbar bleibt (D3).
    { key: null, label: 'Templates', href: '/publish/templates' },
  ];

  const onToolPage = tools.some((tool) => tool.key === active);

  return (
    <div className="border-b border-gray-200">
      <div className="flex items-center gap-1">
        {primary.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active === tab.key ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
              active === tab.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </Link>
        ))}

        <details className="group relative -mb-px ml-auto">
          <summary
            className={`inline-flex min-h-11 cursor-pointer list-none items-center gap-1 border-b-2 px-3 py-2 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden ${
              onToolPage
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {dict.tools}
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="h-3.5 w-3.5 transition-transform group-open:rotate-180"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
            {tools.map((tool) => (
              <Link
                key={tool.href}
                href={tool.href}
                aria-current={active === tool.key ? 'page' : undefined}
                className={`block px-3 py-2 text-sm ${
                  active === tool.key
                    ? 'bg-primary-50 font-semibold text-primary-700'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {tool.label}
              </Link>
            ))}
          </div>
        </details>
      </div>
    </div>
  );
}
