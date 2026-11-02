import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, MapPin, Wifi, History, AlertTriangle, ArrowRight } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import {
  EmptyState,
  ErrorMessage,
  Spinner,
  Tag,
  usePageTitle,
} from '@/components/ui';
import { formatBudgetRange, formatRelative, toPercent } from '@/lib/format';
import type { GigMatch, MatchBreakdown, MatchResponse, MatchSufficiency } from '@/types';

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

export default function AIMatches() {
  usePageTitle('AI matches');

  const [matches, setMatches] = useState<GigMatch[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [sufficiency, setSufficiency] = useState<MatchSufficiency | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function findMatches() {
    setLoading(true);
    setError(null);
    try {
      const result = await apiFetch<MatchResponse>('/match', {
        method: 'POST',
        body: JSON.stringify({ limit: 10 }),
      });
      setMatches(result.matches);
      setGeneratedAt(result.generated_at);
      setSufficiency(result.sufficiency ?? null);
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
          {matches ? 'Refresh matches' : 'Find matches'}
        </button>
        {generatedAt && !loading && (
          <span className="text-xs text-slate-500">
            Updated {formatRelative(generatedAt)}
          </span>
        )}
      </div>

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

      {!loading && !error && matches !== null && matches.length === 0 && (
        <EmptyState
          title="No gigs to match against"
          description="There are no open gigs right now, or none could be scored against your profile."
        />
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
            <span className="shrink-0 rounded-full bg-ayira-50 px-2.5 py-1 text-sm font-semibold text-ayira-700">
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

          <ScoreBreakdown breakdown={breakdown} />
        </div>
      </div>
    </Link>
  );
}

function ScoreBreakdown({ breakdown }: { breakdown: MatchBreakdown }) {
  return (
    <div className="mt-3 border-t border-slate-100 pt-3">
      <h3 className="mb-2 text-xs font-medium text-slate-500">Why this ranked here</h3>
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
