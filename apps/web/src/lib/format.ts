/** Display helpers shared across pages. */

export function formatCurrency(amount: number | null | undefined, currency = 'KES'): string {
  if (amount === null || amount === undefined) return '—';
  return new Intl.NumberFormat('en-KE', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatBudgetRange(
  min: number | null,
  max: number | null,
  currency = 'KES'
): string {
  if (min === null && max === null) return 'Budget not set';
  if (min !== null && max !== null) {
    if (min === max) return formatCurrency(min, currency);
    return `${formatCurrency(min, currency)} – ${formatCurrency(max, currency)}`;
  }
  return formatCurrency(min ?? max, currency);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** "in 3 days" / "2 days ago" — used for deadlines and application dates. */
export function formatRelative(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = date.getTime() - Date.now();
  const diffDays = Math.round(diffMs / 86_400_000);

  if (Math.abs(diffDays) >= 30) return formatDate(value);
  if (diffDays === 0) return 'today';

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  return rtf.format(diffDays, 'day');
}

export function isPastDeadline(deadline: string | null): boolean {
  if (!deadline) return false;
  return new Date(deadline).getTime() < Date.now();
}

/** Turns a name into initials for the avatar fallback. */
export function initialsOf(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

/** Formats a 0–1 match score as a whole percentage. */
export function toPercent(score: number): number {
  return Math.round(Math.max(0, Math.min(1, score)) * 100);
}
