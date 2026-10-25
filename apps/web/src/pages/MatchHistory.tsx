import { Link } from 'react-router-dom';
import { History, Info } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { toQueryString } from '@/lib/api';
import {
  Card,
  EmptyState,
  ErrorMessage,
  SkeletonList,
  GigStatusBadge,
  usePageTitle,
} from '@/components/ui';
import { formatCurrency, formatRelative } from '@/lib/format';
import type { MatchHistoryResponse } from '@/types';

/**
 * Every gig the matcher has ever recommended to this worker, with the score
 * breakdown it produced at the time.
 *
 * The engine has been writing ai_match_logs since matching was built, and
 * until now nothing read them. That mattered more than an unused endpoint
 * usually does: these rows are the only record of what the system actually
 * recommended in use, as opposed to how it scores a benchmark offline. Without
 * a way to read them there was no route to an online evaluation at all.
 *
 * What this page does not claim: an online evaluation. That needs outcomes --
 * whether the worker opened the recommendation, applied, was accepted, and
 * finished the gig -- and those are not collected yet. A score with no outcome
 * beside it shows what was recommended and why, which is a starting point and
 * not a measurement.
 */
export default function MatchHistory() {
  usePageTitle('Match history');

  const { data, loading, error, refetch } = useApi<MatchHistoryResponse>(
    `/match/history${toQueryString({ limit: 50 })}`
  );

  if (loading) return <SkeletonList rows={5} />;
  if (error) return <ErrorMessage message={error} onRetry={refetch} />;

  const logs = data?.logs ?? [];

  return (
    <div>
      <header className="mb-6">
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-slate-900">
          <History size={22} className="text-ayira-600" aria-hidden />
          Match history
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          What Ayira has recommended to you, and the score behind each one.
        </p>
      </header>

      {logs.length === 0 ? (
        <EmptyState
          title="No matches recorded yet"
          description="Run AI Matches and the results will be kept here, so you can see how a score was reached."
          action={
            <Link
              to="/app/matches"
              className="inline-flex items-center rounded-lg bg-ayira-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ayira-700"
            >
              Find matches
            </Link>
          }
        />
      ) : (
        <>
          <p className="mb-4 flex items-start gap-2 rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs leading-relaxed text-indigo-900">
            <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Each bar is one of the four signals the matcher combines. Skills
              match carries most of the weight; nearness and the employer's
              rating adjust it slightly. The percentage is the combined score.
            </span>
          </p>

          <ul className="space-y-3">
            {logs.map((log) => (
              <li key={log.id}>
                <LogRow log={log} />
              </li>
            ))}
          </ul>

          {data && data.total > logs.length && (
            <p className="mt-4 text-center text-sm text-slate-400">
              Showing the {logs.length} most recent of {data.total}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function LogRow({ log }: { log: MatchHistoryResponse['logs'][number] }) {
  const gig = log.gig;
  const pct = Math.round(Number(log.composite_score ?? 0) * 100);

  const body = (
    <Card interactive={Boolean(gig)} className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold text-slate-900">
            {gig?.title ?? 'This gig has been removed'}
          </h2>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {gig?.category && <span>{gig.category}</span>}
            {gig?.status && <GigStatusBadge status={gig.status} />}
            <span>matched {formatRelative(log.created_at)}</span>
          </div>

          {gig?.budget_min != null && (
            <p className="mt-1.5 text-sm font-semibold text-gold-700">
              {formatCurrency(gig.budget_min, gig.currency ?? 'KES')}
              {gig.budget_max != null && gig.budget_max !== gig.budget_min && (
                <> – {formatCurrency(gig.budget_max, gig.currency ?? 'KES')}</>
              )}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="font-display text-2xl font-bold tabular-nums text-ayira-700">
            {pct}%
          </p>
          <p className="text-xs text-slate-400">fit</p>
        </div>
      </div>

      <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-2">
        <Signal label="Skills match" value={log.semantic_score} />
        <Signal label="Keyword overlap" value={log.tfidf_score} />
        <Signal label="Nearness" value={log.location_affinity} hint={nearnessHint(log.location_affinity)} />
      </div>
    </Card>
  );

  // A log row outlives the gig it points at, because ai_match_logs is kept for
  // analysis. Linking a removed gig would send the worker to a 404.
  return gig ? (
    <Link to={`/app/gigs/${gig.id}`} className="block">
      {body}
    </Link>
  ) : (
    body
  );
}

/**
 * Names the location tier rather than showing a bare number.
 *
 * The engine returns an affinity, not a distance: 1.0 same town or remote,
 * 0.6 same county, 0.45 same commuter region, 0.3 unknown, 0 different county.
 * "0.45" means nothing to a worker; "same commuter region" does.
 */
function nearnessHint(value: number | null): string | undefined {
  if (value === null) return undefined;
  const v = Number(value);
  if (v >= 1) return 'Same town, or remote';
  if (v >= 0.6) return 'Same county';
  if (v >= 0.45) return 'Same commuter region';
  if (v >= 0.3) return 'Location not given';
  return 'Different county';
}

function Signal({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | null;
  hint?: string;
}) {
  // Null is distinct from zero: the column was added to ai_match_logs in
  // migration 020, so rows written before it have no value to show.
  if (value === null || value === undefined) {
    return (
      <div className="text-xs text-slate-400">
        {label} — not recorded
      </div>
    );
  }

  const pct = Math.round(Number(value) * 100);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="text-slate-600">{label}</span>
        <span className="font-semibold tabular-nums text-slate-500">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-gradient-to-r from-ayira-500 to-gold-500 transition-[width] duration-500"
          style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
        />
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}
