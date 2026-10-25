import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { toQueryString } from '@/lib/api';
import {
  EmptyState,
  ErrorMessage,
  GigStatusBadge,
  Pagination,
  SkeletonList,
  usePageTitle,
} from '@/components/ui';
import { formatBudgetRange, formatRelative } from '@/lib/format';
import type { GigListResponse, GigStatus } from '@/types';

const STATUS_TABS: { label: string; value: GigStatus }[] = [
  { label: 'Open', value: 'open' },
  { label: 'Drafts', value: 'draft' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function MyGigs() {
  usePageTitle('My gigs');

  const [status, setStatus] = useState<GigStatus>('open');
  const [page, setPage] = useState(1);

  const path = useMemo(
    () => `/gigs${toQueryString({ employer_id: 'me', status, page, limit: 20 })}`,
    [status, page]
  );

  const { data, loading, error, refetch } = useApi<GigListResponse>(path);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">My gigs</h1>
          <p className="text-sm text-slate-500">Manage the gigs you have posted.</p>
        </div>
        <Link
          to="/app/gigs/create"
          className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
        >
          <Plus size={16} />
          Post gig
        </Link>
      </div>

      {/* Status tabs */}
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            aria-current={status === tab.value ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
              status === tab.value
                ? 'border-ayira-600 text-ayira-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <SkeletonList rows={3} />}
      {!loading && error && <ErrorMessage message={error} onRetry={refetch} />}

      {!loading && !error && data && data.gigs.length === 0 && (
        <EmptyState
          title={`No ${STATUS_TABS.find((t) => t.value === status)?.label.toLowerCase()} gigs`}
          description="Gigs you post will appear here."
          action={
            <Link
              to="/app/gigs/create"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
            >
              <Plus size={16} />
              Post your first gig
            </Link>
          }
        />
      )}

      {!loading && !error && data && data.gigs.length > 0 && (
        <>
          <div className="space-y-3">
            {data.gigs.map((gig) => (
              <Link
                key={gig.id}
                to={`/app/gigs/${gig.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-ayira-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-slate-900">{gig.title}</h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {gig.category} · posted {formatRelative(gig.created_at)}
                    </p>
                  </div>
                  <GigStatusBadge status={gig.status} />
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-x-4 text-sm text-slate-600">
                  <span className="font-medium text-ayira-700">
                    {formatBudgetRange(gig.budget_min, gig.budget_max, gig.currency)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {gig.is_remote ? 'Remote' : (gig.location ?? 'Location not set')}
                  </span>
                  {gig.application_count !== undefined && (
                    <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                      <Users size={14} />
                      {gig.application_count}{' '}
                      {gig.application_count === 1 ? 'application' : 'applications'}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
