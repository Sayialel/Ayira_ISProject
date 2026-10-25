import { z } from 'zod';

/**
 * Validation for decisions that move money, kept apart from the route file.
 *
 * admin.ts imports the Supabase client, which needs credentials at import
 * time, so a test that wanted to check these rules would have to stand up the
 * whole gateway first. Separating them means the rules can be tested as rules.
 */

/** The three ways an administrator can settle a dispute. */
export const DISPUTE_OUTCOMES = ['released', 'refunded', 'partial_release'] as const;

export const resolveSchema = z
  .object({
    // Release pays the worker in full, refund returns everything to the
    // employer, and partial_release splits it -- which is what a dispute over
    // half-finished work actually needs.
    outcome: z.enum(DISPUTE_OUTCOMES),
    // Required, and written onto the escrow event. A decision that moves
    // someone's money should not be recordable without a reason attached.
    reason: z
      .string()
      .trim()
      .min(10, 'Give a reason of at least 10 characters')
      .max(1000),
    // What the worker is paid, for a split only. Whole shillings, matching the
    // funding side: a split is a figure that has to be payable over M-Pesa,
    // and M-Pesa cannot move cents. A 1000 escrow split in thirds therefore
    // settles at 333/667 rather than recording a 333.33 nobody can transfer.
    worker_amount: z
      .number()
      .int('Enter a whole number of shillings — M-Pesa cannot pay cents')
      .positive('The worker must be paid more than zero')
      .optional(),
  })
  .refine((v) => v.outcome !== 'partial_release' || v.worker_amount !== undefined, {
    message: 'A split needs the amount to pay the worker',
    path: ['worker_amount'],
  })
  // Rejected rather than ignored. Sending an amount with a full release or a
  // refund means the caller believes it will be honoured, and silently
  // dropping it is how someone ends up thinking they split an escrow they
  // actually released in full.
  .refine((v) => v.outcome === 'partial_release' || v.worker_amount === undefined, {
    message: 'An amount only applies to a split',
    path: ['worker_amount'],
  });

export type ResolveBody = z.infer<typeof resolveSchema>;
