import { describe, it, expect } from 'vitest';
import { passesFilters, type FilterableGig } from './matchFilters';

/**
 * The budget rules are the ones worth pinning down. Comparing a worker's
 * minimum against a gig's *floor* rather than its ceiling would hide work
 * they would have taken, and treating an unset budget as zero would hide
 * every open-ended gig -- which on this platform is much of the informal
 * work.
 */

function gig(over: Partial<FilterableGig> = {}): FilterableGig {
  return {
    category: 'Technology',
    location: 'Nairobi',
    is_remote: false,
    budget_min: 5000,
    budget_max: 15000,
    ...over,
  };
}

describe('no filters', () => {
  it('keeps everything', () => {
    expect(passesFilters(gig(), {})).toBe(true);
    expect(passesFilters(gig({ budget_min: null, budget_max: null }), {})).toBe(true);
  });
});

describe('category', () => {
  it('matches exactly', () => {
    expect(passesFilters(gig(), { category: 'Technology' })).toBe(true);
    expect(passesFilters(gig(), { category: 'Design' })).toBe(false);
  });

  it('rejects a gig with no category when one is asked for', () => {
    expect(passesFilters(gig({ category: null }), { category: 'Technology' })).toBe(false);
  });
});

describe('location', () => {
  it('matches a substring, case-insensitively', () => {
    expect(passesFilters(gig({ location: 'Nairobi, Kenya' }), { location: 'nairobi' })).toBe(true);
    expect(passesFilters(gig({ location: 'Mombasa' }), { location: 'nairobi' })).toBe(false);
  });

  it('does not apply to a remote gig', () => {
    // A remote gig has no commute to fail, so filtering it out by town would
    // hide exactly the work that is most accessible.
    expect(
      passesFilters(gig({ is_remote: true, location: null }), { location: 'Nairobi' })
    ).toBe(true);
  });

  it('rejects an on-site gig with no location set', () => {
    expect(passesFilters(gig({ location: null }), { location: 'Nairobi' })).toBe(false);
  });
});

describe('remote_only', () => {
  it('keeps only remote gigs', () => {
    expect(passesFilters(gig({ is_remote: true }), { remote_only: true })).toBe(true);
    expect(passesFilters(gig({ is_remote: false }), { remote_only: true })).toBe(false);
  });

  it('false is not a filter', () => {
    expect(passesFilters(gig({ is_remote: false }), { remote_only: false })).toBe(true);
  });
});

describe('min_budget', () => {
  it('is satisfied by the gig ceiling, not its floor', () => {
    // 5,000-15,000 against "at least 10,000": the ceiling clears it, so the
    // gig is worth showing. Comparing the floor would reject it.
    expect(passesFilters(gig({ budget_min: 5000, budget_max: 15000 }), { min_budget: 10000 })).toBe(
      true
    );
  });

  it('rejects a gig whose ceiling is below the minimum', () => {
    expect(passesFilters(gig({ budget_min: 1000, budget_max: 3000 }), { min_budget: 10000 })).toBe(
      false
    );
  });

  it('falls back to budget_min when there is no ceiling', () => {
    expect(passesFilters(gig({ budget_min: 20000, budget_max: null }), { min_budget: 10000 })).toBe(
      true
    );
    expect(passesFilters(gig({ budget_min: 2000, budget_max: null }), { min_budget: 10000 })).toBe(
      false
    );
  });

  it('keeps a gig with no budget at all', () => {
    // Absent is not zero. Dropping these would hide every open-ended gig.
    expect(
      passesFilters(gig({ budget_min: null, budget_max: null }), { min_budget: 10000 })
    ).toBe(true);
  });

  it('treats an exact match as passing', () => {
    expect(passesFilters(gig({ budget_min: 10000, budget_max: 10000 }), { min_budget: 10000 })).toBe(
      true
    );
  });
});

describe('max_budget', () => {
  it('is satisfied by the gig floor, not its ceiling', () => {
    expect(passesFilters(gig({ budget_min: 5000, budget_max: 50000 }), { max_budget: 10000 })).toBe(
      true
    );
  });

  it('rejects a gig whose floor is above the maximum', () => {
    expect(passesFilters(gig({ budget_min: 30000, budget_max: 50000 }), { max_budget: 10000 })).toBe(
      false
    );
  });

  it('keeps a gig with no budget at all', () => {
    expect(passesFilters(gig({ budget_min: null, budget_max: null }), { max_budget: 10000 })).toBe(
      true
    );
  });
});

describe('combinations', () => {
  it('requires every filter to pass', () => {
    const remoteTech = gig({ is_remote: true, category: 'Technology', budget_max: 40000 });
    expect(
      passesFilters(remoteTech, { category: 'Technology', remote_only: true, min_budget: 20000 })
    ).toBe(true);
    expect(
      passesFilters(remoteTech, { category: 'Design', remote_only: true, min_budget: 20000 })
    ).toBe(false);
  });

  it('accepts a budget band', () => {
    const g = gig({ budget_min: 8000, budget_max: 12000 });
    expect(passesFilters(g, { min_budget: 5000, max_budget: 15000 })).toBe(true);
    expect(passesFilters(g, { min_budget: 20000, max_budget: 30000 })).toBe(false);
  });
});
