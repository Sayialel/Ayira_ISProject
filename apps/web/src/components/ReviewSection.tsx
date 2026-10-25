import { useState } from 'react';
import { Star } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { apiFetch, toQueryString } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Spinner } from '@/components/ui';
import ReviewRow, { Stars } from '@/components/ReviewRow';
import type { GigDetail, ReviewListResponse, PendingReview } from '@/types';

/**
 * Reviews on a completed gig: what has been said, and the form to say it.
 *
 * Shown only once a gig is complete, which is what the database requires
 * before either side may review the other.
 */
export default function ReviewSection({
  gig,
  isOwner,
}: {
  gig: GigDetail;
  isOwner: boolean;
}) {
  const reviews = useApi<ReviewListResponse>(
    `/reviews${toQueryString({ gig_id: gig.id, user_id: undefined, limit: 20 })}`
  );
  // Whether *this* viewer still owes a review on this gig, which only the
  // server can answer: it depends on an accepted application and on what has
  // already been written.
  const pending = useApi<{ pending: PendingReview[] }>('/reviews/pending');

  const owed = (pending.data?.pending ?? []).find((p) => p.gig_id === gig.id);

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="mb-3 text-sm font-medium text-gray-700">Reviews</h2>

      {owed && (
        <ReviewForm
          gigId={gig.id}
          revieweeId={owed.reviewee_id}
          revieweeRole={owed.role}
          onDone={() => {
            reviews.refetch();
            pending.refetch();
          }}
        />
      )}

      {reviews.loading && <Spinner />}

      {!reviews.loading && (reviews.data?.reviews.length ?? 0) === 0 && !owed && (
        <p className="text-sm text-gray-500">
          No reviews on this gig yet.
          {!isOwner && ' Once the employer reviews you, it will appear here.'}
        </p>
      )}

      <ul className="space-y-3">
        {(reviews.data?.reviews ?? []).map((review) => (
          <ReviewRow key={review.id} review={review} />
        ))}
      </ul>
    </section>
  );
}

function ReviewForm({
  gigId,
  revieweeId,
  revieweeRole,
  onDone,
}: {
  gigId: string;
  revieweeId: string;
  revieweeRole: string;
  onDone: () => void;
}) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit() {
    if (rating < 1) {
      toast.error('Choose a rating from 1 to 5 stars.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch('/reviews', {
        method: 'POST',
        body: JSON.stringify({
          gig_id: gigId,
          reviewee_id: revieweeId,
          rating,
          comment: comment.trim() || undefined,
        }),
      });
      toast.success('Review posted');
      setRating(0);
      setComment('');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post the review');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 rounded-lg border border-ayira-200 bg-ayira-50/50 p-4">
      <p className="mb-2 text-sm font-medium text-gray-800">
        Review the {revieweeRole} you worked with
      </p>
      <p className="mb-3 text-xs text-gray-500">
        Ratings build the reputation shown across the platform, and feed the
        match ranking. You can only review once.
      </p>

      <div className="mb-3 flex items-center gap-1">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setRating(value)}
            aria-label={`${value} star${value === 1 ? '' : 's'}`}
            className="rounded p-0.5 transition-transform hover:scale-110"
          >
            <Star
              size={22}
              className={
                value <= rating ? 'fill-gold-400 text-gold-500' : 'text-gray-300'
              }
            />
          </button>
        ))}
        {rating > 0 && (
          <span className="ml-2 text-sm text-gray-500">{rating} of 5</span>
        )}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="What was it like working together? (optional)"
        className="mb-3 w-full rounded-lg border border-gray-200 p-2.5 text-sm focus:border-ayira-400 focus:outline-none focus:ring-2 focus:ring-ayira-100"
      />

      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-lg bg-ayira-600 px-4 py-2 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-60"
      >
        {busy && <Spinner />}
        Post review
      </button>
    </div>
  );
}

export { Stars };
