/**
 * Keeps the Render services awake.
 *
 * GitHub Actions was doing this and was not reliable: scheduled workflows on
 * free runners are frequently delayed, and a ten-minute schedule that actually
 * fires every 25 minutes lets a service that sleeps after 15 idle minutes go
 * down anyway. That is exactly what happened -- a health check on the engine
 * took 133 seconds because it had spun down despite the workflow existing.
 *
 * Cloudflare's cron triggers fire on time, and the account is already in use
 * for Pages, so this adds no new service to manage.
 *
 * Deliberately not a monitor: it reports nothing and alerts nobody. Its only
 * job is to make a request often enough that Render does not idle the
 * container.
 */

const TARGETS = [
  // The engine first and with the longest patience: if both are asleep this
  // is the one that takes a minute to come back.
  { name: 'engine', url: 'https://ayira-engine.onrender.com/health', timeoutMs: 120_000 },
  { name: 'gateway', url: 'https://ayira-api-t8wf.onrender.com/health', timeoutMs: 60_000 },
];

async function ping({ name, url, timeoutMs }) {
  const started = Date.now();
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // Render counts any inbound request; a HEAD would do, but /health is a
      // real check and costs the same.
      headers: { 'User-Agent': 'ayira-keepwarm/1.0' },
    });
    return `${name}: ${response.status} in ${Date.now() - started}ms`;
  } catch (err) {
    return `${name}: failed after ${Date.now() - started}ms (${err.name})`;
  }
}

export default {
  // Fired by the cron trigger in wrangler.toml.
  async scheduled(_event, _env, ctx) {
    // waitUntil, so the runtime does not cut the fetches short when scheduled
    // returns -- waking a cold engine takes far longer than the handler does.
    ctx.waitUntil(
      Promise.all(TARGETS.map(ping)).then((results) => {
        console.log(results.join(' | '));
      })
    );
  },

  // Visiting the Worker runs the same check by hand, which is what to use
  // before a demonstration rather than waiting for the next cron tick.
  async fetch() {
    const results = await Promise.all(TARGETS.map(ping));
    return new Response(results.join('\n') + '\n', {
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  },
};
