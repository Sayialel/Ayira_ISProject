import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell,
  BriefcaseBusiness,
  CheckCircle2,
  MessageSquare,
  Star,
  Wallet,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatRelative } from '@/lib/format';
import type { Notification, NotificationListResponse, NotificationType } from '@/types';

/**
 * The bell, its unread badge, and the dropdown.
 *
 * Until this existed the platform told nobody anything: a worker was
 * shortlisted, hired, paid or reviewed with no way to find out short of going
 * back and checking the page themselves.
 *
 * The count is polled rather than pushed. Supabase Realtime would avoid the
 * poll, but it needs a subscription per client against a table whose RLS is
 * evaluated per row, and a sixty-second poll of an indexed COUNT is cheap
 * enough that the complexity is not worth buying yet.
 */

const POLL_MS = 60_000;

/** Icon and destination per kind, so the dropdown row is one click to the thing. */
const PRESENTATION: Record<
  NotificationType,
  { icon: typeof Bell; tone: string; href: (n: Notification) => string }
> = {
  application_received: {
    icon: BriefcaseBusiness,
    tone: 'text-ayira-600',
    href: (n) => (n.data?.gig_id ? `/app/gigs/${n.data.gig_id}` : '/app/my-gigs'),
  },
  application_shortlisted: {
    icon: CheckCircle2,
    tone: 'text-gold-600',
    href: () => '/app/applications',
  },
  application_accepted: {
    icon: CheckCircle2,
    tone: 'text-emerald-600',
    href: () => '/app/applications',
  },
  application_rejected: {
    icon: XCircle,
    tone: 'text-slate-400',
    href: () => '/app/applications',
  },
  escrow_funded: { icon: Wallet, tone: 'text-emerald-600', href: () => '/app/escrow' },
  escrow_released: { icon: Wallet, tone: 'text-emerald-600', href: () => '/app/escrow' },
  escrow_disputed: { icon: AlertTriangle, tone: 'text-red-600', href: () => '/app/escrow' },
  review_received: { icon: Star, tone: 'text-gold-600', href: () => '/app/profile' },
  message_received: {
    icon: MessageSquare,
    tone: 'text-ayira-600',
    href: (n) =>
      n.data?.gig_id && n.data?.other_id
        ? `/app/messages/${n.data.gig_id}/${n.data.other_id}`
        : '/app/messages',
  },
};

export default function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(async () => {
    try {
      const { unread: count } = await apiFetch<{ unread: number }>(
        '/notifications/unread-count'
      );
      setUnread(count);
    } catch {
      // A failed count is not worth telling anyone about; the next tick
      // tries again and the badge simply does not move.
    }
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    return () => clearInterval(timer);
  }, [refreshCount]);

  // Close on a click elsewhere, or on Escape. Without both, a dropdown on a
  // sticky header stays open while the page scrolls under it.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next) return;

    setLoading(true);
    try {
      const data = await apiFetch<NotificationListResponse>('/notifications?limit=12');
      setItems(data.notifications);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }

  async function markAllRead() {
    // Optimistic: the badge should clear on the click, not a round trip later.
    setUnread(0);
    setItems((current) => current.map((n) => ({ ...n, is_read: true })));
    try {
      await apiFetch('/notifications/read', { method: 'POST', body: JSON.stringify({}) });
    } catch {
      refreshCount();           // put the real number back
    }
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={toggle}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-expanded={open}
        className="relative rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100"
      >
        <Bell size={20} aria-hidden />
        {unread > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex min-w-[18px] items-center justify-center rounded-full bg-ayira-600 px-1 text-[10px] font-bold leading-[18px] text-white"
            aria-hidden
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-slate-900">Notifications</p>
            {unread > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-ayira-700 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          {loading && <p className="px-4 py-6 text-center text-sm text-slate-500">Loading…</p>}

          {!loading && items.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              Nothing yet. You will hear from us when an application moves or a payment lands.
            </p>
          )}

          {!loading && items.length > 0 && (
            <ul className="max-h-[22rem] divide-y divide-slate-100 overflow-y-auto">
              {items.map((item) => {
                // An unknown type can only come from a server newer than this
                // bundle. Showing it plainly beats crashing the dropdown.
                const style = PRESENTATION[item.type] ?? {
                  icon: Bell,
                  tone: 'text-slate-400',
                  href: () => '/app',
                };
                const Icon = style.icon;

                return (
                  <li key={item.id}>
                    <Link
                      to={style.href(item)}
                      onClick={() => setOpen(false)}
                      className={`flex gap-3 px-4 py-3 transition-colors hover:bg-slate-50 ${
                        item.is_read ? '' : 'bg-ayira-50/60'
                      }`}
                    >
                      <Icon size={18} className={`mt-0.5 shrink-0 ${style.tone}`} aria-hidden />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{item.title}</p>
                        {item.body && (
                          <p className="mt-0.5 line-clamp-2 text-xs text-slate-600">{item.body}</p>
                        )}
                        <p className="mt-1 text-[11px] text-slate-400">
                          {formatRelative(item.created_at)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
