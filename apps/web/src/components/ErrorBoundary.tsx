import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Catches render-time crashes so a single broken page does not blank the whole
 * app. Network and validation failures are handled per page instead.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled UI error:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md rounded-lg border border-gray-200 bg-white p-6 text-center">
          <AlertTriangle className="mx-auto text-amber-500" size={36} aria-hidden />
          <h1 className="mt-3 text-lg font-semibold text-gray-900">Something went wrong</h1>
          <p className="mt-1 text-sm text-gray-500">
            The page failed to load. Reloading usually fixes it.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-4 rounded-lg bg-ayira-600 px-4 py-2 text-sm font-medium text-white hover:bg-ayira-700"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
