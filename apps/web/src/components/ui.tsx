import { ReactNode, useEffect } from 'react';
import { Loader2, AlertCircle, Inbox, CheckCircle2 } from 'lucide-react';
import { initialsOf } from '@/lib/format';
import type { ApplicationStatus, GigStatus } from '@/types';

/* -------------------------------------------------------------------------- */
/* Status badges                                                              */
/* -------------------------------------------------------------------------- */

const GIG_STATUS_STYLES: Record<GigStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  open: 'bg-green-100 text-green-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-ayira-100 text-ayira-700',
  cancelled: 'bg-red-100 text-red-700',
};

const APPLICATION_STATUS_STYLES: Record<ApplicationStatus, string> = {
  pending: 'bg-amber-100 text-amber-800',
  shortlisted: 'bg-blue-100 text-blue-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  withdrawn: 'bg-gray-100 text-gray-600',
};

const STATUS_LABELS: Record<string, string> = {
  in_progress: 'In progress',
};

function labelFor(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

export function GigStatusBadge({ status }: { status: GigStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${GIG_STATUS_STYLES[status]}`}
    >
      {labelFor(status)}
    </span>
  );
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${APPLICATION_STATUS_STYLES[status]}`}
    >
      {labelFor(status)}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-ayira-50 px-2 py-0.5 text-xs font-medium text-ayira-700">
      {children}
    </span>
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
    <div
      role="status"
      className="flex items-center justify-center gap-2 py-12 text-sm text-gray-500"
    >
      <Spinner />
      {label}
    </div>
  );
}

/** Grey placeholder rows shown while a list loads. */
export function SkeletonList({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-gray-200 bg-white p-4">
          <div className="h-4 w-1/3 rounded bg-gray-200" />
          <div className="mt-3 h-3 w-2/3 rounded bg-gray-100" />
          <div className="mt-2 h-3 w-1/2 rounded bg-gray-100" />
        </div>
      ))}
    </div>
  );
}

export function ErrorMessage({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
    >
      <AlertCircle size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="flex-1">
        <p>{message}</p>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="mt-2 font-medium underline underline-offset-2 hover:no-underline"
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
      className="flex items-start gap-3 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800"
    >
      <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden />
      <p>{message}</p>
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white px-6 py-12 text-center">
      <Inbox className="mx-auto text-gray-300" size={36} aria-hidden />
      <h3 className="mt-3 font-medium text-gray-900">{title}</h3>
      {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
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
        className="shrink-0 rounded-full object-cover"
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full bg-ayira-100 font-semibold text-ayira-700"
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

  return (
    <nav className="flex items-center justify-between pt-4" aria-label="Pagination">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
      >
        Previous
      </button>
      <span className="text-sm text-gray-500">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm disabled:opacity-40"
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
