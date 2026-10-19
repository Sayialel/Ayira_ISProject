import { Suspense, lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import ErrorBoundary from '@/components/ErrorBoundary';
import { ToastProvider } from '@/components/Toast';
import { LoadingBlock } from '@/components/ui';
import Layout from '@/components/Layout';
import Landing from '@/pages/Landing';
import SignIn from '@/pages/SignIn';
import SignUp from '@/pages/SignUp';

// Everything behind sign-in is split out of the initial bundle. A first-time
// visitor on a slow connection downloads the landing and sign-in pages only,
// which is most of what the audience for this platform is browsing on.
const Dashboard = lazy(() => import('@/pages/Dashboard'));
const GigFeed = lazy(() => import('@/pages/GigFeed'));
const GigDetail = lazy(() => import('@/pages/GigDetail'));
const CreateGig = lazy(() => import('@/pages/CreateGig'));
const MyGigs = lazy(() => import('@/pages/MyGigs'));
const MyApplications = lazy(() => import('@/pages/MyApplications'));
const AIMatches = lazy(() => import('@/pages/AIMatches'));
const EscrowPage = lazy(() => import('@/pages/Escrow'));
const Profile = lazy(() => import('@/pages/Profile'));
const PublicProfile = lazy(() => import('@/pages/PublicProfile'));
const AdminDashboard = lazy(() => import('@/pages/admin/AdminDashboard'));
const AdminUsers = lazy(() => import('@/pages/admin/AdminUsers'));
const AdminGigs = lazy(() => import('@/pages/admin/AdminGigs'));
const AdminEscrow = lazy(() => import('@/pages/admin/AdminEscrow'));

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingBlock label="Signing you in…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

/**
 * Hides the admin area from anyone whose token does not claim the admin role.
 *
 * This is convenience, not security. `user_metadata` is user-editable in
 * Supabase, so a determined non-admin can reveal these routes -- and will then
 * see nothing but 403s, because the gateway resolves the role from the users
 * table (middleware/auth.resolveRole) and never escalates to admin from a
 * token claim. The real boundary is the API.
 */
function AdminRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.user_metadata?.role !== 'admin') return <Navigate to="/app" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <ErrorBoundary>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/signin" element={<SignIn />} />
            <Route path="/signup" element={<SignUp />} />

            <Route
              path="/app"
              element={
                <ProtectedRoute>
                  <Layout />
                </ProtectedRoute>
              }
            >
              {/* One boundary inside the layout, so the chrome stays put while
                  a route chunk loads rather than the whole page blanking. */}
              <Route index element={<Lazy><Dashboard /></Lazy>} />
              <Route path="gigs" element={<Lazy><GigFeed /></Lazy>} />
              {/* "create" is declared before ":id" so it is not read as a gig id. */}
              <Route path="gigs/create" element={<Lazy><CreateGig /></Lazy>} />
              <Route path="gigs/:id" element={<Lazy><GigDetail /></Lazy>} />
              <Route path="my-gigs" element={<Lazy><MyGigs /></Lazy>} />
              <Route path="applications" element={<Lazy><MyApplications /></Lazy>} />
              <Route path="matches" element={<Lazy><AIMatches /></Lazy>} />
              <Route path="escrow" element={<Lazy><EscrowPage /></Lazy>} />
              <Route path="profile" element={<Lazy><Profile /></Lazy>} />
              <Route path="users/:id" element={<Lazy><PublicProfile /></Lazy>} />

              <Route
                path="admin"
                element={<AdminRoute><Lazy><AdminDashboard /></Lazy></AdminRoute>}
              />
              <Route
                path="admin/users"
                element={<AdminRoute><Lazy><AdminUsers /></Lazy></AdminRoute>}
              />
              <Route
                path="admin/gigs"
                element={<AdminRoute><Lazy><AdminGigs /></Lazy></AdminRoute>}
              />
              <Route
                path="admin/escrow"
                element={<AdminRoute><Lazy><AdminEscrow /></Lazy></AdminRoute>}
              />
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </ToastProvider>
    </AuthProvider>
  );
}

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingBlock />}>{children}</Suspense>;
}
