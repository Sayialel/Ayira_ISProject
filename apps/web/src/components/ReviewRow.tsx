import { Link } from 'react-router-dom';
import { Star } from 'lucide-react';
import { Avatar } from '@/components/ui';
import { formatRelative } from '@/lib/format';
import type { Review } from '@/types';

/**
 * One review, as written by one person about another.
 *
 * Shared by the gig page and the public profile so a review reads the same
 * wherever it is met. The two differ in one thing only: on a gig page the gig
 * is the context already, while on a profile it is the detail that makes the
 * rating mean something -- four stars on a plumbing job says more than four
 * stars alone.
 */
export default function ReviewRow({
  review,
  showGig = false,
}: {
  review: Review;
  showGig?: boolean;
}) {
  const name = review.reviewer?.full_name ?? 'Unknown';

  return (
    <li className="flex gap-3 border-t border-gray-100 pt-3 first:border-0 first:pt-0">
      <Avatar name={name} src={review.reviewer?.avatar_url} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <Link
            to={`/app/users/${review.reviewer_id}`}
            className="truncate text-sm font-medium text-gray-900 hover:text-ayira-700"
          >
            {name}
          </Link>
          <Stars value={review.rating} />
        </div>

        {showGig && review.gig && (
          <Link
            to={`/app/gigs/${review.gig.id}`}
            className="mt-0.5 block truncate text-xs text-gray-500 hover:text-ayira-700"
          >
            on {review.gig.title}
          </Link>
        )}

        {review.comment && (
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-600">{review.comment}</p>
        )}
        <p className="mt-1 text-xs text-gray-400">{formatRelative(review.created_at)}</p>
      </div>
    </li>
  );
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((v) => (
        <Star
          key={v}
          size={14}
          className={v <= value ? 'fill-gold-400 text-gold-500' : 'text-gray-300'}
        />
      ))}
    </span>
  );
}
