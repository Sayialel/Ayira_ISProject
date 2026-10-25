import { Router } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../lib/supabase';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireRole } from '../middleware/auth';
import {
  requireUser,
  userClient,
  assertNoDbError,
  paginationSchema,
  toRange,
  buildPageMeta,
} from '../lib/http';
import {
  initiateStkPush,
  isConfigured,
  parseCallback,
  queryStkStatus,
} from '../services/mpesa';
import type { EscrowRow } from '../types/database';

export const escrowRouter = Router();

/**
 * Mounted separately and without authentication, because Safaricom calls it.
 * See the comment on the handler for how it is secured instead.
 */
export const escrowCallbackRouter = Router();

const uuid = z.string().uuid();

const ESCROW_FIELDS =
  'id, gig_id, employer_id, worker_id, amount, currency, mpesa_checkout_id, mpesa_receipt, status, funded_at, released_at, created_at, updated_at';

const ESCROW_WITH_PARTIES = `${ESCROW_FIELDS}, gig:gigs!gig_id(id, title, status), employer:users!escrow_employer_id_fkey(id, full_name, avatar_url), worker:users!escrow_worker_id_fkey(id, full_name, avatar_url)`;

const fundSchema = z.object({
  gig_id: uuid,
  worker_id: uuid,
  // Whole shillings. Daraja's STK endpoint rejects decimals, so the service
  // rounds on the way out -- which means a request for 100.40 opened an escrow
  // recording 100.40 and asked M-Pesa for 100. The row then held a figure
  // nobody had paid. Refusing the decimal here keeps escrow.amount and the
  // sum actually charged the same number.
  amount: z
    .number()
    .int('Enter a whole number of shillings — M-Pesa cannot charge cents')
    .positive('Amount must be greater than zero')
    .max(500_000),
  phone: z.string().trim().min(9).max(20).optional(),
});

const listQuerySchema = paginationSchema.extend({
  status: z
    .enum(['pending', 'funded', 'released', 'disputed', 'refunded', 'partial_release', 'cancelled'])
    .optional(),
});

/** Maps a Postgres exception from the escrow functions onto an HTTP status. */
function escrowError(message: string | undefined, fallback: string): AppError {
  const text = message ?? '';
  if (/not found/i.test(text)) return new AppError(text, 404);
  if (/not a party|only the employer|only an admin|only an administrator/i.test(text)) {
    return new AppError(text, 403);
  }
  if (text) return new AppError(text, 409);
  return new AppError(fallback, 500);
}

// GET /api/escrow — the caller's transactions, as either party
escrowRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const q = listQuerySchema.parse(req.query);
    const { from, to } = toRange(q.page, q.limit);

    // RLS already restricts this to escrow the caller is party to; the filter
    // is stated anyway so the intent is visible in the code.
    let query = userClient(req)
      .from('escrow')
      .select(ESCROW_WITH_PARTIES, { count: 'exact' })
      .or(`employer_id.eq.${userId},worker_id.eq.${userId}`);

    if (q.status) query = query.eq('status', q.status);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range(from, to);

    assertNoDbError(error, 'Failed to load escrow transactions');

    res.json({
      data: {
        escrow: data ?? [],
        mpesa_configured: isConfigured(),
        ...buildPageMeta(count ?? 0, q.page, q.limit),
      },
    });
  })
);

// GET /api/escrow/:id — one transaction with its history
escrowRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Escrow not found', 404);

    const { data, error } = await userClient(req)
      .from('escrow')
      .select(ESCROW_WITH_PARTIES)
      .eq('id', parsed.data)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load escrow');
    if (!data) throw new AppError('Escrow not found', 404);

    const row = data as unknown as EscrowRow;
    if (row.employer_id !== userId && row.worker_id !== userId) {
      throw new AppError('Escrow not found', 404);
    }

    const { data: events } = await supabaseAdmin
      .from('escrow_events')
      .select('id, from_status, to_status, detail, created_at')
      .eq('escrow_id', parsed.data)
      .order('created_at', { ascending: true });

    res.json({ data: { ...data, events: events ?? [] } });
  })
);

// POST /api/escrow/fund — open an escrow and prompt the employer to pay
escrowRouter.post(
  '/fund',
  requireRole('employer'),
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const body = fundSchema.parse(req.body);

    // The phone that will be charged. Falls back to the employer's profile so
    // the common case needs no input.
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('phone')
      .eq('id', userId)
      .maybeSingle();

    const phone = body.phone ?? profile?.phone ?? '';
    if (!phone) {
      throw new AppError(
        'Add a phone number to your profile, or supply one, before funding escrow.',
        400
      );
    }

    // Opened before the push so the checkout id has a row to attach to — the
    // callback can arrive before Safaricom's response reaches us.
    const { data: opened, error: openError } = await supabaseAdmin.rpc('open_escrow', {
      p_gig_id: body.gig_id,
      p_employer_id: userId,
      p_worker_id: body.worker_id,
      p_amount: body.amount,
    });

    if (openError) {
      console.error('open_escrow failed:', openError.message);
      throw escrowError(openError.message, 'Could not open escrow');
    }

    const escrow = opened as unknown as EscrowRow;

    try {
      const push = await initiateStkPush(phone, body.amount, `AYIRA-${escrow.id.slice(0, 8)}`);

      const { error: linkError } = await supabaseAdmin
        .from('escrow')
        .update({ mpesa_checkout_id: push.checkoutRequestId })
        .eq('id', escrow.id);

      assertNoDbError(linkError, 'Failed to record the payment request');

      res.status(201).json({
        data: {
          escrow_id: escrow.id,
          checkout_request_id: push.checkoutRequestId,
          amount: body.amount,
          message: push.customerMessage,
        },
      });
    } catch (err) {
      // The escrow exists but no payment was started, so it would sit pending
      // forever and block any further attempt on this gig.
      await supabaseAdmin
        .rpc('transition_escrow', {
          p_escrow_id: escrow.id,
          p_actor_id: userId,
          p_to_status: 'cancelled',
          p_detail: 'Payment request could not be started',
        })
        .then(undefined, () => undefined);
      throw err;
    }
  })
);

// POST /api/escrow/:id/release — employer pays the worker
escrowRouter.post(
  '/:id/release',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Escrow not found', 404);

    const { data, error } = await supabaseAdmin.rpc('transition_escrow', {
      p_escrow_id: parsed.data,
      p_actor_id: userId,
      p_to_status: 'released',
      p_detail: 'Released by the employer',
    });

    if (error) {
      console.error('release failed:', error.message);
      throw escrowError(error.message, 'Could not release the payment');
    }

    // In production this is where a B2C payout would be initiated. In the
    // sandbox the status change is the whole of it, which is worth stating
    // rather than leaving the reader to assume money moved.
    res.json({ data });
  })
);

// POST /api/escrow/:id/dispute — either party raises a dispute
escrowRouter.post(
  '/:id/dispute',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Escrow not found', 404);

    const reason = z
      .object({ reason: z.string().trim().min(10).max(500) })
      .parse(req.body ?? {}).reason;

    const { data, error } = await supabaseAdmin.rpc('transition_escrow', {
      p_escrow_id: parsed.data,
      p_actor_id: userId,
      p_to_status: 'disputed',
      p_detail: reason,
    });

    if (error) {
      console.error('dispute failed:', error.message);
      throw escrowError(error.message, 'Could not raise the dispute');
    }

    res.json({ data });
  })
);

// POST /api/escrow/:id/cancel — withdraw an unpaid escrow
escrowRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Escrow not found', 404);

    const { data, error } = await supabaseAdmin.rpc('transition_escrow', {
      p_escrow_id: parsed.data,
      p_actor_id: userId,
      p_to_status: 'cancelled',
      p_detail: 'Cancelled before payment',
    });

    if (error) throw escrowError(error.message, 'Could not cancel the escrow');
    res.json({ data });
  })
);

// POST /api/escrow/:id/sync — ask Safaricom what happened
escrowRouter.post(
  '/:id/sync',
  asyncHandler(async (req, res) => {
    const { userId } = requireUser(req);
    const parsed = uuid.safeParse(req.params.id);
    if (!parsed.success) throw new AppError('Escrow not found', 404);

    const { data: escrow, error } = await supabaseAdmin
      .from('escrow')
      .select('id, employer_id, worker_id, status, mpesa_checkout_id')
      .eq('id', parsed.data)
      .maybeSingle();

    assertNoDbError(error, 'Failed to load escrow');
    if (!escrow) throw new AppError('Escrow not found', 404);
    if (escrow.employer_id !== userId && escrow.worker_id !== userId) {
      throw new AppError('Escrow not found', 404);
    }
    if (escrow.status !== 'pending' || !escrow.mpesa_checkout_id) {
      return res.json({ data: { status: escrow.status, changed: false } });
    }

    // Callbacks get lost — a tunnel drops, a deployment restarts — and without
    // this a payment that actually succeeded leaves the escrow stuck at
    // pending with no way back.
    const status = await queryStkStatus(escrow.mpesa_checkout_id);

    if (status.resultCode === '0') {
      const { error: fundError } = await supabaseAdmin.rpc('mark_escrow_funded', {
        p_checkout_id: escrow.mpesa_checkout_id,
        p_receipt: null,
      });
      if (fundError) throw escrowError(fundError.message, 'Could not record the payment');
      return res.json({ data: { status: 'funded', changed: true, detail: status.resultDesc } });
    }

    res.json({
      data: { status: escrow.status, changed: false, detail: status.resultDesc },
    });
  })
);

/* -------------------------------------------------------------------------- */
/* The public callback                                                        */
/* -------------------------------------------------------------------------- */

/**
 * POST /api/escrow/callback — Safaricom reports the outcome of a push.
 *
 * This endpoint cannot require authentication: Safaricom's servers call it and
 * carry no credential of ours. It is secured by what it will act on instead.
 *
 *   * It accepts only a CheckoutRequestID that already exists on a pending
 *     escrow row. That value is issued by Safaricom and is not guessable.
 *   * mark_escrow_funded() refuses any row that is not pending, so a replayed
 *     callback cannot fund an escrow twice or revive a cancelled one.
 *   * It always answers 200. Safaricom retries anything else, and retrying will
 *     not fix a malformed body — it would only produce a queue of duplicates.
 *
 * The honest limit: anyone who learns a CheckoutRequestID could post a forged
 * success. Closing that properly needs IP allow-listing of Safaricom's ranges
 * at the edge, which is a deployment concern rather than an application one,
 * and is noted as outstanding.
 */
escrowCallbackRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = parseCallback(req.body);

    if (!result) {
      console.warn('M-Pesa callback could not be parsed:', JSON.stringify(req.body).slice(0, 400));
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    if (!result.succeeded) {
      // A cancelled or failed payment. Record it against the escrow and leave
      // the row pending so the employer can try again.
      const { data: escrow } = await supabaseAdmin
        .from('escrow')
        .select('id, status')
        .eq('mpesa_checkout_id', result.checkoutRequestId)
        .maybeSingle();

      if (escrow) {
        await supabaseAdmin.from('escrow_events').insert({
          escrow_id: escrow.id,
          from_status: escrow.status,
          to_status: escrow.status,
          detail: `Payment not completed: ${result.resultDesc}`,
        });
      }

      console.log(`M-Pesa payment not completed (${result.checkoutRequestId}): ${result.resultDesc}`);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    const { error } = await supabaseAdmin.rpc('mark_escrow_funded', {
      p_checkout_id: result.checkoutRequestId,
      p_receipt: result.receipt,
    });

    if (error) {
      // Logged, not surfaced: Safaricom has no use for our errors and would
      // only retry a callback that will fail the same way again.
      console.error('Could not apply M-Pesa callback:', error.message);
    } else {
      console.log(`Escrow funded via M-Pesa receipt ${result.receipt ?? '(none)'}`);
    }

    res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  })
);
