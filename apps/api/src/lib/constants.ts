/**
 * Mirrors GIG_CATEGORIES in packages/shared. It is duplicated here rather than
 * imported because apps/api is deployed standalone (Railway root dir = apps/api),
 * so the workspace package is not present at build time.
 *
 * These names match the rows seeded into skill_categories by migration 009.
 */
export const GIG_CATEGORIES = [
  'Technology',
  'Writing',
  'Design',
  'Marketing',
  'Business',
] as const;

export type GigCategory = (typeof GIG_CATEGORIES)[number];

export const DEFAULT_CURRENCY = 'KES';
