// Shared constants and types for Ayira
export const GIG_CATEGORIES = [
  'Technology', 'Writing', 'Design', 'Marketing', 'Business',
] as const;

export type GigCategory = typeof GIG_CATEGORIES[number];

export const APP_NAME = 'Ayira';
export const DEFAULT_CURRENCY = 'KES';
