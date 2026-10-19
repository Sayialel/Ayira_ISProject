import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { useApi } from '@/hooks/useApi';
import { apiFetch, toQueryString } from '@/lib/api';
import { useToast } from '@/components/Toast';
import {
  Avatar,
  EmptyState,
  ErrorMessage,
  EscrowStatusBadge,
  Pagination,
  SkeletonList,
  Spinner,
  usePageTitle,
} from '@/components/ui';
import { formatCurrency, formatRelative } from '@/lib/format';
import type {
  AdminEscrow as AdminEscrowRow,
  AdminEscrowDetail,
  AdminEscrowListResponse,
  EscrowStatus,
} from '@/types';

const TABS: { label: string; value: EscrowStatus | 'all' }[] = [
  { label: 'Disputes', value: 'disputed' },
  { label: 'All', value: 'all' },
  { label: 'Awaiting payment', value: 'pending' },
  { label: 'Funded', value: 'funded' },
  { label: 'Released', value: 'released' },
  { label: 'Refunded', value: 'refunded' },
  { label: 'Cancelled', value: 'cancelled' },
];

export default function AdminEscrow() {
  usePageTitle('Admin · payments');

  // Defaults to disputes, because that is the only state on this page that
  // nobody else can clear: a disputed escrow holds money and only an admin
  // can decide where it goes.
  const [params, setParams] = useSearchParams();
  const status: EscrowStatus | 'all' =
    (params.get('status') as EscrowStatus | 'all' | null) ?? 'disputed';

  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  const path = useMemo(
    () =>
      `/admin/escrow${toQueryString({
        page,
        limit: 20,
        status: status === 'all' ? undefined : status,
      })}`,
    [page, status]
  );

  const { data, loading, error, refetch } = useApi<AdminEscrowListResponse>(path);

  function selectStatus(value: EscrowStatus | 'all') {
    setPage(1);
    setOpenId(null);
    if (value === 'all') params.delete('status');
    else params.set('status', value);
    setParams(params, { replace: true });
  }

  return (
    <div>
      <div className="mb-4">
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <ShieldCheck size={22} className="text-ayira-600" />
          Payments
        </h1>
        <p className="text-sm text-gray-500">
          Every escrow transaction. Disputes can only be settled here.
        </p>
      </div>

      {(data?.disputed_count ?? 0) > 0 && status !== 'disputed' && (
        <button
          type="button"
          onClick={() => selectStatus('disputed')}
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-left text-sm text-amber-900 hover:bg-amber-100"
        >
          <AlertTriangle size={16} className="shrink-0" />
          <span className="flex-1">
            {data?.disputed_count} dispute{data?.disputed_count === 1 ? '' : 's'} waiting
            on a decision. The money stays frozen until you settle it.
          </span>
          <ArrowRight size={16} />
        </button>
      )}

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-gray-200 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => selectStatus(tab.value)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              status === tab.value
                ? 'border-ayira-600 text-ayira-700'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {tab.label}
            {tab.value === 'disputed' && (data?.disputed_count ?? 0) > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 py-0.5 text-xs font-semibold text-white">
                {data?.disputed_count}
              </span>
            )}
          </button>
        ))}
      </div>

      {loading && <SkeletonList rows={4} />}
      {error && <ErrorMessage message={error} onRetry={refetch} />}

      {data && data.escrow.length === 0 && (
        <EmptyState
          title={status === 'disputed' ? 'No disputes' : 'Nothing here'}
          description={
            status === 'disputed'
              ? 'Nothing is waiting on a decision.'
              : 'No transactions with this status.'
          }
        />
      )}

      {data && data.escrow.length > 0 && (
        <>
          <ul className="space-y-3">
            {data.escrow.map((row) => (
              <EscrowCard
                key={row.id}
                row={row}
                expanded={openId === row.id}
                onToggle={() => setOpenId(openId === row.id ? null : row.id)}
                onResolved={() => {
                  setOpenId(null);
                  refetch();
                }}
              />
            ))}
          </ul>
          <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
        </>
      )}
    </div>
  );
}

function EscrowCard({
  row,
  expanded,
  onToggle,
  onResolved,
}: {
  row: AdminEscrowRow;
  expanded: boolean;
  onToggle: () => void;
  onResolved: () => void;
}) {
  const isDisputed = row.status === 'disputed';

  return (
    <li
      className={`rounded-xl border bg-white p-4 ${
        isDisputed ? 'border-amber-300 ring-1 ring-amber-100' : 'border-gray-200'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {row.gig ? (
            <Link
              to={`/app/gigs/${row.gig.id}`}
              className="block truncate font-semibold text-gray-900 hover:text-ayira-700"
            >
              {row.gig.title}
            </Link>
          ) : (
            <p className="truncate font-semibold text-gray-500">Gig no longer available</p>
          )}
          <p className="mt-0.5 text-xs text-gray-500">
            Opened {formatRelative(row.created_at)}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-semibold tabular-nums text-gold-700">
            {formatCurrency(row.amount, row.currency)}
          </p>
          <EscrowStatusBadge status={row.status} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-600">
        <Party label="Employer" person={row.employer} />
        <Party label="Worker" person={row.worker} />
        {row.mpesa_receipt && (
          <span className="text-gray-400">M-Pesa {row.mpesa_receipt}</span>
        )}
      </div>

      <button
        type="button"
        onClick={onToggle}
        className="mt-3 text-xs font-medium text-ayira-700 hover:underline"
      >
        {expanded ? 'Hide history' : isDisputed ? 'Review and settle' : 'View history'}
      </button>

      {expanded && <EscrowDetail id={row.id} canResolve={isDisputed} onResolved={onResolved} />}
    </li>
  );
}

function Party({
  label,
  person,
}: {
  label: string;
  person: { id: string; full_name: string; avatar_url: string | null } | null;
}) {
  if (!person) return <span className="text-gray-400">{label}: unavailable</span>;
  return (
    <span className="flex items-center gap-1.5">
      <Avatar name={person.full_name} src={person.avatar_url} size={20} />
      <span className="text-gray-400">{label}:</span>
      <Link to={`/app/users/${person.id}`} className="hover:text-ayira-700">
        {person.full_name}
      </Link>
    </span>
  );
}

function EscrowDetail({
  id,
  canResolve,
  onResolved,
}: {
  id: string;
  canResolve: boolean;
  onResolved: () => void;
}) {
  const { data, loading, error, refetch } = useApi<AdminEscrowDetail>(`/admin/escrow/${id}`);
  const [outcome, setOutcome] = useState<'released' | 'refunded' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function resolve() {
    if (!outcome) return;
    if (reason.trim().length < 10) {
      toast.error('Give a reason of at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/admin/escrow/${id}/resolve`, {
        method: 'POST',
        body: JSON.stringify({ outcome, reason: reason.trim() }),
      });
      toast.success(
        outcome === 'released' ? 'Payment released to the worker.' : 'Payment refunded to the employer.'
      );
      onResolved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not settle the dispute');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="mt-3"><Spinner /></div>;
  if (error) return <div className="mt-3"><ErrorMessage message={error} onRetry={refetch} /></div>;
  if (!data) return null;

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
        History
      </h3>
      <ol className="mb-4 space-y-1.5">
        {data.events.map((event) => (
          <li key={event.id} className="text-xs text-gray-600">
            <span className="font-medium text-gray-800">
              {event.from_status ? `${event.from_status} → ` : ''}
              {event.to_status}
            </span>
            {event.actor && <span className="text-gray-400"> by {event.actor.full_name}</span>}
            <span className="text-gray-400"> · {formatRelative(event.created_at)}</span>
            {event.detail && <p className="mt-0.5 text-gray-500">{event.detail}</p>}
          </li>
        ))}
      </ol>

      {canResolve && (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <p className="mb-2 text-sm font-medium text-gray-800">Settle this dispute</p>
          <p className="mb-3 text-xs text-gray-600">
            Releasing pays the worker; refunding returns the money to the employer.
            This cannot be undone, and the reason is recorded against the transaction.
          </p>

          <div className="mb-3 flex gap-2">
            <Choice
              label="Release to worker"
              active={outcome === 'released'}
              onClick={() => setOutcome('released')}
            />
            <Choice
              label="Refund employer"
              active={outcome === 'refunded'}
              onClick={() => setOutcome('refunded')}
            />
          </div>

          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Why is this the right outcome? Both parties can be shown this."
            className="mb-3 w-full rounded-lg border border-gray-200 p-2.5 text-sm focus:border-ayira-400 focus:outline-none focus:ring-2 focus:ring-ayira-100"
          />

          <button
            type="button"
            onClick={resolve}
            disabled={busy || !outcome}
            className="inline-flex items-center gap-2 rounded-lg bg-ayira-600 px-4 py-2 text-sm font-medium text-white hover:bg-ayira-700 disabled:opacity-50"
          >
            {busy && <Spinner />}
            Settle
          </button>
        </div>
      )}
    </div>
  );
}

function Choice({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'border-ayira-500 bg-ayira-50 text-ayira-700'
          : 'border-gray-200 text-gray-600 hover:bg-gray-50'
      }`}
    >
      {label}
    </button>
  );
}
