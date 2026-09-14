import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../lib/supabase';
import type { UserRole } from '../types/database';

export interface AuthRequest extends Request {
  userId?: string;
  userRole?: string;
  accessToken?: string;
}

/**
 * Short-lived role cache.
 *
 * Authenticating already costs one round trip to Supabase; looking the role up
 * on every request would double it. Roles change rarely (only an admin can
 * change one), so a few seconds of staleness is a fair trade. The TTL is short
 * enough that a revoked admin loses access almost immediately.
 */
const ROLE_CACHE_TTL_MS = 30_000;
const roleCache = new Map<string, { role: string; expiresAt: number }>();

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
  const cached = roleCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  const { data, error } = await supabaseAdmin
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to resolve user role:', error.message);
    // Degrade to the least-privileged role rather than to whatever the token
    // claims, and do not cache a result we are not confident in.
    return 'worker';
  }

  // No profile row yet (signup mid-flight): fall back to the requested role,
  // but never to a privileged one.
  const role = data ? (data.role as UserRole) : fallback === 'employer' ? 'employer' : 'worker';

  roleCache.set(userId, { role, expiresAt: Date.now() + ROLE_CACHE_TTL_MS });
  return role;
}

/** Drops a user's cached role, so a change takes effect on the next request. */
export function invalidateRoleCache(userId: string) {
  roleCache.delete(userId);
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
    // Reaching here means the call to Supabase itself failed — a timeout or a
    // network fault — not that the token was rejected. Reporting that as 401
    // would tell users their session had expired and bounce them to the login
    // screen over a transient blip, so it is surfaced as a server-side fault.
    console.error('Authentication check could not be completed:', err);
    return res
      .status(503)
      .json({ error: 'Could not verify your session right now. Please try again.' });
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
