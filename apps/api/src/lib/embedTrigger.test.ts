import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  affectsEmbedding,
  shouldDispatch,
  requestWorkerEmbedding,
  resetDispatchWindow,
  MIN_DISPATCH_INTERVAL_MS,
} from './embedTrigger';

describe('affectsEmbedding', () => {
  // profile_text is built from skills and bio alone, so only those two can
  // change what the matcher would compute.
  it.each(['skills', 'bio'])('is true when %s changed', (field) => {
    expect(affectsEmbedding({ [field]: 'anything' })).toBe(true);
  });

  it.each(['full_name', 'phone', 'avatar_url', 'location'])(
    'is false when only %s changed',
    (field) => {
      expect(affectsEmbedding({ [field]: 'anything' })).toBe(false);
    }
  );

  it('is true when an embedding field is cleared, not just set', () => {
    // Emptying a bio changes the text as much as writing one, and the stored
    // vector is then stale in exactly the same way.
    expect(affectsEmbedding({ bio: '' })).toBe(true);
    expect(affectsEmbedding({ skills: [] })).toBe(true);
  });

  it('is false for an empty patch', () => {
    expect(affectsEmbedding({})).toBe(false);
  });
});

describe('shouldDispatch', () => {
  it('allows the first dispatch whatever the clock reads', () => {
    // 0 is the "never dispatched" sentinel, so this must not depend on `now`
    // being a large epoch value.
    expect(shouldDispatch(1_000, 0)).toBe(true);
    expect(shouldDispatch(Date.now(), 0)).toBe(true);
  });

  it('refuses a second dispatch inside the window', () => {
    expect(shouldDispatch(5_000, 1_000)).toBe(false);
  });

  it('allows one exactly at the boundary', () => {
    expect(shouldDispatch(MIN_DISPATCH_INTERVAL_MS, 0)).toBe(true);
  });

  it('allows one after the window', () => {
    expect(shouldDispatch(MIN_DISPATCH_INTERVAL_MS + 1, 0)).toBe(true);
  });
});

describe('requestWorkerEmbedding', () => {
  const saved = { token: process.env.GITHUB_DISPATCH_TOKEN, repo: process.env.GITHUB_REPO };

  beforeEach(() => {
    resetDispatchWindow();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    if (saved.token === undefined) delete process.env.GITHUB_DISPATCH_TOKEN;
    else process.env.GITHUB_DISPATCH_TOKEN = saved.token;
    if (saved.repo === undefined) delete process.env.GITHUB_REPO;
    else process.env.GITHUB_REPO = saved.repo;
  });

  it('does nothing when unconfigured', () => {
    delete process.env.GITHUB_DISPATCH_TOKEN;
    delete process.env.GITHUB_REPO;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.spyOn(console, 'info').mockImplementation(() => {});

    requestWorkerEmbedding('test');

    // The scheduled run is the fallback; a missing token must not be an error.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('posts a repository_dispatch when configured', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'tok';
    process.env.GITHUB_REPO = 'owner/repo';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    requestWorkerEmbedding('profile saved');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/owner/repo/dispatches');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body));
    expect(body.event_type).toBe('worker-profile-changed');
    expect(body.client_payload.reason).toBe('profile saved');
  });

  it('coalesces a burst into one dispatch', () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'tok';
    process.env.GITHUB_REPO = 'owner/repo';
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));

    // The workflow embeds everyone stale, so five saves need one run.
    for (let i = 0; i < 5; i += 1) requestWorkerEmbedding(`save ${i}`);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not throw when GitHub rejects the call', async () => {
    process.env.GITHUB_DISPATCH_TOKEN = 'tok';
    process.env.GITHUB_REPO = 'owner/repo';
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => requestWorkerEmbedding('test')).not.toThrow();

    // The rejection is handled on the promise, so let the microtask run.
    await new Promise((resolve) => setImmediate(resolve));
    expect(errorSpy).toHaveBeenCalled();
  });
});
