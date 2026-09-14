import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import ErrorBoundary from '@/components/ErrorBoundary';
import Layout from '@/components/Layout';
import Landing from '@/pages/Landing';
import SignIn from '@/pages/SignIn';
import SignUp from '@/pages/SignUp';
import Dashboard from '@/pages/Dashboard';
import GigFeed from '@/pages/GigFeed';
import GigDetail from '@/pages/GigDetail';
import CreateGig from '@/pages/CreateGig';
import MyGigs from '@/pages/MyGigs';
import MyApplications from '@/pages/MyApplications';
import AIMatches from '@/pages/AIMatches';
import Profile from '@/pages/Profile';
import PublicProfile from '@/pages/PublicProfile';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="flex h-screen items-center justify-center">Loading...</div>;
  if (!user) return <Navigate to="/signin" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
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
            <Route index element={<Dashboard />} />
            <Route path="gigs" element={<GigFeed />} />
            {/* "create" is declared before ":id" so it is not read as a gig id. */}
            <Route path="gigs/create" element={<CreateGig />} />
            <Route path="gigs/:id" element={<GigDetail />} />
            <Route path="my-gigs" element={<MyGigs />} />
            <Route path="applications" element={<MyApplications />} />
            <Route path="matches" element={<AIMatches />} />
            <Route path="profile" element={<Profile />} />
            <Route path="users/:id" element={<PublicProfile />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </AuthProvider>
  );
}
