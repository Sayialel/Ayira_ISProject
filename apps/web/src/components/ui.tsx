import { ReactNode, useEffect } from 'react';
import { Loader2, AlertCircle, Inbox, CheckCircle2 } from 'lucide-react';
import { initialsOf } from '@/lib/format';
import type { ApplicationStatus, EscrowStatus, GigStatus } from '@/types';

/* -------------------------------------------------------------------------- */
/* Status badges                                                              */
/* -------------------------------------------------------------------------- */

const BADGE =
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset';

const GIG_STATUS_STYLES: Record<GigStatus, string> = {
  draft: 'bg-slate-100 text-slate-600 ring-slate-200',
  open: 'bg-green-50 text-green-700 ring-green-200',
  in_progress: 'bg-ayira-50 text-ayira-700 ring-ayira-200',
  completed: 'bg-slate-100 text-slate-700 ring-slate-200',
  cancelled: 'bg-red-50 text-red-700 ring-red-200',
};

const APPLICATION_STATUS_STYLES: Record<ApplicationStatus, string> = {
  pending: 'bg-amber-50 text-amber-700 ring-amber-200',
  shortlisted: 'bg-ayira-50 text-ayira-700 ring-ayira-200',
  accepted: 'bg-green-50 text-green-700 ring-green-200',
  rejected: 'bg-red-50 text-red-700 ring-red-200',
  withdrawn: 'bg-slate-100 text-slate-600 ring-slate-200',
};

// Money states get their own scale, anchored on gold, so a payment state is
// never mistaken for a gig state at a glance.
const ESCROW_STATUS_STYLES: Record<EscrowStatus, string> = {
  pending: 'bg-gold-50 text-gold-700 ring-gold-100',
  funded: 'bg-ayira-50 text-ayira-700 ring-ayira-200',
  released: 'bg-green-50 text-green-700 ring-green-200',
  disputed: 'bg-red-50 text-red-700 ring-red-200',
  refunded: 'bg-slate-100 text-slate-700 ring-slate-200',
  partial_release: 'bg-gold-50 text-gold-700 ring-gold-100',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
  partial_release: 'Partly released',
  pending: 'Awaiting payment',
};

function labelFor(status: string, override?: Record<string, string>): string {
  return (
    override?.[status] ??
    STATUS_LABELS[status] ??
    status.charAt(0).toUpperCase() + status.slice(1)
  );
}

export function GigStatusBadge({ status }: { status: GigStatus }) {
  return (
    <span className={`${BADGE} ${GIG_STATUS_STYLES[status]}`}>
      {labelFor(status, { pending: 'Pending' })}
    </span>
  );
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span className={`${BADGE} ${APPLICATION_STATUS_STYLES[status]}`}>
      {labelFor(status, { pending: 'Pending' })}
    </span>
  );
}

export function EscrowStatusBadge({ status }: { status: EscrowStatus }) {
  return <span className={`${BADGE} ${ESCROW_STATUS_STYLES[status]}`}>{labelFor(status)}</span>;
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Surfaces                                                                   */
/* -------------------------------------------------------------------------- */

export function Card({
  children,
  className = '',
  interactive = false,
}: {
  children: ReactNode;
  className?: string;
  interactive?: boolean;
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white shadow-card ${
        interactive
          ? 'transition-all duration-150 hover:-translate-y-0.5 hover:border-ayira-300 hover:shadow-lift active:translate-y-0'
          : ''
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Feedback states                                                            */
/* -------------------------------------------------------------------------- */

export function Spinner({ className = '' }: { className?: string }) {
  return <Loader2 className={`animate-spin ${className}`} size={18} aria-hidden />;
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2.5 py-16 text-sm text-slate-500">
      <Spinner />
      {label}
    </div>
  );
}

export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl border border-slate-200 bg-white p-5 shadow-card">
          <div className="skeleton h-4 w-1/3 rounded" />
          <div className="skeleton mt-3 h-3 w-2/3 rounded" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded" />
          <div className="mt-4 flex gap-2">
            <div className="skeleton h-6 w-16 rounded-md" />
            <div className="skeleton h-6 w-20 rounded-md" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">
        <p className="font-medium">{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 font-semibold underline underline-offset-2 hover:no-underline"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function SuccessMessage({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800"
    >
      <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
      <p className="font-medium">{message}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-400">
        {icon ?? <Inbox size={22} aria-hidden />}
      </div>
      <h3 className="font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Misc                                                                       */
/* -------------------------------------------------------------------------- */

export function Avatar({
  name,
  src,
  size = 40,
}: {
  name: string;
  src?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        className="shrink-0 rounded-full object-cover ring-1 ring-slate-200"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-ayira-100 to-ayira-200 font-bold text-ayira-800 ring-1 ring-ayira-200"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initialsOf(name) || '?'}
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  if (totalPages <= 1) return null;

  const btn =
    'rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 shadow-card transition-colors hover:bg-slate-50 disabled:opacity-40 disabled:pointer-events-none';

  return (
    <nav className="flex items-center justify-between pt-6" aria-label="Pagination">
      <button type="button" onClick={() => onChange(page - 1)} disabled={page <= 1} className={btn}>
        Previous
      </button>
      <span className="text-sm text-slate-500">
        Page <span className="font-semibold text-slate-700">{page}</span> of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className={btn}
      >
        Next
      </button>
    </nav>
  );
}

/** Sets the browser tab title for the current page. */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · Ayira`;
  }, [title]);
}

/* -------------------------------------------------------------------------- */
/* Form primitives                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The canonical input surface.
 *
 * Four pages had each written their own version of this string, and they had
 * drifted: different border colours, different focus rings, one with no focus
 * treatment at all. Exporting it means a field looks the same wherever it
 * appears, and changing the focus ring is one edit rather than five.
 */
export const inputClass =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 ' +
  'placeholder:text-slate-400 transition-colors ' +
  'focus:border-ayira-400 focus:outline-none focus:ring-2 focus:ring-ayira-100 ' +
  'disabled:bg-slate-50 disabled:text-slate-500';

/**
 * A labelled form row.
 *
 * Pairs the label to the control by id, which several of the hand-rolled
 * versions did not, and keeps hint and error text in one place below it so
 * the spacing cannot differ between forms.
 */
export function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-0.5 text-ayira-600" aria-hidden>
            *
          </span>
        )}
      </label>
      {children}
      {/* Error replaces the hint rather than stacking under it: showing both
          makes the reader work out which one applies. */}
      {error ? (
        <p role="alert" className="mt-1.5 text-xs font-medium text-red-700">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1.5 text-xs text-slate-400">{hint}</p>
      )}
    </div>
  );
}

/**
 * A page header: title, optional blurb, optional actions on the right.
 *
 * Every page had built this by hand, which is why the heading sizes and the
 * gap beneath them varied from page to page.
 */
export function PageHeader({
  icon,
  title,
  blurb,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  blurb?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold tracking-tight text-slate-900">
          {icon && <span className="text-ayira-600">{icon}</span>}
          {title}
        </h1>
        {blurb && <p className="mt-1 text-sm text-slate-500">{blurb}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
