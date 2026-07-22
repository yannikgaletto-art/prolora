import Link from 'next/link';

// Plain Server Component: static links, active tab passed in by each page. No
// client-side state needed for a static sub-nav.
export function PublishTabs({ active }: { active: 'compose' | 'calendar' | 'hub' | 'posts' | 'media' }) {
  const tabs = [
    { key: 'compose' as const, label: 'Compose', href: '/publish' },
    { key: 'calendar' as const, label: 'Calendar', href: '/publish/calendar' },
    { key: 'hub' as const, label: 'Content Hub', href: '/publish/hub' },
    { key: 'posts' as const, label: 'Posts', href: '/publish/posts' },
    { key: 'media' as const, label: 'Media', href: '/publish/media' },
  ];

  return (
    <div className="flex gap-1 border-b border-gray-200">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={active === tab.key ? 'page' : undefined}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
            active === tab.key
              ? 'border-primary-600 text-primary-700'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
