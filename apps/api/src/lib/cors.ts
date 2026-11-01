/**
 * Which browser origins may call this API.
 *
 * Extracted from index.ts so it can be tested. index.ts imports the Supabase
 * client at module load, which needs credentials, so anything left in there
 * cannot be tested without standing up the whole gateway.
 */

/**
 * Matches an origin against an allow-list.
 *
 * `*.example.pages.dev` matches exactly one leading label, which is what
 * Cloudflare Pages preview deployments need: every deployment gets its own
 * hash subdomain, so they cannot be listed individually. The wildcard is
 * deliberately narrow -- it matches a single label, never a suffix anywhere,
 * so `evil.com.example.pages.dev` does not match and neither does
 * `evil-example.pages.dev`.
 *
 * An absent Origin is allowed. That is curl, a health check or a
 * server-to-server call, none of which CORS governs -- the browser is the
 * only thing that sends this header, and the only thing this protects.
 */
export function isAllowedOrigin(origin: string | undefined, allowList: string[]): boolean {
  if (!origin) return true;

  // Parsed rather than string-matched. Comparing whole origins meant the
  // "label" before the suffix still carried the scheme, so
  // "https://.example.pages.dev" -- an empty label -- looked like a valid
  // single label and was allowed. Parsing separates scheme, host and port so
  // each is compared as itself.
  let candidate: URL;
  try {
    candidate = new URL(origin);
  } catch {
    return false;                  // not a URL at all
  }

  return allowList.some((allowed) => {
    if (!allowed.startsWith('*.')) {
      let pattern: URL;
      try {
        pattern = new URL(allowed);
      } catch {
        return false;
      }
      return candidate.origin === pattern.origin;
    }

    // Wildcard entries carry no scheme, so they are matched on host alone and
    // constrained to https -- a preview deployment is never served over
    // plain http, and allowing it would make a downgrade attack free.
    if (candidate.protocol !== 'https:') return false;
    if (candidate.port) return false;

    const suffix = allowed.slice(1);          // "*.a.dev" -> ".a.dev"
    const host = candidate.hostname;
    if (!host.endsWith(suffix)) return false;

    const label = host.slice(0, host.length - suffix.length);
    // Exactly one non-empty label, and not itself dotted.
    return label.length > 0 && !label.includes('.');
  });
}

/** Parses the CORS_ORIGIN environment variable into an allow-list. */
export function parseOrigins(raw: string | undefined): string[] {
  return (raw || 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
}
