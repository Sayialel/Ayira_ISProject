import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { Home, Briefcase, User, LogOut, Sparkles, FileText, Plus, LayoutList, Wallet, ShieldCheck, Users } from 'lucide-react';
import { AyiraMark, ShukaWeave } from '@/components/patterns';
import { useAuth } from '@/hooks/useAuth';

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  /** Only the dashboard route should match on its exact path. */
  end?: boolean;
}

const WORKER_NAV: NavItem[] = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/gigs', label: 'Gigs', icon: Briefcase },
  { to: '/app/matches', label: 'Matches', icon: Sparkles },
  { to: '/app/applications', label: 'Applied', icon: FileText },
  { to: '/app/escrow', label: 'Payments', icon: Wallet },
  { to: '/app/profile', label: 'Profile', icon: User },
];

const EMPLOYER_NAV: NavItem[] = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/gigs', label: 'Gigs', icon: Briefcase },
  { to: '/app/my-gigs', label: 'My gigs', icon: LayoutList },
  { to: '/app/gigs/create', label: 'Post', icon: Plus },
  { to: '/app/escrow', label: 'Payments', icon: Wallet },
  { to: '/app/profile', label: 'Profile', icon: User },
];

// Staff navigation. Reached only through AdminRoute, which the API backs up
// by resolving the role from the database rather than the token.
const ADMIN_NAV: NavItem[] = [
  { to: '/app/admin', label: 'Overview', icon: ShieldCheck, end: true },
  { to: '/app/admin/users', label: 'Accounts', icon: Users },
  { to: '/app/admin/gigs', label: 'Gigs', icon: LayoutList },
  { to: '/app/admin/escrow', label: 'Payments', icon: Wallet },
  { to: '/app/profile', label: 'Profile', icon: User },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const role = (user?.user_metadata?.role as string) ?? 'worker';
  const navItems =
    role === 'admin' ? ADMIN_NAV : role === 'employer' ? EMPLOYER_NAV : WORKER_NAV;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2.5">
          <Link to="/app" className="flex items-center gap-2.5">
            <AyiraMark size={28} />
            <span className="font-display text-xl font-bold tracking-tight text-slate-900">
              Ayira
            </span>
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `relative inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-ayira-50 text-ayira-700'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={16} aria-hidden />
                    {label}
                    {/* A woven underline on the active item, so the theme
                        carries into the chrome rather than stopping at the
                        landing page. */}
                    {isActive && (
                      <ShukaWeave
                        className="absolute inset-x-2 -bottom-[7px] rounded-full"
                        height={3}
                      />
                    )}
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <span className="hidden rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold capitalize text-slate-600 sm:inline">
              {role === 'admin' ? 'Staff' : role}
            </span>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sign out"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              <LogOut size={18} aria-hidden />
            </button>
          </div>
        </div>
      </header>

      {/* key on the pathname so each route fades in rather than snapping. */}
      <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-24 md:pb-6">
        <div key={location.pathname} className="animate-fade-in">
          <Outlet />
        </div>
      </main>

      {/* Bottom nav (mobile). pb-safe-ish padding keeps it clear of the home
          indicator on phones that have one. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-slate-200 bg-white/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 text-[11px] font-medium transition-colors ${
                isActive ? 'text-ayira-700' : 'text-slate-500'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={`flex h-7 w-10 items-center justify-center rounded-full transition-all duration-150 ${
                    isActive ? 'bg-ayira-50' : 'bg-transparent'
                  }`}
                >
                  <Icon size={18} aria-hidden />
                </span>
                <span>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
