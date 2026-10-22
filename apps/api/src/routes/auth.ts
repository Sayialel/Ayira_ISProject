import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { asyncHandler } from '../lib/asyncHandler';
import { AppError } from '../middleware/errorHandler';
import { requireUser } from '../lib/http';

export const authRouter = Router();

const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().min(2),
  phone: z.string().min(10),
  role: z.enum(['worker', 'employer']),
});

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

// POST /api/auth/signup
authRouter.post('/signup', async (req: Request, res: Response) => {
  try {
    const body = signUpSchema.parse(req.body);

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
      user_metadata: {
        full_name: body.fullName,
        phone: body.phone,
        role: body.role,
      },
    });

    if (error) return res.status(400).json({ error: error.message });

    // Create profile in users table.
    // The on_auth_user_created trigger (migration 011) already inserts a row
    // from the auth metadata, so this upserts to fill in the same values
    // instead of colliding on the primary key.
    const { error: profileError } = await supabaseAdmin
      .from('users')
      .upsert(
        {
          id: data.user.id,
          email: body.email,
          full_name: body.fullName,
          phone: body.phone,
          role: body.role,
        },
        { onConflict: 'id' }
      );

    if (profileError) return res.status(400).json({ error: profileError.message });

    res.status(201).json({ message: 'Account created', userId: data.user.id });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    return res.status(500).json({ error: 'Registration failed' });
  }
});

// POST /api/auth/signin
authRouter.post('/signin', async (req: Request, res: Response) => {
  try {
    const body = signInSchema.parse(req.body);

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error) return res.status(401).json({ error: error.message });

    res.json({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: {
        id: data.user.id,
        email: data.user.email,
        role: data.user.user_metadata?.role,
      },
    });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation failed', details: err.errors });
    }
    return res.status(500).json({ error: 'Login failed' });
  }
});

// POST /api/auth/refresh
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });
  if (error) return res.status(401).json({ error: error.message });

  res.json({
    accessToken: data.session!.access_token,
    refreshToken: data.session!.refresh_token,
  });
});

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
