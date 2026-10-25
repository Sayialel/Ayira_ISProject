import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { AyiraMark, BeadBand, MudclothField } from '@/components/patterns';

/**
 * The frame around signing in and signing up.
 *
 * Both pages were a bare card on a grey field, which made the jump from the
 * landing page feel like arriving at a different product. Sharing one shell
 * keeps the theme continuous and means the two pages cannot drift apart.
 *
 * The beadwork band is at the top of the card rather than the page, so it
 * still reads as part of Ayira on a phone where the card fills the screen.
 */
export default function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-ayira-50/60 via-slate-50 to-slate-50 px-4 py-10">
      <MudclothField />

      <Link
        to="/"
        className="relative mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
      >
        <ArrowLeft size={15} aria-hidden />
        Back to Ayira
      </Link>

      <div className="relative w-full max-w-sm animate-scale-in overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-pop">
        <BeadBand tone="warm" />

        <div className="p-6 sm:p-7">
          <div className="mb-6 text-center">
            <AyiraMark size={38} className="mx-auto" />
            <h1 className="mt-3 font-display text-2xl font-bold tracking-tight text-slate-900">
              {title}
            </h1>
            {subtitle && <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p>}
          </div>

          {children}
        </div>
      </div>

      {footer && <div className="relative mt-5 text-center text-sm text-slate-500">{footer}</div>}
    </div>
  );
}

/** One input style for both auth forms, so they cannot drift apart. */
export const authInput =
  'w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-ayira-400 focus:outline-none focus:ring-2 focus:ring-ayira-100';

/** The primary submit button, matching the landing page's call to action. */
export const authButton =
  'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all hover:bg-ayira-700 hover:shadow-lift active:scale-[0.99] disabled:opacity-60 disabled:hover:shadow-sm';
