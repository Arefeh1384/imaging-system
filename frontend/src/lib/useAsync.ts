import { useCallback, useEffect, useRef, useState } from 'react';

interface AsyncState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (value: T) => void;
}

/**
 * Loads data for a screen. With pollMs, it refreshes quietly in the background.
 * With keepPrevious, the old rows stay up while the next page loads, so the page doesn't jump.
 */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[], pollMs?: number, options?: { keepPrevious?: boolean }): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const latest = useRef(0);

  const run = useCallback(async (quiet: boolean) => {
    latest.current += 1;
    const id = latest.current;
    if (!quiet) setLoading(true);
    try {
      const result = await loaderRef.current();
      if (id === latest.current) {
        setData(result);
        setError(null);
      }
    } catch (err) {
      if (id === latest.current && !quiet) setError(err instanceof Error ? err.message : 'بارگذاری انجام نشد.');
    } finally {
      if (id === latest.current && !quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!options?.keepPrevious) setData(null);
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!pollMs) return undefined;
    const refresh = () => void run(true);
    const timer = window.setInterval(refresh, pollMs);
    // Refresh right away when another tab changes the data or this tab regains focus.
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [pollMs, run]);

  const reload = useCallback(() => run(true), [run]);
  return { data, error, loading, reload, setData };
}
