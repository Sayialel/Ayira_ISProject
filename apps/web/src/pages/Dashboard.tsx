import { Link } from 'react-router-dom';
import {
  Briefcase,
  CheckCircle2,
  FileText,
  History,
  LayoutList,
  Plus,
  Search,
  Sparkles,
  Star,
  Users,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { Card, ErrorMessage, SkeletonList, usePageTitle } from '@/components/ui';
import { Button, ButtonLink } from '@/components/Button';
import { ShukaWeave } from '@/components/patterns';
import { formatCurrency } from '@/lib/format';
import type { DashboardStats, PendingReview } from '@/types';

/**
 * The first thing anyone sees after signing in.
 *
 * The figures and the actions differ by role, so the page is really two pages
 * sharing a frame. Keeping them in one component is what stops the worker and
 * employer views drifting into different layouts, which is what had happened
 * to the stat cards -- they carried no padding token, no hover state, and a
 * hint on some cards made them taller than their neighbours.
 */
export default function Dashboard() {
  usePageTitle('Dashboard');

  const { user } = useAuth();
  const role = (user?.user_metadata?.role as string) ?? 'worker';
  const fullName = (user?.user_metadata?.full_name as string) ?? '';
  // First name only. "Welcome, Lenina Sayialel" reads like a form letter.
  const name = fullName.trim().split(' ')[0] || 'there';

  const { data, loading, error, refetch } = useApi<DashboardStats>('/workers/dashboard/stats');

  return (
    <div>
      <header className="mb-6">
        <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900">
          Welcome, {name}
        </h1>
        <ShukaWeave className="mt-2.5 w-24 rounded-full" height={5} />
        <p className="mt-2.5 text-sm text-slate-500">
          {role === 'employer'
            ? 'Post work, review applicants and release payments.'
            : role === 'admin'
              ? 'Platform staff account.'
              : 'Find work that fits your skills, and get paid through escrow.'}
        </p>
      </header>

      <PendingReviews />

      {loading && <SkeletonList rows={2} />}
      {!loading && error && <ErrorMessage message={error} onRetry={refetch} />}

      {!loading && !error && data && (
        <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3">
          {data.role === 'worker' ? (
            <>
              <StatCard
                icon={<FileText size={17} />}
                label="Applications"
                value={data.total_applications}
                to="/app/applications"
              />
              <StatCard
                icon={<Briefcase size={17} />}
                label="Active gigs"
                value={data.active_gigs}
                to="/app/applications"
              />
              <StatCard
                icon={<CheckCircle2 size={17} />}
                label="Completed"
                value={data.completed_gigs}
                tone="acacia"
              />
              <StatCard
                icon={<Star size={17} />}
                label="Rating"
                value={data.average_rating.toFixed(2)}
                hint={`${data.total_reviews} ${data.total_reviews === 1 ? 'review' : 'reviews'}`}
              />
              <StatCard
                icon={<Wallet size={17} />}
                label="Earned"
                value={formatCurrency(data.total_earnings)}
                tone="gold"
                to="/app/escrow"
              />
            </>
          ) : (
            <>
              <StatCard
                icon={<LayoutList size={17} />}
                label="Gigs posted"
                value={data.total_gigs}
                to="/app/my-gigs"
              />
              <StatCard
                icon={<Briefcase size={17} />}
                label="Open gigs"
                value={data.open_gigs}
                to="/app/my-gigs"
              />
              <StatCard
                icon={<CheckCircle2 size={17} />}
                label="In progress"
                value={data.active_gigs}
                tone="acacia"
              />
              <StatCard
                icon={<Users size={17} />}
                label="Applicants"
                value={data.total_applicants}
                to="/app/my-gigs"
              />
              <StatCard
                icon={<Wallet size={17} />}
                label="In escrow"
                value={formatCurrency(data.escrow_held)}
                hint={`${formatCurrency(data.total_paid_out)} paid out`}
                tone="gold"
                to="/app/escrow"
              />
            </>
          )}
        </div>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Quick actions
        </h2>
        <div className="flex flex-wrap gap-2">
          {role === 'employer' ? (
            <>
              <ButtonLink to="/app/gigs/create" icon={<Plus size={16} aria-hidden />}>
                Post a gig
              </ButtonLink>
              <ButtonLink
                to="/app/my-gigs"
                variant="secondary"
                icon={<LayoutList size={16} aria-hidden />}
              >
                My gigs
              </ButtonLink>
              <ButtonLink
                to="/app/escrow"
                variant="secondary"
                icon={<Wallet size={16} aria-hidden />}
              >
                Payments
              </ButtonLink>
            </>
          ) : (
            <>
              <ButtonLink to="/app/matches" icon={<Sparkles size={16} aria-hidden />}>
                Find AI matches
              </ButtonLink>
              <ButtonLink
                to="/app/gigs"
                variant="secondary"
                icon={<Search size={16} aria-hidden />}
              >
                Browse gigs
              </ButtonLink>
              <ButtonLink
                to="/app/matches/history"
                variant="secondary"
                icon={<History size={16} aria-hidden />}
              >
                Match history
              </ButtonLink>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const TONES = {
  ayira: { icon: 'text-ayira-600', value: 'text-slate-900' },
  gold: { icon: 'text-gold-600', value: 'text-gold-700' },
  acacia: { icon: 'text-acacia-600', value: 'text-acacia-700' },
} as const;

function StatCard({
  icon,
  label,
  value,
  hint,
  to,
  tone = 'ayira',
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
  tone?: keyof typeof TONES;
}) {
  const t = TONES[tone];

  // h-full to fill the equal-height grid row, and mt-auto on the hint so
  // values line up across cards whether a hint is present or not.
  const body = (
    <Card interactive={Boolean(to)} className="flex h-full flex-col p-4">
      <div className="mb-1.5 flex items-start gap-2 text-slate-500">
        <span className={`shrink-0 ${t.icon}`}>{icon}</span>
        <span className="text-xs font-medium uppercase leading-tight tracking-wide">
          {label}
        </span>
      </div>
      <p className={`font-display text-2xl font-bold tabular-nums break-words ${t.value}`}>
        {value}
      </p>
      {hint && <p className="mt-auto pt-2 text-xs leading-snug text-slate-400">{hint}</p>}
    </Card>
  );

  return to ? (
    <Link to={to} className="block h-full">
      {body}
    </Link>
  ) : (
    body
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
  const { data, refetch } = useApi<{ pending: PendingReview[] }>('/reviews/pending');
  const pending = data?.pending ?? [];

  if (pending.length === 0) return null;

  return (
    <section className="mb-6 overflow-hidden rounded-xl border border-gold-200 bg-gold-50/70">
      <div className="p-4">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-900">
          <Star size={16} className="fill-gold-400 text-gold-500" aria-hidden />
          {pending.length === 1
            ? 'You have a review to leave'
            : `You have ${pending.length} reviews to leave`}
        </h2>
        <p className="mb-3 text-xs text-slate-600">
          Reviews build reputation on both sides, and feed how gigs are ranked.
        </p>

        <ul className="space-y-1.5">
          {pending.slice(0, 4).map((item) => (
            <li key={`${item.gig_id}-${item.reviewee_id}`} className="text-sm">
              <Link
                to={`/app/gigs/${item.gig_id}`}
                className="font-medium text-ayira-700 hover:underline"
              >
                {item.title}
              </Link>
              <span className="text-xs text-slate-500"> — review the {item.role}</span>
            </li>
          ))}
        </ul>

        {pending.length > 4 && (
          <p className="mt-2 text-xs text-slate-500">and {pending.length - 4} more</p>
        )}

        <Button
          variant="ghost"
          size="sm"
          onClick={() => refetch()}
          className="mt-2 -ml-3 text-gold-800 hover:bg-gold-100"
        >
          Refresh
        </Button>
      </div>
    </section>
  );
}
