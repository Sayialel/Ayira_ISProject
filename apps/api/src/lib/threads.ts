/**
 * Folds a flat list of messages into conversations.
 *
 * Extracted from routes/messages.ts so it can be tested. The route reads the
 * caller's visible messages newest-first and this turns them into one entry
 * per conversation, with the latest message and the unread count.
 *
 * A conversation is (gig, counterparty), not (gig). An employer with three
 * applicants on one gig is having three separate conversations about it, and
 * each worker must see only their own.
 */

export interface FoldableMessage {
  gig_id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  is_read: boolean;
  created_at: string;
}

export interface FoldedThread {
  gig_id: string;
  other_id: string;
  last_message: string;
  last_at: string;
  /** So the list can render "You: …" without comparing ids in the view. */
  last_from_me: boolean;
  unread: number;
}

/**
 * @param rows  the caller's messages, **newest first**. The order is the
 *              contract: the first row seen for a conversation is taken as
 *              its latest message, so passing them oldest-first would show
 *              the wrong preview.
 * @param userId the caller, which decides who the counterparty is on each row
 *              and which messages count as unread.
 */
export function foldThreads(rows: FoldableMessage[], userId: string): FoldedThread[] {
  const threads = new Map<string, FoldedThread>();

  for (const row of rows) {
    const fromMe = row.sender_id === userId;
    const otherId = fromMe ? row.receiver_id : row.sender_id;
    const key = `${row.gig_id}:${otherId}`;

    const existing = threads.get(key);
    const thread: FoldedThread = existing ?? {
      gig_id: row.gig_id,
      other_id: otherId,
      last_message: row.content,
      last_at: row.created_at,
      last_from_me: fromMe,
      unread: 0,
    };
    if (!existing) threads.set(key, thread);

    // Unread means addressed to the caller and not yet opened. A message the
    // caller sent is never unread for them, however the column reads.
    if (!fromMe && !row.is_read) thread.unread += 1;
  }

  // Sorted here rather than relying on the input order, because the Map
  // preserves first-seen order and a later conversation can be discovered
  // after an earlier one when rows interleave.
  return [...threads.values()].sort((a, b) => b.last_at.localeCompare(a.last_at));
}
