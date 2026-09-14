import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, SlidersHorizontal, Sparkles } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { toQueryString } from '@/lib/api';
import { useDebounced } from '@/hooks/useDebounced';
import GigCard from '@/components/GigCard';
import {
  EmptyState,
  ErrorMessage,
  Pagination,
  SkeletonList,
  usePageTitle,
} from '@/components/ui';
import type { GigListResponse, SkillCategory } from '@/types';

export default function GigFeed() {
  usePageTitle('Browse gigs');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('');
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  // Typing should not fire a request per keystroke.
  const debouncedSearch = useDebounced(search, 350);
  const debouncedLocation = useDebounced(location, 350);

  const { data: categories } = useApi<SkillCategory[]>('/gigs/meta/categories');

  const path = useMemo(
    () =>
      `/gigs${toQueryString({
        status: 'open',
        search: debouncedSearch,
        category,
        location: debouncedLocation,
        is_remote: remoteOnly ? 'true' : undefined,
        page,
        limit: 20,
      })}`,
    [debouncedSearch, category, debouncedLocation, remoteOnly, page]
  );

  const { data, loading, error, refetch } = useApi<GigListResponse>(path);

  // Any filter change invalidates the current page number.
  const resetPage = () => setPage(1);

  const hasFilters = Boolean(search || category || location || remoteOnly);

  return (
    <div>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Browse gigs</h1>
          <p className="text-sm text-gray-500">Find work that matches your skills.</p>
        </div>
        <Link
          to="/app/matches"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-ayira-600 px-3 py-2 text-sm font-medium text-white hover:bg-ayira-700"
        >
          <Sparkles size={16} />
          AI Match
        </Link>
      </div>

      {/* Search + filters */}
      <div className="mb-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="Search gigs by title or description"
              aria-label="Search gigs"
              className="w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            <SlidersHorizontal size={16} />
            <span className="hidden sm:inline">Filters</span>
          </button>
        </div>

        {showFilters && (
          <div className="grid gap-3 rounded-lg border border-gray-200 bg-white p-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Category</span>
              <select
                value={category}
                onChange={(e) => {
                  setCategory(e.target.value);
                  resetPage();
                }}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ayira-500 focus:outline-none"
              >
                <option value="">All categories</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="text-sm">
              <span className="mb-1 block text-gray-600">Location</span>
              <input
                type="text"
                value={location}
                onChange={(e) => {
                  setLocation(e.target.value);
                  resetPage();
                }}
                placeholder="e.g. Nairobi"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-ayira-500 focus:outline-none"
              />
            </label>

            <label className="flex items-end gap-2 text-sm">
              <input
                type="checkbox"
                checked={remoteOnly}
                onChange={(e) => {
                  setRemoteOnly(e.target.checked);
                  resetPage();
                }}
                className="mb-2.5 h-4 w-4 rounded border-gray-300 text-ayira-600 focus:ring-ayira-500"
              />
              <span className="mb-2 text-gray-700">Remote only</span>
            </label>
          </div>
        )}
      </div>

      {/* Results */}
      {loading && <SkeletonList rows={4} />}

      {!loading && error && <ErrorMessage message={error} onRetry={refetch} />}

      {!loading && !error && data && data.gigs.length === 0 && (
        <EmptyState
          title="No gigs found"
          description={
            hasFilters
              ? 'Try removing a filter or searching for something broader.'
              : 'There are no open gigs right now. Check back soon.'
          }
        />
      )}

      {!loading && !error && data && data.gigs.length > 0 && (
        <>
          <p className="mb-3 text-sm text-gray-500">
            {data.total} {data.total === 1 ? 'gig' : 'gigs'} found
          </p>
          <div className="space-y-3">
            {data.gigs.map((gig) => (
              <GigCard key={gig.id} gig={gig} />
            ))}
          </div>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
