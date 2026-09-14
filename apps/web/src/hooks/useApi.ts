import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches a gateway endpoint and tracks loading/error state.
 *
 * `path` is the cache key as well as the URL, so callers should build it with
 * `toQueryString` and let it change when filters change. Pass `null` to skip
 * the request (e.g. while a route param is still undefined).
 */
export function useApi<T>(path: string | null): ApiState<T> & { refetch: () => void } {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: path !== null,
    error: null,
  });
  const [reloadToken, setReloadToken] = useState(0);

  const refetch = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    if (path === null) {
      setState({ data: null, loading: false, error: null });
      return;
    }

    // Guards against a slow earlier request overwriting a newer result.
    let active = true;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    apiFetch<T>(path)
      .then((data) => {
        if (active) setState({ data, loading: false, error: null });
      })
      .catch((err: Error) => {
        if (active) setState({ data: null, loading: false, error: err.message });
      });

    return () => {
      active = false;
    };
  }, [path, reloadToken]);

  return { ...state, refetch };
}
