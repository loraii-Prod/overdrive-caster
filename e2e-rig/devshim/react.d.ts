// Sandbox typecheck only: a small, honest subset of React 19's types (no @types/react available here).
declare module 'react' {
  export type ReactNode = any;
  export type Key = string | number;
  export type CSSProperties = { [k: string]: string | number | undefined };
  export interface RefObject<T> { current: T }
  export type Dispatch<A> = (a: A) => void;
  export type SetStateAction<S> = S | ((prev: S) => S);
  export function useState<S>(init: S | (() => S)): [S, Dispatch<SetStateAction<S>>];
  export function useState<S = undefined>(): [S | undefined, Dispatch<SetStateAction<S | undefined>>];
  export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useLayoutEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void;
  export function useMemo<T>(fn: () => T, deps: readonly unknown[]): T;
  export function useCallback<T extends (...a: any[]) => any>(fn: T, deps: readonly unknown[]): T;
  export function useRef<T>(init: T): RefObject<T>;
  export function useRef<T>(init: T | null): RefObject<T | null>;
  export function useContext<T>(c: Context<T>): T;
  export function useSyncExternalStore<T>(sub: (cb: () => void) => () => void, get: () => T, getServer?: () => T): T;
  export interface Context<T> { Provider: (p: { value: T; children?: ReactNode }) => any; _t?: T }
  export function createContext<T>(v: T): Context<T>;
  export function memo<P>(c: (p: P) => any, eq?: (a: P, b: P) => boolean): (p: P) => any;
  export function forwardRef<R, P>(c: (p: P, ref: any) => any): (p: P & { ref?: any }) => any;
  export function createElement(t: any, p?: any, ...c: any[]): any;
  export const Fragment: any;
  export const Children: { toArray(c: any): any[] };
  export function isValidElement(x: any): boolean;
  export type ReactElement<P = any> = { props: P };
  export class Component<P = {}, S = {}> { props: P; state: S; constructor(p: P); setState(s: Partial<S> | ((s: S) => Partial<S>)): void; render(): any }
  export type DragEvent<T = Element> = globalThis.DragEvent & { currentTarget: T; target: EventTarget & T };
  export type PointerEvent<T = Element> = globalThis.PointerEvent & { currentTarget: T };
  export type ChangeEvent<T = Element> = Event & { target: T; currentTarget: T };
  export type KeyboardEvent<T = Element> = globalThis.KeyboardEvent & { currentTarget: T; target: EventTarget & T };
  export type MouseEvent<T = Element> = globalThis.MouseEvent & { currentTarget: T };
}
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
declare module 'react-dom/client' { export function createRoot(el: Element): { render(n: any): void }; }
declare module '*.css' {}
declare namespace JSX {
  type Element = any;
  interface ElementChildrenAttribute { children: {} }
  interface IntrinsicAttributes { key?: string | number | null }
  interface IntrinsicElements { [tag: string]: any }
}
