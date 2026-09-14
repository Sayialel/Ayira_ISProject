import { Outlet, NavLink, Link, useNavigate } from 'react-router-dom';
import { Home, Briefcase, User, LogOut, Sparkles, FileText, Plus, LayoutList } from 'lucide-react';
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
  { to: '/app/profile', label: 'Profile', icon: User },
];

const EMPLOYER_NAV: NavItem[] = [
  { to: '/app', label: 'Home', icon: Home, end: true },
  { to: '/app/gigs', label: 'Gigs', icon: Briefcase },
  { to: '/app/my-gigs', label: 'My gigs', icon: LayoutList },
  { to: '/app/gigs/create', label: 'Post', icon: Plus },
  { to: '/app/profile', label: 'Profile', icon: User },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const role = (user?.user_metadata?.role as string) ?? 'worker';
  const navItems = role === 'employer' ? EMPLOYER_NAV : WORKER_NAV;

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-10 border-b border-gray-200 bg-white px-4 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4">
          <Link to="/app" className="text-xl font-bold text-ayira-700">
            Ayira
          </Link>

          {/* Desktop navigation */}
          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map(({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  `inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-ayira-50 text-ayira-700'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  }`
                }
              >
                <Icon size={16} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <span className="hidden text-sm capitalize text-gray-500 sm:inline">{role}</span>
            <button
              onClick={handleSignOut}
              aria-label="Sign out"
              className="text-gray-400 transition hover:text-gray-600"
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 p-4 pb-20 md:pb-4">
        <Outlet />
      </main>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-gray-200 bg-white py-2 md:hidden">
        {navItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-2 text-xs transition ${
                isActive ? 'text-ayira-600' : 'text-gray-500 hover:text-ayira-600'
              }`
            }
          >
            <Icon size={20} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
