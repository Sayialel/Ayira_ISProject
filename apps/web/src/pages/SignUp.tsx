import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import GoogleButton, { OrDivider } from '@/components/GoogleButton';
import type { UserRole } from '@/types';

/**
 * Creating an account, either with Google or with an email and a password.
 *
 * The role question comes first, above both routes in, because Google cannot
 * be asked it. Collecting it here means a Google sign-up lands with the right
 * role immediately instead of arriving as a worker and being asked afterwards.
 */
export default function SignUp() {
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

  const update = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

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
    } catch (err: any) {
      setError(err.message || 'Sign up failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-xl shadow-sm border p-6">
        <h2 className="text-2xl font-bold text-center mb-1">Join Ayira</h2>
        <p className="text-center text-sm text-gray-500 mb-5">
          First, which describes you?
        </p>
        {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}

        {/* Above both sign-up routes, because the Google one cannot ask it. */}
        <div className="mb-5 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          <RoleOption
            label="I'm looking for gigs"
            active={form.role === 'worker'}
            onClick={() => setForm(prev => ({ ...prev, role: 'worker' }))}
          />
          <RoleOption
            label="I'm hiring"
            active={form.role === 'employer'}
            onClick={() => setForm(prev => ({ ...prev, role: 'employer' }))}
          />
        </div>

        <GoogleButton label="Sign up with Google" role={form.role} />
        <OrDivider />

        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="Full Name" value={form.fullName} onChange={update('fullName')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required />
          <input type="email" placeholder="Email" value={form.email} onChange={update('email')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required />
          <input type="tel" placeholder="Phone (+254...)" value={form.phone} onChange={update('phone')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required />
          <input type="password" placeholder="Password (min 8 chars)" value={form.password} onChange={update('password')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required minLength={8} />
          <button type="submit" disabled={loading}
            className="w-full bg-ayira-600 text-white py-2 rounded-lg font-medium hover:bg-ayira-700 disabled:opacity-50">
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>
        <p className="text-center text-sm text-gray-500 mt-4">
          Already have an account? <Link to="/signin" className="text-ayira-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

/** One of the two account types, as a button rather than a select option. */
function RoleOption({
  label,
  active,
  onClick,
}: {
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
      className={`rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${
        active
          ? 'border-ayira-500 bg-ayira-50 text-ayira-700 ring-1 ring-ayira-200'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
      }`}
    >
      {label}
    </button>
  );
}
