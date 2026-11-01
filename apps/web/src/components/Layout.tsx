import { useEffect, useState } from 'react';
import { Outlet, NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Briefcase,
  ChevronDown,
  FileText,
  Home,
  LayoutList,
  LogOut,
  Menu,
  PanelLeft,
  Plus,
  Search,
  ShieldCheck,
  Sparkles,
  User,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { AyiraMark } from '@/components/patterns';
import { Avatar } from '@/components/ui';
import { useAuth } from '@/hooks/useAuth';

/**
 * The application chrome: a collapsible left sidebar on desktop, a slide-over
 * drawer on phones.
 *
 * The sidebar replaces a horizontal top navigation. A top bar works while
 * there are five or six destinations and stops working as soon as sections
 * have sub-pages -- which these do: matching has a history view, gigs have a
 * feed and the caller's own, payments have an admin view. A vertical list has
 * room to show that structure instead of hiding it behind a page people have
 * to already know about.
 *
 * The bottom bar on phones stays. A drawer is the right place for secondary
 * destinations but the wrong place for the four a worker uses constantly.
 */

interface NavItem {
  to: string;
  label: string;
  icon: typeof Home;
  /** Only an index route should match on its exact path. */
  end?: boolean;
  /** Sub-destinations, revealed when the group is open. */
  children?: { to: string; label: string; end?: boolean }[];
}

const WORKER_NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: Home, end: true },
  {
    to: '/app/gigs',
    label: 'Gigs',
    icon: Briefcase,
    children: [
      { to: '/app/gigs', label: 'Browse gigs', end: true },
      { to: '/app/applications', label: 'My applications' },
    ],
  },
  {
    to: '/app/matches',
    label: 'AI matches',
    icon: Sparkles,
    children: [
      { to: '/app/matches', label: 'Find matches', end: true },
      { to: '/app/matches/history', label: 'Match history' },
    ],
  },
  { to: '/app/escrow', label: 'Payments', icon: Wallet },
  { to: '/app/profile', label: 'Profile', icon: User },
];

const EMPLOYER_NAV: NavItem[] = [
  { to: '/app', label: 'Dashboard', icon: Home, end: true },
  {
    to: '/app/my-gigs',
    label: 'Gigs',
    icon: Briefcase,
    children: [
      { to: '/app/my-gigs', label: 'My gigs', end: true },
      { to: '/app/gigs/create', label: 'Post a gig' },
      { to: '/app/gigs', label: 'Browse all', end: true },
    ],
  },
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

/** The four destinations that stay on the phone bottom bar, by role. */
const MOBILE_BAR: Record<string, { to: string; label: string; icon: typeof Home; end?: boolean }[]> =
  {
    worker: [
      { to: '/app', label: 'Home', icon: Home, end: true },
      { to: '/app/gigs', label: 'Gigs', icon: Briefcase, end: true },
      { to: '/app/matches', label: 'Matches', icon: Sparkles, end: true },
      { to: '/app/applications', label: 'Applied', icon: FileText },
      { to: '/app/escrow', label: 'Pay', icon: Wallet },
    ],
    employer: [
      { to: '/app', label: 'Home', icon: Home, end: true },
      { to: '/app/my-gigs', label: 'My gigs', icon: LayoutList, end: true },
      { to: '/app/gigs/create', label: 'Post', icon: Plus },
      { to: '/app/gigs', label: 'Browse', icon: Search, end: true },
      { to: '/app/escrow', label: 'Pay', icon: Wallet },
    ],
    admin: [
      { to: '/app/admin', label: 'Overview', icon: ShieldCheck, end: true },
      { to: '/app/admin/users', label: 'Accounts', icon: Users },
      { to: '/app/admin/gigs', label: 'Gigs', icon: LayoutList },
      { to: '/app/admin/escrow', label: 'Pay', icon: Wallet },
    ],
  };

const COLLAPSE_KEY = 'ayira.sidebar_collapsed';

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const role = (user?.user_metadata?.role as string) ?? 'worker';
  const navItems =
    role === 'admin' ? ADMIN_NAV : role === 'employer' ? EMPLOYER_NAV : WORKER_NAV;
  const barItems = MOBILE_BAR[role] ?? MOBILE_BAR.worker;

  // Remembered per browser. A collapsed sidebar is a working preference, not
  // state anyone else needs, so localStorage is the right home for it.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
    } catch {
      /* private browsing; the preference simply does not persist */
    }
  }, [collapsed]);

  // A drawer that survived navigation would cover the page just reached.
  useEffect(() => setDrawerOpen(false), [location.pathname]);

  const handleSignOut = async () => {
    await signOut();
    navigate('/');
  };

  const fullName = (user?.user_metadata?.full_name as string) ?? '';
  const email = user?.email ?? '';

  return (
    <div className="flex min-h-screen bg-slate-100/60">
      {/* ---------------------------------------------------------------- */}
      {/* Desktop sidebar                                                  */}
      {/* ---------------------------------------------------------------- */}
      <aside
        className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 md:flex ${
          collapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        <SidebarBody
          collapsed={collapsed}
          onToggle={() => setCollapsed((c) => !c)}
          navItems={navItems}
          role={role}
          fullName={fullName}
          email={email}
          avatarUrl={user?.user_metadata?.avatar_url as string | undefined}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* ---------------------------------------------------------------- */}
      {/* Phone drawer                                                     */}
      {/* ---------------------------------------------------------------- */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="absolute inset-0 bg-slate-900/40 animate-fade-in"
          />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col border-r border-slate-200 bg-white shadow-pop">
            <SidebarBody
              collapsed={false}
              onToggle={() => setDrawerOpen(false)}
              toggleIcon={<X size={18} aria-hidden />}
              navItems={navItems}
              role={role}
              fullName={fullName}
              email={email}
              avatarUrl={user?.user_metadata?.avatar_url as string | undefined}
              onSignOut={handleSignOut}
            />
          </aside>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* Content                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone-only top bar: the sidebar is a drawer there, so the mark
            and the menu button need somewhere to live. */}
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur md:hidden">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-slate-600 transition-colors hover:bg-slate-100"
          >
            <Menu size={20} aria-hidden />
          </button>
          <Link to="/app" className="flex items-center gap-2">
            <AyiraMark size={26} />
            <span className="font-display text-lg font-bold text-slate-900">Ayira</span>
          </Link>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-24 sm:p-6 md:pb-8">
          {/* key on the pathname so each route fades in rather than snapping. */}
          <div key={location.pathname} className="animate-fade-in">
            <Outlet />
          </div>
        </main>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Phone bottom bar                                                 */}
      {/* ---------------------------------------------------------------- */}
      <nav className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-slate-200 bg-white/95 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur md:hidden">
        {barItems.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to + label}
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

/* -------------------------------------------------------------------------- */

/** Shared by the desktop sidebar and the phone drawer, so they cannot drift. */
function SidebarBody({
  collapsed,
  onToggle,
  toggleIcon,
  navItems,
  role,
  fullName,
  email,
  avatarUrl,
  onSignOut,
}: {
  collapsed: boolean;
  onToggle: () => void;
  toggleIcon?: React.ReactNode;
  navItems: NavItem[];
  role: string;
  fullName: string;
  email: string;
  avatarUrl?: string;
  onSignOut: () => void;
}) {
  return (
    <>
      {/* Brand + collapse toggle */}
      <div
        className={`flex items-center gap-2 border-b border-slate-100 px-3 py-3.5 ${
          collapsed ? 'justify-center' : 'justify-between'
        }`}
      >
        {!collapsed && (
          <Link to="/app" className="flex items-center gap-2.5 overflow-hidden">
            <AyiraMark size={28} />
            <span className="font-display text-xl font-bold tracking-tight text-slate-900">
              Ayira
            </span>
          </Link>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
        >
          {toggleIcon ?? <PanelLeft size={18} aria-hidden />}
        </button>
      </div>

      {/* Destinations */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.to + item.label}>
              <NavGroup item={item} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </nav>

      {/* Account */}
      <div className="border-t border-slate-100 p-2">
        <div
          className={`flex items-center gap-2.5 rounded-xl p-2 ${
            collapsed ? 'justify-center' : ''
          }`}
        >
          <Avatar name={fullName || email || 'You'} src={avatarUrl} size={collapsed ? 30 : 34} />
          {!collapsed && (
            <>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-900">
                  {fullName || 'Your account'}
                </p>
                <p className="truncate text-xs text-slate-400">
                  {role === 'admin' ? 'Platform staff' : email}
                </p>
              </div>
              <button
                type="button"
                onClick={onSignOut}
                aria-label="Sign out"
                title="Sign out"
                className="shrink-0 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              >
                <LogOut size={16} aria-hidden />
              </button>
            </>
          )}
        </div>

        {collapsed && (
          <button
            type="button"
            onClick={onSignOut}
            aria-label="Sign out"
            title="Sign out"
            className="mt-1 flex w-full justify-center rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <LogOut size={16} aria-hidden />
          </button>
        )}
      </div>
    </>
  );
}

/**
 * One destination, which may expand to reveal its sub-pages.
 *
 * The group opens when one of its children is the current route, so arriving
 * by a link rather than by clicking the parent still shows where you are.
 */
function NavGroup({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const location = useLocation();
  const { icon: Icon, children } = item;

  const childActive = Boolean(
    children?.some((c) =>
      c.end ? location.pathname === c.to : location.pathname.startsWith(c.to)
    )
  );
  const [open, setOpen] = useState(childActive);

  useEffect(() => {
    if (childActive) setOpen(true);
  }, [childActive]);

  const base =
    'group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors';

  // Collapsed, or no children: a plain link. An expander with nowhere to put
  // the labels would be a button that does nothing visible.
  if (collapsed || !children) {
    return (
      <NavLink
        to={item.to}
        end={item.end}
        title={collapsed ? item.label : undefined}
        className={({ isActive }) =>
          `${base} ${collapsed ? 'justify-center' : ''} ${
            isActive || childActive
              ? 'bg-ayira-50 text-ayira-700'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          }`
        }
      >
        <Icon size={18} className="shrink-0" aria-hidden />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </NavLink>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={`${base} ${
          childActive
            ? 'text-ayira-700'
            : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
        }`}
      >
        <Icon size={18} className="shrink-0" aria-hidden />
        <span className="flex-1 truncate text-left">{item.label}</span>
        <ChevronDown
          size={15}
          aria-hidden
          className={`shrink-0 text-slate-400 transition-transform duration-200 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <ul className="mt-0.5 space-y-0.5 pl-[30px]">
          {children.map((child) => (
            <li key={child.to + child.label}>
              <NavLink
                to={child.to}
                end={child.end}
                className={({ isActive }) =>
                  `block truncate rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                    isActive
                      ? 'bg-ayira-50 font-semibold text-ayira-700'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                  }`
                }
              >
                {child.label}
              </NavLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
