import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { BadgeCheck, MapPin, Star, CheckCircle2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { toQueryString } from '@/lib/api';
import ReviewRow from '@/components/ReviewRow';
import {
  Avatar,
  ErrorMessage,
  LoadingBlock,
  Spinner,
  Tag,
  usePageTitle,
} from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { PublicProfileData, ReviewListResponse } from '@/types';

export default function PublicProfile() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refetch } = useApi<PublicProfileData>(
    id ? `/workers/profile/${id}` : null
  );

  usePageTitle(data?.full_name ?? 'Profile');

  if (loading) return <LoadingBlock label="Loading profile…" />;
  if (error) return <ErrorMessage message={error} onRetry={refetch} />;
  if (!data) return <ErrorMessage message="Profile not found." />;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-start gap-4">
          <Avatar name={data.full_name} src={data.avatar_url} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-xl font-bold">
              {data.full_name}
              {data.is_verified && (
                <BadgeCheck size={18} className="text-ayira-600" aria-label="Verified" />
              )}
            </h1>
            <p className="text-sm capitalize text-slate-500">{data.role}</p>
            {data.location && (
              <p className="mt-1 flex items-center gap-1 text-sm text-slate-600">
                <MapPin size={14} />
                {data.location}
              </p>
            )}
            <p className="mt-1 text-xs text-slate-400">
              Member since {formatDate(data.created_at)}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-slate-100 pt-4 text-center">
          <div>
            <dt className="flex items-center justify-center gap-1 text-xs text-slate-500">
              <Star size={13} />
              Rating
            </dt>
            <dd className="mt-1 text-lg font-semibold">
              {Number(data.reputation_score ?? 0).toFixed(2)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Reviews</dt>
            <dd className="mt-1 text-lg font-semibold">{data.total_reviews}</dd>
          </div>
          <div>
            <dt className="flex items-center justify-center gap-1 text-xs text-slate-500">
              <CheckCircle2 size={13} />
              Completed
            </dt>
            <dd className="mt-1 text-lg font-semibold">{data.completed_gigs}</dd>
          </div>
        </dl>
      </header>

      {data.bio && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-medium text-slate-700">About</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{data.bio}</p>
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-medium text-slate-700">Skills</h2>
          <div className="flex flex-wrap gap-1.5">
            {data.skills.map((skill) => (
              <Tag key={skill}>{skill}</Tag>
            ))}
          </div>
        </section>
      )}

      {id && <ProfileReviews userId={id} total={data.total_reviews} />}
    </div>
  );
}

/** How many reviews to show before asking whether they want the rest. */
const FIRST_PAGE = 5;

/**
 * What people have actually said about this person.
 *
 * The header above shows a score and a count, which is the aggregate the match
 * ranking consumes. On its own it is not much use to someone deciding whether
 * to hire or to take a job: 4.2 over nine reviews does not say whether the
 * complaint was about timekeeping or about the work. The reviews themselves
 * were being written -- several hundred of them -- and read by nobody outside
 * the gig they were left on.
 */
function ProfileReviews({ userId, total }: { userId: string; total: number }) {
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? 50 : FIRST_PAGE;

  const { data, loading, error, refetch } = useApi<ReviewListResponse>(
    `/reviews${toQueryString({ user_id: userId, limit })}`
  );

  const reviews = data?.reviews ?? [];

  // Nothing at all: say so rather than rendering an empty panel, but only once
  // the count agrees. A profile with reviews that failed to load is a
  // different situation from one with none.
  if (!loading && !error && reviews.length === 0) {
    return (
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-medium text-slate-700">Reviews</h2>
        <p className="text-sm text-slate-500">
          No reviews yet. They appear here once a gig is completed and paid for.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-slate-700">
        Reviews{total > 0 && <span className="ml-1 text-slate-400">({total})</span>}
      </h2>

      {loading && <Spinner />}
      {error && <ErrorMessage message={error} onRetry={refetch} />}

      <ul className="space-y-3">
        {reviews.map((review) => (
          // showGig, because on a profile the gig is what gives the rating
          // its meaning.
          <ReviewRow key={review.id} review={review} showGig />
        ))}
      </ul>

      {!expanded && total > reviews.length && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-3 text-sm font-medium text-ayira-700 hover:underline"
        >
          Show all {total} reviews
        </button>
      )}
    </section>
  );
}
