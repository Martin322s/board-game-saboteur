import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppError, toAppError } from '../../lib/errors/appError.ts';
import type { AuthGateway } from '../../lib/services/types.ts';

/**
 * Anonymous identity (ARCHITECTURE §9.1, PRODUCT_SPEC §3.8).
 *
 *  INITIALIZING → restoring any locally persisted session (never creates a user)
 *  SIGNED_OUT   → no session yet; one is created lazily when multiplayer is first needed
 *  READY        → session available
 *  ERROR        → could not restore/create; the stored session (if any) is left untouched
 */
export type AuthState =
  | { readonly status: 'INITIALIZING' }
  | { readonly status: 'SIGNED_OUT' }
  | { readonly status: 'READY'; readonly userId: string }
  | { readonly status: 'ERROR'; readonly error: AppError };

interface AuthContextValue {
  readonly state: AuthState;
  /** Resolves with the user id, signing in anonymously only if no session exists. */
  readonly ensureSession: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({
  gateway,
  children,
}: {
  gateway: AuthGateway | null;
  children: ReactNode;
}) {
  const [state, setState] = useState<AuthState>(() =>
    gateway ? { status: 'INITIALIZING' } : { status: 'ERROR', error: new AppError('CONFIG_ERROR') },
  );
  const inflight = useRef<Promise<string> | null>(null);

  useEffect(() => {
    if (!gateway) return;
    let active = true;
    gateway.getSession().then(
      (session) => {
        if (active)
          setState(
            session ? { status: 'READY', userId: session.userId } : { status: 'SIGNED_OUT' },
          );
      },
      (error: unknown) => {
        if (active) setState({ status: 'ERROR', error: toAppError(error) });
      },
    );
    const unsubscribe = gateway.onSessionChange((session) => {
      if (!active) return;
      setState((previous) => {
        if (session) {
          return previous.status === 'READY' && previous.userId === session.userId
            ? previous
            : { status: 'READY', userId: session.userId };
        }
        return previous.status === 'READY' ? { status: 'SIGNED_OUT' } : previous;
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [gateway]);

  const ensureSession = useCallback((): Promise<string> => {
    if (!gateway) return Promise.reject(new AppError('CONFIG_ERROR'));
    // Deduplicate concurrent callers so two clicks never create two anonymous users.
    inflight.current ??= (async () => {
      try {
        const existing = await gateway.getSession();
        const session = existing ?? (await gateway.signInAnonymously());
        setState({ status: 'READY', userId: session.userId });
        return session.userId;
      } catch (error) {
        const appError = toAppError(error);
        setState({ status: 'ERROR', error: appError });
        throw appError;
      } finally {
        inflight.current = null;
      }
    })();
    return inflight.current;
  }, [gateway]);

  const value = useMemo(() => ({ state, ensureSession }), [state, ensureSession]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}
