import type { UserRole } from '@/types';

/**
 * Carries the role chosen on the sign-up form across the trip to Google.
 *
 * Google cannot be told that this platform has workers and employers, so the
 * choice has to be held on our side while the browser is away at
 * accounts.google.com and applied when it comes back.
 *
 * sessionStorage rather than a query parameter on redirectTo. The role would
 * work in the URL, but it would then be in browser history, in the Referer of
 * anything the landing page loads, and in any log that records query strings
 * -- and a crafted link could preset it for someone else. sessionStorage is
 * per-tab, same-origin, and survives a full-page navigation away and back,
 * which is exactly the lifetime needed here.
 */
const KEY = 'ayira.pending_role';

/** Only the two self-service roles survive a round trip. */
function isSelfServiceRole(value: unknown): value is UserRole {
  return value === 'worker' || value === 'employer';
}

export function setPendingRole(role: UserRole): void {
  try {
    sessionStorage.setItem(KEY, role);
  } catch {
    // Private browsing, blocked site data, or a full quota. Losing the choice
    // is not a failure: the account still arrives with role_confirmed false
    // and RequireRole asks for the role on the other side. Never block the
    // sign-in over storage.
  }
}

/**
 * Reads the pending role and clears it in the same breath.
 *
 * Clearing on read matters: confirm_user_role accepts exactly one choice, so a
 * value left behind would be replayed against the next account signed into in
 * this tab and rejected with a 409 that has no visible cause.
 */
export function takePendingRole(): UserRole | null {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return isSelfServiceRole(value) ? value : null;
  } catch {
    return null;
  }
}

export function clearPendingRole(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* nothing readable means nothing to clear */
  }
}
