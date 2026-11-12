"use client";

/**
 * Session state for the whole app.
 *
 * - The session is whatever GET /auth/me says; the HttpOnly cookie is never read here.
 * - The CSRF token is kept in memory only (module variable in api/client.ts, mirrored in
 *   this context). It is refreshed from /auth/me on load and after sign-in/registration.
 * - Any 401 from a non-auth endpoint clears the session and, inside /app, redirects to
 *   /sign-in?next=<current path>.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from "react";

import { api, setCsrfToken, setUnauthorizedHandler, unwrap } from "@/lib/api/client";
import { fetchSession, meQueryOptions } from "@/lib/api/hooks";
import { qk } from "@/lib/api/keys";
import { safeNextPath } from "@/lib/navigation-safety";
import type { SessionInfo, User } from "@/lib/api/types";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error";

export interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  csrfToken: string | null;
  /** Set when /auth/me failed for a reason other than being signed out. */
  error: Error | null;
  /** Throws ApiError (show `error.message`). */
  signIn: (input: { email: string; password: string }) => Promise<User>;
  /** Throws ApiError; `error.fieldIssues` lists per-field validation messages. */
  register: (input: { email: string; password: string; display_name?: string }) => Promise<User>;
  /** Ends the session and navigates to `redirectTo` (default "/"). */
  signOut: (redirectTo?: string) => Promise<void>;
  /**
   * Ask the API for the session, bypassing the session-hint shortcut, and update the
   * context. Resolves true when a session exists.
   */
  refresh: () => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export { safeNextPath };

export function signInHref(next?: string | null): string {
  return next ? `/sign-in?next=${encodeURIComponent(next)}` : "/sign-in";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const me = useQuery(meQueryOptions);

  // A 401 anywhere means the session ended (expired, revoked or signed out elsewhere).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCsrfToken(null);
      queryClient.setQueryData(qk.me, null);
      const here = window.location.pathname + window.location.search;
      if (window.location.pathname.startsWith("/app")) router.replace(signInHref(here));
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient, router]);

  const adopt = useCallback(
    (session: SessionInfo) => {
      setCsrfToken(session.csrf_token ?? null);
      // Drop anything cached for a previous user before exposing the new session.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "meta" });
      queryClient.setQueryData(qk.me, session);
    },
    [queryClient],
  );

  const signIn = useCallback<AuthContextValue["signIn"]>(
    async (input) => {
      const session = await unwrap(api.POST("/api/v1/auth/login", { body: input }));
      adopt(session);
      return session.user;
    },
    [adopt],
  );

  const register = useCallback<AuthContextValue["register"]>(
    async (input) => {
      const session = await unwrap(api.POST("/api/v1/auth/register", { body: { display_name: "", ...input } }));
      adopt(session);
      return session.user;
    },
    [adopt],
  );

  const signOut = useCallback<AuthContextValue["signOut"]>(
    async (redirectTo = "/") => {
      try {
        await unwrap(api.POST("/api/v1/auth/logout"));
      } catch {
        // Already signed out or unreachable: clear local state regardless.
      }
      setCsrfToken(null);
      queryClient.setQueryData(qk.me, null);
      router.replace(redirectTo);
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "meta" });
    },
    [queryClient, router],
  );

  const refresh = useCallback(async () => {
    const session = await fetchSession();
    queryClient.setQueryData(qk.me, session);
    return session !== null;
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(() => {
    const session = me.data ?? null;
    const status: AuthStatus = me.isPending
      ? "loading"
      : session
        ? "authenticated"
        : me.isError
          ? "error"
          : "unauthenticated";
    return {
      status,
      user: session?.user ?? null,
      csrfToken: session?.csrf_token ?? null,
      error: me.isError ? me.error : null,
      signIn,
      register,
      signOut,
      refresh,
    };
  }, [me.data, me.isPending, me.isError, me.error, signIn, register, signOut, refresh]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** The signed-in user. Only call inside the /app shell, where a session is guaranteed. */
export function useUser(): User {
  const { user } = useAuth();
  if (!user) throw new Error("useUser called without a session");
  return user;
}
