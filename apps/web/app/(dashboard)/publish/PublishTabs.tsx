import Link from 'next/link';

// Plain Server Component: static links, active tab passed in by each page. No
// client-side state needed for a static sub-nav.
export function PublishTabs({
  active,
}: {
  active: 'start' | 'writer' | 'compose' | 'pipeline' | 'calendar' | 'hub' | 'posts' | 'media';
}) {
  const tabs = [
    { key: 'start' as const, label: 'Start', href: '/publish/start' },
    { key: 'writer' as const, label: 'Writer', href: '/publish/writer', badge: 'Pilot' },
    { key: 'compose' as const, label: 'Compose', href: '/publish' },
    // Plan 2 / 2B.5 — Tages-Cockpit der Content-Fabrik.
    { key: 'pipeline' as const, label: 'Fabrik', href: '/publish/pipeline' },
    { key: 'calendar' as const, label: 'Calendar', href: '/publish/calendar' },
    { key: 'hub' as const, label: 'Content Hub', href: '/publish/hub' },
    { key: 'posts' as const, label: 'Posts', href: '/publish/posts' },
    { key: 'media' as const, label: 'Media', href: '/publish/media' },
  ];

  return (
    <div className="overflow-x-auto border-b border-gray-200">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={active === tab.key ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 ${
              active === tab.key
                ? 'border-primary-600 text-primary-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
            {'badge' in tab && (
              <span className="rounded-full bg-primary-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-primary-700 ring-1 ring-inset ring-primary-600/15">
                {tab.badge}
              </span>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
