import { Link } from 'react-router-dom';
import { Plus, Search, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { ErrorMessage, SkeletonList, usePageTitle } from '@/components/ui';
import { formatCurrency } from '@/lib/format';
import { Star } from 'lucide-react';
import type { DashboardStats, PendingReview } from '@/types';

export default function Dashboard() {
  usePageTitle('Dashboard');

  const { user } = useAuth();
  const role = (user?.user_metadata?.role as string) ?? 'worker';
  const name = (user?.user_metadata?.full_name as string) ?? 'there';

  const { data, loading, error, refetch } = useApi<DashboardStats>('/workers/dashboard/stats');

  return (
    <div>
      <h1 className="text-2xl font-bold">Welcome, {name}</h1>
      <p className="mb-6 text-sm text-gray-500">Your {role} dashboard</p>

      <PendingReviews />

      {loading && <SkeletonList rows={1} />}
      {!loading && error && <ErrorMessage message={error} onRetry={refetch} />}

      {!loading && !error && data && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {data.role === 'worker' ? (
            <>
              <StatCard label="Applications" value={data.total_applications} />
              <StatCard label="Active gigs" value={data.active_gigs} />
              <StatCard label="Completed" value={data.completed_gigs} />
              <StatCard
                label="Rating"
                value={data.average_rating.toFixed(2)}
                hint={`${data.total_reviews} ${data.total_reviews === 1 ? 'review' : 'reviews'}`}
              />
              <StatCard label="Earned" value={formatCurrency(data.total_earnings)} />
            </>
          ) : (
            <>
              <StatCard label="Gigs posted" value={data.total_gigs} />
              <StatCard label="Open gigs" value={data.open_gigs} />
              <StatCard label="In progress" value={data.active_gigs} />
              <StatCard label="Applicants" value={data.total_applicants} />
              <StatCard
                label="In escrow"
                value={formatCurrency(data.escrow_held)}
                hint={`${formatCurrency(data.total_paid_out)} paid out`}
              />
            </>
          )}
        </div>
      )}

      {/* Quick actions */}
      <div className="mt-8">
        <h2 className="mb-3 text-sm font-medium text-gray-700">Quick actions</h2>
        <div className="flex flex-wrap gap-2">
          {role === 'employer' ? (
            <>
              <ActionLink to="/app/gigs/create" icon={<Plus size={16} />} label="Post a gig" primary />
              <ActionLink to="/app/my-gigs" icon={<Search size={16} />} label="My gigs" />
            </>
          ) : (
            <>
              <ActionLink
                to="/app/matches"
                icon={<Sparkles size={16} />}
                label="Find AI matches"
                primary
              />
              <ActionLink to="/app/gigs" icon={<Search size={16} />} label="Browse gigs" />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}

function ActionLink({
  to,
  icon,
  label,
  primary = false,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium ${
        primary
          ? 'bg-ayira-600 text-white hover:bg-ayira-700'
          : 'border border-gray-300 text-gray-700 hover:bg-gray-50'
      }`}
    >
      {icon}
      {label}
    </Link>
  );
}

/**
 * Nudges the viewer to review people they have finished working with.
 *
 * Without this the review feature is effectively invisible: nobody reopens a
 * gig they finished last week to check whether they left a review, so
 * reputations would stay empty and the match ranking would keep falling back
 * to a neutral prior for every employer.
 *
 * Renders nothing when there is nothing owed, so it costs no space in the
 * common case.
 */
function PendingReviews() {
  const { data } = useApi<{ pending: PendingReview[] }>('/reviews/pending');
  const pending = data?.pending ?? [];

  if (pending.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-gold-200 bg-gold-50/60 p-4">
      <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-gray-800">
        <Star size={16} className="fill-gold-400 text-gold-500" />
        {pending.length === 1
          ? 'You have a review to leave'
          : `You have ${pending.length} reviews to leave`}
      </h2>
      <p className="mb-3 text-xs text-gray-600">
        Reviews build reputation on both sides, and feed how gigs are ranked.
      </p>
      <ul className="space-y-1.5">
        {pending.slice(0, 4).map((item) => (
          <li key={`${item.gig_id}-${item.reviewee_id}`}>
            <Link
              to={`/app/gigs/${item.gig_id}`}
              className="text-sm font-medium text-ayira-700 hover:underline"
            >
              {item.title}
            </Link>
            <span className="text-xs text-gray-500"> — review the {item.role}</span>
          </li>
        ))}
      </ul>
      {pending.length > 4 && (
        <p className="mt-2 text-xs text-gray-500">and {pending.length - 4} more</p>
      )}
    </section>
  );
}
