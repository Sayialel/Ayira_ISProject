import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function SignUp() {
  const [form, setForm] = useState({ email: '', password: '', fullName: '', phone: '', role: 'worker' });
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
        <h2 className="text-2xl font-bold text-center mb-6">Join Ayira</h2>
        {error && <p className="text-red-500 text-sm mb-4 text-center">{error}</p>}
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="text" placeholder="Full Name" value={form.fullName} onChange={update('fullName')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required />
          <input type="email" placeholder="Email" value={form.email} onChange={update('email')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required />
          <input type="tel" placeholder="Phone (+254...)" value={form.phone} onChange={update('phone')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required />
          <input type="password" placeholder="Password (min 8 chars)" value={form.password} onChange={update('password')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500" required minLength={8} />
          <select value={form.role} onChange={update('role')}
            className="w-full border rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-ayira-500">
            <option value="worker">I'm looking for gigs (Worker)</option>
            <option value="employer">I'm hiring (Employer)</option>
          </select>
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
