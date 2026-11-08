import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Send } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import { Avatar } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';
import type { Message, ThreadResponse } from '@/types';

/**
 * One conversation.
 *
 * Polled on an interval rather than subscribed. The honest reason is that a
 * fifteen-second poll of an indexed query is enough for agreeing a scope and
 * a price, which is what this is for -- it is not a chat app, and Realtime
 * would add a per-client subscription for a conversation that sees a handful
 * of messages a day.
 */

const POLL_MS = 15_000;

export default function MessageThread() {
  const { gigId, otherId } = useParams<{ gigId: string; otherId: string }>();
  const { user } = useAuth();
  const me = user?.id;

  const [thread, setThread] = useState<ThreadResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const endRef = useRef<HTMLDivElement>(null);
  // So a poll that brings nothing new does not yank the view to the bottom
  // while someone is reading back through the thread.
  const lastCountRef = useRef(0);

  useEffect(() => {
    if (!gigId || !otherId) return;
    let cancelled = false;

    async function load(initial: boolean) {
      try {
        const data = await apiFetch<ThreadResponse>(`/messages/threads/${gigId}/${otherId}`);
        if (cancelled) return;
        setThread(data);
        setError(null);
      } catch (err) {
        if (!cancelled && initial) {
          setError((err as Error).message || 'Could not load this conversation');
        }
      } finally {
        if (!cancelled && initial) setLoading(false);
      }
    }

    load(true);
    const timer = setInterval(() => load(false), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [gigId, otherId]);

  useEffect(() => {
    const count = thread?.messages.length ?? 0;
    if (count !== lastCountRef.current) {
      lastCountRef.current = count;
      endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [thread]);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || !gigId || !otherId || sending) return;

    setSending(true);
    setError(null);
    try {
      const sent = await apiFetch<Message>('/messages', {
        method: 'POST',
        body: JSON.stringify({ gig_id: gigId, receiver_id: otherId, content }),
      });
      // Appended locally rather than refetching: the send already returned
      // the row, so a second round trip would only add latency.
      setThread((current) =>
        current ? { ...current, messages: [...current.messages, sent] } : current
      );
      setDraft('');
    } catch (err) {
      setError((err as Error).message || 'Could not send that message');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="flex min-h-[calc(100vh-12rem)] flex-col">
      <header className="flex items-center gap-3 border-b border-slate-200 pb-3">
        <Link
          to="/app/messages"
          aria-label="Back to messages"
          className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-100"
        >
          <ArrowLeft size={18} aria-hidden />
        </Link>
        <Avatar
          name={thread?.other?.full_name ?? 'Unknown'}
          src={thread?.other?.avatar_url}
          size={38}
        />
        <div className="min-w-0">
          {thread?.other ? (
            <Link
              to={`/app/users/${thread.other.id}`}
              className="truncate text-sm font-semibold text-slate-900 hover:text-ayira-700"
            >
              {thread.other.full_name}
            </Link>
          ) : (
            <p className="text-sm font-semibold text-slate-900">Unknown</p>
          )}
          {thread?.gig && (
            <Link
              to={`/app/gigs/${thread.gig.id}`}
              className="block truncate text-xs text-slate-500 hover:text-ayira-700"
            >
              {thread.gig.title}
            </Link>
          )}
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto py-4">
        {thread?.messages.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-500">
            No messages yet. Say hello, or ask about the work.
          </p>
        )}

        {thread?.messages.map((message) => {
          const mine = message.sender_id === me;
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[min(32rem,80%)] rounded-2xl px-3.5 py-2 ${
                  mine
                    ? 'rounded-br-md bg-ayira-600 text-white'
                    : 'rounded-bl-md bg-slate-100 text-slate-900'
                }`}
              >
                <p className="whitespace-pre-wrap break-words text-sm">{message.content}</p>
                <p
                  className={`mt-1 text-[10px] ${mine ? 'text-ayira-100' : 'text-slate-400'}`}
                >
                  {formatRelative(message.created_at)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="mb-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <form onSubmit={send} className="flex items-end gap-2 border-t border-slate-200 pt-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter makes a new line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(e);
            }
          }}
          rows={1}
          maxLength={4000}
          placeholder="Write a message…"
          aria-label="Message"
          className="max-h-32 min-h-[2.5rem] flex-1 resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-ayira-500 focus:outline-none focus:ring-1 focus:ring-ayira-500"
        />
        <button
          type="submit"
          disabled={sending || draft.trim().length === 0}
          className="flex h-10 items-center gap-1.5 rounded-lg bg-ayira-600 px-4 text-sm font-medium text-white transition-colors hover:bg-ayira-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={15} aria-hidden />
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  );
}
