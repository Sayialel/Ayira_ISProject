import { describe, it, expect } from 'vitest';
import { foldThreads, type FoldableMessage } from './threads';

/**
 * The case worth pinning down is an employer with several applicants on one
 * gig. Keying a conversation on the gig alone would merge them, which would
 * show each worker the others' messages -- a privacy failure that the RLS
 * policy would not catch, because every one of those rows is legitimately
 * readable by the employer.
 */

const EMPLOYER = 'e0000000-0000-0000-0000-000000000001';
const WORKER_A = 'a0000000-0000-0000-0000-00000000000a';
const WORKER_B = 'b0000000-0000-0000-0000-00000000000b';
const GIG = 'g0000000-0000-0000-0000-000000000011';
const OTHER_GIG = 'g0000000-0000-0000-0000-000000000022';

function msg(over: Partial<FoldableMessage> = {}): FoldableMessage {
  return {
    gig_id: GIG,
    sender_id: WORKER_A,
    receiver_id: EMPLOYER,
    content: 'hello',
    is_read: false,
    created_at: '2026-11-08T10:00:00Z',
    ...over,
  };
}

describe('foldThreads', () => {
  it('returns nothing for no messages', () => {
    expect(foldThreads([], EMPLOYER)).toEqual([]);
  });

  it('keeps two applicants on one gig as separate conversations', () => {
    const rows = [
      msg({ sender_id: WORKER_B, created_at: '2026-11-08T12:00:00Z', content: 'from B' }),
      msg({ sender_id: WORKER_A, created_at: '2026-11-08T11:00:00Z', content: 'from A' }),
    ];

    const threads = foldThreads(rows, EMPLOYER);

    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.other_id)).toEqual([WORKER_B, WORKER_A]);
    expect(threads.map((t) => t.last_message)).toEqual(['from B', 'from A']);
  });

  it('separates the same counterparty on different gigs', () => {
    const rows = [
      msg({ gig_id: OTHER_GIG, created_at: '2026-11-08T12:00:00Z' }),
      msg({ gig_id: GIG, created_at: '2026-11-08T11:00:00Z' }),
    ];
    expect(foldThreads(rows, EMPLOYER)).toHaveLength(2);
  });

  it('takes the first row seen as the latest message', () => {
    // The input contract is newest-first; the fold must not re-derive it.
    const rows = [
      msg({ content: 'newest', created_at: '2026-11-08T12:00:00Z' }),
      msg({ content: 'older', created_at: '2026-11-08T09:00:00Z' }),
    ];

    const [thread] = foldThreads(rows, EMPLOYER);
    expect(thread.last_message).toBe('newest');
    expect(thread.last_at).toBe('2026-11-08T12:00:00Z');
  });

  it('counts only inbound unread messages', () => {
    const rows = [
      msg({ is_read: false }),                                      // to me, unread
      msg({ is_read: false, created_at: '2026-11-08T09:30:00Z' }),  // to me, unread
      msg({ is_read: true, created_at: '2026-11-08T09:00:00Z' }),   // to me, read
      // Sent by me and somehow flagged unread: it is the recipient's flag,
      // not mine, so it must not land in my badge.
      msg({
        sender_id: EMPLOYER,
        receiver_id: WORKER_A,
        is_read: false,
        created_at: '2026-11-08T08:00:00Z',
      }),
    ];

    const [thread] = foldThreads(rows, EMPLOYER);
    expect(thread.unread).toBe(2);
  });

  it('identifies the counterparty from whichever side the caller is on', () => {
    const inbound = foldThreads([msg()], EMPLOYER);
    expect(inbound[0].other_id).toBe(WORKER_A);
    expect(inbound[0].last_from_me).toBe(false);

    // The same row read by the other party.
    const outbound = foldThreads([msg()], WORKER_A);
    expect(outbound[0].other_id).toBe(EMPLOYER);
    expect(outbound[0].last_from_me).toBe(true);
  });

  it('sorts conversations newest first even when rows interleave', () => {
    // A quiet conversation's only message can appear after a busy one's
    // older messages, so first-seen order is not newest-first.
    const rows = [
      msg({ sender_id: WORKER_A, created_at: '2026-11-08T10:00:00Z' }),
      msg({ sender_id: WORKER_A, created_at: '2026-11-08T09:00:00Z' }),
      msg({ sender_id: WORKER_B, created_at: '2026-11-08T08:00:00Z' }),
    ];

    const threads = foldThreads(rows, EMPLOYER);
    expect(threads.map((t) => t.other_id)).toEqual([WORKER_A, WORKER_B]);
  });

  it('does not let one conversation\'s unread count leak into another', () => {
    const rows = [
      msg({ sender_id: WORKER_A, is_read: false }),
      msg({ sender_id: WORKER_A, is_read: false, created_at: '2026-11-08T09:00:00Z' }),
      msg({ sender_id: WORKER_B, is_read: true, created_at: '2026-11-08T08:00:00Z' }),
    ];

    const byOther = new Map(foldThreads(rows, EMPLOYER).map((t) => [t.other_id, t.unread]));
    expect(byOther.get(WORKER_A)).toBe(2);
    expect(byOther.get(WORKER_B)).toBe(0);
  });
});
