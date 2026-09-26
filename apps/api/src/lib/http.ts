import { PostgrestError } from '@supabase/supabase-js';
import { z } from 'zod';
import { AppError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { createUserClient } from './supabase';

/** PostgREST / Postgres error codes we handle by name rather than by message. */
export const PG_UNIQUE_VIOLATION = '23505';
export const PGRST_NO_ROWS = 'PGRST116';

/**
 * Narrows the optional fields that authMiddleware attaches, so route handlers
 * get non-optional values without repeating null checks.
 */
export function requireUser(req: AuthRequest): {
  userId: string;
  role: string;
  accessToken: string;
} {
  if (!req.userId || !req.accessToken) {
    throw new AppError('Authentication required', 401);
  }
  return { userId: req.userId, role: req.userRole ?? 'worker', accessToken: req.accessToken };
}

/** A Supabase client scoped to the caller, so RLS applies to every query. */
export function userClient(req: AuthRequest) {
  return createUserClient(requireUser(req).accessToken);
}

/** Throws a clean AppError when a Supabase query fails. */
export function assertNoDbError(
  error: PostgrestError | null,
  message: string,
  statusCode = 500
): void {
  if (error) {
    console.error(`${message}:`, error.message, error.details ?? '');
    throw new AppError(message, statusCode);
  }
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

/** Converts page/limit into the inclusive range Supabase expects. */
export function toRange(page: number, limit: number): { from: number; to: number } {
  const from = (page - 1) * limit;
  return { from, to: from + limit - 1 };
}

export function buildPageMeta(total: number, page: number, limit: number) {
  return { total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) };
}

/**
 * PostgREST parses `or=(...)` filters as a mini-language, where commas, parens
 * and dots are syntax. Strip them (plus LIKE wildcards) so a search term can
 * never alter the filter it is interpolated into.
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,().*%\\"']/g, ' ').trim().slice(0, 100);
}

/**
 * Prepares a term for full-text search.
 *
 * Unlike the `or=(...)` case above, a textSearch term is sent as a parameter
 * rather than spliced into a filter expression, so it needs no escaping —
 * and stripping punctuation would break the syntax websearch_to_tsquery
 * supports: "quoted phrases", OR, and -exclusions. Only the length is capped.
 */
export function normalizeSearchQuery(term: string): string {
  return term.trim().slice(0, 200);
}
