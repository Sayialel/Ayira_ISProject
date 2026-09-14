import { createClient } from '@supabase/supabase-js';
import { env } from './env';
import type { Database } from '../types/database';

// Admin client — bypasses RLS, used for server-side operations
export const supabaseAdmin = createClient<Database>(
  env.supabaseUrl,
  env.supabaseServiceRoleKey,
  {
    // A server has no browser storage and no user to refresh a session for.
    auth: { autoRefreshToken: false, persistSession: false },
  }
);

// Creates a per-request client that respects RLS using the user's JWT
export function createUserClient(accessToken: string) {
  return createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
