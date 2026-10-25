import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Briefcase, HardHat } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import GoogleButton, { OrDivider } from '@/components/GoogleButton';
import AuthShell, { authButton, authInput } from '@/components/AuthShell';
import { Spinner, usePageTitle } from '@/components/ui';
import type { UserRole } from '@/types';

/**
 * Creating an account, either with Google or with an email and a password.
 *
 * The role question comes first, above both routes in, because Google cannot
 * be asked it. Collecting it here means a Google sign-up lands with the right
 * role immediately instead of arriving as a worker and being asked afterwards.
 * GoogleButton carries the choice across the redirect; see lib/pendingRole.
 */
export default function SignUp() {
  usePageTitle('Join Ayira');

  const [form, setForm] = useState<{
    email: string;
    password: string;
    fullName: string;
    phone: string;
    role: UserRole;
  }>({ email: '', password: '', fullName: '', phone: '', role: 'worker' });

  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const navigate = useNavigate();

  const update =
    (field: 'email' | 'password' | 'fullName' | 'phone') =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signUp(form.email, form.password, {
        full_name: form.fullName,
        phone: form.phone,
        role: form.role,
      });
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Join Ayira"
      subtitle="First, which describes you?"
      footer={
        <>
          Already have an account?{' '}
          <Link to="/signin" className="font-semibold text-ayira-700 hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg border border-ayira-200 bg-ayira-50 px-3 py-2 text-sm text-ayira-800"
        >
          {error}
        </p>
      )}

      {/* Above both sign-up routes, because the Google one cannot ask it. */}
      <div className="mb-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
        <RoleOption
          icon={<HardHat size={17} aria-hidden />}
          label="Looking for gigs"
          active={form.role === 'worker'}
          onClick={() => setForm((prev) => ({ ...prev, role: 'worker' }))}
        />
        <RoleOption
          icon={<Briefcase size={17} aria-hidden />}
          label="I'm hiring"
          active={form.role === 'employer'}
          onClick={() => setForm((prev) => ({ ...prev, role: 'employer' }))}
        />
      </div>

      <GoogleButton label="Sign up with Google" role={form.role} />
      <OrDivider />

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">
            Full name
          </label>
          <input
            id="fullName"
            type="text"
            autoComplete="name"
            placeholder="Your name"
            value={form.fullName}
            onChange={update('fullName')}
            className={authInput}
            required
          />
        </div>

        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={form.email}
            onChange={update('email')}
            className={authInput}
            required
          />
        </div>

        <div>
          <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700">
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            autoComplete="tel"
            placeholder="07XX XXX XXX"
            value={form.phone}
            onChange={update('phone')}
            className={authInput}
            required
          />
          <p className="mt-1 text-xs text-slate-400">
            Used for M-Pesa. Kenyan numbers in any format.
          </p>
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={form.password}
            onChange={update('password')}
            className={authInput}
            required
            minLength={8}
          />
        </div>

        <button type="submit" disabled={loading} className={authButton}>
          {loading && <Spinner />}
          {loading ? 'Creating account…' : 'Create account'}
        </button>
      </form>
    </AuthShell>
  );
}

/** One of the two account types, as a button rather than a select option. */
function RoleOption({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="radio"
      aria-checked={active}
      className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-semibold transition-all ${
        active
          ? 'border-ayira-500 bg-ayira-50 text-ayira-700 ring-1 ring-ayira-200'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
      }`}
    >
      <span className={active ? 'text-ayira-600' : 'text-slate-400'}>{icon}</span>
      {label}
    </button>
  );
}
