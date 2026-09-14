import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { toQueryString } from '@/lib/api';
import {
  ApplicationStatusBadge,
  EmptyState,
  ErrorMessage,
  Pagination,
  SkeletonList,
  usePageTitle,
} from '@/components/ui';
import { formatBudgetRange, formatRelative } from '@/lib/format';
import type { ApplicationListResponse, ApplicationStatus } from '@/types';

const STATUS_TABS: { label: string; value: ApplicationStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Pending', value: 'pending' },
  { label: 'Shortlisted', value: 'shortlisted' },
  { label: 'Accepted', value: 'accepted' },
  { label: 'Rejected', value: 'rejected' },
  { label: 'Withdrawn', value: 'withdrawn' },
];

export default function MyApplications() {
  usePageTitle('My applications');

  const [status, setStatus] = useState<ApplicationStatus | ''>('');
  const [page, setPage] = useState(1);

  const path = useMemo(
    () => `/applications${toQueryString({ status: status || undefined, page, limit: 20 })}`,
    [status, page]
  );

  const { data, loading, error, refetch } = useApi<ApplicationListResponse>(path);

  return (
    <div>
      <h1 className="text-2xl font-bold">My applications</h1>
      <p className="mb-4 text-sm text-gray-500">Track the gigs you have applied for.</p>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            aria-current={status === tab.value ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
              status === tab.value
                ? 'border-ayira-600 text-ayira-700'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <SkeletonList rows={3} />}
      {!loading && error && <ErrorMessage message={error} onRetry={refetch} />}

      {!loading && !error && data && data.applications.length === 0 && (
        <EmptyState
          title="No applications yet"
          description="Browse open gigs and apply to the ones that fit your skills."
          action={
            <Link
              to="/app/gigs"
              className="inline-flex items-center gap-1.5 rounded-lg bg-ayira-600 px-4 py-2 text-sm font-medium text-white hover:bg-ayira-700"
            >
              <Search size={16} />
              Browse gigs
            </Link>
          }
        />
      )}

      {!loading && !error && data && data.applications.length > 0 && (
        <>
          <div className="space-y-3">
            {data.applications.map((application) => (
              <Link
                key={application.id}
                to={`/app/gigs/${application.gig_id}`}
                className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-ayira-300 hover:shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold text-gray-900">
                      {application.gig?.title ?? 'Gig unavailable'}
                    </h2>
                    <p className="mt-0.5 text-xs text-gray-500">
                      {application.gig?.employer?.full_name ?? 'Unknown employer'} · applied{' '}
                      {formatRelative(application.created_at)}
                    </p>
                  </div>
                  <ApplicationStatusBadge status={application.status} />
                </div>

                {application.proposed_amount !== null && (
                  <p className="mt-2 text-sm text-gray-600">
                    You asked for{' '}
                    <span className="font-medium text-ayira-700">
                      {formatBudgetRange(
                        application.proposed_amount,
                        application.proposed_amount,
                        application.gig?.currency
                      )}
                    </span>
                  </p>
                )}
              </Link>
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
