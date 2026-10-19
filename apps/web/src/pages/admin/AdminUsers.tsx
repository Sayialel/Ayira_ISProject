import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BadgeCheck, Search, ShieldCheck } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { useDebounced } from '@/hooks/useDebounced';
import { apiFetch, toQueryString } from '@/lib/api';
import { useToast } from '@/components/Toast';
import {
  Avatar,
  EmptyState,
  ErrorMessage,
  Pagination,
  SkeletonList,
  usePageTitle,
} from '@/components/ui';
import { formatRelative } from '@/lib/format';
import type { AdminUserListResponse, UserRole } from '@/types';

const ROLE_TABS: { label: string; value: UserRole | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Workers', value: 'worker' },
  { label: 'Employers', value: 'employer' },
  { label: 'Admins', value: 'admin' },
];

export default function AdminUsers() {
  usePageTitle('Admin · accounts');

  // The role filter comes from the URL so the dashboard tiles can link
  // straight to a filtered view, and so a view can be shared.
  const [params, setParams] = useSearchParams();
  const role = (params.get('role') as UserRole | null) ?? 'all';

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<string | null>(null);
  const debouncedSearch = useDebounced(search, 300);
  const toast = useToast();

  const path = useMemo(
    () =>
      `/admin/users${toQueryString({
        page,
        limit: 20,
        role: role === 'all' ? undefined : role,
        search: debouncedSearch.trim() || undefined,
      })}`,
    [page, role, debouncedSearch]
  );

  const { data, loading, error, refetch } = useApi<AdminUserListResponse>(path);

  function selectRole(value: UserRole | 'all') {
    setPage(1);
    if (value === 'all') params.delete('role');
    else params.set('role', value);
    setParams(params, { replace: true });
  }

  async function toggleVerified(id: string, next: boolean) {
    setPending(id);
    try {
      await apiFetch(`/admin/users/${id}/verify`, {
        method: 'PATCH',
        body: JSON.stringify({ is_verified: next }),
      });
      toast.success(next ? 'Account verified' : 'Verification removed');
      refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck size={22} className="text-ayira-600" />
          Accounts
        </h1>
        <p className="text-sm text-gray-500">
          Every account on the platform. Verifying marks an account as checked; it
          grants no extra permissions.
        </p>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
        {ROLE_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => selectRole(tab.value)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              role === tab.value
                ? 'border-ayira-600 text-ayira-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <label className="relative mb-4 block">
        <Search
          size={16}
          className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
        />
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name or email"
          className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:border-ayira-400 focus:outline-none focus:ring-2 focus:ring-ayira-100"
        />
      </label>

      {loading && <SkeletonList rows={5} />}
      {error && <ErrorMessage message={error} onRetry={refetch} />}

      {data && data.users.length === 0 && (
        <EmptyState
          title="No accounts match"
          description="Try a different role or clear the search."
        />
      )}

      {data && data.users.length > 0 && (
        <>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            {/* A table on wide screens; the same rows stack on a phone. */}
            <div className="hidden grid-cols-[2fr_1fr_1fr_1fr_auto] gap-3 border-b border-gray-100 bg-gray-50 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500 md:grid">
              <span>Account</span>
              <span>Role</span>
              <span>Location</span>
              <span>Joined</span>
              <span className="text-right">Verified</span>
            </div>

            <ul className="divide-y divide-gray-100">
              {data.users.map((account) => (
                <li
                  key={account.id}
                  className="grid gap-2 px-4 py-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-center md:gap-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={account.full_name} src={account.avatar_url} size={36} />
                    <div className="min-w-0">
                      <Link
                        to={`/app/users/${account.id}`}
                        className="block truncate font-medium text-gray-900 hover:text-ayira-700"
                      >
                        {account.full_name}
                      </Link>
                      <p className="truncate text-xs text-gray-500">{account.email}</p>
                    </div>
                  </div>

                  <span className="text-sm capitalize text-gray-600">{account.role}</span>
                  <span className="truncate text-sm text-gray-600">
                    {account.location ?? '—'}
                  </span>
                  <span className="text-sm text-gray-500">
                    {formatRelative(account.created_at)}
                  </span>

                  <div className="md:text-right">
                    <button
                      type="button"
                      disabled={pending === account.id}
                      onClick={() => toggleVerified(account.id, !account.is_verified)}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        account.is_verified
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <BadgeCheck size={14} />
                      {account.is_verified ? 'Verified' : 'Verify'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}
