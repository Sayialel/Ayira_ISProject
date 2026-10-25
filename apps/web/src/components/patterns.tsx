/**
 * Kenyan textile patterns, as SVG.
 *
 * Drawn rather than photographed, so they scale, re-colour with the theme and
 * cost nothing to load. Each one is a real tradition rather than a generic
 * "ethnic" motif:
 *
 *   - ShukaWeave   the checked plaid of the Maasai shuka
 *   - BeadBand     Maasai beadwork, concentric triangles in a row
 *   - KikoyStripes the striped coastal cloth of the Kenyan coast
 *   - MudclothMark bogolanfini dots and bars, used as a quiet page texture
 *
 * All of them are decorative, so every one is aria-hidden and none carries
 * meaning a screen reader would need.
 */

/** A woven check, for section dividers and the hero underline. */
export function ShukaWeave({
  className = '',
  height = 10,
}: {
  className?: string;
  height?: number;
}) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        height,
        backgroundImage: `
          repeating-linear-gradient(90deg,
            var(--shuka-a) 0 16px,
            var(--shuka-b) 16px 24px,
            var(--shuka-a) 24px 32px,
            var(--shuka-c) 32px 48px)`,
      }}
    />
  );
}

/**
 * A band of Maasai beadwork triangles.
 *
 * `tone` picks the palette rather than taking raw colours, so a caller cannot
 * put the band outside the theme.
 */
export function BeadBand({
  className = '',
  tone = 'warm',
}: {
  className?: string;
  tone?: 'warm' | 'cool' | 'mono';
}) {
  const sets = {
    warm: ['#b8402a', '#cf8f22', '#faf8f5', '#4a6a3e'],
    cool: ['#42567b', '#cf8f22', '#faf8f5', '#b8402a'],
    mono: ['#443d33', '#a89c8a', '#faf8f5', '#5c5245'],
  } as const;
  const [a, b, c, d] = sets[tone];

  return (
    <svg
      aria-hidden
      className={className}
      width="100%"
      height="16"
      viewBox="0 0 96 16"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern id={`bead-${tone}`} width="24" height="16" patternUnits="userSpaceOnUse">
          <rect width="24" height="16" fill={c} />
          <path d="M0 16 L6 0 L12 16 Z" fill={a} />
          <path d="M12 16 L18 0 L24 16 Z" fill={b} />
          <path d="M6 16 L12 6 L18 16 Z" fill={d} opacity="0.85" />
        </pattern>
      </defs>
      <rect width="96" height="16" fill={`url(#bead-${tone})`} />
    </svg>
  );
}

/** Coastal kikoy stripes. Vertical, for sidebars and card edges. */
export function KikoyEdge({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={className}
      style={{
        backgroundImage: `repeating-linear-gradient(180deg,
          #b8402a 0 6px, #cf8f22 6px 10px, #42567b 10px 14px, #4a6a3e 14px 18px)`,
      }}
    />
  );
}

/**
 * A very low-contrast mudcloth texture for large empty areas.
 *
 * Kept under 4% opacity: a page background should be felt rather than seen,
 * and anything stronger competes with the text sitting on it.
 */
export function MudclothField({ className = '' }: { className?: string }) {
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60">
      <g fill="none" stroke="#1c1814" stroke-width="1.2">
        <path d="M0 15h60M0 45h60"/>
        <path d="M8 15v30M30 15v30M52 15v30" stroke-dasharray="3 6"/>
      </g>
      <g fill="#1c1814">
        <circle cx="15" cy="7" r="1.6"/><circle cx="45" cy="7" r="1.6"/>
        <circle cx="30" cy="30" r="1.6"/>
        <circle cx="15" cy="53" r="1.6"/><circle cx="45" cy="53" r="1.6"/>
      </g>
    </svg>`
  );

  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={{
        backgroundImage: `url("data:image/svg+xml,${svg}")`,
        backgroundSize: '60px 60px',
        opacity: 0.035,
      }}
    />
  );
}

/**
 * The Ayira mark: a stylised bead rosette.
 *
 * Four petals around a centre, which is the shape Maasai beadwork collars
 * make. It reads as a flower, a sun and a network of connections, all of which
 * suit a platform that joins people to work.
 */
export function AyiraMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      className={className}
      role="img"
      aria-label="Ayira"
    >
      <circle cx="16" cy="16" r="15" fill="#b8402a" />
      <g fill="#faf8f5">
        <ellipse cx="16" cy="8.5" rx="3.1" ry="4.6" />
        <ellipse cx="16" cy="23.5" rx="3.1" ry="4.6" />
        <ellipse cx="8.5" cy="16" rx="4.6" ry="3.1" />
        <ellipse cx="23.5" cy="16" rx="4.6" ry="3.1" />
      </g>
      <circle cx="16" cy="16" r="3.4" fill="#cf8f22" />
    </svg>
  );
}
