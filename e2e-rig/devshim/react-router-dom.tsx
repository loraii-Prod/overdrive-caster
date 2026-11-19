// Sandbox stub of react-router-dom (the subset Overdrive uses). The real build uses react-router-dom.
import { Children, createContext, isValidElement, useContext, useEffect, useState, type ReactElement, type ReactNode } from 'react';
const Ctx = createContext<Record<string, string>>({});
const match = (pat: string, path: string) => {
  if (pat === '*') return {};
  const names: string[] = [];
  const re = new RegExp('^' + pat.replace(/:(\w+)/g, (_, n) => { names.push(n); return '([^/]+)'; }) + '/?$');
  const m = re.exec(path); if (!m) return null;
  return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])]));
};
export const BrowserRouter = ({ children }: { children: ReactNode }) => <>{children}</>;
export function Routes({ children }: { children: ReactNode }) {
  const [p, setP] = useState(location.pathname);
  useEffect(() => { const on = () => setP(location.pathname); addEventListener('popstate', on); return () => removeEventListener('popstate', on); }, []);
  for (const c of Children.toArray(children)) {
    if (!isValidElement(c)) continue;
    const props = (c as ReactElement<{ path: string; element: ReactNode }>).props;
    const m = match(props.path, p);
    if (m) return <Ctx.Provider value={m}>{props.element}</Ctx.Provider>;
  }
  return null;
}
export const Route = (_: { path: string; element: ReactNode }) => null;
export const useParams = () => useContext(Ctx);
export function Navigate({ to, replace }: { to: string; replace?: boolean }) { useEffect(() => { replace ? history.replaceState(null, '', to) : history.pushState(null, '', to); dispatchEvent(new PopStateEvent('popstate')); }, [to]); return null; }
export const useNavigate = () => (to: string) => { history.pushState(null, '', to); dispatchEvent(new PopStateEvent('popstate')); };
export const useLocation = () => ({ pathname: location.pathname, search: location.search, hash: location.hash });
