import { Link } from 'react-router-dom';
import {
  Briefcase,
  CheckCircle2,
  FileText,
  Loader,
  ShieldCheck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { Card, ErrorMessage, SkeletonList, usePageTitle } from '@/components/ui';
import { formatCurrency } from '@/lib/format';
import type { AdminDashboardStats } from '@/types';

export default function AdminDashboard() {
  usePageTitle('Admin overview');

  const { data, loading, error, refetch } = useApi<AdminDashboardStats>('/admin/dashboard');

  if (loading) return <SkeletonList rows={4} />;
  if (error) return <ErrorMessage message={error} onRetry={refetch} />;
  if (!data) return null;

  return (
    <div>
      <div className="mb-6">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck size={22} className="text-ayira-600" />
          Platform overview
        </h1>
        <p className="text-sm text-gray-500">
          Every figure here is platform-wide, across all accounts.
        </p>
      </div>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          People
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            icon={<Users size={18} />}
            label="Total accounts"
            value={data.total_users}
            to="/app/admin/users"
          />
          <Stat
            icon={<UserCog size={18} />}
            label="Workers"
            value={data.total_workers}
            to="/app/admin/users?role=worker"
          />
          <Stat
            icon={<Briefcase size={18} />}
            label="Employers"
            value={data.total_employers}
            to="/app/admin/users?role=employer"
          />
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Work
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            icon={<FileText size={18} />}
            label="Total gigs"
            value={data.total_gigs}
            to="/app/admin/gigs"
          />
          <Stat
            icon={<CheckCircle2 size={18} />}
            label="Open"
            value={data.open_gigs}
            to="/app/admin/gigs?status=open"
          />
          <Stat
            icon={<Loader size={18} />}
            label="In progress"
            value={data.in_progress_gigs}
            to="/app/admin/gigs?status=in_progress"
          />
          <Stat
            icon={<FileText size={18} />}
            label="Applications"
            value={data.total_applications}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-500">
          Money
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat
            icon={<Wallet size={18} />}
            label="Held in escrow"
            value={formatCurrency(data.active_escrow_amount)}
            hint="Funded, disputed or part-released"
            gold
          />
          <Stat
            icon={<Wallet size={18} />}
            label="Released to workers"
            value={formatCurrency(data.total_released_amount)}
            gold
          />
          <Stat
            icon={<Wallet size={18} />}
            label="Platform revenue"
            value={formatCurrency(data.total_platform_revenue)}
            // Reported as zero rather than inferred from volume: no commission
            // is charged yet, so any other figure would be invented.
            hint="No commission is charged yet"
          />
        </div>
      </section>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
  to,
  gold = false,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  to?: string;
  gold?: boolean;
}) {
  const body = (
    <Card interactive={Boolean(to)}>
      <div className="mb-2 flex items-center gap-2 text-gray-500">
        <span className={gold ? 'text-gold-600' : 'text-ayira-600'}>{icon}</span>
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p
        className={`text-2xl font-bold tabular-nums ${gold ? 'text-gold-700' : 'text-gray-900'}`}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </Card>
  );

  return to ? (
    <Link to={to} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}
