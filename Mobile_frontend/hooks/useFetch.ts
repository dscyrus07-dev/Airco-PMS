/**
 * Tiny server-state hook — fetch on mount + on screen focus, expose
 * loading/error/refresh. No polling: screens pull-to-refresh and refetch
 * on focus, which is enough for a staff task list.
 */

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  /** Raw failure — screens inspect ApiError.status for 403/404 handling. */
  error: unknown;
  /** Re-runs the fetcher (pull-to-refresh / retry). */
  refresh: () => void;
}

export function useFetch<T>(fetcher: () => Promise<T>, deps: unknown[] = []): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const generation = useRef(0);
  // Keep the latest fetcher without retriggering effects on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = useCallback(async (isRefresh: boolean) => {
    const gen = ++generation.current;
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (generation.current === gen) setData(result);
    } catch (err) {
      if (generation.current === gen) setError(err);
    } finally {
      if (generation.current === gen) {
        setLoading(false);
        setRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useFocusEffect(
    useCallback(() => {
      void run(false);
    }, [run])
  );

  return { data, loading, refreshing, error, refresh: () => void run(true) };
}
