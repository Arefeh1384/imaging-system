// A small router with no dependencies. It uses normal browser URLs, and falls
// back to in-memory routes when VITE_ROUTER=memory (used by the hosted preview).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

const useMemoryRoutes = import.meta.env.VITE_ROUTER === 'memory';

interface RouterValue {
  path: string;
  search: string;
  navigate: (to: string, options?: { replace?: boolean }) => void;
}

const RouterContext = createContext<RouterValue | null>(null);
const ParamsContext = createContext<Record<string, string>>({});

function currentUrl(): string {
  if (useMemoryRoutes) return '/';
  return location.pathname + location.search;
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [url, setUrl] = useState(currentUrl);

  useEffect(() => {
    if (useMemoryRoutes) return undefined;
    const onPop = () => setUrl(currentUrl());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, options?: { replace?: boolean }) => {
    if (!useMemoryRoutes) {
      if (options?.replace) history.replaceState(null, '', to);
      else history.pushState(null, '', to);
    }
    setUrl(to);
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => {
    const [path, search = ''] = url.split('?');
    return { path, search, navigate };
  }, [url, navigate]);

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

function useRouter(): RouterValue {
  const value = useContext(RouterContext);
  if (!value) throw new Error('RouterProvider is missing');
  return value;
}

export const useNavigate = () => useRouter().navigate;
export const usePath = () => useRouter().path;
export const useParams = () => useContext(ParamsContext);

export function useSearchParam(name: string): [string, (value: string) => void] {
  const { path, search, navigate } = useRouter();
  const value = new URLSearchParams(search).get(name) ?? '';
  const set = useCallback(
    (next: string) => {
      const params = new URLSearchParams(search);
      if (next) params.set(name, next);
      else params.delete(name);
      const query = params.toString();
      navigate(query ? `${path}?${query}` : path, { replace: true });
    },
    [name, path, search, navigate],
  );
  return [value, set];
}

/** Changes several query values in one step, such as a filter and the page it resets. */
export function useSearchUpdate(): (changes: Record<string, string>) => void {
  const { path, search, navigate } = useRouter();
  return useCallback(
    (changes: Record<string, string>) => {
      const params = new URLSearchParams(search);
      Object.entries(changes).forEach(([name, value]) => {
        if (value) params.set(name, value);
        else params.delete(name);
      });
      const query = params.toString();
      navigate(query ? `${path}?${query}` : path, { replace: true });
    },
    [path, search, navigate],
  );
}

function matchPath(pattern: string, path: string): Record<string, string> | null {
  const a = pattern.split('/').filter(Boolean);
  const b = path.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]);
    else if (a[i] !== b[i]) return null;
  }
  return params;
}

export interface RouteDef {
  path: string;
  element: ReactNode;
}

export function Routes({ routes, fallback }: { routes: RouteDef[]; fallback: ReactNode }) {
  const { path } = useRouter();
  for (const route of routes) {
    const params = matchPath(route.path, path);
    if (params) return <ParamsContext.Provider value={params}>{route.element}</ParamsContext.Provider>;
  }
  return <>{fallback}</>;
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const { navigate } = useRouter();
  const handle = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

export function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}
