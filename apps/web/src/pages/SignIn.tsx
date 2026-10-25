import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import GoogleButton, { OrDivider } from '@/components/GoogleButton';
import AuthShell, { authButton, authInput } from '@/components/AuthShell';
import { Spinner, usePageTitle } from '@/components/ui';

/**
 * Signing in.
 *
 * No role question here, deliberately. A returning account already has one,
 * and asking would invite someone to try to change it -- which
 * confirm_user_role refuses anyway. A brand-new account arriving by Google on
 * this page is still handled: RequireRole asks on the other side. See
 * App.tsx.
 */
export default function SignIn() {
  usePageTitle('Sign in to Ayira');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/app');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to see your gigs and payments."
      footer={
        <>
          New to Ayira?{' '}
          <Link to="/signup" className="font-semibold text-ayira-700 hover:underline">
            Create an account
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

      <GoogleButton label="Sign in with Google" />
      <OrDivider />

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div>
          <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authInput}
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="mb-1.5 block text-sm font-medium text-slate-700">
            Password
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={authInput}
            required
          />
        </div>

        <button type="submit" disabled={loading} className={authButton}>
          {loading && <Spinner />}
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthShell>
  );
}
