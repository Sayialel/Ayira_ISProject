import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Sparkles, MapPin, Wifi } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import {
  EmptyState,
  ErrorMessage,
  Spinner,
  Tag,
  usePageTitle,
} from '@/components/ui';
import { formatBudgetRange, formatRelative, toPercent } from '@/lib/format';
import type { GigMatch, MatchBreakdown, MatchResponse } from '@/types';

/** The weights the AI engine applies in composite_score(). */
const WEIGHTS: { key: keyof MatchBreakdown; label: string; weight: number }[] = [
  { key: 'semantic', label: 'Skills & description fit', weight: 0.45 },
  { key: 'tfidf', label: 'Keyword overlap', weight: 0.25 },
  { key: 'location', label: 'Location', weight: 0.15 },
  { key: 'reputation', label: 'Reputation', weight: 0.15 },
];

export default function AIMatches() {
  usePageTitle('AI matches');

  const [matches, setMatches] = useState<GigMatch[] | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Sparkles size={22} className="text-ayira-600" />
          AI matches
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Open gigs ranked against your skills, bio, location and reputation.
        </p>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={findMatches}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-60"
        >
          {loading ? <Spinner /> : <Sparkles size={16} />}
          {matches ? 'Refresh matches' : 'Find matches'}
        </button>
        {generatedAt && !loading && (
          <span className="text-xs text-gray-500">
            Updated {formatRelative(generatedAt)}
          </span>
        )}
      </div>

      {loading && (
        <div className="rounded-lg border border-gray-200 bg-white px-6 py-12 text-center">
          <Spinner className="mx-auto text-ayira-600" />
          <p className="mt-3 font-medium text-gray-900">Scoring open gigs…</p>
          <p className="mt-1 text-sm text-gray-500">
            The first run can take up to a minute while the matching model loads.
          </p>
        </div>
      )}

      {!loading && error && <ErrorMessage message={error} onRetry={findMatches} />}

      {!loading && !error && matches === null && (
        <EmptyState
          title="No matches yet"
          description="Run a match to see which open gigs fit your profile best. Add skills and a bio to your profile first for better results."
          action={
            <Link
              to="/app/profile"
              className="inline-flex items-center rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
      className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-ayira-300 hover:shadow-sm"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
          {rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="truncate font-semibold text-gray-900">{gig.title}</h2>
              <p className="mt-0.5 text-xs text-gray-500">
                {gig.category}
                {gig.employer ? ` · ${gig.employer.full_name}` : ''}
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-ayira-50 px-2.5 py-1 text-sm font-semibold text-ayira-700">
              {match.score_percent}% match
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
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
    <div className="mt-3 border-t border-gray-100 pt-3">
      <h3 className="mb-2 text-xs font-medium text-gray-500">Why this ranked here</h3>
      <dl className="space-y-1.5">
        {WEIGHTS.map(({ key, label, weight }) => {
          const raw = breakdown[key];

          // location arrives as a boolean; reputation is on a 0–5 scale.
          let value: number;
          if (key === 'location') value = raw ? 1 : 0;
          else if (key === 'reputation') value = Math.min(Number(raw ?? 0) / 5, 1);
          else value = Math.max(0, Math.min(Number(raw ?? 0), 1));

          return (
            <div key={key} className="flex items-center gap-2">
              <dt className="w-40 shrink-0 truncate text-xs text-gray-500">{label}</dt>
              <dd className="flex flex-1 items-center gap-2">
                <div
                  className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100"
                  role="img"
                  aria-label={`${label}: ${toPercent(value)} percent`}
                >
                  <div
                    className="h-full rounded-full bg-ayira-500"
                    style={{ width: `${toPercent(value)}%` }}
                  />
                </div>
                <span className="w-14 shrink-0 text-right text-xs tabular-nums text-gray-400">
                  {toPercent(value)}%
                  <span className="ml-0.5 text-gray-300">×{weight}</span>
                </span>
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
