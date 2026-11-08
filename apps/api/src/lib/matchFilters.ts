/**
 * Narrowing a ranked match list.
 *
 * Extracted from routes/matching.ts so it can be tested. The budget rules in
 * particular are not obvious, and getting them wrong hides work a worker
 * would have taken.
 *
 * Filters are applied AFTER the engine ranks, never before. NDCG@10 0.780 was
 * measured over the candidate pool the engine retrieves; pushing a filter
 * into retrieval would change that pool and the reported figure would stop
 * describing the deployed system. Filtering the ranked list leaves the
 * ranking, and so every rank-based metric, exactly as evaluated.
 */

export interface MatchFilters {
  category?: string;
  /** Substring, case-insensitive, matched against the gig's location. */
  location?: string;
  remote_only?: boolean;
  min_budget?: number;
  max_budget?: number;
}

export interface FilterableGig {
  category: string | null;
  location: string | null;
  is_remote: boolean;
  budget_min: number | null;
  budget_max: number | null;
}

/**
 * Whether a gig survives the caller's filters.
 *
 * Two decisions worth stating.
 *
 * Budget is compared against the gig's *range*, not a single figure. A gig
 * paying 5,000-15,000 satisfies "at least 10,000" because its ceiling does;
 * rejecting it on its floor would hide work the worker would take. The
 * mirror case holds for max_budget, which is read against the floor.
 *
 * A gig with no budget set is kept. Absent is not zero, and treating it as
 * zero would silently hide every gig an employer left open-ended -- which on
 * this platform is a lot of the informal work.
 *
 * A remote gig ignores the location filter: it has no commute to fail.
 */
export function passesFilters(gig: FilterableGig, filters: MatchFilters): boolean {
  if (filters.category && gig.category !== filters.category) return false;

  if (filters.remote_only && !gig.is_remote) return false;

  if (filters.location && !gig.is_remote) {
    const want = filters.location.toLowerCase();
    if (!(gig.location ?? '').toLowerCase().includes(want)) return false;
  }

  if (filters.min_budget !== undefined) {
    const ceiling = gig.budget_max ?? gig.budget_min;
    if (ceiling !== null && ceiling < filters.min_budget) return false;
  }

  if (filters.max_budget !== undefined) {
    const floor = gig.budget_min ?? gig.budget_max;
    if (floor !== null && floor > filters.max_budget) return false;
  }

  return true;
}
