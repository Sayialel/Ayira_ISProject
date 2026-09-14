import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import type { UserRole } from '../types/database';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  accessToken?: string;
}

/**
 * Roles are read from public.users, never from the JWT's user_metadata.
 *
 * user_metadata is writable by the account holder — a signed-in user can call
 * supabase.auth.updateUser({ data: { role: 'admin' } }) with the public anon
 * key — so trusting it would let anyone reach the admin routes. The users table
 * is protected by the trigger in migration 011, which makes it the only
 * trustworthy source.
 */
async function resolveRole(userId: string, fallback: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to resolve user role:', error.message);
    // Degrade to the least-privileged role rather than to whatever the token claims.
    return 'worker';
  }

  // No profile row yet (signup mid-flight): fall back to the requested role,
  // but never to a privileged one.
  if (!data) return fallback === 'employer' ? 'employer' : 'worker';

  return data.role as UserRole;
}

export async function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.userId = user.id;
    req.accessToken = token;
    req.userRole = await resolveRole(user.id, user.user_metadata?.role);
    next();
  } catch (err) {
    console.error('Authentication failed:', err);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

export function requireRole(...roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.userRole || !roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
