import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import {
  requireUser,
  userClient,
  assertNoDbError,
  paginationSchema,
  toRange,
  buildPageMeta,
} from '../lib/http';

export const notificationRouter = Router();

/**
 * Notifications were created in migration 006 and never read or written by
 * anything. Until now the platform told nobody anything: a worker was
 * shortlisted, accepted, paid or reviewed without ever being informed, so the
 * only way to learn an application had progressed was to go back and look.
 *
 * Reads go through the caller's own client, so the "Users see own
 * notifications" policy decides what they see rather than a WHERE clause
 * here. Marking read goes through mark_notifications_read, because the table
 * has no UPDATE policy -- see migration 025 for why that is a function and
 * not a policy.
 */

const uuid = z.string().uuid();

const NOTIFICATION_COLUMNS = 'id, type, title, body, data, is_read, created_at';

const markReadSchema = z.object({
  /** Omitted or empty means "everything unread". */
  ids: z.array(uuid).max(200).optional(),
});

// GET /api/notifications — the caller's notifications, newest first
notificationRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { page, limit } = paginationSchema.parse(req.query);
    const { from, to } = toRange(page, limit);

    const { data, error, count } = await userClient(req)
      .from('notifications')
      .select(NOTIFICATION_COLUMNS, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load notifications');

    res.json({
      data: {
        notifications: data ?? [],
        ...buildPageMeta(count ?? 0, page, limit),
      },
    });
  })
);

/**
 * GET /api/notifications/unread-count — just the badge number.
 *
 * Separate from the list because the bell is on every page and the list is
 * not. `head: true` means Postgres counts without returning rows, and the
 * partial index on (user_id) WHERE is_read = FALSE serves it directly.
 */
notificationRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const { count, error } = await userClient(req)
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('is_read', false);

    assertNoDbError(error, 'Failed to count notifications');
    res.json({ data: { unread: count ?? 0 } });
  })
);

/**
 * POST /api/notifications/read — mark some, or all, as read.
 *
 * The user id comes from the verified token, never the body, so this cannot
 * be pointed at someone else's rows even though it runs as the service role.
 */
notificationRouter.post(
  '/read',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const { ids } = markReadSchema.parse(req.body ?? {});

    const { data, error } = await supabaseAdmin.rpc('mark_notifications_read', {
      p_user_id: userId,
      p_ids: ids && ids.length > 0 ? ids : null,
    });

    assertNoDbError(error, 'Failed to mark notifications read');
    res.json({ data: { marked: data ?? 0 } });
  })
);
