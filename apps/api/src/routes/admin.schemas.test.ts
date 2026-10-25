import { describe, it, expect } from 'vitest';
import { resolveSchema } from './admin.schemas';

/**
 * The validation in front of a dispute settlement.
 *
 * This is the last check before transition_escrow moves someone's money, and
 * the amount rules here are the ones a careless caller would get wrong: the
 * database refuses a split that pays everything or nothing, and these refuse
 * it earlier with a message that says why.
 */

const REASON = 'The work was delivered late but usable.';

function parse(body: unknown) {
  return resolveSchema.safeParse(body);
}

/** Every message a failed parse produced, flattened for easy assertion. */
function messages(result: ReturnType<typeof parse>): string {
  return result.success ? '' : result.error.issues.map((i) => i.message).join(' | ');
}

describe('outcome', () => {
  it.each(['released', 'refunded', 'partial_release'])('accepts %s', (outcome) => {
    const body =
      outcome === 'partial_release'
        ? { outcome, reason: REASON, worker_amount: 400 }
        : { outcome, reason: REASON };
    expect(parse(body).success).toBe(true);
  });

  it.each(['cancelled', 'disputed', 'funded', 'pending', 'PARTIAL_RELEASE', ''])(
    'rejects %s, which is not a settlement',
    (outcome) => {
      expect(parse({ outcome, reason: REASON }).success).toBe(false);
    }
  );

  it('rejects a missing outcome', () => {
    expect(parse({ reason: REASON }).success).toBe(false);
  });
});

describe('reason', () => {
  it('requires at least ten characters', () => {
    const result = parse({ outcome: 'released', reason: 'too short' });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(/at least 10 characters/);
  });

  it('counts the trimmed length, not the padding', () => {
    // '   ok   ' is eight characters of whitespace around two of substance.
    // Without the trim this would pass the minimum on spaces alone.
    const result = parse({ outcome: 'released', reason: '          ok          ' });
    expect(result.success).toBe(false);
  });

  it('rejects a missing reason', () => {
    expect(parse({ outcome: 'refunded' }).success).toBe(false);
  });

  it('rejects one over a thousand characters', () => {
    expect(parse({ outcome: 'refunded', reason: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('accepts one at exactly a thousand', () => {
    expect(parse({ outcome: 'refunded', reason: 'x'.repeat(1000) }).success).toBe(true);
  });
});

describe('worker_amount', () => {
  it('is required for a split', () => {
    const result = parse({ outcome: 'partial_release', reason: REASON });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(/needs the amount/);
  });

  /**
   * Rejected rather than ignored. A caller who sends an amount believes it
   * will be honoured, and quietly dropping it is how someone ends up thinking
   * they split an escrow they actually released in full.
   */
  it.each(['released', 'refunded'])('is refused on a %s', (outcome) => {
    const result = parse({ outcome, reason: REASON, worker_amount: 500 });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(/only applies to a split/);
  });

  it('must be a whole number of shillings', () => {
    const result = parse({ outcome: 'partial_release', reason: REASON, worker_amount: 333.33 });
    expect(result.success).toBe(false);
    expect(messages(result)).toMatch(/whole number of shillings/);
  });

  it.each([0, -1, -500])('rejects %s', (worker_amount) => {
    expect(parse({ outcome: 'partial_release', reason: REASON, worker_amount }).success).toBe(
      false
    );
  });

  it('accepts a single shilling', () => {
    expect(
      parse({ outcome: 'partial_release', reason: REASON, worker_amount: 1 }).success
    ).toBe(true);
  });

  it.each(['400', null, true, [], {}])('rejects the non-number %s', (worker_amount) => {
    expect(parse({ outcome: 'partial_release', reason: REASON, worker_amount }).success).toBe(
      false
    );
  });

  it('leaves the upper bound to the database', () => {
    // There is no escrow in scope here, so "less than the amount funded"
    // cannot be checked. transition_escrow owns that rule and raises
    // 'Paying the worker the full % is a release, not a split'.
    expect(
      parse({ outcome: 'partial_release', reason: REASON, worker_amount: 9_999_999 }).success
    ).toBe(true);
  });
});
