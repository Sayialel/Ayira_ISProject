import { Link } from 'react-router-dom';
import { MapPin, Wifi, CalendarClock } from 'lucide-react';
import { Avatar, Tag } from './ui';
import { formatBudgetRange, formatRelative, isPastDeadline } from '@/lib/format';
import type { Gig } from '@/types';

export default function GigCard({ gig, footer }: { gig: Gig; footer?: React.ReactNode }) {
  const overdue = isPastDeadline(gig.deadline);

  return (
    <Link
      to={`/app/gigs/${gig.id}`}
      className="block rounded-lg border border-gray-200 bg-white p-4 transition hover:border-ayira-300 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-semibold text-gray-900">{gig.title}</h3>
          <p className="mt-0.5 text-xs text-gray-500">{gig.category}</p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-ayira-700">
          {formatBudgetRange(gig.budget_min, gig.budget_max, gig.currency)}
        </span>
      </div>

      <p className="mt-2 line-clamp-2 text-sm text-gray-600">{gig.description}</p>

      {gig.required_skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {gig.required_skills.slice(0, 5).map((skill) => (
            <Tag key={skill}>{skill}</Tag>
          ))}
          {gig.required_skills.length > 5 && (
            <span className="text-xs text-gray-400">
              +{gig.required_skills.length - 5} more
            </span>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-gray-500">
        {gig.employer && (
          <span className="flex items-center gap-1.5">
            <Avatar name={gig.employer.full_name} src={gig.employer.avatar_url} size={20} />
            {gig.employer.full_name}
          </span>
        )}
        <span className="flex items-center gap-1">
          {gig.is_remote ? <Wifi size={14} /> : <MapPin size={14} />}
          {gig.is_remote ? 'Remote' : (gig.location ?? 'Location not set')}
        </span>
        {gig.deadline && (
          <span className={`flex items-center gap-1 ${overdue ? 'text-red-600' : ''}`}>
            <CalendarClock size={14} />
            {overdue ? 'Deadline passed' : `Due ${formatRelative(gig.deadline)}`}
          </span>
        )}
      </div>

      {footer && <div className="mt-3 border-t border-gray-100 pt-3">{footer}</div>}
    </Link>
  );
}
