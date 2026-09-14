import { useParams } from 'react-router-dom';
import { BadgeCheck, MapPin, Star, CheckCircle2 } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import {
  Avatar,
  ErrorMessage,
  LoadingBlock,
  Tag,
  usePageTitle,
} from '@/components/ui';
import { formatDate } from '@/lib/format';
import type { PublicProfileData } from '@/types';

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
      <header className="rounded-lg border border-gray-200 bg-white p-5">
        <div className="flex items-start gap-4">
          <Avatar name={data.full_name} src={data.avatar_url} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="flex items-center gap-1.5 text-xl font-bold">
              {data.full_name}
              {data.is_verified && (
                <BadgeCheck size={18} className="text-ayira-600" aria-label="Verified" />
              )}
            </h1>
            <p className="text-sm capitalize text-gray-500">{data.role}</p>
            {data.location && (
              <p className="mt-1 flex items-center gap-1 text-sm text-gray-600">
                <MapPin size={14} />
                {data.location}
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400">
              Member since {formatDate(data.created_at)}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 border-t border-gray-100 pt-4 text-center">
          <div>
            <dt className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <Star size={13} />
              Rating
            </dt>
            <dd className="mt-1 text-lg font-semibold">
              {Number(data.reputation_score ?? 0).toFixed(2)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-gray-500">Reviews</dt>
            <dd className="mt-1 text-lg font-semibold">{data.total_reviews}</dd>
          </div>
          <div>
            <dt className="flex items-center justify-center gap-1 text-xs text-gray-500">
              <CheckCircle2 size={13} />
              Completed
            </dt>
            <dd className="mt-1 text-lg font-semibold">{data.completed_gigs}</dd>
          </div>
        </dl>
      </header>

      {data.bio && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-medium text-gray-700">About</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{data.bio}</p>
        </section>
      )}

      {data.skills.length > 0 && (
        <section className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="mb-2 text-sm font-medium text-gray-700">Skills</h2>
          <div className="flex flex-wrap gap-1.5">
            {data.skills.map((skill) => (
              <Tag key={skill}>{skill}</Tag>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
