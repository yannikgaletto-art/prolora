'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ComponentType, ReactNode } from 'react';
import {
  BoardIcon,
  ChevronIcon,
  CloseIcon,
  ConnectionsIcon,
  DiscoverIcon,
  ListenIcon,
  MenuIcon,
  PublishIcon,
  SettingsIcon,
} from './NavIcons';
import { UserMenu } from './UserMenu';

interface NavItem {
  href: string;
  label: string;
  Icon: ComponentType<{ className?: string }>;
}

// Core: the three things a new user came here to do.
// GOAL-RUN9: Products (workspace-as-product library) sits first — the flow
// starts with WHAT you are posting about.
const CORE_ITEMS: NavItem[] = [
  { href: '/products', label: 'Products', Icon: BoardIcon },
  { href: '/publish', label: 'Publish', Icon: PublishIcon },
  { href: '/listen', label: 'Listen', Icon: ListenIcon },
  { href: '/connections', label: 'Connections', Icon: ConnectionsIcon },
];

// Extended: hidden behind "More" until the user goes looking.
const EXTENDED_ITEMS: NavItem[] = [
  { href: '/discover', label: 'Discover', Icon: DiscoverIcon },
  { href: '/board', label: 'Board', Icon: BoardIcon },
  { href: '/settings', label: 'Settings', Icon: SettingsIcon },
];

const MORE_EXPANDED_KEY = 'prolora.nav.more-expanded';

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const { Icon } = item;
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
        active
          ? 'bg-primary-50 font-semibold text-primary-700'
          : 'font-medium text-gray-700 hover:bg-gray-100'
      }`}
    >
      <Icon className={`h-5 w-5 ${active ? 'text-primary-600' : 'text-gray-400'}`} />
      {item.label}
    </Link>
  );
}

// GOAL-RUN11: die GuideBar ("Schritt x von 6") ist raus — fehlende
// Voraussetzungen fragt der One-Path-Posten-Button just-in-time ab, statt
// als drittes Navigationssystem über allem zu hängen. GuideBar.tsx und
// lib/guide/ bleiben liegen (D3: nichts löschen).
export interface AppShellProps {
  workspaceName: string;
  userEmail: string;
  children: ReactNode;
}

export function AppShell({ workspaceName, userEmail, children }: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [moreExpanded, setMoreExpanded] = useState(false);

  const onExtendedPage = EXTENDED_ITEMS.some((item) => isActive(pathname, item.href));

  // localStorage is read after hydration — reading it during render would make
  // the server and client markup disagree.
  useEffect(() => {
    if (window.localStorage.getItem(MORE_EXPANDED_KEY) === 'true') setMoreExpanded(true);
  }, []);

  // Landing on an extended page counts as discovering the section: it stays
  // open on every future visit.
  useEffect(() => {
    if (onExtendedPage) {
      setMoreExpanded(true);
      window.localStorage.setItem(MORE_EXPANDED_KEY, 'true');
    }
  }, [onExtendedPage]);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const toggleMore = () => {
    setMoreExpanded((expanded) => {
      const next = !expanded;
      window.localStorage.setItem(MORE_EXPANDED_KEY, String(next));
      return next;
    });
  };

  const showExtended = moreExpanded || onExtendedPage;
  const closeDrawer = () => setDrawerOpen(false);

  const nav = (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {CORE_ITEMS.map((item) => (
        <NavLink
          key={item.href}
          item={item}
          active={isActive(pathname, item.href)}
          onNavigate={closeDrawer}
        />
      ))}

      <div className="mt-4">
        <button
          type="button"
          onClick={toggleMore}
          aria-expanded={showExtended}
          className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 hover:bg-gray-100"
        >
          More
          <ChevronIcon
            className={`h-4 w-4 transition-transform ${showExtended ? '' : '-rotate-90'}`}
          />
        </button>
        {showExtended && (
          <div className="mt-1 flex flex-col gap-1">
            {EXTENDED_ITEMS.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                onNavigate={closeDrawer}
              />
            ))}
          </div>
        )}
      </div>
    </nav>
  );

  const brand = (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-200 px-5">
      <span className="h-2.5 w-2.5 rounded-full bg-primary-600" />
      <span className="text-sm font-semibold tracking-tight text-gray-900">Prolora</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Desktop sidebar — 240px, fixed. */}
      <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-gray-200 bg-white lg:flex">
        {brand}
        {nav}
      </aside>

      {/* Mobile drawer. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-gray-900/40"
            onClick={closeDrawer}
            aria-hidden="true"
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 pr-2">
              <div className="flex-1">{brand}</div>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close navigation"
                className="rounded-md p-2 text-gray-500 hover:bg-gray-100"
              >
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
            {nav}
          </aside>
        </div>
      )}

      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b border-gray-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              className="-ml-2 rounded-md p-2 text-gray-600 hover:bg-gray-100 lg:hidden"
            >
              <MenuIcon className="h-5 w-5" />
            </button>
            <Link
              href="/products"
              className="truncate text-sm font-medium text-gray-900 hover:text-primary-700"
              title="Switch product"
            >
              {workspaceName}
            </Link>
          </div>
          <UserMenu email={userEmail} />
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
