import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Ban,
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

/**
 * Platform-wide figures for an administrator.
 *
 * Two things were wrong here and both were about the numbers rather than the
 * layout. The people section showed 49 workers and 26 employers against a
 * total of 76, leaving one account unexplained -- the administrator's own.
 * The work section showed 105 gigs against 102 open and 0 in progress,
 * leaving three unexplained. A figure that does not reconcile on screen
 * invites the reader to distrust the ones that do, so every section now adds
 * up and says so.
 *
 * The cards are also a fixed height per row. A `hint` on some cards and not
 * others made them different heights, which is what the misalignment was.
 */
export default function AdminDashboard() {
  usePageTitle('Admin overview');

  const { data, loading, error, refetch } = useApi<AdminDashboardStats>('/admin/dashboard');

  if (loading) return <SkeletonList rows={4} />;
  if (error) return <ErrorMessage message={error} onRetry={refetch} />;
  if (!data) return null;

  const peopleAddUp =
    data.total_workers + data.total_employers + data.total_admins === data.total_users;

  const gigsAccounted =
    data.open_gigs + data.in_progress_gigs + data.completed_gigs + data.cancelled_gigs;
  const drafts = data.total_gigs - gigsAccounted;

  return (
    <div>
      <header className="mb-7">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-slate-900">
          <ShieldCheck size={22} className="text-ayira-600" aria-hidden />
          Platform overview
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Every figure here is platform-wide, across all accounts.
        </p>
      </header>

      {/* The only thing on this page that is work rather than information. */}
      {data.disputed_escrow_count > 0 && (
        <Link
          to="/app/admin/escrow?status=disputed"
          className="group mb-7 flex items-center gap-3 rounded-xl border border-gold-300 bg-gold-50 px-4 py-3.5 transition-colors hover:bg-gold-100"
        >
          <AlertTriangle size={20} className="shrink-0 text-gold-700" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">
              {data.disputed_escrow_count} dispute
              {data.disputed_escrow_count === 1 ? '' : 's'} waiting on you
            </p>
            <p className="text-xs text-slate-600">
              Each one holds money that only an administrator can release.
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-gold-800 group-hover:underline">
            Settle →
          </span>
        </Link>
      )}

      <Section
        title="People"
        note={
          peopleAddUp
            ? `${data.total_workers} workers + ${data.total_employers} employers + ${data.total_admins} staff = ${data.total_users}`
            : undefined
        }
      >
        <Stat
          icon={<Users size={18} />}
          label="All accounts"
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
        <Stat
          icon={<ShieldCheck size={18} />}
          label="Staff"
          value={data.total_admins}
          to="/app/admin/users?role=admin"
        />
      </Section>

      <Section
        title="Work"
        note={
          drafts > 0
            ? `${data.total_gigs} posted in total, of which ${drafts} ${
                drafts === 1 ? 'is' : 'are'
              } still a draft`
            : `${data.total_gigs} posted in total`
        }
      >
        <Stat
          icon={<FileText size={18} />}
          label="All gigs"
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
          icon={<CheckCircle2 size={18} />}
          label="Completed"
          value={data.completed_gigs}
          to="/app/admin/gigs?status=completed"
          tone="acacia"
        />
        <Stat
          icon={<Ban size={18} />}
          label="Cancelled"
          value={data.cancelled_gigs}
          to="/app/admin/gigs?status=cancelled"
        />
        <Stat
          icon={<FileText size={18} />}
          label="Applications"
          value={data.total_applications}
        />
      </Section>

      <Section title="Money" note="Escrow is held in KES and settled through M-Pesa.">
        <Stat
          icon={<Wallet size={18} />}
          label="Held in escrow"
          value={formatCurrency(data.active_escrow_amount)}
          // Was "Funded, disputed or part-released" — wrong since a split
          // escrow has already paid out and is no longer held.
          hint="Funded or disputed"
          tone="gold"
        />
        <Stat
          icon={<Wallet size={18} />}
          label="Paid to workers"
          value={formatCurrency(data.total_released_amount)}
          hint="Full releases and splits"
          tone="gold"
        />
        <Stat
          icon={<Wallet size={18} />}
          label="Platform revenue"
          value={formatCurrency(data.total_platform_revenue)}
          // Reported as zero rather than inferred from volume: no commission
          // is charged yet, so any other figure would be invented.
          hint="No commission is charged yet"
        />
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * A titled group of cards.
 *
 * `auto-rows-fr` is what fixes the alignment: every card in a row takes the
 * height of the tallest, so a card with a hint no longer sits taller than its
 * neighbours.
 */
function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {title}
        </h2>
        {note && <p className="text-xs tabular-nums text-slate-400">{note}</p>}
      </div>

      <div className="grid auto-rows-fr gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {children}
      </div>
    </section>
  );
}

const TONES = {
  ayira: { icon: 'text-ayira-600', value: 'text-slate-900' },
  gold: { icon: 'text-gold-600', value: 'text-gold-700' },
  acacia: { icon: 'text-acacia-600', value: 'text-acacia-700' },
} as const;

function Stat({
  icon,
  label,
  value,
  hint,
  to,
  tone = 'ayira',
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  hint?: string;
  to?: string;
  tone?: keyof typeof TONES;
}) {
  const t = TONES[tone];

  const body = (
    // h-full so the card fills the equal-height grid row rather than hugging
    // its own content. flex-col with mt-auto keeps the hint pinned to the
    // bottom, so values line up across cards whether a hint is present or not.
    // p-4 because Card carries no padding of its own, and this grid never
    // passed any -- which is most of why the cards looked cramped.
    <Card interactive={Boolean(to)} className="flex h-full flex-col p-4">
      <div className="mb-2 flex items-start gap-2 text-slate-500">
        <span className={`shrink-0 ${t.icon}`}>{icon}</span>
        <span className="text-xs font-medium uppercase leading-tight tracking-wide">
          {label}
        </span>
      </div>

      {/* break-words rather than truncate: a six-figure currency value should
          wrap rather than be silently cut to something wrong. */}
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
