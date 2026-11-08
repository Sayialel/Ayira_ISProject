/**
 * Writes notifications.
 *
 * Always with the service role, never the caller's client. The notifications
 * table has no INSERT policy at all (migration 025), which is deliberate: a
 * notification is a claim about something the server observed, and a client
 * able to insert its own could fabricate "your escrow has been released".
 *
 * Nothing here is awaited by a request handler. A notification is a courtesy
 * on top of an action that has already succeeded -- the application really was
 * shortlisted, the escrow really was funded -- so a failure to announce it
 * must not turn a successful request into an error the user sees. Failures are
 * logged and dropped.
 */

import { supabaseAdmin } from './supabase';

/**
 * The kinds of notification the system can raise.
 *
 * A closed set rather than free strings so the UI can switch on it for an
 * icon and a destination, and so a typo becomes a compile error rather than a
 * notification nobody ever renders.
 */
export type NotificationType =
  | 'application_received'
  | 'application_shortlisted'
  | 'application_accepted'
  | 'application_rejected'
  | 'escrow_funded'
  | 'escrow_released'
  | 'escrow_disputed'
  | 'review_received'
  | 'message_received';

export interface NotificationInput {
  /** Who should see it. */
  userId: string;
  type: NotificationType;
  /** One line, shown in the dropdown. */
  title: string;
  /** Optional detail. */
  body?: string | null;
  /**
   * Where clicking it should go, plus anything the row needs to outlive the
   * thing it points at. Kept small: this is a pointer, not a copy of the gig.
   */
  data?: Record<string, unknown>;
}

/**
 * Raises one notification. Fire-and-forget: never awaited, never throws.
 */
export function notify(input: NotificationInput): void {
  void supabaseAdmin
    .from('notifications')
    .insert({
      user_id: input.userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      data: input.data ?? {},
    })
    .then(({ error }) => {
      if (error) {
        console.error(`Could not raise ${input.type} for ${input.userId}:`, error.message);
      }
    });
}

/**
 * Raises several at once, in one round trip.
 *
 * Used where one action concerns both parties -- a dispute is raised by one of
 * them and matters to the other -- so they are not two sequential inserts on
 * the request path.
 */
export function notifyMany(inputs: NotificationInput[]): void {
  if (inputs.length === 0) return;

  void supabaseAdmin
    .from('notifications')
    .insert(
      inputs.map((input) => ({
        user_id: input.userId,
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        data: input.data ?? {},
      }))
    )
    .then(({ error }) => {
      if (error) {
        console.error('Could not raise a batch of notifications:', error.message);
      }
    });
}
