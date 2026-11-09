/**
 * A circular percentage indicator.
 *
 * Drawn with two SVG circles rather than a library: the arc is a dash offset
 * on the second circle, which is a few lines and animates for free.
 *
 * The value shown is always derived from real fields -- see profileCompletion
 * below. A ring that showed an invented number would be worse than no ring,
 * because it implies the system is measuring something it is not.
 */
export default function ProgressRing({
  value,
  size = 56,
  stroke = 5,
  label,
}: {
  /** 0-100. Clamped, so a bad caller cannot draw an arc past the circle. */
  value: number;
  size?: number;
  stroke?: number;
  label?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - pct / 100);

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `${pct}% complete`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-slate-200"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-ayira-600 transition-[stroke-dashoffset] duration-700 ease-out"
          strokeWidth={stroke}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-xs font-bold tabular-nums text-slate-700">
        {pct}%
      </span>
    </div>
  );
}

/** One thing a profile needs, and whether this profile has it. */
export interface CompletionItem {
  label: string;
  done: boolean;
  /** Where the person goes to fix it, when it is not done. */
  hint?: string;
}

/**
 * How complete a profile is, and precisely which parts are missing.
 *
 * Weighted by what the matcher actually reads. Skills and bio are the two
 * fields `profile_text` is built from, so a profile without them cannot be
 * matched on anything but luck.
 *
 * A photo is deliberately NOT counted. It contributes nothing to matching,
 * and counting it meant a worker who had filled in everything the matcher
 * uses still saw an incomplete ring and a checklist item telling them to fix
 * it -- which pointed them at the one field that would not change a single
 * result. `avatar_url` is still accepted in the argument so existing callers
 * need no change.
 *
 * Returns the checklist as well as the number, so the UI can say what is
 * missing instead of showing a percentage the person cannot act on.
 */
export function profileCompletion(profile: {
  full_name?: string | null;
  phone?: string | null;
  location?: string | null;
  bio?: string | null;
  skills?: string[] | null;
  avatar_url?: string | null;
}): { percent: number; items: CompletionItem[] } {
  const has = (v?: string | null) => Boolean(v && v.trim());

  const weighted: (CompletionItem & { weight: number })[] = [
    { label: 'Your name', done: has(profile.full_name), weight: 1 },
    { label: 'Phone number', done: has(profile.phone), weight: 1, hint: 'Needed for M-Pesa' },
    { label: 'Your town', done: has(profile.location), weight: 1, hint: 'Used to rank nearby gigs' },
    { label: 'About you', done: has(profile.bio), weight: 2, hint: 'The matcher reads this' },
    {
      label: 'Skills',
      done: (profile.skills?.length ?? 0) > 0,
      weight: 3,
      hint: 'The strongest matching signal',
    },
  ];

  const total = weighted.reduce((sum, i) => sum + i.weight, 0);
  const earned = weighted.reduce((sum, i) => sum + (i.done ? i.weight : 0), 0);

  return {
    percent: Math.round((earned / total) * 100),
    items: weighted.map(({ weight: _weight, ...item }) => item),
  };
}
