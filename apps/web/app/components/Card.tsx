import type { ReactNode } from 'react';

export interface CardProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Rendered on the right of the header — usually a Button. */
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Drop the body padding when the card holds a full-bleed table. */
  flush?: boolean;
}

export function Card({
  title,
  description,
  actions,
  children,
  className = '',
  flush = false,
}: CardProps) {
  const hasHeader = Boolean(title || description || actions);
  return (
    <section
      className={`overflow-hidden rounded-lg border border-gray-200 bg-white ${className}`}
    >
      {hasHeader && (
        <header className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-gray-900">{title}</h2>}
            {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children && <div className={flush ? '' : 'px-5 py-4'}>{children}</div>}
    </section>
  );
}

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
}

// The metric tile used across Listen, Board and Analytics.
export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  );
}
