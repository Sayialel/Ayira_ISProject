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
 * Fires the dispatch. Never throws and never awaited by a request handler:
 * a worker saving their profile must not wait on GitHub, and must not see an
 * error if GitHub is down. The schedule covers whatever this misses.
 */
export function requestWorkerEmbedding(reason: string): void {
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  const repo = process.env.GITHUB_REPO;        // "owner/name"

  if (!token || !repo) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.info(
        'GITHUB_DISPATCH_TOKEN/GITHUB_REPO not set; new worker embeddings will ' +
          'wait for the scheduled run rather than starting immediately.'
      );
    }
    return;
  }

  const now = Date.now();
  if (!shouldDispatch(now, lastDispatchAt)) return;
  lastDispatchAt = now;

  // Deliberately not awaited.
  void fetch(`https://api.github.com/repos/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: DISPATCH_EVENT,
      client_payload: { reason },
    }),
  })
    .then((response) => {
      if (!response.ok) {
        // 204 is success here. Anything else is worth seeing in the log, but
        // is not the worker's problem.
        console.error(
          `Embedding dispatch returned ${response.status}; the scheduled run will cover it.`
        );
      }
    })
    .catch((error) => {
      console.error('Embedding dispatch failed:', (error as Error).message);
    });
}
