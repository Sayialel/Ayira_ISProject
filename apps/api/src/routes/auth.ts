import { Router, Request, Response } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import { z } from 'zod';

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
