import { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'money';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-ayira-600 text-white shadow-card hover:bg-ayira-700 active:bg-ayira-800',
  secondary: 'bg-white text-slate-700 border border-slate-200 shadow-card hover:bg-slate-50 hover:border-slate-300',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
  danger: 'bg-white text-red-700 border border-red-200 hover:bg-red-50 hover:border-red-300',
  // Reserved for actions that move money, so they never look like an ordinary
  // primary action sitting next to them.
  money: 'bg-gold-600 text-white shadow-card hover:bg-gold-700 active:bg-gold-700',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-5 text-sm gap-2',
};

const BASE =
  'inline-flex items-center justify-center rounded-lg font-semibold transition-colors ' +
  'disabled:opacity-55 disabled:pointer-events-none select-none';

interface CommonProps {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
    >
      {loading ? <Loader2 size={16} className="animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

/** Same surface as Button, for navigation rather than an action. */
export function ButtonLink({
  to,
  variant = 'primary',
  size = 'md',
  icon,
  children,
  className = '',
}: CommonProps & { to: string }) {
  return (
    <Link to={to} className={`${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`}>
      {icon}
      {children}
    </Link>
  );
}
