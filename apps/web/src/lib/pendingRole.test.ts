import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { setPendingRole, takePendingRole, clearPendingRole } from './pendingRole';

/**
 * The role chosen on the sign-up form has to survive a full-page trip to
 * accounts.google.com and back. These tests cover the three ways that goes
 * wrong: the value is never read, it is read twice, or storage is unavailable.
 *
 * sessionStorage is stubbed rather than provided by jsdom, because the cases
 * worth testing are the ones where it misbehaves -- a throwing accessor in
 * private browsing, a value that is not a role -- and those are easier to
 * arrange directly than to provoke in a real implementation.
 */

function installStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
  return store;
}

/** Private browsing and blocked site data both surface as a throw. */
function installThrowingStorage(): void {
  const boom = () => {
    throw new DOMException('The operation is insecure.', 'SecurityError');
  };
  vi.stubGlobal('sessionStorage', {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    length: 0,
  });
}

describe('with working storage', () => {
  let store: Map<string, string>;

  beforeEach(() => {
    store = installStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(['worker', 'employer'] as const)('carries %s across the redirect', (role) => {
    setPendingRole(role);
    expect(takePendingRole()).toBe(role);
  });

  /**
   * The important one. confirm_user_role accepts exactly one choice, so a
   * value left behind would be replayed against the next account signed into
   * in this tab and rejected with a 409 that has no visible cause.
   */
  it('clears on read, so it cannot be spent twice', () => {
    setPendingRole('employer');
    expect(takePendingRole()).toBe('employer');
    expect(takePendingRole()).toBeNull();
    expect(store.size).toBe(0);
  });

  it('returns null when nothing was stored', () => {
    expect(takePendingRole()).toBeNull();
  });

  it('keeps only the most recent choice', () => {
    setPendingRole('worker');
    setPendingRole('employer');
    expect(takePendingRole()).toBe('employer');
  });

  it('clearPendingRole discards an unspent choice', () => {
    setPendingRole('worker');
    clearPendingRole();
    expect(takePendingRole()).toBeNull();
  });

  it('is safe to clear when there is nothing to clear', () => {
    expect(() => clearPendingRole()).not.toThrow();
  });

  /**
   * sessionStorage is writable by anything running on the origin, so the value
   * read back is not trusted. 'admin' is the case that matters: confirm_user_role
   * would refuse it anyway, but failing here means the request is never sent.
   */
  it.each(['admin', 'Worker', 'EMPLOYER', 'superuser', '', 'null', '{}'])(
    'refuses the tampered value %s',
    (value) => {
      store.set('ayira.pending_role', value);
      expect(takePendingRole()).toBeNull();
    }
  );

  it('clears a tampered value rather than leaving it to be retried', () => {
    store.set('ayira.pending_role', 'admin');
    takePendingRole();
    expect(store.size).toBe(0);
  });
});

describe('with storage unavailable', () => {
  beforeEach(() => installThrowingStorage());
  afterEach(() => vi.unstubAllGlobals());

  /**
   * Losing the choice is not a failure. The account still arrives with
   * role_confirmed false and RequireRole asks on the other side, so the
   * sign-in must never be blocked over storage.
   */
  it('setPendingRole does not throw', () => {
    expect(() => setPendingRole('worker')).not.toThrow();
  });

  it('takePendingRole returns null instead of throwing', () => {
    expect(() => takePendingRole()).not.toThrow();
    expect(takePendingRole()).toBeNull();
  });

  it('clearPendingRole does not throw', () => {
    expect(() => clearPendingRole()).not.toThrow();
  });
});

describe('with sessionStorage entirely absent', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', undefined));
  afterEach(() => vi.unstubAllGlobals());

  it('degrades to no stored choice', () => {
    expect(() => setPendingRole('employer')).not.toThrow();
    expect(takePendingRole()).toBeNull();
  });
});
