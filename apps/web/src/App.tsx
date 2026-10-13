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
