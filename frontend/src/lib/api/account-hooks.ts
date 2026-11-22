"use client";

/**
 * Hooks for the account area (Settings): sessions, API tokens, password change, data
 * export, account deletion and the administrator read-outs. They follow the same pattern
 * as `hooks.ts` and use the keys that already exist in `keys.ts`.
 */
import { useQuery } from "@tanstack/react-query";

import { api, unwrap } from "./client";
import { FILE_URL_REFETCH, FILE_URL_STALE_TIME, useApiMutation } from "./hooks";
import { qk } from "./keys";
import type { ExportOut, Job, MfaSetupOut, RecoveryCodesOut, SessionOut, TokenCreated, TokenIn, TokenOut } from "./types";

/* ----------------------------------------------------------------- sessions */

export function useSessions() {
  return useQuery({
    queryKey: qk.sessions,
    queryFn: () => unwrap<SessionOut[]>(api.GET("/api/v1/auth/sessions")),
  });
}

export function useRevokeSession() {
  return useApiMutation(
    (sessionId: string) =>
      unwrap(api.DELETE("/api/v1/auth/sessions/{session_id}", { params: { path: { session_id: sessionId } } })),
    { invalidate: [qk.sessions] },
  );
}

/* ------------------------------------------------------------------- tokens */

export function useTokens() {
  return useQuery({
    queryKey: qk.tokens,
    queryFn: () => unwrap<TokenOut[]>(api.GET("/api/v1/auth/tokens")),
  });
}

/** Resolves with the new token INCLUDING its secret (`token`), which the API returns only once. */
export function useCreateToken() {
  return useApiMutation(
    (body: TokenIn) => unwrap<TokenCreated>(api.POST("/api/v1/auth/tokens", { body: body as never })),
    { invalidate: [qk.tokens] },
  );
}

export function useRevokeToken() {
  return useApiMutation(
    (tokenId: string) =>
      unwrap(api.DELETE("/api/v1/auth/tokens/{token_id}", { params: { path: { token_id: tokenId } } })),
    { invalidate: [qk.tokens] },
  );
}

/* ----------------------------------------------------------------- password */

/** Changes the password. The API signs out every other session. */
export function useChangePassword() {
  return useApiMutation(
    (body: { current_password: string; new_password: string }) => unwrap(api.POST("/api/v1/auth/password", { body })),
    { invalidate: [qk.sessions] },
  );
}

/* ---------------------------------------------------- two-step verification */

/** Step 1: checks the password and returns a new authenticator secret that is not active yet. */
export function useStartMfa() {
  return useApiMutation((password: string) => unwrap<MfaSetupOut>(api.POST("/api/v1/auth/mfa/setup", { body: { password } })));
}

/** Step 2: confirms the secret with a current code. Returns the recovery codes, which are shown once. */
export function useEnableMfa() {
  return useApiMutation((code: string) => unwrap<RecoveryCodesOut>(api.POST("/api/v1/auth/mfa/enable", { body: { code } })), {
    invalidate: [qk.me, qk.sessions],
  });
}

export function useDisableMfa() {
  return useApiMutation((body: { password: string; code: string }) => unwrap(api.POST("/api/v1/auth/mfa/disable", { body })), {
    invalidate: [qk.me],
  });
}

/** Needs a current authenticator code (not a recovery code). The old recovery codes stop working. */
export function useReplaceRecoveryCodes() {
  return useApiMutation((code: string) => unwrap<RecoveryCodesOut>(api.POST("/api/v1/auth/mfa/recovery-codes", { body: { code } })));
}

/* ------------------------------------------------------------------ exports */

/** Exports carry a signed `download_url` once ready. */
export function useExports() {
  return useQuery({
    queryKey: qk.exports,
    queryFn: () => unwrap<ExportOut[]>(api.GET("/api/v1/account/exports")),
    staleTime: FILE_URL_STALE_TIME,
    refetchInterval: FILE_URL_REFETCH,
  });
}

/** Starts an export of the whole account. Resolves with `{ export, job }`. */
export function useStartAccountExport() {
  return useApiMutation(
    () => unwrap<{ export: ExportOut; job: Job }>(api.POST("/api/v1/account/export")),
    { invalidate: [qk.exports, qk.jobs.all, qk.dashboard] },
  );
}

export function useDeleteExport() {
  return useApiMutation(
    (exportId: string) =>
      unwrap(api.DELETE("/api/v1/account/exports/{export_id}", { params: { path: { export_id: exportId } } })),
    { invalidate: [qk.exports, qk.usage, qk.dashboard] },
  );
}

/* ------------------------------------------------------------------ account */

/** The literal text the API requires in `confirm` to delete an account. */
export const DELETE_ACCOUNT_CONFIRMATION = "DELETE MY ACCOUNT";

/** Permanently deletes the account. The caller is responsible for leaving the app afterwards. */
export function useDeleteAccount() {
  return useApiMutation((password: string) =>
    unwrap(api.DELETE("/api/v1/account", { body: { password, confirm: DELETE_ACCOUNT_CONFIRMATION } })),
  );
}

/* -------------------------------------------------------------------- admin */

export interface AdminConfig {
  environment?: string;
  storage_backend?: string;
  registration_open?: boolean;
  versions?: { engine?: string; algorithm?: string; decision_policy?: string; libraries?: Record<string, string> };
  limits?: Record<string, number | string | boolean | null>;
}
export interface AdminStats {
  users?: number;
  jobs_by_status?: Record<string, number>;
  evidence_bytes?: number;
  analyses?: number;
}

/** Administrator only: pass `enabled: user.role === "admin"`. */
export function useAdminConfig(enabled: boolean) {
  return useQuery({
    queryKey: qk.adminConfig,
    queryFn: () => unwrap<AdminConfig>(api.GET("/api/v1/admin/config")),
    enabled,
  });
}
export function useAdminStats(enabled: boolean) {
  return useQuery({
    queryKey: qk.adminStats,
    queryFn: () => unwrap<AdminStats>(api.GET("/api/v1/admin/stats")),
    enabled,
  });
}
