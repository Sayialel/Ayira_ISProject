import { Link } from 'react-router-dom';
import { Plus, Search, Sparkles } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { ErrorMessage, SkeletonList, usePageTitle } from '@/components/ui';
import { formatCurrency } from '@/lib/format';
import type { DashboardStats } from '@/types';

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
