import { describe, it, expect } from 'vitest';
import { isAllowedOrigin, parseOrigins } from './cors';

/**
 * The allow-list is the only thing standing between a hostile page and a
 * user's session, so the wildcard needs pinning down. It exists for Cloudflare
 * Pages preview deployments, which each get their own hash subdomain and so
 * cannot be listed individually.
 */

const ALLOW = [
  'https://ayira-87w.pages.dev',
  '*.ayira-87w.pages.dev',
  'http://localhost:5173',
];

describe('exact matches', () => {
  it.each(ALLOW.filter((a) => !a.startsWith('*')))('allows %s', (origin) => {
    expect(isAllowedOrigin(origin, ALLOW)).toBe(true);
  });

  it('rejects an origin that is not listed', () => {
    expect(isAllowedOrigin('https://example.com', ALLOW)).toBe(false);
  });

  it('is scheme-sensitive', () => {
    // http:// and https:// are different origins, and a downgrade should not
    // inherit the allowance.
    expect(isAllowedOrigin('http://ayira-87w.pages.dev', ALLOW)).toBe(false);
  });

  it('is port-sensitive', () => {
    expect(isAllowedOrigin('http://localhost:5174', ALLOW)).toBe(false);
  });
});

describe('the preview wildcard', () => {
  it('allows a single-label preview subdomain', () => {
    expect(isAllowedOrigin('https://6a5618e3.ayira-87w.pages.dev', ALLOW)).toBe(true);
  });

  /**
   * The attack the narrow wildcard exists to stop. A suffix match would let
   * anyone who can register a domain ending in the allowed string through.
   */
  it('rejects a dotted label pretending to be a preview', () => {
    expect(isAllowedOrigin('https://evil.com.ayira-87w.pages.dev', ALLOW)).toBe(false);
  });

  it('rejects a lookalike with no dot separator', () => {
    expect(isAllowedOrigin('https://evil-ayira-87w.pages.dev', ALLOW)).toBe(false);
  });

  it('rejects a deeper subdomain', () => {
    expect(isAllowedOrigin('https://a.b.ayira-87w.pages.dev', ALLOW)).toBe(false);
  });

  it('does not treat the wildcard as matching the apex twice', () => {
    // The apex is allowed by its own exact entry, not by the wildcard.
    expect(isAllowedOrigin('https://ayira-87w.pages.dev', ['*.ayira-87w.pages.dev'])).toBe(
      false
    );
  });

  it('rejects an empty label', () => {
    expect(isAllowedOrigin('https://.ayira-87w.pages.dev', ALLOW)).toBe(false);
  });
});

describe('absent origin', () => {
  /**
   * Only a browser sends Origin. curl, health checks and server-to-server
   * calls do not, and CORS does not govern them -- refusing here would break
   * the platform health check while protecting nothing.
   */
  it('is allowed', () => {
    expect(isAllowedOrigin(undefined, ALLOW)).toBe(true);
    expect(isAllowedOrigin('', ALLOW)).toBe(true);
  });

  it('is still allowed when the list is empty', () => {
    expect(isAllowedOrigin(undefined, [])).toBe(true);
  });
});

describe('parseOrigins', () => {
  it('splits a comma-separated list and trims it', () => {
    expect(parseOrigins('https://a.dev, https://b.dev ,https://c.dev')).toEqual([
      'https://a.dev',
      'https://b.dev',
      'https://c.dev',
    ]);
  });

  it('drops empty entries from a trailing comma', () => {
    expect(parseOrigins('https://a.dev,,')).toEqual(['https://a.dev']);
  });

  it('falls back to the local dev server', () => {
    expect(parseOrigins(undefined)).toEqual(['http://localhost:5173']);
    expect(parseOrigins('')).toEqual(['http://localhost:5173']);
  });
});
