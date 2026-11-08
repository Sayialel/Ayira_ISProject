import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, AlertTriangle } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { Avatar } from '@/components/ui';
import type { MessageThread, ThreadListResponse } from '@/types';

/**
 * The list of conversations.
 *
 * One row per (gig, counterparty). An employer hiring for one gig talks to
 * each applicant separately, so the gig title alone does not identify a
 * conversation and both are shown.
 */
export default function Messages() {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const data = await apiFetch<ThreadListResponse>('/messages/threads');
        if (cancelled) return;
        setThreads(data.threads);
        setTruncated(data.truncated);
      } catch (err) {
        if (!cancelled) setError((err as Error).message || 'Could not load your conversations');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold text-slate-900">Messages</h1>
        <p className="mt-1 text-sm text-slate-600">
          Conversations with the other party on a gig.
        </p>
      </header>

      {loading && <p className="text-sm text-slate-500">Loading…</p>}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {truncated && (
        <p className="flex items-start gap-2 rounded-lg border border-gold-200 bg-gold-50 px-4 py-3 text-sm text-gold-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          Showing your most recent conversations only. Older ones may not appear here yet.
        </p>
      )}

      {!loading && !error && threads.length === 0 && (
        <div className="rounded-xl border border-dashed border-slate-300 px-6 py-12 text-center">
          <MessageSquare size={28} className="mx-auto text-slate-300" aria-hidden />
          <p className="mt-3 text-sm font-medium text-slate-900">No conversations yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-slate-600">
            A conversation opens once you apply to a gig, or once someone applies to one of
            yours. Until then there is nobody to message.
          </p>
          <Link
            to="/app/gigs"
            className="mt-4 inline-block rounded-lg bg-ayira-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ayira-700"
          >
            Browse gigs
          </Link>
        </div>
      )}

      {threads.length > 0 && (
        <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {threads.map((thread) => (
            <li key={`${thread.gig_id}:${thread.other_id}`}>
              <Link
                to={`/app/messages/${thread.gig_id}/${thread.other_id}`}
                className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-slate-50"
              >
                <Avatar
                  name={thread.other?.full_name ?? 'Unknown'}
                  src={thread.other?.avatar_url}
                  size={40}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {thread.other?.full_name ?? 'Unknown'}
                    </p>
                    <span className="shrink-0 text-[11px] text-slate-400">
                      {formatRelative(thread.last_at)}
                    </span>
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {thread.gig?.title ?? 'A gig that has since been removed'}
                  </p>
                  <p
                    className={`mt-1 truncate text-sm ${
                      thread.unread > 0 ? 'font-medium text-slate-900' : 'text-slate-600'
                    }`}
                  >
                    {thread.last_from_me && <span className="text-slate-400">You: </span>}
                    {thread.last_message}
                  </p>
                </div>
                {thread.unread > 0 && (
                  <span className="mt-1 flex min-w-[20px] shrink-0 items-center justify-center rounded-full bg-ayira-600 px-1.5 text-[11px] font-bold text-white">
                    {thread.unread > 9 ? '9+' : thread.unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
