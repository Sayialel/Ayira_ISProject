import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireUser, userClient, assertNoDbError } from '../lib/http';
import { notify } from '../lib/notify';
import { foldThreads } from '../lib/threads';

export const messageRouter = Router();

/**
 * Messaging between the two parties on a gig.
 *
 * The table has existed since migration 007 with nothing reading or writing
 * it, which left a hole in the middle of the workflow: an employer could
 * shortlist a worker and then had no way to ask them anything, and no way to
 * agree what the work actually was before funding escrow for it.
 *
 * A thread is (gig, counterparty), not (gig). An employer with three
 * applicants on one gig has three separate conversations about it, and the
 * worker in each should not see the other two.
 *
 * Who may write is decided by the database. Migration 013's policy requires
 * the two people to be the employer on the gig and a worker who applied to
 * it, in either direction. Sending through the caller's own client rather
 * than the service role is what puts that policy in the path -- supabaseAdmin
 * here would bypass it entirely and turn this into an open inbox.
 */

const uuid = z.string().uuid();

const MESSAGE_COLUMNS = 'id, gig_id, sender_id, receiver_id, content, is_read, created_at';

const PERSON_FIELDS = 'id, full_name, avatar_url, role';

const sendSchema = z.object({
  gig_id: uuid,
  receiver_id: uuid,
  // Capped so one message cannot be used to store arbitrary data. The table
  // also refuses anything blank (migration 025).
  content: z.string().trim().min(1, 'A message cannot be empty').max(4000),
});

const threadParamsSchema = z.object({
  gigId: uuid,
  otherId: uuid,
});

/**
 * GET /api/messages/threads — one row per conversation the caller is in.
 *
 * Built in the gateway rather than with a GROUP BY. PostgREST cannot express
 * "the latest row per group", and adding a view or an RPC for it would mean
 * reimplementing the visibility rule that the SELECT policy already applies
 * correctly. So this reads the caller's visible messages newest-first and
 * folds them into threads, which is also what lets the unread count and the
 * last message come from one query rather than one per thread.
 *
 * The cap is the honest limitation: a caller with more than MESSAGE_SCAN
 * messages would get threads built from only the most recent slice. At this
 * stage no account has more than a handful; past that this wants a view with
 * DISTINCT ON (gig_id, counterparty).
 */
const MESSAGE_SCAN = 500;

messageRouter.get(
  '/threads',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);

    const { data, error } = await userClient(req)
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .order('created_at', { ascending: false })
      .limit(MESSAGE_SCAN);

    assertNoDbError(error, 'Failed to load conversations');

    const rows = data ?? [];
    const list = foldThreads(rows, userId);

    if (list.length === 0) {
      return res.json({ data: { threads: [], truncated: false } });
    }

    // The gig titles and the other person's name, in two queries rather than
    // two per thread. The service role is used for these two reads only: they
    // are public-profile fields and gig titles the caller can already see on
    // the gig page, and the set of ids was derived from rows RLS had already
    // allowed them to read.
    const gigIds = [...new Set(list.map((t) => t.gig_id))];
    const peopleIds = [...new Set(list.map((t) => t.other_id))];

    const [gigs, people] = await Promise.all([
      supabaseAdmin.from('gigs').select('id, title, status').in('id', gigIds),
      supabaseAdmin.from('users').select(PERSON_FIELDS).in('id', peopleIds),
    ]);

    assertNoDbError(gigs.error, 'Failed to load conversation gigs');
    assertNoDbError(people.error, 'Failed to load conversation participants');

    const gigById = new Map((gigs.data ?? []).map((g) => [g.id, g]));
    const personById = new Map((people.data ?? []).map((p) => [p.id, p]));

    res.json({
      data: {
        threads: list.map((thread) => ({
          ...thread,
          gig: gigById.get(thread.gig_id) ?? null,
          other: personById.get(thread.other_id) ?? null,
        })),
        // So the UI can say so rather than silently showing a partial list.
        truncated: rows.length === MESSAGE_SCAN,
      },
    });
  })
);

/**
 * GET /api/messages/threads/:gigId/:otherId — one conversation, oldest first.
 *
 * Opening a thread marks the other party's messages in it as read, which is
 * what a reader expects and saves a second round trip from the client.
 */
messageRouter.get(
  '/threads/:gigId/:otherId',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const { gigId, otherId } = threadParamsSchema.parse(req.params);

    const { data, error } = await userClient(req)
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('gig_id', gigId)
      .or(`sender_id.eq.${otherId},receiver_id.eq.${otherId}`)
      .order('created_at', { ascending: true });

    assertNoDbError(error, 'Failed to load the conversation');

    const { error: readError } = await supabaseAdmin.rpc('mark_thread_read', {
      p_gig_id: gigId,
      p_user_id: userId,
      p_other_id: otherId,
    });

    // Failing to mark read is not worth failing the read for; they would
    // simply see the badge again.
    if (readError) {
      console.error('Could not mark the thread read:', readError.message);
    }

    const [gig, other] = await Promise.all([
      supabaseAdmin.from('gigs').select('id, title, status').eq('id', gigId).maybeSingle(),
      supabaseAdmin.from('users').select(PERSON_FIELDS).eq('id', otherId).maybeSingle(),
    ]);

    res.json({
      data: {
        messages: data ?? [],
        gig: gig.data ?? null,
        other: other.data ?? null,
      },
    });
  })
);

/**
 * POST /api/messages — send one.
 *
 * sender_id is taken from the verified token and never from the body. The
 * policy would refuse a mismatch anyway, but it should not be possible to
 * express.
 */
messageRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const body = sendSchema.parse(req.body);

    if (body.receiver_id === userId) {
      throw new AppError('You cannot message yourself', 400);
    }

    const { data, error } = await userClient(req)
      .from('messages')
      .insert({
        gig_id: body.gig_id,
        sender_id: userId,
        receiver_id: body.receiver_id,
        content: body.content,
      })
      .select(MESSAGE_COLUMNS)
      .single();

    if (error) {
      // 42501 is insufficient_privilege: the RLS policy refused it, which
      // here means these two people are not the employer and an applicant on
      // this gig. That is a permission error, not a server fault, and the
      // message says what the rule is rather than echoing the database.
      if (error.code === '42501') {
        throw new AppError(
          'You can only message the other party on a gig you have applied to or posted.',
          403
        );
      }
      assertNoDbError(error, 'Failed to send the message');
    }

    // The point of the whole feature: the recipient finds out.
    const sender = await supabaseAdmin
      .from('users')
      .select('full_name')
      .eq('id', userId)
      .maybeSingle();

    notify({
      userId: body.receiver_id,
      type: 'message_received',
      title: `New message from ${sender.data?.full_name ?? 'someone'}`,
      body: body.content.slice(0, 140),
      data: { gig_id: body.gig_id, other_id: userId },
    });

    res.status(201).json({ data });
  })
);
