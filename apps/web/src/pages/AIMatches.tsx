import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles,
  MapPin,
  Wifi,
  History,
  AlertTriangle,
  ArrowRight,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import {
  EmptyState,
  ErrorMessage,
  Spinner,
  Tag,
  usePageTitle,
} from '@/components/ui';
import { formatBudgetRange, formatRelative, toPercent } from '@/lib/format';
import type {
  GigMatch,
  MatchBreakdown,
  MatchResponse,
  MatchSufficiency,
  SkillCategory,
} from '@/types';

/** The weights the AI engine applies in composite_score(). */
// Must match DEFAULT_WEIGHTS in apps/ai-engine/app/services/scoring.py. These
// had drifted badly -- they still showed the weights the project first shipped
// (0.45/0.25/0.15/0.15), long after the engine had moved on, so the panel was
// explaining the ranking with numbers the ranking no longer used.
const WEIGHTS: { key: keyof MatchBreakdown; label: string; weight: number }[] = [
  { key: 'semantic', label: 'Skills & description fit', weight: 0.72 },
  { key: 'tfidf', label: 'Keyword overlap', weight: 0.22 },
  { key: 'location', label: 'Location', weight: 0.03 },
  { key: 'employer_reputation', label: 'Employer reputation', weight: 0.03 },
];

/** What the panel holds. Strings, because they come from inputs. */
interface MatchFilterState {
  category?: string;
  location?: string;
  remote_only?: boolean;
  min_budget?: string;
  max_budget?: string;
}

/**
 * Turns the panel state into the request body, dropping anything blank.
 *
 * An untouched panel must produce `{}` so the request is byte-identical to
 * the unfiltered one -- otherwise every worker silently gets the wider
 * `limit` and a different code path.
 */
function sentFilters(state: MatchFilterState) {
  const out: Record<string, string | number | boolean> = {};
  if (state.category) out.category = state.category;
  if (state.location?.trim()) out.location = state.location.trim();
  if (state.remote_only) out.remote_only = true;
  const min = Number(state.min_budget);
  const max = Number(state.max_budget);
  if (state.min_budget && Number.isFinite(min) && min >= 0) out.min_budget = min;
  if (state.max_budget && Number.isFinite(max) && max > 0) out.max_budget = max;
  return out;
}

export default function AIMatches() {
  usePageTitle('AI matches');
  const { data: categories } = useApi<SkillCategory[]>('/gigs/meta/categories');

  const [matches, setMatches] = useState<GigMatch[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [sufficiency, setSufficiency] = useState<MatchSufficiency | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineReady, setEngineReady] = useState<boolean | null>(null);
  const [filters, setFilters] = useState<MatchFilterState>({});
  const [filteredOut, setFilteredOut] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  /**
   * Start the engine waking as soon as the page opens.
   *
   * It sleeps after about fifteen idle minutes and takes a minute or two to
   * come back. Doing this on arrival rather than on the button press means
   * the waiting happens while someone is reading the page, and by the time
   * they press it the engine is usually up. It also lets the button say so
   * instead of failing.
   *
   * Polls until ready, because the first probe is what starts the wake-up and
   * will almost always report false.
   */
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    async function probe() {
      if (cancelled || attempts > 20) return;      // ~2 minutes, then give up quietly
      attempts += 1;
      try {
        const { ready } = await apiFetch<{ ready: boolean }>('/match/ready');
        if (cancelled) return;
        setEngineReady(ready);
        if (!ready) setTimeout(probe, 6_000);
      } catch {
        // Never surface this: it is a convenience, and the match itself
        // reports properly if something is actually wrong.
        if (!cancelled) setTimeout(probe, 6_000);
      }
    }

    probe();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeCount = Object.keys(sentFilters(filters)).length;

  async function findMatches() {
    setLoading(true);
    setError(null);
    try {
      // A wider limit when filtering, because narrowing happens after the
      // engine has ranked: asking for ten and then hiding eight leaves two.
      // See matchRequestSchema in the gateway for why the filter is not
      // pushed into retrieval instead.
      const active = Object.keys(sentFilters(filters)).length > 0;
      const result = await apiFetch<MatchResponse>('/match', {
        method: 'POST',
        body: JSON.stringify({
          limit: active ? 40 : 10,
          ...(active ? { filters: sentFilters(filters) } : {}),
        }),
      });
      setMatches(result.matches);
      setGeneratedAt(result.generated_at);
      setSufficiency(result.sufficiency ?? null);
      setFilteredOut(result.filtered_out ?? 0);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-slate-900">
            <Sparkles size={22} className="text-ayira-600" aria-hidden />
            AI matches
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Open gigs ranked against your skills, bio, location and reputation.
          </p>
        </div>

        {/* Secondary view of this same feature, so it belongs here rather than
            as a seventh item in a six-item bottom bar. */}
        <Link
          to="/app/matches/history"
          className="shrink-0 inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-card transition-all duration-150 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
        >
          <History size={15} aria-hidden />
          History
        </Link>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={findMatches}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
        >
          {loading ? <Spinner /> : <Sparkles size={16} />}
          {loading
            ? 'Scoring…'
            : engineReady === false
              ? 'Starting the matcher…'
              : matches
                ? 'Refresh matches'
                : 'Find matches'}
        </button>
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            activeCount > 0
              ? 'border-ayira-600 bg-ayira-50 text-ayira-700'
              : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
          }`}
        >
          <SlidersHorizontal size={15} aria-hidden />
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-ayira-600 px-1.5 text-[11px] font-bold text-white">
              {activeCount}
            </span>
          )}
        </button>
        {generatedAt && !loading && (
          <span className="text-xs text-slate-500">
            Updated {formatRelative(generatedAt)}
          </span>
        )}
      </div>

      {showFilters && (
        <div className="mb-5 rounded-xl border border-slate-200 bg-white p-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Category</span>
              <select
                value={filters.category ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, category: e.target.value || undefined }))
                }
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
              >
                <option value="">Any</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">Town or county</span>
              <input
                type="text"
                value={filters.location ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, location: e.target.value || undefined }))
                }
                placeholder="e.g. Nairobi"
                disabled={filters.remote_only}
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500 disabled:bg-slate-50 disabled:text-slate-400"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Pays at least (KES)
              </span>
              <input
                type="number"
                min={0}
                step={1}
                value={filters.min_budget ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, min_budget: e.target.value || undefined }))
                }
                placeholder="Any"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-600">
                Pays at most (KES)
              </span>
              <input
                type="number"
                min={1}
                step={1}
                value={filters.max_budget ?? ''}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, max_budget: e.target.value || undefined }))
                }
                placeholder="Any"
                className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
              />
            </label>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={filters.remote_only ?? false}
                onChange={(e) =>
                  setFilters((f) => ({
                    ...f,
                    remote_only: e.target.checked || undefined,
                    // A town is meaningless once remote-only is on, and
                    // leaving a stale one set would filter on it invisibly.
                    location: e.target.checked ? undefined : f.location,
                  }))
                }
                className="h-4 w-4 rounded border-slate-300 text-ayira-600 focus:ring-ayira-500"
              />
              Remote work only
            </label>

            <div className="flex gap-2">
              {activeCount > 0 && (
                <button
                  type="button"
                  onClick={() => setFilters({})}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-50"
                >
                  <X size={14} aria-hidden />
                  Clear
                </button>
              )}
              <button
                type="button"
                onClick={findMatches}
                disabled={loading}
                className="rounded-lg bg-ayira-600 px-4 py-1.5 text-sm font-semibold text-white transition-colors hover:bg-ayira-700 disabled:opacity-50"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-12 text-center">
          <Spinner className="mx-auto text-ayira-600" />
          <p className="mt-3 font-medium text-slate-900">Scoring open gigs…</p>
          <p className="mt-1 text-sm text-slate-500">
            The first run can take up to a minute while the matching model loads.
          </p>
        </div>
      )}

      {!loading && error && <ErrorMessage message={error} onRetry={findMatches} />}

      {!loading && !error && sufficiency && sufficiency.level !== 'ok' && (
        <SufficiencyNotice sufficiency={sufficiency} />
      )}

      {!loading && !error && matches === null && (
        <EmptyState
          title="No matches yet"
          description="Run a match to see which open gigs fit your profile best. Add skills and a bio to your profile first for better results."
          action={
            <Link
              to="/app/profile"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-card transition-all duration-150 hover:border-slate-400 hover:bg-slate-50 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
            >
              Update profile
            </Link>
          }
        />
      )}

      {/* The two reasons a list is empty need different advice, and
          conflating them would send someone to fix their profile when the
          real problem is a 50,000 shilling floor on a 15,000 shilling gig. */}
      {!loading && !error && matches !== null && matches.length === 0 && filteredOut > 0 && (
        <EmptyState
          title="Your filters hid every match"
          description={`The matcher ranked ${filteredOut} ${
            filteredOut === 1 ? 'gig' : 'gigs'
          } for you, but none of them met your filters. Try widening them.`}
          action={
            <button
              type="button"
              onClick={() => {
                setFilters({});
                setShowFilters(true);
              }}
              className="rounded-lg bg-ayira-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-ayira-700"
            >
              Clear filters
            </button>
          }
        />
      )}

      {!loading && !error && matches !== null && matches.length === 0 && filteredOut === 0 && (
        <EmptyState
          title="No gigs to match against"
          description="There are no open gigs right now, or none could be scored against your profile."
        />
      )}

      {/* Shown alongside results too: a worker who gets three matches should
          know the matcher found more and the filters removed them. */}
      {!loading && !error && matches !== null && matches.length > 0 && filteredOut > 0 && (
        <p className="mb-3 text-xs text-slate-500">
          {filteredOut} further {filteredOut === 1 ? 'match was' : 'matches were'} hidden by your
          filters.
        </p>
      )}

      {!loading && matches && matches.length > 0 && (
        <ol className="space-y-3">
          {matches.map((match, index) => (
            <li key={match.gig.id}>
              <MatchCard match={match} rank={index + 1} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function MatchCard({ match, rank }: { match: GigMatch; rank: number }) {
  const { gig, breakdown } = match;

  return (
    <Link
      to={`/app/gigs/${gig.id}`}
      className="block rounded-lg border border-slate-200 bg-white p-4 transition hover:border-ayira-300 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-slate-900">{gig.title}</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                {gig.category}
                {gig.employer ? ` · ${gig.employer.full_name}` : ''}
              </p>
            </div>
            <span
              className="shrink-0 rounded-full bg-ayira-50 px-2.5 py-1 text-sm font-semibold text-ayira-700"
              title={
                match.calibrated
                  ? `Of past gigs scored like this one, about ${match.score_percent}% were judged a good fit.`
                  : 'A raw match score. This engine has no calibration fitted.'
              }
            >
              {match.score_percent}% match
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            <span className="font-medium text-ayira-700">
              {formatBudgetRange(gig.budget_min, gig.budget_max, gig.currency)}
            </span>
            <span className="flex items-center gap-1">
              {gig.is_remote ? <Wifi size={13} /> : <MapPin size={13} />}
              {gig.is_remote ? 'Remote' : (gig.location ?? 'Location not set')}
            </span>
          </div>

          {gig.required_skills.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {gig.required_skills.slice(0, 5).map((skill) => (
                <Tag key={skill}>{skill}</Tag>
              ))}
            </div>
          )}

          <ScoreBreakdown breakdown={breakdown} raw={match.score_raw} />
        </div>
      </div>
    </Link>
  );
}

function ScoreBreakdown({ breakdown, raw }: { breakdown: MatchBreakdown; raw?: number }) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <h3 className="mb-2 text-xs font-medium text-slate-500">
        Why this ranked here
        {raw !== undefined && (
          <span className="ml-1 font-normal text-slate-400">
            (combined score {raw.toFixed(2)})
          </span>
        )}
      </h3>
      <dl className="space-y-1.5">
        {WEIGHTS.map(({ key, label, weight }) => {
          const raw = breakdown[key];

          // location is an affinity from 0 to 1, employer reputation is 0–5.
          let value: number;
          if (key === 'employer_reputation')
            value = Math.min(Number(raw ?? 0) / 5, 1);
          else value = Math.max(0, Math.min(Number(raw ?? 0), 1));

          return (
            <div key={key} className="flex items-center gap-2">
              <dt className="w-40 shrink-0 truncate text-xs text-slate-500">{label}</dt>
              <dd className="flex flex-1 items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100"
                  role="img"
                  aria-label={`${label}: ${toPercent(value)} percent`}
                >
                  <div
                    className="h-full rounded-full bg-ayira-500"
                    style={{ width: `${toPercent(value)}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-slate-400">
                  {toPercent(value)}%
                  <span className="ml-0.5 text-slate-300">×{weight}</span>
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

/**
 * Says when the ranking had little to work with.
 *
 * `insufficient` is arithmetic rather than a judgement: with no skills and no
 * bio, both text signals return exactly zero for every candidate, so the order
 * is carried entirely by the 6% of weight on location and employer rating. The
 * list is still shown -- a location-ordered list is usable while someone fills
 * their profile in -- but it is no longer presented as a skills match.
 */
function SufficiencyNotice({ sufficiency }: { sufficiency: MatchSufficiency }) {
  const severe = sufficiency.level === 'insufficient';
  // Degraded is not the worker's doing -- their profile is fine, the
  // ranking simply ran without its strongest signal -- so it is phrased
  // as a temporary state rather than something to go and fix.
  const degraded = sufficiency.level === 'degraded';

  return (
    <div
      role="status"
      className={`mb-5 flex items-start gap-3 rounded-xl border p-4 ${
        severe
          ? 'border-ayira-200 bg-ayira-50'
          : 'border-gold-200 bg-gold-50'
      }`}
    >
      <AlertTriangle
        size={18}
        aria-hidden
        className={`mt-0.5 shrink-0 ${severe ? 'text-ayira-700' : 'text-gold-700'}`}
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900">
          {severe
            ? 'These are not skill matches yet'
            : degraded
              ? 'Showing keyword matches for now'
              : 'These matches could be better'}
        </p>
        <p className="mt-0.5 text-sm text-slate-600">{sufficiency.reason}</p>
        {severe && (
          <p className="mt-1.5 text-xs text-slate-500">
            With nothing written in your profile, the ranking can only use your
            town and the employer&rsquo;s rating — about 6% of the score.
          </p>
        )}
        {!degraded && (
          <Link
            to="/app/profile"
            className="mt-2.5 inline-flex items-center gap-1.5 text-sm font-semibold text-ayira-700 hover:underline"
          >
            Update your profile
            <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
