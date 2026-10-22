import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Spinner } from '@/components/ui';

/**
 * Sign in or sign up with Google.
 *
 * One button for both, because Google does not distinguish them: the account
 * either exists or is created on first return. Labelling it "sign up" on one
 * page and "sign in" on the other would imply a choice the provider does not
 * offer.
 */
export default function GoogleButton({ label = 'Continue with Google' }: { label?: string }) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
      // No success branch: the browser navigates to Google, so nothing after
      // this runs unless the handoff itself failed.
    } catch (err) {
      setError(
        err instanceof Error && /provider is not enabled/i.test(err.message)
          ? 'Google sign-in is not configured on this server yet.'
          : 'Could not reach Google. Please try again.'
      );
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={go}
        disabled={busy}
        className="flex w-full items-center justify-center gap-2.5 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-60"
      >
        {busy ? <Spinner /> : <GoogleMark />}
        {label}
      </button>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** Google's four-colour mark, inline so the button needs no network request. */
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 7.9-21l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-16c0-1.2.1-2.3 0-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 5.8 1.2 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.6 5A20 20 0 0 0 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 40.2 44 35 44 24c0-1.2-.1-2.3-.4-3.5z"
      />
    </svg>
  );
}

/** A labelled rule, for separating the Google button from the email form. */
export function OrDivider() {
  return (
    <div className="my-4 flex items-center gap-3">
      <span className="h-px flex-1 bg-gray-200" />
      <span className="text-xs uppercase tracking-wide text-gray-400">or</span>
      <span className="h-px flex-1 bg-gray-200" />
    </div>
  );
}
