/**
 * Asks GitHub Actions to embed workers whose profile text has just changed.
 *
 * Why this is not done here, or in the engine. Computing an embedding means
 * loading all-MiniLM-L6-v2 through sentence-transformers. The engine is
 * measured at 129 MB with the model unloaded and 445 MB once it is loaded and
 * used, against a 512 MB instance -- so a request that tried to embed was
 * killed by the host and the worker saw a 502. That is exactly the failure
 * new workers hit. Serving therefore never loads the model, and the vector is
 * computed on a GitHub runner, which has gigabytes and costs nothing on a
 * public repository.
 *
 * The workflow (.github/workflows/embed-new-workers.yml) already runs on a
 * schedule, so this is not the only path -- it is the fast one. Without it a
 * new worker waits for the next scheduled run; with it the run starts as soon
 * as they save a profile worth embedding. Either way they can match
 * immediately, on keywords and location, marked 'degraded'.
 */

import { env } from './env';

const DISPATCH_EVENT = 'worker-profile-changed';

/**
 * Minimum gap between dispatches.
 *
 * The workflow embeds *everyone* whose stored hash is stale, not one named
 * worker, so ten profile saves in a minute need one run rather than ten. This
 * coalesces them. A save that arrives inside the window is still picked up:
 * the run it is coalesced into reads the table when it starts, which is after
 * the save committed, and the schedule is the backstop if it somehow is not.
 */
export const MIN_DISPATCH_INTERVAL_MS = 60_000;

let lastDispatchAt = 0;
let warnedUnconfigured = false;

/**
 * Whether enough time has passed since the last dispatch. Pure, so it can be
 * tested.
 *
 * `lastAt === 0` means "never dispatched" and is always allowed. Stating that
 * explicitly rather than relying on `now - 0` exceeding the interval: that
 * happens to hold for a real epoch timestamp, but it made the function's
 * correctness depend on the magnitude of the clock, which is not a property
 * worth depending on.
 */
export function shouldDispatch(now: number, lastAt: number): boolean {
  if (lastAt === 0) return true;
  return now - lastAt >= MIN_DISPATCH_INTERVAL_MS;
}

/** Only for tests: forgets the last dispatch time. */
export function resetDispatchWindow(): void {
  lastDispatchAt = 0;
  warnedUnconfigured = false;
}

/**
 * Whether a profile change is worth a run at all.
 *
 * A name, phone or avatar edit changes nothing the matcher reads, and
 * dispatching on it would spend a run to discover there is nothing to do.
 * Only the two fields profile_text is built from matter.
 */
export function affectsEmbedding(patch: Record<string, unknown>): boolean {
  return 'skills' in patch || 'bio' in patch;
}

/**
 * Asks the engine to embed one worker, now.
 *
 * This is the primary path. It replaced a GitHub Actions dispatch as the
 * default for an unglamorous reason: the workflow needs two repository
 * secrets that were never set, so it had never run once, and every new worker
 * was ranked on keywords alone -- labelled 'degraded' and visibly worse --
 * until somebody noticed and ran the backfill by hand.
 *
 * The engine releases the model immediately afterwards, so this does not
 * leave it sitting near its memory limit. See app/routers/embedding.py.
 *
 * Never awaited by a request handler: a worker saving their profile must not
 * wait on an encoder, and must not see an error if it is asleep.
 */
function askEngineToEmbed(workerId: string, reason: string): void {
  if (!env.aiEngineSecret) return;

  const controller = new AbortController();
  // Generous, because a sleeping free instance has to wake and then load a
  // model. Still bounded, because nothing is waiting on the answer and a
  // hung socket should not be held open indefinitely.
  const timer = setTimeout(() => controller.abort(), 120_000);

  void fetch(`${env.aiEngineUrl}/ai/embed-worker`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ayira-Key': env.aiEngineSecret },
    body: JSON.stringify({ worker_id: workerId }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        console.error(
          `Engine embed for ${workerId} returned ${response.status} (${reason}); ` +
            'the scheduled backfill will cover it.'
        );
        return;
      }
      const body = (await response.json().catch(() => null)) as
        | { embedded?: boolean; reason?: string }
        | null;
      console.info(
        `Engine embed for ${workerId}: ${body?.embedded ? 'embedded' : 'skipped'}` +
          `${body?.reason ? ` (${body.reason})` : ''}`
      );
    })
    .catch((error) => {
      const message = (error as Error).name === 'AbortError' ? 'timed out' : (error as Error).message;
      console.error(`Engine embed for ${workerId} failed: ${message}`);
    })
    .finally(() => clearTimeout(timer));
}

/**
 * Fires the GitHub Actions dispatch, if it is configured.
 *
 * Kept as a backstop rather than the primary path. A runner has gigabytes and
 * the engine has 512 MB, so the runner is the better place to do this -- it
 * is just not a place that works without the two repository secrets being
 * set. When they are, this covers anything the engine missed.
 */
function askGithubToEmbed(reason: string): void {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;        // "owner/name"

  if (!token || !repo) return;

  const now = Date.now();
  if (!shouldDispatch(now, lastDispatchAt)) return;
  lastDispatchAt = now;

  void fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ event_type: DISPATCH_EVENT, client_payload: { reason } }),
  })
    .then((response) => {
      if (!response.ok) {
        console.error(
          `Embedding dispatch returned ${response.status}; the scheduled run will cover it.`
        );
      }
    })
    .catch((error) => {
      console.error('Embedding dispatch failed:', (error as Error).message);
    });
}

/**
 * Gets a worker's profile embedded as soon as possible.
 *
 * Both paths are tried: the engine for immediacy, GitHub Actions when it is
 * configured. Both are idempotent -- each checks the stored hash before
 * loading anything -- so the overlap costs a read, not a recompute.
 *
 * Never throws, never awaited.
 */
export function requestWorkerEmbedding(reason: string, workerId?: string): void {
  if (workerId) askEngineToEmbed(workerId, reason);

  if (!process.env.GITHUB_DISPATCH_TOKEN || !process.env.GITHUB_REPO) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.info(
        'GITHUB_DISPATCH_TOKEN/GITHUB_REPO not set; relying on the engine to embed ' +
          'and on eval/backfill_worker_embeddings.py as the backstop.'
      );
    }
    return;
  }

  askGithubToEmbed(reason);
}

/**
 * Asks the engine to embed any gigs that have no vector.
 *
 * Called when a gig becomes visible to the matcher. A gig with no vector is
 * not retrievable by vector search at all, so without this a freshly
 * published gig is invisible to matching however well it fits -- and the
 * employer has no way to know.
 *
 * It used to happen inside the match request instead, which charged an
 * unrelated worker for the model load. Never awaited here either: publishing
 * a gig must not wait on an encoder.
 */
export function requestGigEmbedding(reason: string): void {
  if (!env.aiEngineSecret) return;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);

  void fetch(`${env.aiEngineUrl}/ai/embed-gigs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Ayira-Key': env.aiEngineSecret },
    body: JSON.stringify({ limit: 50 }),
    signal: controller.signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        console.error(`Engine gig embed returned ${response.status} (${reason}).`);
        return;
      }
      const body = (await response.json().catch(() => null)) as
        | { embedded?: number; remaining?: number }
        | null;
      console.info(
        `Engine gig embed (${reason}): ${body?.embedded ?? 0} embedded, ` +
          `${body?.remaining ?? 0} still waiting`
      );
    })
    .catch((error) => {
      const message =
        (error as Error).name === 'AbortError' ? 'timed out' : (error as Error).message;
      console.error(`Engine gig embed failed: ${message}`);
    })
    .finally(() => clearTimeout(timer));
}
