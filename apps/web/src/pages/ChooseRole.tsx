import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Briefcase, HardHat } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { apiFetch } from '@/lib/api';
import { useToast } from '@/components/Toast';
import { Spinner, usePageTitle } from '@/components/ui';
import type { UserRole } from '@/types';

/**
 * Asks an OAuth signup which side of the platform they are on.
 *
 * Google tells us a name and an email and nothing else, so the account lands
 * as a worker by default with role_confirmed false. Without this step an
 * employer would silently become a worker and could not fix it themselves:
 * protect_user_privileges reverts role changes from anyone but the server.
 *
 * Shown once. confirm_user_role refuses a second attempt, so this is a real
 * decision rather than a setting.
 */
export default function ChooseRole({ onChosen }: { onChosen: () => void }) {
  usePageTitle('Welcome to Ayira');

  const { user } = useAuth();
  const [choice, setChoice] = useState<UserRole | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  const name = (user?.user_metadata?.full_name ||
    user?.user_metadata?.name ||
    '') as string;

  async function save() {
    if (!choice) return;
    setBusy(true);
    try {
      await apiFetch('/auth/role', {
        method: 'POST',
        body: JSON.stringify({ role: choice }),
      });
      // The role lives on the token's metadata as well as the users row, and
      // the session was minted before the choice. Refreshing it means the
      // navigation and route guards see the new role straight away instead of
      // after the next sign-in.
      await import('@/lib/supabase').then(({ supabase }) => supabase.auth.refreshSession());
      toast.success(
        choice === 'employer' ? 'You can now post gigs.' : 'You can now apply for gigs.'
      );
      onChosen();
      navigate('/app', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save your choice');
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-bold">
        Welcome{name ? `, ${name.split(' ')[0]}` : ''}
      </h1>
      <p className="mb-6 mt-1 text-sm text-slate-500">
        One question before you start. You can only answer it once, so pick the
        one that describes you.
      </p>

      <div className="space-y-3">
        <RoleCard
          icon={<HardHat size={20} />}
          title="I'm looking for work"
          description="Browse gigs, get matched to work that fits your skills, and apply."
          active={choice === 'worker'}
          onClick={() => setChoice('worker')}
        />
        <RoleCard
          icon={<Briefcase size={20} />}
          title="I'm hiring"
          description="Post gigs, review applicants, and pay through escrow."
          active={choice === 'employer'}
          onClick={() => setChoice('employer')}
        />
      </div>

      <button
        type="button"
        onClick={save}
        disabled={!choice || busy}
        className="mt-6 inline-flex items-center justify-center gap-2 rounded-lg bg-ayira-600 px-4 py-2.5 text-sm font-semibold text-white shadow-card transition-all duration-150 hover:bg-ayira-700 hover:shadow-lift active:scale-[0.98] disabled:pointer-events-none disabled:opacity-55"
      >
        {busy && <Spinner />}
        Continue
      </button>

      <p className="mt-4 text-xs text-slate-400">
        Changing this later needs an administrator, so it is worth getting right
        now.
      </p>
    </div>
  );
}

function RoleCard({
  icon,
  title,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition-colors ${
        active
          ? 'border-ayira-500 bg-ayira-50 ring-1 ring-ayira-200'
          : 'border-slate-200 bg-white hover:border-slate-300'
      }`}
    >
      <span className={active ? 'text-ayira-600' : 'text-slate-400'}>{icon}</span>
      <span>
        <span className="block font-medium text-slate-900">{title}</span>
        <span className="mt-0.5 block text-sm text-slate-500">{description}</span>
      </span>
    </button>
  );
}
