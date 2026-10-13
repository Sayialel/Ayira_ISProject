import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Wallet, ShieldAlert, RefreshCw, Banknote, Clock } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useApi } from '@/hooks/useApi';
import { apiFetch, toQueryString } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Button, ButtonLink } from '@/components/Button';
import {
  Avatar,
  Card,
  EmptyState,
  ErrorMessage,
  EscrowStatusBadge,
  Pagination,
  SectionHeading,
  SkeletonList,
  usePageTitle,
} from '@/components/ui';
import { formatCurrency, formatRelative } from '@/lib/format';
import type { Escrow, EscrowListResponse, EscrowStatus } from '@/types';

const TABS: { label: string; value: EscrowStatus | '' }[] = [
  { label: 'All', value: '' },
  { label: 'Awaiting payment', value: 'pending' },
  { label: 'Held', value: 'funded' },
  { label: 'Released', value: 'released' },
  { label: 'Disputed', value: 'disputed' },
];

export default function EscrowPage() {
  usePageTitle('Payments');

  const { user } = useAuth();
  const toast = useToast();
  const [status, setStatus] = useState<EscrowStatus | ''>('');
  const [page, setPage] = useState(1);
  const [busyId, setBusyId] = useState<string | null>(null);

  const path = useMemo(
    () => `/escrow${toQueryString({ status: status || undefined, page, limit: 20 })}`,
    [status, page]
  );
  const { data, loading, error, refetch } = useApi<EscrowListResponse>(path);

  const myId = user?.id;
  const rows = data?.escrow ?? [];

  const held = rows
    .filter((e) => e.status === 'funded')
    .reduce((total, e) => total + Number(e.amount), 0);

  async function act(
    escrow: Escrow,
    action: 'release' | 'dispute' | 'cancel' | 'sync',
    body?: unknown
  ) {
    setBusyId(escrow.id);
    try {
      await apiFetch(`/escrow/${escrow.id}/${action}`, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });

      const said: Record<typeof action, string> = {
        release: 'Payment released to the worker.',
        dispute: 'Dispute raised. An administrator will review it.',
        cancel: 'Escrow cancelled.',
        sync: 'Checked with M-Pesa.',
      };
      toast.success(said[action]);
      refetch();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusyId(null);
    }
  }

  function onDispute(escrow: Escrow) {
    const reason = window.prompt(
      'What has gone wrong? This is shown to the administrator reviewing the dispute.'
    );
    if (!reason) return;
    if (reason.trim().length < 10) {
      toast.error('Please describe the problem in at least ten characters.');
      return;
    }
    act(escrow, 'dispute', { reason: reason.trim() });
  }

  return (
    <div>
      <SectionHeading
        title="Payments"
        description="Money held in escrow until work is finished."
      />

      {data && data.mpesa_configured === false && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-gold-100 bg-gold-50 p-4 text-sm text-gold-700">
          <ShieldAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
          <p>
            M-Pesa is not configured on this server, so new escrow cannot be funded.
            Existing transactions are still shown.
          </p>
        </div>
      )}

      {held > 0 && (
        <Card className="mb-5 flex items-center gap-4 p-5">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gold-50 text-gold-600">
            <Wallet size={20} aria-hidden />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Currently held in escrow
            </p>
            <p className="text-2xl font-bold text-slate-900">{formatCurrency(held)}</p>
          </div>
        </Card>
      )}

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 pb-px">
        {TABS.map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => {
              setStatus(tab.value);
              setPage(1);
            }}
            aria-current={status === tab.value ? 'page' : undefined}
            className={`whitespace-nowrap border-b-2 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
              status === tab.value
                ? 'border-ayira-600 text-ayira-700'
                : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <SkeletonList rows={3} />}
      {!loading && error && <ErrorMessage message={error} onRetry={refetch} />}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          icon={<Banknote size={22} aria-hidden />}
          title="No payments yet"
          description="Escrow appears here once an employer funds a gig you are working on, or once you fund one."
          action={<ButtonLink to="/app/gigs" variant="secondary">Browse gigs</ButtonLink>}
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <>
          <div className="space-y-3">
            {rows.map((escrow) => {
              const isEmployer = escrow.employer_id === myId;
              const other = isEmployer ? escrow.worker : escrow.employer;
              const busy = busyId === escrow.id;

              return (
                <Card key={escrow.id} className="p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <EscrowStatusBadge status={escrow.status} />
                        <span className="text-xs text-slate-400">
                          {isEmployer ? 'You are paying' : 'You are being paid'}
                        </span>
                      </div>

                      <Link
                        to={`/app/gigs/${escrow.gig_id}`}
                        className="font-semibold text-slate-900 hover:text-ayira-700"
                      >
                        {escrow.gig?.title ?? 'Gig unavailable'}
                      </Link>

                      {other && (
                        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                          <Avatar name={other.full_name} src={other.avatar_url} size={22} />
                          {other.full_name}
                        </div>
                      )}

                      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
                        <Clock size={13} aria-hidden />
                        Opened {formatRelative(escrow.created_at)}
                        {escrow.mpesa_receipt && ` · receipt ${escrow.mpesa_receipt}`}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="text-xl font-bold text-slate-900">
                        {formatCurrency(escrow.amount, escrow.currency)}
                      </p>
                    </div>
                  </div>

                  {/* Actions available to this party in this state. */}
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                    {escrow.status === 'pending' && isEmployer && (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<RefreshCw size={14} />}
                          loading={busy}
                          onClick={() => act(escrow, 'sync')}
                        >
                          Check payment
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => act(escrow, 'cancel')}
                        >
                          Cancel
                        </Button>
                      </>
                    )}

                    {escrow.status === 'funded' && isEmployer && (
                      <Button
                        size="sm"
                        variant="money"
                        icon={<Banknote size={14} />}
                        loading={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Release ${formatCurrency(escrow.amount, escrow.currency)} to ${
                                escrow.worker?.full_name ?? 'the worker'
                              }? This cannot be undone.`
                            )
                          ) {
                            act(escrow, 'release');
                          }
                        }}
                      >
                        Release payment
                      </Button>
                    )}

                    {escrow.status === 'funded' && (
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={busy}
                        onClick={() => onDispute(escrow)}
                      >
                        Raise a dispute
                      </Button>
                    )}

                    {escrow.status === 'pending' && !isEmployer && (
                      <p className="text-sm text-slate-500">
                        Waiting for the employer to complete payment.
                      </p>
                    )}

                    {escrow.status === 'released' && (
                      <p className="text-sm text-green-700">
                        Paid{escrow.released_at ? ` ${formatRelative(escrow.released_at)}` : ''}.
                      </p>
                    )}

                    {escrow.status === 'disputed' && (
                      <p className="text-sm text-red-700">
                        Under review by an administrator.
                      </p>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
          {data && (
            <Pagination page={data.page} totalPages={data.totalPages} onChange={setPage} />
          )}
        </>
      )}
    </div>
  );
}
