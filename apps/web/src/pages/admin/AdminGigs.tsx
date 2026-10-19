import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MapPin, Search, ShieldCheck } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useDebounced } from '@/hooks/useDebounced';
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
import type { AdminGigListResponse, GigStatus } from '@/types';

const STATUS_TABS: { label: string; value: GigStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Open', value: 'open' },
  { label: 'In progress', value: 'in_progress' },
  { label: 'Completed', value: 'completed' },
  { label: 'Drafts', value: 'draft' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function AdminGigs() {
  usePageTitle('Admin · gigs');

  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as GigStatus | null) ?? 'all';

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const debouncedSearch = useDebounced(search, 300);

  const path = useMemo(
    () =>
      `/admin/gigs${toQueryString({
        page,
        limit: 20,
        status: status === 'all' ? undefined : status,
        search: debouncedSearch.trim() || undefined,
      })}`,
    [page, status, debouncedSearch]
  );

  const { data, loading, error, refetch } = useApi<AdminGigListResponse>(path);

  function selectStatus(value: GigStatus | 'all') {
    setPage(1);
    if (value === 'all') params.delete('status');
    else params.set('status', value);
    setParams(params, { replace: true });
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck size={22} className="text-ayira-600" />
          Gigs
        </h1>
        <p className="text-sm text-gray-500">
          Every gig on the platform, including drafts and cancelled ones that the
          public feed never shows.
        </p>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => selectStatus(tab.value)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              status === tab.value
                ? 'border-ayira-600 text-ayira-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <label className="relative mb-4 block">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search titles and descriptions"
          className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-ayira-400 focus:outline-none focus:ring-2 focus:ring-ayira-100"
        />
      </label>

      {loading && <SkeletonList rows={5} />}
      {error && <ErrorMessage message={error} onRetry={refetch} />}

      {data && data.gigs.length === 0 && (
        <EmptyState
          title="No gigs match"
          description="Try a different status or clear the search."
        />
      )}

      {data && data.gigs.length > 0 && (
        <>
          <ul className="space-y-3">
            {data.gigs.map((gig) => (
              <li
                key={gig.id}
                className="rounded-xl border border-gray-200 bg-white p-4 transition-colors hover:border-ayira-200"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      to={`/app/gigs/${gig.id}`}
                      className="block truncate font-semibold text-gray-900 hover:text-ayira-700"
                    >
                      {gig.title}
                    </Link>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {gig.employer ? (
                        <>
                          Posted by{' '}
                          <Link
                            to={`/app/users/${gig.employer.id}`}
                            className="hover:text-ayira-700"
                          >
                            {gig.employer.full_name}
                          </Link>
                        </>
                      ) : (
                        // employer_id is NOT NULL, so this only shows if the
                        // account was removed after the gig was posted.
                        'Employer account no longer available'
                      )}
                      {' · '}
                      {formatRelative(gig.created_at)}
                    </p>
                  </div>
                  <GigStatusBadge status={gig.status} />
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
                  <span className="font-medium text-gold-700">
                    {formatBudgetRange(gig.budget_min, gig.budget_max, gig.currency)}
                  </span>
                  <span className="flex items-center gap-1">
                    <MapPin size={12} />
                    {gig.is_remote ? 'Remote' : (gig.location ?? 'Not specified')}
                  </span>
                  <span>{gig.category}</span>
                </div>
              </li>
            ))}
          </ul>

          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
