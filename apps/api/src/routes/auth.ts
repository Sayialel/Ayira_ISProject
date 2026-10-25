import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireUser } from '../lib/http';

export const authRouter = Router();

/**
 * Removed: POST /signup, POST /signin and POST /refresh.
 *
 * The browser talks to Supabase GoTrue directly -- supabase.auth.signUp,
 * signInWithPassword and the client's own token refresh -- so these three were
 * called by nothing. Dead weight would have been reason enough to drop them.
 * Being reachable made it urgent.
 *
 * /signup called supabaseAdmin.auth.admin.createUser with email_confirm: true
 * on an unauthenticated route. Anyone who could reach the gateway could mint a
 * pre-verified account for an address they do not own, pick its role, and sign
 * in as it immediately -- confirmed by doing exactly that against the running
 * server, after which the account was deleted. The confirmation email is the
 * only thing tying an account to a mailbox, and this handed out accounts that
 * had skipped it.
 *
 * /signin and /refresh were a smaller version of the same problem: a second
 * credential path to keep correct, returning refresh tokens over our own
 * transport for no gain over the client that already does it.
 *
 * Only /role remains, and it has to be here: it runs confirm_user_role, which
 * is granted to the service role alone precisely so the browser cannot call
 * it.
 */

/**
 * POST /api/auth/role — the one-time role choice after an OAuth signup.
 *
 * Signing in with Google tells us a name and an email and nothing about
 * whether this person hires or works, so handle_new_user defaults them to
 * 'worker' and leaves role_confirmed false. This is where they say.
 *
 * Authenticated, unlike the rest of this router: the account exists by the
 * time it is called. The rules live in confirm_user_role, which accepts only
 * the two self-service roles and refuses once the choice is recorded, so this
 * window is one decision wide and closes behind them.
 */
authRouter.post(
  '/role',
  authMiddleware,
  asyncHandler(async (req: Request, res: Response) => {
    const { userId } = requireUser(req);
    const { role } = z
      .object({ role: z.enum(['worker', 'employer']) })
      .parse(req.body ?? {});

    const { error } = await supabaseAdmin.rpc('confirm_user_role', {
      p_user_id: userId,
      p_role: role,
    });

    if (error) {
      const text = error.message ?? '';
      if (/not found/i.test(text)) throw new AppError(text, 404);
      // Already chosen: a second attempt is a conflict, not a server fault.
      if (/already has a role/i.test(text)) throw new AppError(text, 409);
      throw new AppError(text || 'Could not set the role', 400);
    }

    const { data, error: readError } = await supabaseAdmin
      .from('users')
      .select('id, full_name, email, role, role_confirmed, avatar_url')
      .eq('id', userId)
      .single();

    if (readError) throw new AppError('Role set but the profile could not be re-read', 500);
    res.json({ data });
  })
);
